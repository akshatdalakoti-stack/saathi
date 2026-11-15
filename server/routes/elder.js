// The elder's own screen: today's doses, check-ins, help, consent decisions, voice and settings.
import express from 'express';
import * as notify from '../notify.js';
import { one, all, run, logActivity } from '../db.js';
import { requireActive, requireElder } from '../auth.js';
import { buildSlots, actOnDoses, applyChange, circle, callName, escalationOf, safeJson, refreshDoses } from '../logic.js';
import { localDate, addDays } from '../time.js';
import { voiceIntent } from '../gemini.js';
import { speechAudio } from '../tts.js';
import { routinesToday } from '../health.js';
import { languageOf } from '../../shared/languages.js';
import { saveRoutine, cleanLanguage, HttpError, streak, nextAppointments, recentMessages, pendingProposals, lowStock } from './helpers.js';

const router = express.Router();

// ================================================================ elder

router.get('/elder/home', requireElder, (req, res) => {
  const { profile, member } = req;
  refreshDoses(profile.id);
  const today = localDate();
  const slots = buildSlots(profile, today);
  let done = 0;
  let total = 0;
  for (const s of slots) for (const d of s.doses) {
    total += 1;
    if (d.status === 'taken') done += 1;
  }
  const tomorrow = buildSlots(profile, addDays(today, 1));
  res.json({
    me: { name: member.name, call_name: callName(profile), care_id: profile.care_id, language: profile.language, text_size: profile.text_size },
    now: Date.now(),
    date: today,
    slots,
    tomorrow_first: tomorrow[0] || null,
    stats: { done, total, streak: streak(profile.id) },
    proposals: pendingProposals(profile.id),
    joins: all("SELECT id, name, relation, role, created_at FROM members WHERE profile_id = ? AND status = 'pending'", profile.id),
    messages: recentMessages(profile.id, 6),
    checkin: one('SELECT * FROM checkins WHERE profile_id = ? AND date = ? ORDER BY id DESC', profile.id, today) || null,
    appointments: nextAppointments(profile.id, 2),
    low: lowStock(profile.id),
    questions: all('SELECT * FROM questions WHERE profile_id = ? AND done = 0 ORDER BY created_at', profile.id),
    circle: all("SELECT id, name, relation, role, permission, phone FROM members WHERE profile_id = ? AND status = 'active' AND role != 'elder'", profile.id),
    escalation: escalationOf(profile),
    routines: routinesToday(profile, today),
  });
});

router.post('/elder/routines/:id', requireElder, (req, res) => {
  res.json(saveRoutine(req, req.params.id));
});

router.post('/elder/doses', requireElder, async (req, res) => {
  const { profile, member } = req;
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  const action = req.body.action;
  if (!['taken', 'skipped', 'unsure', 'snooze', 'undo'].includes(action)) throw new HttpError(400, 'Unknown action.');
  const changed = actOnDoses(profile, ids, action, member.name);
  if (action === 'unsure' && changed.length > 0) {
    const doses = all(`SELECT d.*, m.name, m.strength, m.form, m.amount, m.purpose, m.category, m.pill_color, m.food FROM doses d
      JOIN medications m ON m.id = d.med_id WHERE d.id IN (${changed.map(() => '?').join(',')})`, ...changed.map((d) => d.id));
    notify.unsureDose(profile, doses, circle(profile.id, { roles: ['caretaker', 'family'] }));
  }
  res.json({ ok: true, changed: changed.length });
});

router.post('/elder/checkin', requireElder, (req, res) => {
  const { profile, member } = req;
  const mood = ['good', 'okay', 'unwell'].includes(req.body.mood) ? req.body.mood : 'okay';
  const symptoms = Array.isArray(req.body.symptoms) ? req.body.symptoms.map(String).slice(0, 8) : [];
  const today = localDate();
  run('DELETE FROM checkins WHERE profile_id = ? AND date = ?', profile.id, today);
  run('INSERT INTO checkins (profile_id, date, mood, symptoms, created_at) VALUES (?, ?, ?, ?, ?)',
    profile.id, today, mood, JSON.stringify(symptoms), Date.now());
  const moodWords = { good: 'is feeling good', okay: 'is feeling okay', unwell: `isn't feeling well${symptoms.length ? ` (${symptoms.join(', ')})` : ''}` };
  logActivity(profile.id, member.name, 'checkin', moodWords[mood]);
  if (mood === 'unwell') notify.notWell(profile, symptoms, circle(profile.id, { roles: ['caretaker', 'family'] }));
  res.json({ ok: true });
});

router.post('/elder/help', requireElder, (req, res) => {
  const { profile, member } = req;
  logActivity(profile.id, member.name, 'help', 'pressed the Help button');
  const people = circle(profile.id, { roles: ['caretaker', 'family'] });
  notify.helpRequest(profile, people);
  res.json({ ok: true, told: people.map((p) => p.name), phones: people.filter((p) => p.phone).map((p) => ({ name: p.name, phone: p.phone, relation: p.relation })) });
});

router.post('/elder/okay', requireElder, (req, res) => {
  const { profile, member } = req;
  run('INSERT INTO messages (profile_id, member_id, from_elder, text, created_at) VALUES (?, ?, 1, ?, ?)',
    profile.id, member.id, String(req.body.text || "I'm okay today").slice(0, 300), Date.now());
  logActivity(profile.id, member.name, 'okay', 'sent "I\'m okay today" to the family');
  notify.elderOkay(profile, circle(profile.id, { roles: ['caretaker', 'family'] }));
  res.json({ ok: true });
});

router.post('/elder/proposals/:id', requireElder, (req, res) => {
  const { profile, member } = req;
  const proposal = one("SELECT * FROM proposals WHERE id = ? AND profile_id = ? AND status = 'pending'", Number(req.params.id), profile.id);
  if (!proposal) throw new HttpError(404, 'That suggestion was already decided.');
  const proposer = one('SELECT * FROM members WHERE id = ?', proposal.member_id);
  const approve = !!req.body.approve;
  if (approve) {
    applyChange(profile, proposal.kind, safeJson(proposal.payload, {}), proposal.target_id, `${proposer ? proposer.name : 'Family'} (approved by ${callName(profile)})`);
  }
  run('UPDATE proposals SET status = ?, decided_at = ? WHERE id = ?', approve ? 'approved' : 'declined', Date.now(), proposal.id);
  logActivity(profile.id, member.name, 'consent', `${approve ? 'said yes to' : 'said no to'}: ${proposal.summary}`);
  if (proposer) notify.proposalDecided(profile, proposal, approve, proposer);
  res.json({ ok: true });
});

router.post('/elder/members/:id', requireElder, (req, res) => {
  const { profile, member } = req;
  const target = one("SELECT * FROM members WHERE id = ? AND profile_id = ? AND role != 'elder'", Number(req.params.id), profile.id);
  if (!target) throw new HttpError(404, 'Person not found.');
  const permission = req.body.permission;
  const words = { view: 'can see the care plan', suggest: 'can suggest changes', manage: 'can manage the care plan' };
  if (permission === 'remove') {
    run("UPDATE members SET status = 'removed' WHERE id = ?", target.id);
    run('DELETE FROM sessions WHERE member_id = ?', target.id);
    logActivity(profile.id, member.name, 'circle', target.status === 'pending' ? `didn't let ${target.name} join` : `removed ${target.name} from the circle`);
  } else if (words[permission]) {
    const wasPending = target.status === 'pending';
    run("UPDATE members SET permission = ?, status = 'active' WHERE id = ?", permission, target.id);
    logActivity(profile.id, member.name, 'circle', `${wasPending ? `let ${target.name} join. They` : `changed ${target.name}'s access. They now`} ${words[permission]}`);
  } else {
    throw new HttpError(400, 'Unknown choice.');
  }
  res.json({ ok: true });
});

router.post('/elder/messages/:id/heart', requireElder, (req, res) => {
  const { profile } = req;
  const msg = one('SELECT * FROM messages WHERE id = ? AND profile_id = ?', Number(req.params.id), profile.id);
  if (!msg) throw new HttpError(404, 'Message not found.');
  if (!msg.hearted) {
    run('UPDATE messages SET hearted = 1 WHERE id = ?', msg.id);
    const sender = one('SELECT * FROM members WHERE id = ?', msg.member_id);
    if (sender && !msg.from_elder) notify.heartMessage(profile, sender, msg.text);
  }
  res.json({ ok: true });
});

router.post('/elder/questions', requireElder, (req, res) => {
  const { profile, member } = req;
  const text = String(req.body.text || '').trim();
  if (!text) throw new HttpError(400, 'Say or type your question first.');
  run('INSERT INTO questions (profile_id, text, asked_by, created_at) VALUES (?, ?, ?, ?)', profile.id, text.slice(0, 500), member.name, Date.now());
  logActivity(profile.id, member.name, 'question', `added a question for the doctor: "${text.slice(0, 80)}"`);
  res.json({ ok: true });
});

// Spoken audio for any text, in any of Saathi's languages (used when the phone has no voice for it).
router.post('/tts', requireActive, async (req, res) => {
  const lang = languageOf(cleanLanguage(req.body.lang));
  const audio = await speechAudio(req.body.text, `${lang.english} (${lang.native})`);
  res.set('content-type', 'audio/wav').set('cache-control', 'private, max-age=86400').send(audio);
});

// Works out what the elder said, in any language.
router.post('/elder/voice', requireElder, async (req, res) => {
  const lang = languageOf(cleanLanguage(req.body.lang, req.profile.language));
  try {
    res.json({ intent: await voiceIntent(req.body.text, lang.english) });
  } catch {
    res.json({ intent: 'other' });
  }
});

router.post('/elder/settings', requireElder, (req, res) => {
  const { profile } = req;
  const language = cleanLanguage(req.body.language, profile.language);
  let size = Number(req.body.text_size);
  if (Number.isNaN(size) || size < 0 || size > 2) size = profile.text_size;
  run('UPDATE profiles SET language = ?, text_size = ? WHERE id = ?', language, size, profile.id);
  res.json({ ok: true });
});

export default router;

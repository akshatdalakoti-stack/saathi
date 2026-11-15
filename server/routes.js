// All the JSON API endpoints the React app talks to.
import express from 'express';
import { one, all, run, logActivity } from './db.js';
import {
  hashSecret, checkSecret, isLocked, recordFailure, clearFailures, startSession, endSession,
  currentUser, requireActive, requireElder, canManage, canSuggest, publicMember, randomToken,
} from './auth.js';
import {
  buildSlots, actOnDoses, insights, readMed, stockInfo, describeChange, applyChange, normalizeMed,
  normalizeAppt, circle, elderOf, callName, routineOf, escalationOf, safeJson, refreshDoses,
} from './logic.js';
import * as notify from './notify.js';
import { localDate, localTime, addDays, toMs, niceTime } from './time.js';
import { mailMode } from './mailer.js';
import { scanPrescription, checkClashes, geminiReady, voiceIntent } from './gemini.js';
import { speechAudio } from './tts.js';
import { routinesToday, recordRoutine, readings, routineAdherence, ROUTINE_KINDS, ROUTINE_LABEL, formatReading, judgeReading } from './health.js';
import { sendDigest } from './engine.js';

// Records a health task; if the number is outside the safe range, tells the circle right away.
function saveRoutine(req, routineId) {
  const { profile, member } = req;
  const result = recordRoutine(profile, routineId, req.body.value1, req.body.value2, member.name);
  if (result.judgement.level !== 'ok') {
    const label = ROUTINE_LABEL[result.routine.kind].replace(' check', '');
    const people = circle(profile.id, { roles: ['caretaker', 'family'] }).filter((m) => m.id !== member.id);
    notify.readingAlert(profile, label, result.value, result.judgement, people);
  }
  return { ok: true, value: result.value, level: result.judgement.level, text: result.judgement.text };
}

function latestReading(profileId, kind) {
  const r = one('SELECT * FROM routine_logs WHERE profile_id = ? AND kind = ? AND value1 IS NOT NULL ORDER BY created_at DESC LIMIT 1', profileId, kind);
  if (!r) return null;
  return { value: formatReading(kind, r.value1, r.value2), at: r.created_at, ...judgeReading(kind, r.value1, r.value2) };
}
import { LANGUAGE_CODES, languageOf } from '../shared/languages.js';

function cleanLanguage(code, fallback = 'en') {
  return LANGUAGE_CODES.includes(code) ? code : fallback;
}
import { DEMO_MODE, baseUrl } from './env.js';
import { tick } from './engine.js';
import { seedDemo, DEMO_CARE_ID } from './seed.js';

export const api = express.Router();

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function profileSummary(p) {
  return {
    id: p.id, care_id: p.care_id, name: p.name, call_name: p.call_name, birth_year: p.birth_year,
    language: p.language, text_size: p.text_size, conditions: p.conditions, allergies: p.allergies,
    blood_group: p.blood_group, doctor_name: p.doctor_name, doctor_phone: p.doctor_phone,
    checkin_by: p.checkin_by, routine: routineOf(p), escalation: escalationOf(p), demo_fast: !!p.demo_fast,
  };
}

function memberName(id) {
  const m = one('SELECT name FROM members WHERE id = ?', id);
  return m ? m.name : 'Someone';
}

function cleanPin(pin) {
  const text = String(pin || '').trim();
  if (!/^\d{4,6}$/.test(text)) throw new HttpError(400, 'A PIN is 4 to 6 numbers.');
  return text;
}

// Days in a row where every dose was taken. Elders like seeing a streak grow.
function streak(profileId) {
  let count = 0;
  let date = addDays(localDate(), -1);
  for (let i = 0; i < 60; i++) {
    const row = one(`SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'taken' THEN 1 ELSE 0 END) AS taken
      FROM doses WHERE profile_id = ? AND date = ? AND status != 'due'`, profileId, date);
    if (!row.total || row.taken !== row.total) break;
    count += 1;
    date = addDays(date, -1);
  }
  return count;
}

function nextAppointments(profileId, limit) {
  return all(`SELECT a.*, m.name AS companion_name FROM appointments a LEFT JOIN members m ON m.id = a.companion_id
    WHERE a.profile_id = ? AND a.status = 'upcoming' AND a.starts_at > ? ORDER BY a.starts_at LIMIT ?`,
  profileId, Date.now() - 2 * 3600 * 1000, limit);
}

function recentMessages(profileId, limit) {
  return all(`SELECT msg.*, m.name AS sender, m.relation FROM messages msg LEFT JOIN members m ON m.id = msg.member_id
    WHERE msg.profile_id = ? ORDER BY msg.created_at DESC LIMIT ?`, profileId, limit);
}

function pendingProposals(profileId) {
  return all(`SELECT p.*, m.name AS proposer, m.relation FROM proposals p JOIN members m ON m.id = p.member_id
    WHERE p.profile_id = ? AND p.status = 'pending' ORDER BY p.created_at`, profileId);
}

function lowStock(profileId) {
  const meds = all('SELECT * FROM medications WHERE profile_id = ? AND active = 1 AND stock IS NOT NULL', profileId).map(readMed);
  const out = [];
  for (const med of meds) {
    const info = stockInfo(med);
    if (info && info.low) {
      const picker = med.refill_by ? one('SELECT name FROM members WHERE id = ?', med.refill_by) : null;
      out.push({ id: med.id, name: med.name, strength: med.strength, category: med.category || 'other', refill_by: med.refill_by || null, refill_by_name: picker ? picker.name : null, ...info });
    }
  }
  return out;
}

// Managers change things directly. "Suggest" members create a proposal for the elder.
function changeOrPropose(req, kind, payload, targetId) {
  const { member, profile } = req;
  if (canManage(member)) {
    const id = applyChange(profile, kind, payload, targetId, member.name);
    return { applied: true, id };
  }
  if (!canSuggest(member)) throw new HttpError(403, `You can view ${callName(profile)}'s care, but not change it.`);
  const summary = describeChange(profile, kind, payload, targetId);
  const result = run(`INSERT INTO proposals (profile_id, member_id, kind, target_id, payload, summary, reason, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, profile.id, member.id, kind, targetId, JSON.stringify(payload), summary,
  String(payload.reason || '').trim(), Date.now());
  logActivity(profile.id, member.name, 'proposal', `suggested: ${summary}`);
  const elder = elderOf(profile.id);
  const proposal = one('SELECT * FROM proposals WHERE id = ?', Number(result.lastInsertRowid));
  if (elder) notify.proposalCreated(profile, elder, proposal, member);
  return { proposed: true, summary };
}

// ================================================================ health and auth

api.get('/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

api.get('/config', (req, res) => {
  res.json({ demo: DEMO_MODE, mail: mailMode(), ai: geminiReady() });
});

api.get('/me', (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Not logged in.' });
  res.json({ member: publicMember(user.member), profile: profileSummary(user.profile) });
});

api.post('/login/elder', (req, res) => {
  const careId = String(req.body.care_id || '').trim().toUpperCase();
  const key = `elder:${careId}`;
  if (isLocked(key)) throw new HttpError(429, 'Too many tries. Wait 5 minutes and try again.');
  const profile = one('SELECT * FROM profiles WHERE care_id = ?', careId);
  const elder = profile ? elderOf(profile.id) : null;
  if (!elder || !checkSecret(req.body.pin, elder.pin_hash)) {
    recordFailure(key);
    throw new HttpError(401, "That Care ID and PIN don't match. Try again.");
  }
  clearFailures(key);
  startSession(res, elder.id, 365);
  res.json({ ok: true, kind: 'elder' });
});

api.post('/login/member', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const key = `member:${email}`;
  if (isLocked(key)) throw new HttpError(429, 'Too many tries. Wait 5 minutes and try again.');
  const candidates = all("SELECT m.*, p.name AS profile_name, p.care_id FROM members m JOIN profiles p ON p.id = m.profile_id WHERE lower(m.email) = ? AND m.status != 'removed' AND m.role != 'elder'", email);
  const matches = candidates.filter((m) => checkSecret(req.body.pin, m.pin_hash));
  if (matches.length === 0) {
    recordFailure(key);
    throw new HttpError(401, "That email and PIN don't match. Try again.");
  }
  clearFailures(key);
  let chosen = matches[0];
  if (matches.length > 1) {
    const wanted = matches.find((m) => m.id === Number(req.body.member_id));
    if (!wanted) return res.json({ choose: matches.map((m) => ({ member_id: m.id, profile_name: m.profile_name, care_id: m.care_id })) });
    chosen = wanted;
  }
  startSession(res, chosen.id, 30);
  res.json({ ok: true, kind: 'member', pending: chosen.status === 'pending' });
});

api.post('/logout', (req, res) => {
  endSession(req, res);
  res.json({ ok: true });
});

api.post('/join', (req, res) => {
  const careId = String(req.body.care_id || '').trim().toUpperCase();
  const key = `join:${careId}`;
  if (isLocked(key)) throw new HttpError(429, 'Too many tries. Wait 5 minutes and try again.');
  const profile = one('SELECT * FROM profiles WHERE care_id = ?', careId);
  if (!profile || !checkSecret(String(req.body.passcode || '').trim(), profile.passcode_hash)) {
    recordFailure(key);
    throw new HttpError(401, "That Care ID and passcode don't match. Ask the family for the right ones.");
  }
  clearFailures(key);
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!name) throw new HttpError(400, 'Add your name.');
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, 'Add a valid email so you can get reminders.');
  const pin = cleanPin(req.body.pin);
  const role = req.body.role === 'caretaker' ? 'caretaker' : 'family';
  const existing = one("SELECT * FROM members WHERE profile_id = ? AND lower(email) = ? AND status != 'removed'", profile.id, email);
  if (existing) throw new HttpError(409, 'Someone with this email is already in the circle. Log in instead.');
  const result = run(`INSERT INTO members (profile_id, name, email, phone, relation, role, permission, status, pin_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'view', 'pending', ?, ?)`, profile.id, name, email, String(req.body.phone || '').trim(),
  String(req.body.relation || '').trim(), role, hashSecret(pin), Date.now());
  const newMember = one('SELECT * FROM members WHERE id = ?', Number(result.lastInsertRowid));
  logActivity(profile.id, name, 'join', `asked to join the care circle${newMember.relation ? ` as ${newMember.relation}` : ''}`);
  notify.joinRequest(profile, newMember, circle(profile.id, { roles: ['elder', 'caretaker', 'family'], managersOnly: true }));
  startSession(res, newMember.id, 30);
  res.json({ ok: true, pending: true, elder: callName(profile) });
});

api.post('/setup', (req, res) => {
  const elderIn = req.body.elder || {};
  const youIn = req.body.you || {};
  const self = !!req.body.self;
  const elderName = String(elderIn.name || '').trim();
  if (!elderName) throw new HttpError(400, "Add the elder's name.");
  const elderPin = cleanPin(req.body.elder_pin);
  const passcode = String(req.body.passcode || '').trim();
  if (!/^\d{6}$/.test(passcode)) throw new HttpError(400, 'The circle passcode must be 6 numbers.');
  if (!self) {
    if (!String(youIn.name || '').trim()) throw new HttpError(400, 'Add your own name.');
    if (!/^\S+@\S+\.\S+$/.test(String(youIn.email || ''))) throw new HttpError(400, 'Add your email so you get alerts.');
    cleanPin(youIn.pin);
  }
  // Care ID: first name + 4 digits, e.g. KAMLA-4821
  const base = elderName.split(/\s+/)[0].toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6) || 'SAATHI';
  let careId = '';
  for (let i = 0; i < 20; i++) {
    careId = `${base}-${Math.floor(1000 + Math.random() * 9000)}`;
    if (!one('SELECT id FROM profiles WHERE care_id = ?', careId)) break;
  }
  const now = Date.now();
  const p = run(`INSERT INTO profiles (care_id, name, call_name, birth_year, language, conditions, allergies, blood_group,
    passcode_hash, routine, card_token, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  careId, elderName, String(elderIn.call_name || '').trim() || elderName.split(/\s+/)[0], Number(elderIn.birth_year) || null,
  cleanLanguage(elderIn.language), elderIn.conditions || '', elderIn.allergies || '', elderIn.blood_group || '',
  hashSecret(passcode), JSON.stringify(elderIn.routine || {}), randomToken(12), now);
  const profileId = Number(p.lastInsertRowid);
  const e = run(`INSERT INTO members (profile_id, name, email, phone, relation, role, permission, status, pin_hash, created_at)
    VALUES (?, ?, ?, ?, 'self', 'elder', 'owner', 'active', ?, ?)`,
  profileId, elderName, String(elderIn.email || '').trim().toLowerCase(), String(elderIn.phone || '').trim(), hashSecret(elderPin), now);
  let sessionMember = Number(e.lastInsertRowid);
  logActivity(profileId, elderName, 'setup', 'Saathi was set up');
  if (!self) {
    const y = run(`INSERT INTO members (profile_id, name, email, phone, relation, role, permission, status, pin_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'manage', 'active', ?, ?)`,
    profileId, String(youIn.name).trim(), String(youIn.email).trim().toLowerCase(), String(youIn.phone || '').trim(),
    String(youIn.relation || '').trim(), youIn.role === 'caretaker' ? 'caretaker' : 'family', hashSecret(cleanPin(youIn.pin)), now);
    sessionMember = Number(y.lastInsertRowid);
    logActivity(profileId, String(youIn.name).trim(), 'setup', `set up Saathi for ${elderName} and can manage it (the elder can change this anytime)`);
  }
  startSession(res, sessionMember, self ? 365 : 30);
  res.json({ ok: true, care_id: careId, kind: self ? 'elder' : 'member' });
});

// ================================================================ demo helpers

const DEMO_PEOPLE = { elder: 'elder', ravi: 'Ravi Sharma', priya: 'Priya Nair', anjali: 'Anjali Sharma' };

api.post('/demo/login', (req, res) => {
  if (!DEMO_MODE) throw new HttpError(404, 'Demo is turned off.');
  let profile = one('SELECT * FROM profiles WHERE care_id = ?', DEMO_CARE_ID);
  if (!profile) {
    seedDemo();
    profile = one('SELECT * FROM profiles WHERE care_id = ?', DEMO_CARE_ID);
  }
  const who = DEMO_PEOPLE[req.body.as];
  if (!who) throw new HttpError(400, 'Unknown demo person.');
  const member = who === 'elder' ? elderOf(profile.id) : one('SELECT * FROM members WHERE profile_id = ? AND name = ?', profile.id, who);
  if (!member) throw new HttpError(404, 'Demo person not found. Try resetting the demo.');
  startSession(res, member.id, 7);
  res.json({ ok: true, kind: member.role === 'elder' ? 'elder' : 'member' });
});

api.post('/demo/reset', (req, res) => {
  if (!DEMO_MODE) throw new HttpError(404, 'Demo is turned off.');
  seedDemo();
  res.json({ ok: true });
});

// ================================================================ elder

api.get('/elder/home', requireElder, (req, res) => {
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

api.post('/elder/routines/:id', requireElder, (req, res) => {
  res.json(saveRoutine(req, req.params.id));
});

api.post('/elder/doses', requireElder, async (req, res) => {
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

api.post('/elder/checkin', requireElder, (req, res) => {
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

api.post('/elder/help', requireElder, (req, res) => {
  const { profile, member } = req;
  logActivity(profile.id, member.name, 'help', 'pressed the Help button');
  const people = circle(profile.id, { roles: ['caretaker', 'family'] });
  notify.helpRequest(profile, people);
  res.json({ ok: true, told: people.map((p) => p.name), phones: people.filter((p) => p.phone).map((p) => ({ name: p.name, phone: p.phone, relation: p.relation })) });
});

api.post('/elder/okay', requireElder, (req, res) => {
  const { profile, member } = req;
  run('INSERT INTO messages (profile_id, member_id, from_elder, text, created_at) VALUES (?, ?, 1, ?, ?)',
    profile.id, member.id, String(req.body.text || "I'm okay today").slice(0, 300), Date.now());
  logActivity(profile.id, member.name, 'okay', 'sent "I\'m okay today" to the family');
  notify.elderOkay(profile, circle(profile.id, { roles: ['caretaker', 'family'] }));
  res.json({ ok: true });
});

api.post('/elder/proposals/:id', requireElder, (req, res) => {
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

api.post('/elder/members/:id', requireElder, (req, res) => {
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

api.post('/elder/messages/:id/heart', requireElder, (req, res) => {
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

api.post('/elder/questions', requireElder, (req, res) => {
  const { profile, member } = req;
  const text = String(req.body.text || '').trim();
  if (!text) throw new HttpError(400, 'Say or type your question first.');
  run('INSERT INTO questions (profile_id, text, asked_by, created_at) VALUES (?, ?, ?, ?)', profile.id, text.slice(0, 500), member.name, Date.now());
  logActivity(profile.id, member.name, 'question', `added a question for the doctor: "${text.slice(0, 80)}"`);
  res.json({ ok: true });
});

// Spoken audio for any text, in any of Saathi's languages (used when the phone has no voice for it).
api.post('/tts', requireActive, async (req, res) => {
  const lang = languageOf(cleanLanguage(req.body.lang));
  const audio = await speechAudio(req.body.text, `${lang.english} (${lang.native})`);
  res.set('content-type', 'audio/wav').set('cache-control', 'private, max-age=86400').send(audio);
});

// Works out what the elder said, in any language.
api.post('/elder/voice', requireElder, async (req, res) => {
  const lang = languageOf(cleanLanguage(req.body.lang, req.profile.language));
  try {
    res.json({ intent: await voiceIntent(req.body.text, lang.english) });
  } catch {
    res.json({ intent: 'other' });
  }
});

api.post('/elder/settings', requireElder, (req, res) => {
  const { profile } = req;
  const language = cleanLanguage(req.body.language, profile.language);
  let size = Number(req.body.text_size);
  if (Number.isNaN(size) || size < 0 || size > 2) size = profile.text_size;
  run('UPDATE profiles SET language = ?, text_size = ? WHERE id = ?', language, size, profile.id);
  res.json({ ok: true });
});

// ================================================================ care circle (family and caretakers)

api.get('/care/overview', requireActive, (req, res) => {
  const { profile, member } = req;
  refreshDoses(profile.id);
  const now = Date.now();
  const today = localDate();
  const slots = buildSlots(profile, today, now);
  const steps = escalationOf(profile);
  const alerts = [];
  for (const s of slots) {
    const names = s.doses.map((d) => d.name).join(', ');
    if (s.status === 'missed') alerts.push({ level: 'red', kind: 'missed', text: `Missed the ${s.nice} medicines (${names}).` });
    if (s.status === 'unsure') alerts.push({ level: 'amber', kind: 'unsure', text: `${callName(profile)} isn't sure about the ${s.nice} medicines. Please check the pill box.`, ids: s.doses.filter((d) => d.status === 'unsure').map((d) => d.id) });
    if (s.status === 'now' && s.late_minutes >= steps.remind) alerts.push({ level: 'amber', kind: 'late', text: `The ${s.nice} medicines aren't confirmed yet (${s.late_minutes} min late).`, ids: s.doses.filter((d) => d.status === 'due').map((d) => d.id) });
  }
  const checkin = one('SELECT * FROM checkins WHERE profile_id = ? AND date = ?', profile.id, today);
  if (checkin && checkin.mood === 'unwell') {
    const symptoms = safeJson(checkin.symptoms, []);
    alerts.push({ level: 'red', kind: 'unwell', text: `${callName(profile)} isn't feeling well today${symptoms.length ? `: ${symptoms.join(', ')}` : ''}.` });
  }
  if (!checkin && localTime(now) >= (profile.checkin_by || '11:00')) {
    alerts.push({ level: 'amber', kind: 'checkin', text: `No check-in from ${callName(profile)} yet today.` });
  }
  for (const low of lowStock(profile.id)) {
    const who = low.refill_by_name ? ` ${low.refill_by_name} is picking it up.` : '';
    alerts.push({ level: low.refill_by ? 'blue' : 'amber', kind: 'refill', text: `${low.name} runs out in about ${low.daysLeft} day${low.daysLeft === 1 ? '' : 's'} (${low.runsOut}).${who}`, med_id: low.id, picked: !!low.refill_by });
  }
  const todaysReadings = all('SELECT * FROM routine_logs WHERE profile_id = ? AND date = ? AND value1 IS NOT NULL ORDER BY created_at', profile.id, today);
  for (const r of todaysReadings) {
    const j = judgeReading(r.kind, r.value1, r.value2);
    if (j.level === 'ok') continue;
    const label = ROUTINE_LABEL[r.kind].replace(' check', '');
    alerts.unshift({ level: j.level === 'danger' ? 'red' : 'amber', kind: 'reading', text: `${label} was ${formatReading(r.kind, r.value1, r.value2)} at ${niceTime(localTime(r.created_at))}, which is ${j.text}.` });
  }
  const joins = all("SELECT id, name, relation FROM members WHERE profile_id = ? AND status = 'pending'", profile.id);
  for (const j of joins) alerts.push({ level: 'blue', kind: 'join', text: `${j.name} asked to join. ${callName(profile)} will decide.` });

  const helpRecent = one("SELECT * FROM activity WHERE profile_id = ? AND kind = 'help' AND created_at > ? ORDER BY created_at DESC", profile.id, now - 6 * 3600 * 1000);
  if (helpRecent) alerts.unshift({ level: 'red', kind: 'help', text: `${callName(profile)} pressed Help at ${niceTime(localTime(helpRecent.created_at))}. Call them now.` });

  const ins = insights(profile);
  res.json({
    me: publicMember(member),
    profile: profileSummary(profile),
    now,
    date: today,
    slots,
    alerts,
    checkin: checkin || null,
    checkins: all('SELECT * FROM checkins WHERE profile_id = ? ORDER BY date DESC LIMIT 7', profile.id),
    messages: recentMessages(profile.id, 10),
    proposals: pendingProposals(profile.id),
    appointments: nextAppointments(profile.id, 3),
    week: ins.week,
    streak: streak(profile.id),
    health: {
      bp: latestReading(profile.id, 'bp'),
      sugar: latestReading(profile.id, 'sugar'),
      routines: routinesToday(profile, today),
    },
    notes: ins.notes,
    config: { mail: mailMode(), ai: geminiReady(), demo: DEMO_MODE },
  });
});

api.get('/care/insights', requireActive, (req, res) => {
  const ins = insights(req.profile);
  const moods = all('SELECT date, mood, symptoms FROM checkins WHERE profile_id = ? AND date >= ? ORDER BY date', req.profile.id, addDays(localDate(), -27));
  res.json({ ...ins, moods });
});

api.post('/care/doses', requireActive, (req, res) => {
  const { profile, member } = req;
  if (!canSuggest(member)) throw new HttpError(403, 'You can only view this care plan.');
  const action = req.body.action;
  if (!['taken', 'missed', 'skipped', 'undo'].includes(action)) throw new HttpError(400, 'Unknown action.');
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  actOnDoses(profile, ids, action, `${member.name} (checked)`);
  res.json({ ok: true });
});

api.post('/care/messages', requireActive, (req, res) => {
  const { profile, member } = req;
  const text = String(req.body.text || '').trim();
  if (!text) throw new HttpError(400, 'Write a message first.');
  run('INSERT INTO messages (profile_id, member_id, from_elder, text, created_at) VALUES (?, ?, 0, ?, ?)', profile.id, member.id, text.slice(0, 400), Date.now());
  logActivity(profile.id, member.name, 'message', `sent a note to ${callName(profile)}`);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- medicines

api.get('/care/meds', requireActive, (req, res) => {
  const routine = routineOf(req.profile);
  const meds = all('SELECT * FROM medications WHERE profile_id = ? ORDER BY active DESC, name', req.profile.id).map(readMed);
  res.json({
    routine,
    meds: meds.map((m) => ({ ...m, stock_info: stockInfo(m) })),
    can: { manage: canManage(req.member), suggest: canSuggest(req.member) },
  });
});

api.post('/care/meds', requireActive, (req, res) => {
  normalizeMed(req.body);
  res.json(changeOrPropose(req, 'med_add', req.body, null));
});

api.put('/care/meds/:id', requireActive, (req, res) => {
  res.json(changeOrPropose(req, 'med_edit', req.body, Number(req.params.id)));
});

api.delete('/care/meds/:id', requireActive, (req, res) => {
  res.json(changeOrPropose(req, 'med_stop', { reason: req.query.reason || '' }, Number(req.params.id)));
});

// Recording a refill is a practical task, not a medical decision, so anyone who can suggest can do it.
api.post('/care/meds/:id/refill', requireActive, (req, res) => {
  const { profile, member } = req;
  if (!canSuggest(member)) throw new HttpError(403, 'You can only view this care plan.');
  const med = one('SELECT * FROM medications WHERE id = ? AND profile_id = ?', Number(req.params.id), profile.id);
  if (!med) throw new HttpError(404, 'Medicine not found.');
  const stock = Number(req.body.stock);
  if (!(stock >= 0)) throw new HttpError(400, 'How many are there now?');
  run('UPDATE medications SET stock = ?, refill_alert_at = NULL, refill_by = NULL WHERE id = ?', stock, med.id);
  logActivity(profile.id, member.name, 'refill', `refilled ${med.name} (now ${stock} left)`);
  res.json({ ok: true });
});

// "I'll pick it up": one person takes the refill, so nobody buys it twice and the elder knows it's coming.
api.post('/care/meds/:id/pickup', requireActive, (req, res) => {
  const { profile, member } = req;
  const med = one('SELECT * FROM medications WHERE id = ? AND profile_id = ?', Number(req.params.id), profile.id);
  if (!med) throw new HttpError(404, 'Medicine not found.');
  run('UPDATE medications SET refill_by = ? WHERE id = ?', member.id, med.id);
  logActivity(profile.id, member.name, 'refill', `will pick up the refill of ${med.name}`);
  notify.refillPickup(profile, med, member, circle(profile.id, { roles: ['caretaker', 'family'] }).filter((m) => m.id !== member.id));
  res.json({ ok: true });
});

// ---------------------------------------------------------------- health routines and readings

api.get('/care/health', requireActive, (req, res) => {
  const { profile } = req;
  res.json({
    today: routinesToday(profile),
    routines: all('SELECT * FROM routines WHERE profile_id = ? AND active = 1 ORDER BY time', profile.id)
      .map((r) => ({ ...r, days: r.days === 'daily' ? 'daily' : safeJson(r.days, []) })),
    bp: readings(profile.id, 'bp', 30),
    sugar: readings(profile.id, 'sugar', 30),
    weight: readings(profile.id, 'weight', 60),
    adherence: routineAdherence(profile.id, 7),
    can: { manage: canManage(req.member), suggest: canSuggest(req.member) },
  });
});

api.post('/care/routines', requireActive, (req, res) => {
  const { profile, member } = req;
  if (!canSuggest(member)) throw new HttpError(403, 'You can only view this care plan.');
  const kind = ROUTINE_KINDS.includes(req.body.kind) ? req.body.kind : 'other';
  const time = /^\d{2}:\d{2}$/.test(req.body.time || '') ? req.body.time : null;
  if (!time) throw new HttpError(400, 'Pick a time.');
  const days = Array.isArray(req.body.days) && req.body.days.length && req.body.days.length < 7 ? JSON.stringify(req.body.days.map(Number)) : 'daily';
  const title = String(req.body.title || '').trim() || ROUTINE_LABEL[kind];
  run('INSERT INTO routines (profile_id, kind, title, time, days, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    profile.id, kind, title, time, days, member.name, Date.now());
  logActivity(profile.id, member.name, 'health', `added a health task: ${title} at ${niceTime(time)}`);
  res.json({ ok: true });
});

api.delete('/care/routines/:id', requireActive, (req, res) => {
  const { profile, member } = req;
  if (!canSuggest(member)) throw new HttpError(403, 'You can only view this care plan.');
  const r = one('SELECT * FROM routines WHERE id = ? AND profile_id = ?', Number(req.params.id), profile.id);
  if (!r) throw new HttpError(404, 'Not found.');
  run('UPDATE routines SET active = 0 WHERE id = ?', r.id);
  logActivity(profile.id, member.name, 'health', `removed the health task: ${r.title}`);
  res.json({ ok: true });
});

// A caretaker can record a reading they took for the elder.
api.post('/care/routines/:id/log', requireActive, (req, res) => {
  if (!canSuggest(req.member)) throw new HttpError(403, 'You can only view this care plan.');
  res.json(saveRoutine(req, req.params.id));
});

api.post('/care/scan', requireActive, async (req, res) => {
  if (!canSuggest(req.member)) throw new HttpError(403, 'You can only view this care plan.');
  const result = await scanPrescription(req.body.image);
  res.json(result);
});

api.post('/care/clashes', requireActive, async (req, res) => {
  const meds = all('SELECT * FROM medications WHERE profile_id = ? AND active = 1', req.profile.id).map(readMed);
  if (meds.length < 2) return res.json({ items: [] });
  const items = await checkClashes(meds, req.profile.allergies);
  res.json({ items });
});

// ---------------------------------------------------------------- appointments

api.get('/care/appointments', requireActive, (req, res) => {
  const { profile } = req;
  res.json({
    upcoming: nextAppointments(profile.id, 20),
    past: all(`SELECT a.*, m.name AS companion_name FROM appointments a LEFT JOIN members m ON m.id = a.companion_id
      WHERE a.profile_id = ? AND (a.status != 'upcoming' OR a.starts_at <= ?) ORDER BY a.starts_at DESC LIMIT 8`, profile.id, Date.now() - 2 * 3600 * 1000),
    members: all("SELECT id, name, relation FROM members WHERE profile_id = ? AND status = 'active' AND role != 'elder'", profile.id),
    can: { manage: canManage(req.member), suggest: canSuggest(req.member) },
  });
});

api.post('/care/appointments', requireActive, (req, res) => {
  normalizeAppt(req.body);
  res.json(changeOrPropose(req, 'appt_add', req.body, null));
});

api.put('/care/appointments/:id', requireActive, (req, res) => {
  res.json(changeOrPropose(req, 'appt_edit', req.body, Number(req.params.id)));
});

api.delete('/care/appointments/:id', requireActive, (req, res) => {
  res.json(changeOrPropose(req, 'appt_cancel', {}, Number(req.params.id)));
});

// Volunteering to go along is logistics, so anyone in the circle can do it.
api.post('/care/appointments/:id/companion', requireActive, (req, res) => {
  const { profile, member } = req;
  const appt = one('SELECT * FROM appointments WHERE id = ? AND profile_id = ?', Number(req.params.id), profile.id);
  if (!appt) throw new HttpError(404, 'Visit not found.');
  run('UPDATE appointments SET companion_id = ? WHERE id = ?', member.id, appt.id);
  logActivity(profile.id, member.name, 'appt', `will go with ${callName(profile)} to see ${appt.doctor}`);
  res.json({ ok: true });
});

// The visit sheet: everything the doctor needs on one page.
api.get('/care/visit/:id', requireActive, (req, res) => {
  const { profile } = req;
  const appt = one(`SELECT a.*, m.name AS companion_name FROM appointments a LEFT JOIN members m ON m.id = a.companion_id
    WHERE a.id = ? AND a.profile_id = ?`, Number(req.params.id), profile.id);
  if (!appt) throw new HttpError(404, 'Visit not found.');
  const last = one("SELECT starts_at FROM appointments WHERE profile_id = ? AND starts_at < ? AND status != 'cancelled' AND id != ? ORDER BY starts_at DESC", profile.id, appt.starts_at, appt.id);
  const from = last ? localDate(last.starts_at) : addDays(localDate(), -29);
  const to = localDate();
  const meds = all('SELECT * FROM medications WHERE profile_id = ? AND active = 1 ORDER BY name', profile.id).map(readMed);
  const missed = all(`SELECT d.date, d.time, m.name FROM doses d JOIN medications m ON m.id = d.med_id
    WHERE d.profile_id = ? AND d.date >= ? AND d.status IN ('missed', 'skipped') ORDER BY d.date DESC, d.time LIMIT 30`, profile.id, from);
  const checkins = all("SELECT date, mood, symptoms FROM checkins WHERE profile_id = ? AND date >= ? AND mood = 'unwell' ORDER BY date", profile.id, from);
  const ins = insights(profile);
  res.json({
    profile: profileSummary(profile),
    appt,
    since: from,
    meds,
    routine: routineOf(profile),
    adherence: (() => {
      const rows = all(`SELECT status, COUNT(*) AS n FROM doses WHERE profile_id = ? AND date >= ? AND date <= ? AND status != 'due' GROUP BY status`, profile.id, from, to);
      const c = { taken: 0, missed: 0, skipped: 0, unsure: 0 };
      for (const r of rows) c[r.status] = r.n;
      const total = c.taken + c.missed + c.skipped + c.unsure;
      return { ...c, total, pct: total ? Math.round((c.taken / total) * 100) : null };
    })(),
    patterns: ins.patterns,
    notes: ins.notes,
    missed,
    unwell: checkins.map((c) => ({ date: c.date, symptoms: safeJson(c.symptoms, []) })),
    questions: all('SELECT * FROM questions WHERE profile_id = ? AND done = 0 ORDER BY created_at', profile.id),
  });
});

// ---------------------------------------------------------------- questions for the doctor

api.get('/care/questions', requireActive, (req, res) => {
  res.json({ questions: all('SELECT * FROM questions WHERE profile_id = ? ORDER BY done, created_at DESC', req.profile.id) });
});

api.post('/care/questions', requireActive, (req, res) => {
  const { profile, member } = req;
  const text = String(req.body.text || '').trim();
  if (!text) throw new HttpError(400, 'Write the question first.');
  run('INSERT INTO questions (profile_id, text, asked_by, created_at) VALUES (?, ?, ?, ?)', profile.id, text.slice(0, 500), member.name, Date.now());
  logActivity(profile.id, member.name, 'question', `added a question for the doctor: "${text.slice(0, 80)}"`);
  res.json({ ok: true });
});

api.put('/care/questions/:id', requireActive, (req, res) => {
  run('UPDATE questions SET done = ? WHERE id = ? AND profile_id = ?', req.body.done ? 1 : 0, Number(req.params.id), req.profile.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- circle, profile and settings

api.get('/care/circle', requireActive, (req, res) => {
  const { profile, member } = req;
  res.json({
    me: publicMember(member),
    care_id: profile.care_id,
    members: all("SELECT * FROM members WHERE profile_id = ? AND status != 'removed' ORDER BY role = 'elder' DESC, status, created_at", profile.id).map(publicMember),
    can: { manage: canManage(member) },
  });
});

api.put('/care/me', requireActive, (req, res) => {
  const { member } = req;
  const name = String(req.body.name ?? member.name).trim() || member.name;
  const email = String(req.body.email ?? member.email ?? '').trim().toLowerCase();
  const phone = String(req.body.phone ?? member.phone ?? '').trim();
  const notifyOn = req.body.notify === undefined ? member.notify : (req.body.notify ? 1 : 0);
  run('UPDATE members SET name = ?, email = ?, phone = ?, notify = ? WHERE id = ?', name, email, phone, notifyOn, member.id);
  if (req.body.pin) run('UPDATE members SET pin_hash = ? WHERE id = ?', hashSecret(cleanPin(req.body.pin)), member.id);
  res.json({ ok: true });
});

api.put('/care/profile', requireActive, (req, res) => {
  const { profile, member } = req;
  if (!canManage(member)) throw new HttpError(403, `Only ${callName(profile)} or a manager can change these settings.`);
  const b = req.body;
  const routine = { ...routineOf(profile), ...(b.routine || {}) };
  const escalation = { ...safeJson(profile.escalation, {}), ...(b.escalation || {}) };
  run(`UPDATE profiles SET name = ?, call_name = ?, birth_year = ?, conditions = ?, allergies = ?, blood_group = ?,
    doctor_name = ?, doctor_phone = ?, checkin_by = ?, routine = ?, escalation = ?, language = ?, demo_fast = ? WHERE id = ?`,
  String(b.name ?? profile.name).trim() || profile.name, String(b.call_name ?? profile.call_name ?? '').trim(),
  Number(b.birth_year ?? profile.birth_year) || null, String(b.conditions ?? profile.conditions ?? ''),
  String(b.allergies ?? profile.allergies ?? ''), String(b.blood_group ?? profile.blood_group ?? ''),
  String(b.doctor_name ?? profile.doctor_name ?? ''), String(b.doctor_phone ?? profile.doctor_phone ?? ''),
  /^\d{2}:\d{2}$/.test(b.checkin_by || '') ? b.checkin_by : profile.checkin_by,
  JSON.stringify(routine), JSON.stringify(escalation), cleanLanguage(b.language, profile.language),
  b.demo_fast === undefined ? profile.demo_fast : (b.demo_fast ? 1 : 0), profile.id);
  if (b.elder_email !== undefined || b.elder_phone !== undefined) {
    const elder = elderOf(profile.id);
    if (elder) run('UPDATE members SET email = ?, phone = ? WHERE id = ?', String(b.elder_email ?? elder.email ?? '').trim().toLowerCase(), String(b.elder_phone ?? elder.phone ?? '').trim(), elder.id);
  }
  logActivity(profile.id, member.name, 'settings', 'updated the care settings');
  res.json({ ok: true });
});

api.post('/care/passcode', requireActive, (req, res) => {
  const { profile, member } = req;
  if (!canManage(member)) throw new HttpError(403, 'Only managers can change the circle passcode.');
  const passcode = String(req.body.passcode || '').trim();
  if (!/^\d{6}$/.test(passcode)) throw new HttpError(400, 'The passcode must be 6 numbers.');
  run('UPDATE profiles SET passcode_hash = ? WHERE id = ?', hashSecret(passcode), profile.id);
  logActivity(profile.id, member.name, 'circle', 'changed the circle passcode');
  res.json({ ok: true });
});

api.get('/care/card', requireActive, (req, res) => {
  let token = req.profile.card_token;
  if (!token) {
    token = randomToken(12);
    run('UPDATE profiles SET card_token = ? WHERE id = ?', token, req.profile.id);
  }
  res.json({ url: `${baseUrl()}/card/${token}` });
});

api.post('/care/card/rotate', requireActive, (req, res) => {
  if (!canManage(req.member)) throw new HttpError(403, 'Only managers can do this.');
  const token = randomToken(12);
  run('UPDATE profiles SET card_token = ? WHERE id = ?', token, req.profile.id);
  logActivity(req.profile.id, req.member.name, 'settings', 'made a new emergency card link (the old one stopped working)');
  res.json({ url: `${baseUrl()}/card/${token}` });
});

api.get('/care/activity', requireActive, (req, res) => {
  res.json({ items: all('SELECT * FROM activity WHERE profile_id = ? ORDER BY created_at DESC LIMIT 80', req.profile.id) });
});

api.get('/care/outbox', requireActive, (req, res) => {
  res.json({
    mode: mailMode(),
    items: all('SELECT id, to_email, to_name, subject, kind, status, error, created_at FROM outbox WHERE profile_id = ? ORDER BY id DESC LIMIT 60', req.profile.id),
  });
});

api.get('/care/outbox/:id', requireActive, (req, res) => {
  const mail = one('SELECT * FROM outbox WHERE id = ? AND profile_id = ?', Number(req.params.id), req.profile.id);
  if (!mail) throw new HttpError(404, 'Email not found.');
  res.json(mail);
});

// ---------------------------------------------------------------- live demo controls

api.post('/care/demo/due-now', requireActive, async (req, res) => {
  const { profile, member } = req;
  if (!DEMO_MODE) throw new HttpError(404, 'Demo is turned off.');
  const meds = all('SELECT * FROM medications WHERE profile_id = ? AND active = 1 ORDER BY id LIMIT 2', profile.id);
  if (meds.length === 0) throw new HttpError(400, 'Add a medicine first.');
  const today = localDate();
  const time = localTime();
  for (const med of meds) {
    run(`INSERT INTO doses (profile_id, med_id, date, time, due_at, upcoming_sent) VALUES (?, ?, ?, ?, ?, 1)
      ON CONFLICT(med_id, date, time) DO UPDATE SET status = 'due', level = 0, acted_at = NULL, acted_by = NULL, snooze_until = NULL`,
    profile.id, med.id, today, time, toMs(today, time));
  }
  run('UPDATE profiles SET demo_fast = 1 WHERE id = ?', profile.id);
  logActivity(profile.id, member.name, 'demo', `started a live demo: medicines due now at ${niceTime(time)}, fast reminders on`);
  res.json({ ok: true, time });
});

api.post('/care/demo/digest', requireActive, async (req, res) => {
  if (!DEMO_MODE) throw new HttpError(404, 'Demo is turned off.');
  await sendDigest(req.profile);
  res.json({ ok: true });
});

api.post('/care/demo/tick', requireActive, async (req, res) => {
  await tick();
  res.json({ ok: true });
});

// ================================================================ errors

api.use((req, res) => res.status(404).json({ error: 'Not found.' }));

// eslint-disable-next-line no-unused-vars
api.use((err, req, res, next) => {
  const status = err.status || 400;
  if (!err.status) console.error('[api]', req.method, req.path, err.message);
  res.status(status).json({ error: err.message || 'Something went wrong.' });
});

// Family and caretaker dashboard: overview, insights, marking doses and notes to the elder.
import express from 'express';
import { one, all, run, logActivity } from '../db.js';
import { requireActive, canSuggest, publicMember } from '../auth.js';
import { buildSlots, actOnDoses, insights, callName, escalationOf, safeJson, refreshDoses } from '../logic.js';
import { localDate, localTime, addDays, niceTime } from '../time.js';
import { mailMode } from '../mailer.js';
import { geminiReady } from '../gemini.js';
import { routinesToday, ROUTINE_LABEL, formatReading, judgeReading } from '../health.js';
import { DEMO_MODE } from '../env.js';
import { latestReading, HttpError, profileSummary, streak, nextAppointments, recentMessages, pendingProposals, lowStock } from './helpers.js';

const router = express.Router();

// ================================================================ care circle (family and caretakers)

router.get('/care/overview', requireActive, (req, res) => {
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

router.get('/care/insights', requireActive, (req, res) => {
  const ins = insights(req.profile);
  const moods = all('SELECT date, mood, symptoms FROM checkins WHERE profile_id = ? AND date >= ? ORDER BY date', req.profile.id, addDays(localDate(), -27));
  res.json({ ...ins, moods });
});

router.post('/care/doses', requireActive, (req, res) => {
  const { profile, member } = req;
  if (!canSuggest(member)) throw new HttpError(403, 'You can only view this care plan.');
  const action = req.body.action;
  if (!['taken', 'missed', 'skipped', 'undo'].includes(action)) throw new HttpError(400, 'Unknown action.');
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  actOnDoses(profile, ids, action, `${member.name} (checked)`);
  res.json({ ok: true });
});

router.post('/care/messages', requireActive, (req, res) => {
  const { profile, member } = req;
  const text = String(req.body.text || '').trim();
  if (!text) throw new HttpError(400, 'Write a message first.');
  run('INSERT INTO messages (profile_id, member_id, from_elder, text, created_at) VALUES (?, ?, 0, ?, ?)', profile.id, member.id, text.slice(0, 400), Date.now());
  logActivity(profile.id, member.name, 'message', `sent a note to ${callName(profile)}`);
  res.json({ ok: true });
});

export default router;

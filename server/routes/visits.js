// Doctor visits, the printable visit sheet and the questions-for-the-doctor list.
import express from 'express';
import { one, all, run, logActivity } from '../db.js';
import { requireActive, canManage, canSuggest } from '../auth.js';
import { insights, readMed, normalizeAppt, callName, routineOf, safeJson } from '../logic.js';
import { localDate, addDays } from '../time.js';
import { HttpError, profileSummary, nextAppointments, changeOrPropose } from './helpers.js';

const router = express.Router();

// ---------------------------------------------------------------- appointments

router.get('/care/appointments', requireActive, (req, res) => {
  const { profile } = req;
  res.json({
    upcoming: nextAppointments(profile.id, 20),
    past: all(`SELECT a.*, m.name AS companion_name FROM appointments a LEFT JOIN members m ON m.id = a.companion_id
      WHERE a.profile_id = ? AND (a.status != 'upcoming' OR a.starts_at <= ?) ORDER BY a.starts_at DESC LIMIT 8`, profile.id, Date.now() - 2 * 3600 * 1000),
    members: all("SELECT id, name, relation FROM members WHERE profile_id = ? AND status = 'active' AND role != 'elder'", profile.id),
    can: { manage: canManage(req.member), suggest: canSuggest(req.member) },
  });
});

router.post('/care/appointments', requireActive, (req, res) => {
  normalizeAppt(req.body);
  res.json(changeOrPropose(req, 'appt_add', req.body, null));
});

router.put('/care/appointments/:id', requireActive, (req, res) => {
  res.json(changeOrPropose(req, 'appt_edit', req.body, Number(req.params.id)));
});

router.delete('/care/appointments/:id', requireActive, (req, res) => {
  res.json(changeOrPropose(req, 'appt_cancel', {}, Number(req.params.id)));
});

// Volunteering to go along is logistics, so anyone in the circle can do it.
router.post('/care/appointments/:id/companion', requireActive, (req, res) => {
  const { profile, member } = req;
  const appt = one('SELECT * FROM appointments WHERE id = ? AND profile_id = ?', Number(req.params.id), profile.id);
  if (!appt) throw new HttpError(404, 'Visit not found.');
  run('UPDATE appointments SET companion_id = ? WHERE id = ?', member.id, appt.id);
  logActivity(profile.id, member.name, 'appt', `will go with ${callName(profile)} to see ${appt.doctor}`);
  res.json({ ok: true });
});

// The visit sheet: everything the doctor needs on one page.
router.get('/care/visit/:id', requireActive, (req, res) => {
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

router.get('/care/questions', requireActive, (req, res) => {
  res.json({ questions: all('SELECT * FROM questions WHERE profile_id = ? ORDER BY done, created_at DESC', req.profile.id) });
});

router.post('/care/questions', requireActive, (req, res) => {
  const { profile, member } = req;
  const text = String(req.body.text || '').trim();
  if (!text) throw new HttpError(400, 'Write the question first.');
  run('INSERT INTO questions (profile_id, text, asked_by, created_at) VALUES (?, ?, ?, ?)', profile.id, text.slice(0, 500), member.name, Date.now());
  logActivity(profile.id, member.name, 'question', `added a question for the doctor: "${text.slice(0, 80)}"`);
  res.json({ ok: true });
});

router.put('/care/questions/:id', requireActive, (req, res) => {
  run('UPDATE questions SET done = ? WHERE id = ? AND profile_id = ?', req.body.done ? 1 : 0, Number(req.params.id), req.profile.id);
  res.json({ ok: true });
});

export default router;

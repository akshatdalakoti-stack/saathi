// Health routines (BP, sugar, weight, walks) and readings for the charts.
import express from 'express';
import { one, all, run, logActivity } from '../db.js';
import { requireActive, canManage, canSuggest } from '../auth.js';
import { safeJson } from '../logic.js';
import { niceTime } from '../time.js';
import { routinesToday, readings, routineAdherence, ROUTINE_KINDS, ROUTINE_LABEL } from '../health.js';
import { saveRoutine, HttpError } from './helpers.js';

const router = express.Router();

// ---------------------------------------------------------------- health routines and readings

router.get('/care/health', requireActive, (req, res) => {
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

router.post('/care/routines', requireActive, (req, res) => {
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

router.delete('/care/routines/:id', requireActive, (req, res) => {
  const { profile, member } = req;
  if (!canSuggest(member)) throw new HttpError(403, 'You can only view this care plan.');
  const r = one('SELECT * FROM routines WHERE id = ? AND profile_id = ?', Number(req.params.id), profile.id);
  if (!r) throw new HttpError(404, 'Not found.');
  run('UPDATE routines SET active = 0 WHERE id = ?', r.id);
  logActivity(profile.id, member.name, 'health', `removed the health task: ${r.title}`);
  res.json({ ok: true });
});

// A caretaker can record a reading they took for the elder.
router.post('/care/routines/:id/log', requireActive, (req, res) => {
  if (!canSuggest(req.member)) throw new HttpError(403, 'You can only view this care plan.');
  res.json(saveRoutine(req, req.params.id));
});

export default router;

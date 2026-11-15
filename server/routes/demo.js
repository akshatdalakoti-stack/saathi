// Demo-only endpoints: one-click demo logins, reset, and live demo controls.
import express from 'express';
import { one, all, run, logActivity } from '../db.js';
import { startSession, requireActive } from '../auth.js';
import { elderOf } from '../logic.js';
import { localDate, localTime, toMs, niceTime } from '../time.js';
import { sendDigest, tick } from '../engine.js';
import { DEMO_MODE } from '../env.js';
import { seedDemo, DEMO_CARE_ID } from '../seed.js';
import { HttpError } from './helpers.js';

const router = express.Router();

// ================================================================ demo helpers

const DEMO_PEOPLE = { elder: 'elder', ravi: 'Ravi Sharma', priya: 'Priya Nair', anjali: 'Anjali Sharma' };

router.post('/demo/login', (req, res) => {
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

router.post('/demo/reset', requireActive, (req, res) => {
  if (!DEMO_MODE) throw new HttpError(404, 'Demo is turned off.');
  seedDemo();
  res.json({ ok: true });
});

// ---------------------------------------------------------------- live demo controls

router.post('/care/demo/due-now', requireActive, async (req, res) => {
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

router.post('/care/demo/digest', requireActive, async (req, res) => {
  if (!DEMO_MODE) throw new HttpError(404, 'Demo is turned off.');
  await sendDigest(req.profile);
  res.json({ ok: true });
});

router.post('/care/demo/tick', requireActive, async (req, res) => {
  await tick();
  res.json({ ok: true });
});

export default router;

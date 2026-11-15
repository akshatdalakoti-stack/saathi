// Medicines: list, add/edit/stop (or propose), refills, pickup, prescription scan and clash check.
import express from 'express';
import * as notify from '../notify.js';
import { one, all, run, logActivity } from '../db.js';
import { requireActive, canManage, canSuggest } from '../auth.js';
import { readMed, stockInfo, normalizeMed, circle, routineOf } from '../logic.js';
import { scanPrescription, checkClashes } from '../gemini.js';
import { HttpError, changeOrPropose } from './helpers.js';

const router = express.Router();

// ---------------------------------------------------------------- medicines

router.get('/care/meds', requireActive, (req, res) => {
  const routine = routineOf(req.profile);
  const meds = all('SELECT * FROM medications WHERE profile_id = ? ORDER BY active DESC, name', req.profile.id).map(readMed);
  res.json({
    routine,
    meds: meds.map((m) => ({ ...m, stock_info: stockInfo(m) })),
    can: { manage: canManage(req.member), suggest: canSuggest(req.member) },
  });
});

router.post('/care/meds', requireActive, (req, res) => {
  normalizeMed(req.body);
  res.json(changeOrPropose(req, 'med_add', req.body, null));
});

router.put('/care/meds/:id', requireActive, (req, res) => {
  res.json(changeOrPropose(req, 'med_edit', req.body, Number(req.params.id)));
});

router.delete('/care/meds/:id', requireActive, (req, res) => {
  res.json(changeOrPropose(req, 'med_stop', { reason: req.query.reason || '' }, Number(req.params.id)));
});

// Recording a refill is a practical task, not a medical decision, so anyone who can suggest can do it.
router.post('/care/meds/:id/refill', requireActive, (req, res) => {
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
router.post('/care/meds/:id/pickup', requireActive, (req, res) => {
  const { profile, member } = req;
  const med = one('SELECT * FROM medications WHERE id = ? AND profile_id = ?', Number(req.params.id), profile.id);
  if (!med) throw new HttpError(404, 'Medicine not found.');
  run('UPDATE medications SET refill_by = ? WHERE id = ?', member.id, med.id);
  logActivity(profile.id, member.name, 'refill', `will pick up the refill of ${med.name}`);
  notify.refillPickup(profile, med, member, circle(profile.id, { roles: ['caretaker', 'family'] }).filter((m) => m.id !== member.id));
  res.json({ ok: true });
});

router.post('/care/scan', requireActive, async (req, res) => {
  if (!canSuggest(req.member)) throw new HttpError(403, 'You can only view this care plan.');
  const result = await scanPrescription(req.body.image);
  res.json(result);
});

router.post('/care/clashes', requireActive, async (req, res) => {
  const meds = all('SELECT * FROM medications WHERE profile_id = ? AND active = 1', req.profile.id).map(readMed);
  if (meds.length < 2) return res.json({ items: [] });
  const items = await checkClashes(meds, req.profile.allergies);
  res.json({ items });
});

export default router;

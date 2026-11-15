// Care circle, profile settings, passcode, emergency card, activity log and email outbox.
import express from 'express';
import { one, all, run, logActivity } from '../db.js';
import { hashSecret, requireActive, canManage, publicMember, randomToken } from '../auth.js';
import { elderOf, callName, routineOf, safeJson } from '../logic.js';
import { mailMode } from '../mailer.js';
import { baseUrl } from '../env.js';
import { cleanLanguage, HttpError, cleanPin } from './helpers.js';

const router = express.Router();

// ---------------------------------------------------------------- circle, profile and settings

router.get('/care/circle', requireActive, (req, res) => {
  const { profile, member } = req;
  res.json({
    me: publicMember(member),
    care_id: profile.care_id,
    members: all("SELECT * FROM members WHERE profile_id = ? AND status != 'removed' ORDER BY role = 'elder' DESC, status, created_at", profile.id).map(publicMember),
    can: { manage: canManage(member) },
  });
});

router.put('/care/me', requireActive, (req, res) => {
  const { member } = req;
  const name = String(req.body.name ?? member.name).trim() || member.name;
  const email = String(req.body.email ?? member.email ?? '').trim().toLowerCase();
  const phone = String(req.body.phone ?? member.phone ?? '').trim();
  const notifyOn = req.body.notify === undefined ? member.notify : (req.body.notify ? 1 : 0);
  run('UPDATE members SET name = ?, email = ?, phone = ?, notify = ? WHERE id = ?', name, email, phone, notifyOn, member.id);
  if (req.body.pin) run('UPDATE members SET pin_hash = ? WHERE id = ?', hashSecret(cleanPin(req.body.pin)), member.id);
  res.json({ ok: true });
});

router.put('/care/profile', requireActive, (req, res) => {
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

router.post('/care/passcode', requireActive, (req, res) => {
  const { profile, member } = req;
  if (!canManage(member)) throw new HttpError(403, 'Only managers can change the circle passcode.');
  const passcode = String(req.body.passcode || '').trim();
  if (!/^\d{6}$/.test(passcode)) throw new HttpError(400, 'The passcode must be 6 numbers.');
  run('UPDATE profiles SET passcode_hash = ? WHERE id = ?', hashSecret(passcode), profile.id);
  logActivity(profile.id, member.name, 'circle', 'changed the circle passcode');
  res.json({ ok: true });
});

router.get('/care/card', requireActive, (req, res) => {
  let token = req.profile.card_token;
  if (!token) {
    token = randomToken(12);
    run('UPDATE profiles SET card_token = ? WHERE id = ?', token, req.profile.id);
  }
  res.json({ url: `${baseUrl()}/card/${token}` });
});

router.post('/care/card/rotate', requireActive, (req, res) => {
  if (!canManage(req.member)) throw new HttpError(403, 'Only managers can do this.');
  const token = randomToken(12);
  run('UPDATE profiles SET card_token = ? WHERE id = ?', token, req.profile.id);
  logActivity(req.profile.id, req.member.name, 'settings', 'made a new emergency card link (the old one stopped working)');
  res.json({ url: `${baseUrl()}/card/${token}` });
});

router.get('/care/activity', requireActive, (req, res) => {
  res.json({ items: all('SELECT * FROM activity WHERE profile_id = ? ORDER BY created_at DESC LIMIT 80', req.profile.id) });
});

router.get('/care/outbox', requireActive, (req, res) => {
  res.json({
    mode: mailMode(),
    items: all('SELECT id, to_email, to_name, subject, kind, status, error, created_at FROM outbox WHERE profile_id = ? ORDER BY id DESC LIMIT 60', req.profile.id),
  });
});

router.get('/care/outbox/:id', requireActive, (req, res) => {
  const mail = one('SELECT * FROM outbox WHERE id = ? AND profile_id = ?', Number(req.params.id), req.profile.id);
  if (!mail) throw new HttpError(404, 'Email not found.');
  res.json(mail);
});

export default router;

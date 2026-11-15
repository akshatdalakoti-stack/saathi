// Health check, config, login, logout, joining a circle and first-time setup.
import express from 'express';
import * as notify from '../notify.js';
import { one, all, run, logActivity } from '../db.js';
import { hashSecret, checkSecret, isLocked, recordFailure, clearFailures, startSession, endSession, currentUser, publicMember, randomToken } from '../auth.js';
import { circle, elderOf, callName } from '../logic.js';
import { mailMode } from '../mailer.js';
import { geminiReady } from '../gemini.js';
import { DEMO_MODE } from '../env.js';
import { cleanLanguage, HttpError, profileSummary, cleanPin } from './helpers.js';

const router = express.Router();

// ================================================================ health and auth

router.get('/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

router.get('/config', (req, res) => {
  res.json({ demo: DEMO_MODE, mail: mailMode(), ai: geminiReady() });
});

router.get('/me', (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Not logged in.' });
  res.json({ member: publicMember(user.member), profile: profileSummary(user.profile) });
});

router.post('/login/elder', (req, res) => {
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

router.post('/login/member', (req, res) => {
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

router.post('/logout', (req, res) => {
  endSession(req, res);
  res.json({ ok: true });
});

router.post('/join', (req, res) => {
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

router.post('/setup', (req, res) => {
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

export default router;

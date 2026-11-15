// Passcode-based access.
// - Every person has their own PIN (stored hashed with scrypt, never in plain text).
// - Each elder's profile has a Care ID + circle passcode. Anyone joining needs both,
//   and then the ELDER decides whether they get in and what they are allowed to do.
import crypto from 'node:crypto';
import { one, run } from './db.js';
import { IS_PROD } from './env.js';

export function hashSecret(secret) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(secret), salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

export function checkSecret(secret, stored) {
  if (!stored || secret === undefined || secret === null) return false;
  const [salt, hash] = stored.split(':');
  const attempt = crypto.scryptSync(String(secret), salt, 32);
  const real = Buffer.from(hash, 'hex');
  return real.length === attempt.length && crypto.timingSafeEqual(real, attempt);
}

export function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('hex');
}

// --- Stop people guessing PINs: 5 wrong tries locks that login for 5 minutes ---
const failures = new Map();

export function isLocked(key) {
  const entry = failures.get(key);
  return entry !== undefined && entry.lockedUntil > Date.now();
}

export function recordFailure(key) {
  const entry = failures.get(key) || { count: 0, lockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= 5) {
    entry.lockedUntil = Date.now() + 5 * 60 * 1000;
    entry.count = 0;
  }
  failures.set(key, entry);
}

export function clearFailures(key) {
  failures.delete(key);
}

// --- Sessions: a random token in an httpOnly cookie, looked up in the database ---
const COOKIE = 'saathi_session';

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function startSession(res, memberId, days) {
  const token = randomToken();
  const now = Date.now();
  const expires = now + days * 24 * 60 * 60 * 1000;
  run('INSERT INTO sessions (token, member_id, created_at, expires_at) VALUES (?, ?, ?, ?)', token, memberId, now, expires);
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD,
    maxAge: days * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

export function endSession(req, res) {
  const token = readCookie(req, COOKIE);
  if (token) run('DELETE FROM sessions WHERE token = ?', token);
  res.clearCookie(COOKIE, { path: '/' });
}

// Finds who is logged in. Returns { member, profile } or null.
export function currentUser(req) {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  const session = one('SELECT * FROM sessions WHERE token = ?', token);
  if (!session || session.expires_at < Date.now()) return null;
  const member = one('SELECT * FROM members WHERE id = ?', session.member_id);
  if (!member || member.status === 'removed') return null;
  const profile = one('SELECT * FROM profiles WHERE id = ?', member.profile_id);
  if (!profile) return null;
  return { member, profile };
}

// Route guards
export function requireActive(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Please log in again.' });
  if (user.member.status !== 'active') return res.status(403).json({ error: 'Waiting for approval.', pending: true });
  req.member = user.member;
  req.profile = user.profile;
  next();
}

export function requireElder(req, res, next) {
  requireActive(req, res, () => {
    if (req.member.role !== 'elder') return res.status(403).json({ error: 'Only the elder can do this.' });
    next();
  });
}

// Owner (the elder) and "manage" members change things directly.
// "suggest" members send proposals the elder approves. "view" members only look.
export function canManage(member) {
  return member.permission === 'owner' || member.permission === 'manage';
}
export function canSuggest(member) {
  return canManage(member) || member.permission === 'suggest';
}

// Only share what a person needs to see about another member.
export function publicMember(m) {
  return {
    id: m.id, name: m.name, email: m.email, phone: m.phone, relation: m.relation,
    role: m.role, permission: m.permission, status: m.status, notify: !!m.notify, created_at: m.created_at,
  };
}

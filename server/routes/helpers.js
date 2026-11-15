// Shared helpers for the API route modules: errors, data shaping and the
// "family proposes, elder decides" change flow.
import * as notify from '../notify.js';
import { one, all, run, logActivity } from '../db.js';
import { canManage, canSuggest } from '../auth.js';
import { readMed, stockInfo, describeChange, applyChange, circle, elderOf, callName, routineOf, escalationOf } from '../logic.js';
import { localDate, addDays } from '../time.js';
import { recordRoutine, ROUTINE_LABEL, formatReading, judgeReading } from '../health.js';
import { LANGUAGE_CODES } from '../../shared/languages.js';

// Records a health task; if the number is outside the safe range, tells the circle right away.
export function saveRoutine(req, routineId) {
  const { profile, member } = req;
  const result = recordRoutine(profile, routineId, req.body.value1, req.body.value2, member.name);
  if (result.judgement.level !== 'ok') {
    const label = ROUTINE_LABEL[result.routine.kind].replace(' check', '');
    const people = circle(profile.id, { roles: ['caretaker', 'family'] }).filter((m) => m.id !== member.id);
    notify.readingAlert(profile, label, result.value, result.judgement, people);
  }
  return { ok: true, value: result.value, level: result.judgement.level, text: result.judgement.text };
}

export function latestReading(profileId, kind) {
  const r = one('SELECT * FROM routine_logs WHERE profile_id = ? AND kind = ? AND value1 IS NOT NULL ORDER BY created_at DESC LIMIT 1', profileId, kind);
  if (!r) return null;
  return { value: formatReading(kind, r.value1, r.value2), at: r.created_at, ...judgeReading(kind, r.value1, r.value2) };
}

export function cleanLanguage(code, fallback = 'en') {
  return LANGUAGE_CODES.includes(code) ? code : fallback;
}


export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function profileSummary(p) {
  return {
    id: p.id, care_id: p.care_id, name: p.name, call_name: p.call_name, birth_year: p.birth_year,
    language: p.language, text_size: p.text_size, conditions: p.conditions, allergies: p.allergies,
    blood_group: p.blood_group, doctor_name: p.doctor_name, doctor_phone: p.doctor_phone,
    checkin_by: p.checkin_by, routine: routineOf(p), escalation: escalationOf(p), demo_fast: !!p.demo_fast,
  };
}

export function cleanPin(pin) {
  const text = String(pin || '').trim();
  if (!/^\d{4,6}$/.test(text)) throw new HttpError(400, 'A PIN is 4 to 6 numbers.');
  return text;
}

// Days in a row where every dose was taken. Elders like seeing a streak grow.
export function streak(profileId) {
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

export function nextAppointments(profileId, limit) {
  return all(`SELECT a.*, m.name AS companion_name FROM appointments a LEFT JOIN members m ON m.id = a.companion_id
    WHERE a.profile_id = ? AND a.status = 'upcoming' AND a.starts_at > ? ORDER BY a.starts_at LIMIT ?`,
  profileId, Date.now() - 2 * 3600 * 1000, limit);
}

export function recentMessages(profileId, limit) {
  return all(`SELECT msg.*, m.name AS sender, m.relation FROM messages msg LEFT JOIN members m ON m.id = msg.member_id
    WHERE msg.profile_id = ? ORDER BY msg.created_at DESC LIMIT ?`, profileId, limit);
}

export function pendingProposals(profileId) {
  return all(`SELECT p.*, m.name AS proposer, m.relation FROM proposals p JOIN members m ON m.id = p.member_id
    WHERE p.profile_id = ? AND p.status = 'pending' ORDER BY p.created_at`, profileId);
}

export function lowStock(profileId) {
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
export function changeOrPropose(req, kind, payload, targetId) {
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

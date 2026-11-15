// Healthcare routines beyond medicines: BP and sugar checks, weight, walks, water.
// The elder taps "done" or types the number on a big keypad. Numbers outside a safe
// range are flagged and the family is told straight away.
import { one, all, run, logActivity } from './db.js';
import { localDate, toMs, weekday, partOfDay, niceTime, addDays } from './time.js';
import { safeJson } from './logic.js';

export const ROUTINE_KINDS = ['bp', 'sugar', 'weight', 'walk', 'exercise', 'water', 'other'];
export const ROUTINE_EMOJI = { bp: '🩺', sugar: '🩸', weight: '⚖️', walk: '🚶', exercise: '🧘', water: '💧', other: '✅' };
export const ROUTINE_LABEL = { bp: 'BP check', sugar: 'Sugar check', weight: 'Weight check', walk: 'Walk', exercise: 'Exercise', water: 'Water', other: 'Health task' };
export const NEEDS_NUMBER = { bp: 2, sugar: 1, weight: 1 };

function runsOn(routine, dateStr) {
  if (!routine.active) return false;
  if (!routine.days || routine.days === 'daily') return true;
  return safeJson(routine.days, []).includes(weekday(dateStr));
}

export function formatReading(kind, v1, v2) {
  if (v1 === null || v1 === undefined) return '';
  if (kind === 'bp') return `${Math.round(v1)}/${Math.round(v2)} mmHg`;
  if (kind === 'sugar') return `${Math.round(v1)} mg/dL`;
  if (kind === 'weight') return `${Number(v1).toFixed(1)} kg`;
  return String(v1);
}

// Simple, widely used home-monitoring cut-offs. Not a diagnosis: it decides whom to tell.
export function judgeReading(kind, v1, v2) {
  if (kind === 'bp') {
    if (v1 >= 180 || v2 >= 110) return { level: 'danger', text: 'very high' };
    if (v1 < 90 || v2 < 60) return { level: 'low', text: 'low' };
    if (v1 >= 140 || v2 >= 90) return { level: 'high', text: 'high' };
    return { level: 'ok', text: 'normal' };
  }
  if (kind === 'sugar') {
    if (v1 < 54) return { level: 'danger', text: 'very low' };
    if (v1 >= 300) return { level: 'danger', text: 'very high' };
    if (v1 < 70) return { level: 'low', text: 'low' };
    if (v1 >= 180) return { level: 'high', text: 'high' };
    return { level: 'ok', text: 'normal' };
  }
  return { level: 'ok', text: '' };
}

function lastReading(profileId, kind) {
  return one(`SELECT * FROM routine_logs WHERE profile_id = ? AND kind = ? AND value1 IS NOT NULL
    ORDER BY created_at DESC LIMIT 1`, profileId, kind) || null;
}

// Today's routines with whether each one is done yet.
export function routinesToday(profile, dateStr = localDate()) {
  const list = all('SELECT * FROM routines WHERE profile_id = ? AND active = 1 ORDER BY time', profile.id);
  const out = [];
  for (const r of list) {
    if (!runsOn(r, dateStr)) continue;
    const log = one('SELECT * FROM routine_logs WHERE routine_id = ? AND date = ? ORDER BY id DESC', r.id, dateStr);
    const last = NEEDS_NUMBER[r.kind] ? lastReading(profile.id, r.kind) : null;
    out.push({
      id: r.id, kind: r.kind, title: r.title, time: r.time, nice: niceTime(r.time), part: partOfDay(r.time),
      due_at: toMs(dateStr, r.time), emoji: ROUTINE_EMOJI[r.kind], numbers: NEEDS_NUMBER[r.kind] || 0,
      done: log ? { at: log.created_at, value: formatReading(r.kind, log.value1, log.value2), by: log.by } : null,
      last: last ? { value: formatReading(r.kind, last.value1, last.value2), at: last.created_at } : null,
    });
  }
  return out;
}

export function recordRoutine(profile, routineId, v1, v2, by) {
  const routine = one('SELECT * FROM routines WHERE id = ? AND profile_id = ?', Number(routineId), profile.id);
  if (!routine) throw new Error('That health task no longer exists.');
  const n1 = v1 === '' || v1 === null || v1 === undefined ? null : Number(v1);
  const n2 = v2 === '' || v2 === null || v2 === undefined ? null : Number(v2);
  if (n1 !== null && !(n1 > 0 && n1 < 1000)) throw new Error('That number looks wrong. Try again.');
  if (routine.kind === 'bp' && n1 !== null && !(n2 > 0 && n2 < 300)) throw new Error('BP needs both numbers.');
  run(`INSERT INTO routine_logs (profile_id, routine_id, kind, date, value1, value2, by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, profile.id, routine.id, routine.kind, localDate(), n1, n2, by, Date.now());
  const judgement = n1 === null ? { level: 'ok', text: '' } : judgeReading(routine.kind, n1, n2);
  const value = formatReading(routine.kind, n1, n2);
  logActivity(profile.id, by, 'health', n1 === null
    ? `did "${routine.title || ROUTINE_LABEL[routine.kind]}"`
    : `recorded ${ROUTINE_LABEL[routine.kind].replace(' check', '')} ${value}${judgement.level !== 'ok' ? ` (${judgement.text})` : ''}`);
  return { routine, value, judgement };
}

// Readings for charts: one point per log, oldest first.
export function readings(profileId, kind, days = 30) {
  return all(`SELECT date, value1, value2, created_at FROM routine_logs
    WHERE profile_id = ? AND kind = ? AND value1 IS NOT NULL AND date >= ? ORDER BY created_at`,
  profileId, kind, addDays(localDate(), -(days - 1))).map((r) => ({ ...r, ...judgeReading(kind, r.value1, r.value2) }));
}

export function routineAdherence(profileId, days = 7) {
  const list = all('SELECT * FROM routines WHERE profile_id = ? AND active = 1', profileId);
  let planned = 0;
  let done = 0;
  for (let i = 1; i <= days; i++) {
    const date = addDays(localDate(), -i);
    for (const r of list) {
      if (!runsOn(r, date)) continue;
      planned += 1;
      if (one('SELECT id FROM routine_logs WHERE routine_id = ? AND date = ?', r.id, date)) done += 1;
    }
  }
  return { planned, done, pct: planned ? Math.round((done / planned) * 100) : null };
}

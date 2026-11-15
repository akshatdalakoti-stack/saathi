// The heart of Saathi: medicines, doses, adherence and the
// "family proposes, elder decides" change flow.
import { one, all, run, transaction, logActivity } from './db.js';
import {
  localDate, toMs, addDays, weekday, partOfDay, routineLabel, routineText,
  niceTime, niceDateTime, DEFAULT_ROUTINE,
} from './time.js';
import { CATEGORY_KEYS, guessCategory, categoryOf } from '../shared/categories.js';

export function safeJson(text, fallback) {
  try {
    return text ? JSON.parse(text) : fallback;
  } catch {
    return fallback;
  }
}

export function routineOf(profile) {
  return { ...DEFAULT_ROUTINE, ...safeJson(profile.routine, {}) };
}

// How long to wait (in minutes) before each escalation step.
// remind = nudge the elder, caretaker = tell the caretaker, family = mark missed and tell everyone.
export function escalationOf(profile) {
  if (profile.demo_fast) return { lead: 1, remind: 1, caretaker: 2, family: 3, snooze: 1 };
  const saved = safeJson(profile.escalation, {});
  return { lead: 10, remind: 30, caretaker: 60, family: 120, snooze: 15, ...saved };
}

export function callName(profile) {
  return profile.call_name || profile.name;
}

// ---------------------------------------------------------------- medicines

export function readMed(row) {
  if (!row) return null;
  let days = 'daily';
  if (row.days && row.days !== 'daily') days = safeJson(row.days, 'daily');
  return { ...row, times: safeJson(row.times, []), days, critical: !!row.critical, active: !!row.active };
}

export function medRunsOn(med, dateStr) {
  if (!med.active) return false;
  if (med.start_date && dateStr < med.start_date) return false;
  if (med.end_date && dateStr > med.end_date) return false;
  if (med.days === 'daily') return true;
  return med.days.includes(weekday(dateStr));
}

export function foodText(food) {
  const words = { before: 'before food', after: 'after food', with: 'with food', empty: 'on an empty stomach', any: 'with or without food' };
  return words[food] || '';
}

export function amountText(amount, form) {
  const n = Number(amount || 1);
  const unit = {
    tablet: n === 1 ? 'tablet' : 'tablets',
    capsule: n === 1 ? 'capsule' : 'capsules',
    syrup: 'ml',
    injection: n === 1 ? 'injection' : 'injections',
    drops: n === 1 ? 'drop' : 'drops',
    inhaler: n === 1 ? 'puff' : 'puffs',
  }[form] || (n === 1 ? 'dose' : 'doses');
  const shown = n === 0.5 ? 'half' : String(n);
  return `${shown} ${unit}`;
}

// Cleans up a medicine sent from a form or from the prescription scanner.
export function normalizeMed(p) {
  const name = String(p.name || '').trim();
  if (!name) throw new Error('Give the medicine a name.');
  let times = Array.isArray(p.times) ? p.times : [];
  times = times.map((t) => String(t).trim()).filter((t) => /^\d{2}:\d{2}$/.test(t));
  times = [...new Set(times)].sort();
  if (times.length === 0) throw new Error('Pick at least one time of day.');
  let days = 'daily';
  if (Array.isArray(p.days) && p.days.length > 0 && p.days.length < 7) days = p.days.map(Number);
  const amount = Number(p.amount) > 0 ? Number(p.amount) : 1;
  let stock = null;
  if (p.stock !== null && p.stock !== undefined && p.stock !== '') stock = Math.max(0, Number(p.stock));
  const purpose = String(p.purpose || '').trim();
  const category = CATEGORY_KEYS.includes(p.category) ? p.category : guessCategory(name, purpose);
  return {
    name,
    strength: String(p.strength || '').trim(),
    form: p.form || 'tablet',
    amount,
    purpose,
    category,
    pill_color: p.pill_color || 'white',
    pill_shape: p.pill_shape || 'round',
    food: p.food || 'any',
    times,
    days,
    start_date: p.start_date || null,
    end_date: p.end_date || null,
    stock,
    refill_at_days: Number(p.refill_at_days) > 0 ? Number(p.refill_at_days) : 5,
    critical: !!p.critical,
    notes: String(p.notes || '').trim(),
  };
}

export function stockInfo(med) {
  if (med.stock === null || med.stock === undefined) return null;
  let perDay = med.times.length * (med.amount || 1);
  if (med.days !== 'daily') perDay = (perDay * med.days.length) / 7;
  if (perDay <= 0) return null;
  const daysLeft = Math.floor(med.stock / perDay);
  return {
    stock: med.stock,
    perDay,
    daysLeft,
    runsOut: addDays(localDate(), daysLeft),
    low: daysLeft <= (med.refill_at_days || 5),
  };
}

// ---------------------------------------------------------------- doses

// Creates the individual dose rows for one day, based on each medicine's schedule.
export function materializeDoses(profileId, dateStr) {
  const meds = all('SELECT * FROM medications WHERE profile_id = ? AND active = 1', profileId).map(readMed);
  for (const med of meds) {
    if (!medRunsOn(med, dateStr)) continue;
    for (const time of med.times) {
      run('INSERT OR IGNORE INTO doses (profile_id, med_id, date, time, due_at) VALUES (?, ?, ?, ?, ?)',
        profileId, med.id, dateStr, time, toMs(dateStr, time));
    }
  }
}

export function refreshDoses(profileId) {
  const today = localDate();
  materializeDoses(profileId, today);
  materializeDoses(profileId, addDays(today, 1));
}

// After a medicine is edited or stopped, forget its future doses so they get rebuilt.
function clearFutureDoses(medId) {
  run("DELETE FROM doses WHERE med_id = ? AND status = 'due' AND due_at > ?", medId, Date.now());
}

function slotStatus(slot, now) {
  const open = slot.doses.filter((d) => d.status === 'due');
  if (open.length === 0) {
    const statuses = slot.doses.map((d) => d.status);
    if (statuses.includes('unsure')) return 'unsure';
    if (statuses.includes('missed')) return 'missed';
    if (statuses.every((s) => s === 'skipped')) return 'skipped';
    return 'done';
  }
  let snoozedUntil = 0;
  for (const d of open) if (d.snooze_until && d.snooze_until > snoozedUntil) snoozedUntil = d.snooze_until;
  if (snoozedUntil > now) return 'snoozed';
  if (slot.due_at <= now) return 'now';
  return 'later';
}

// Groups one day's doses by time, like the compartments of a pill box.
export function buildSlots(profile, dateStr, now = Date.now()) {
  const routine = routineOf(profile);
  const rows = all(`
    SELECT d.*, m.name, m.strength, m.form, m.amount, m.purpose, m.category, m.pill_color, m.pill_shape, m.food, m.critical, m.notes
    FROM doses d JOIN medications m ON m.id = d.med_id
    WHERE d.profile_id = ? AND d.date = ?
    ORDER BY d.due_at, m.name`, profile.id, dateStr);
  const slots = [];
  const byTime = new Map();
  for (const r of rows) {
    let slot = byTime.get(r.time);
    if (!slot) {
      const { anchor, rel } = routineLabel(r.time, routine);
      slot = {
        time: r.time, nice: niceTime(r.time), due_at: r.due_at, part: partOfDay(r.time),
        anchor, rel, label: routineText(r.time, routine), doses: [],
      };
      byTime.set(r.time, slot);
      slots.push(slot);
    }
    slot.doses.push({
      id: r.id, med_id: r.med_id, name: r.name, strength: r.strength, form: r.form, amount: r.amount,
      amount_text: amountText(r.amount, r.form), purpose: r.purpose, category: r.category || 'other', pill_color: r.pill_color,
      pill_shape: r.pill_shape, food: r.food, food_text: foodText(r.food), critical: !!r.critical,
      notes: r.notes, status: r.status, acted_at: r.acted_at, acted_by: r.acted_by,
      snooze_until: r.snooze_until, level: r.level,
    });
  }
  for (const slot of slots) {
    slot.status = slotStatus(slot, now);
    slot.late_minutes = slot.status === 'now' ? Math.floor((now - slot.due_at) / 60000) : 0;
    const acted = slot.doses.filter((d) => d.acted_at).map((d) => d.acted_at);
    slot.acted_at = acted.length ? Math.max(...acted) : null;
    slot.acted_by = slot.doses.find((d) => d.acted_by)?.acted_by || null;
  }
  return slots;
}

export function actOnDoses(profile, doseIds, action, actorName) {
  const now = Date.now();
  const snoozeMs = escalationOf(profile).snooze * 60 * 1000;
  const changed = [];
  transaction(() => {
    for (const id of doseIds) {
      const dose = one('SELECT * FROM doses WHERE id = ? AND profile_id = ?', Number(id), profile.id);
      if (!dose) continue;
      const med = one('SELECT * FROM medications WHERE id = ?', dose.med_id);
      const hasStock = med && med.stock !== null;
      const amount = (med && med.amount) || 1;

      if (action === 'taken') {
        if (dose.status === 'taken') continue;
        run("UPDATE doses SET status = 'taken', acted_at = ?, acted_by = ? WHERE id = ?", now, actorName, dose.id);
        if (hasStock) run('UPDATE medications SET stock = MAX(0, stock - ?) WHERE id = ?', amount, med.id);
      } else if (action === 'skipped' || action === 'unsure' || action === 'missed') {
        if (dose.status === 'taken' && hasStock) run('UPDATE medications SET stock = stock + ? WHERE id = ?', amount, med.id);
        run('UPDATE doses SET status = ?, acted_at = ?, acted_by = ? WHERE id = ?', action, now, actorName, dose.id);
      } else if (action === 'snooze') {
        run('UPDATE doses SET snooze_until = ? WHERE id = ?', now + snoozeMs, dose.id);
      } else if (action === 'undo') {
        if (dose.status === 'taken' && hasStock) run('UPDATE medications SET stock = stock + ? WHERE id = ?', amount, med.id);
        run("UPDATE doses SET status = 'due', acted_at = NULL, acted_by = NULL WHERE id = ?", dose.id);
      } else {
        throw new Error('Unknown action.');
      }
      changed.push({ ...dose, med_name: med ? med.name : '' });
    }
  });
  if (changed.length > 0) {
    const names = changed.map((d) => d.med_name).join(', ');
    const when = niceTime(changed[0].time);
    const verbs = {
      taken: `marked ${when} medicines as taken`, skipped: `skipped ${when} medicines`,
      unsure: `isn't sure about ${when} medicines`, missed: `marked ${when} medicines as missed`,
      snooze: `asked to be reminded again about ${when} medicines`, undo: `undid the mark on ${when} medicines`,
    };
    logActivity(profile.id, actorName, 'dose', `${verbs[action]} (${names})`);
  }
  return changed;
}

// ---------------------------------------------------------------- adherence

export function adherence(profileId, fromDate, toDate) {
  const rows = all(`SELECT status, COUNT(*) AS n FROM doses
    WHERE profile_id = ? AND date >= ? AND date <= ? AND status != 'due' GROUP BY status`, profileId, fromDate, toDate);
  const counts = { taken: 0, missed: 0, skipped: 0, unsure: 0 };
  for (const r of rows) counts[r.status] = r.n;
  const total = counts.taken + counts.missed + counts.skipped + counts.unsure;
  return { ...counts, total, pct: total ? Math.round((counts.taken / total) * 100) : null };
}

export function insights(profile) {
  const today = localDate();
  const week = adherence(profile.id, addDays(today, -6), today);
  const prevWeek = adherence(profile.id, addDays(today, -13), addDays(today, -7));
  const month = adherence(profile.id, addDays(today, -29), today);

  // Day-by-day grid for the last 28 days.
  const heatmap = [];
  for (let i = 27; i >= 0; i--) {
    const date = addDays(today, -i);
    const a = adherence(profile.id, date, date);
    heatmap.push({ date, taken: a.taken, total: a.total, pct: a.pct });
  }

  // Which part of the day gets missed most?
  const rows = all(`SELECT time, date, status FROM doses
    WHERE profile_id = ? AND date >= ? AND date <= ? AND status != 'due'`, profile.id, addDays(today, -29), today);
  const parts = {};
  for (const part of ['morning', 'afternoon', 'evening', 'night']) parts[part] = { part, taken: 0, total: 0, weekendMisses: 0, misses: 0 };
  for (const r of rows) {
    const p = parts[partOfDay(r.time)];
    p.total += 1;
    if (r.status === 'taken') p.taken += 1;
    if (r.status === 'missed' || r.status === 'skipped') {
      p.misses += 1;
      const wd = weekday(r.date);
      if (wd === 0 || wd === 6) p.weekendMisses += 1;
    }
  }
  const patterns = Object.values(parts).map((p) => ({ ...p, pct: p.total ? Math.round((p.taken / p.total) * 100) : null }));

  const notes = [];
  if (week.pct !== null && prevWeek.pct !== null) {
    const diff = week.pct - prevWeek.pct;
    if (diff > 0) notes.push(`This week ${week.pct}% of doses were taken, up from ${prevWeek.pct}% last week.`);
    else if (diff < 0) notes.push(`This week ${week.pct}% of doses were taken, down from ${prevWeek.pct}% last week.`);
    else notes.push(`This week ${week.pct}% of doses were taken, the same as last week.`);
  }
  const worst = [...patterns].filter((p) => p.misses > 0).sort((a, b) => b.misses - a.misses)[0];
  if (worst) {
    let line = `${worst.part[0].toUpperCase()}${worst.part.slice(1)} doses are missed most often (${worst.misses} in the last 30 days)`;
    if (worst.weekendMisses >= Math.ceil(worst.misses / 2) && worst.misses >= 2) line += `, mostly on weekends`;
    notes.push(`${line}. A family call around that time could help.`);
  }
  const notWell = all(`SELECT symptoms FROM checkins WHERE profile_id = ? AND date >= ? AND mood = 'unwell'`, profile.id, addDays(today, -13));
  if (notWell.length > 0) {
    const symptomCounts = {};
    for (const c of notWell) for (const s of safeJson(c.symptoms, [])) symptomCounts[s] = (symptomCounts[s] || 0) + 1;
    const top = Object.entries(symptomCounts).sort((a, b) => b[1] - a[1])[0];
    notes.push(`Felt unwell on ${notWell.length} day${notWell.length > 1 ? 's' : ''} in the last 2 weeks${top ? ` (most often: ${top[0]})` : ''}. Worth raising at the next doctor visit.`);
  }
  return { week, prevWeek, month, heatmap, patterns, notes };
}

// ---------------------------------------------------------------- appointments

export function normalizeAppt(p) {
  const doctor = String(p.doctor || '').trim();
  if (!doctor) throw new Error("Add the doctor's name.");
  let startsAt = Number(p.starts_at);
  if (p.date && p.time) startsAt = toMs(p.date, p.time);
  if (!startsAt || Number.isNaN(startsAt)) throw new Error('Pick a date and time for the visit.');
  return {
    doctor,
    specialty: String(p.specialty || '').trim(),
    place: String(p.place || '').trim(),
    starts_at: startsAt,
    purpose: String(p.purpose || '').trim(),
    companion_id: p.companion_id ? Number(p.companion_id) : null,
    notes: String(p.notes || '').trim(),
  };
}

// ---------------------------------------------------------------- changes and proposals

function medSummary(m) {
  const times = m.times.map(niceTime).join(' and ');
  return `${m.name}${m.strength ? ' ' + m.strength : ''} (${categoryOf(m.category).label.toLowerCase()}), ${amountText(m.amount, m.form)} at ${times}`;
}

function medDiff(old, m) {
  const parts = [];
  if (old.times.join() !== m.times.join()) parts.push(`move it from ${old.times.map(niceTime).join(' and ')} to ${m.times.map(niceTime).join(' and ')}`);
  if (Number(old.amount) !== Number(m.amount)) parts.push(`change the dose from ${amountText(old.amount, old.form)} to ${amountText(m.amount, m.form)}`);
  if ((old.strength || '') !== m.strength) parts.push(`change the strength to ${m.strength || 'not set'}`);
  if (old.name !== m.name) parts.push(`rename it to ${m.name}`);
  if (old.food !== m.food) parts.push(`take it ${foodText(m.food)}`);
  if ((old.purpose || '') !== m.purpose) parts.push(`note it is ${m.purpose || 'for (not set)'}`);
  if ((old.category || 'other') !== m.category) parts.push(`call it "${categoryOf(m.category).label.toLowerCase()}"`);
  if ((old.stock ?? null) !== m.stock) parts.push(`set pills left to ${m.stock ?? 'not tracked'}`);
  if (!!old.critical !== m.critical) parts.push(m.critical ? 'mark it as critical' : 'mark it as not critical');
  if ((old.notes || '') !== m.notes) parts.push('update the notes');
  return parts.length ? parts.join(', ') : 'update its details';
}

// A plain-language sentence for the elder to read before saying yes or no.
export function describeChange(profile, kind, payload, targetId) {
  if (kind === 'med_add') return `Start a new medicine: ${medSummary(normalizeMed(payload))}`;
  if (kind === 'med_edit' || kind === 'med_stop') {
    const old = readMed(one('SELECT * FROM medications WHERE id = ? AND profile_id = ?', targetId, profile.id));
    if (!old) throw new Error('That medicine no longer exists.');
    if (kind === 'med_stop') return `Stop taking ${old.name}${old.strength ? ' ' + old.strength : ''}`;
    const m = normalizeMed({ ...old, ...payload });
    return `${old.name}${old.strength ? ' ' + old.strength : ''}: ${medDiff(old, m)}`;
  }
  if (kind === 'appt_add') {
    const a = normalizeAppt(payload);
    return `Add a doctor visit with ${a.doctor}${a.specialty ? ` (${a.specialty})` : ''} on ${niceDateTime(a.starts_at)}`;
  }
  if (kind === 'appt_edit' || kind === 'appt_cancel') {
    const old = one('SELECT * FROM appointments WHERE id = ? AND profile_id = ?', targetId, profile.id);
    if (!old) throw new Error('That visit no longer exists.');
    if (kind === 'appt_cancel') return `Cancel the visit with ${old.doctor} on ${niceDateTime(old.starts_at)}`;
    const a = normalizeAppt({ ...old, ...payload });
    if (a.starts_at !== old.starts_at) return `Move the visit with ${old.doctor} to ${niceDateTime(a.starts_at)}`;
    return `Update the details of the visit with ${old.doctor}`;
  }
  throw new Error('Unknown change.');
}

// Actually makes a change. Used directly by managers, or after the elder approves a proposal.
export function applyChange(profile, kind, payload, targetId, actorName) {
  const now = Date.now();
  if (kind === 'med_add') {
    const m = normalizeMed(payload);
    const result = run(`INSERT INTO medications
      (profile_id, name, strength, form, amount, purpose, category, pill_color, pill_shape, food, times, days,
       start_date, end_date, stock, refill_at_days, critical, notes, active, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      profile.id, m.name, m.strength, m.form, m.amount, m.purpose, m.category, m.pill_color, m.pill_shape, m.food,
      JSON.stringify(m.times), m.days === 'daily' ? 'daily' : JSON.stringify(m.days),
      m.start_date, m.end_date, m.stock, m.refill_at_days, m.critical, m.notes, actorName, now, now);
    refreshDoses(profile.id);
    logActivity(profile.id, actorName, 'med', `added ${medSummary(m)}`);
    return Number(result.lastInsertRowid);
  }
  if (kind === 'med_edit') {
    const old = readMed(one('SELECT * FROM medications WHERE id = ? AND profile_id = ?', targetId, profile.id));
    if (!old) throw new Error('That medicine no longer exists.');
    const m = normalizeMed({ ...old, ...payload });
    run(`UPDATE medications SET name = ?, strength = ?, form = ?, amount = ?, purpose = ?, category = ?, pill_color = ?, pill_shape = ?,
      food = ?, times = ?, days = ?, start_date = ?, end_date = ?, stock = ?, refill_at_days = ?, critical = ?, notes = ?,
      updated_at = ? WHERE id = ?`,
      m.name, m.strength, m.form, m.amount, m.purpose, m.category, m.pill_color, m.pill_shape, m.food,
      JSON.stringify(m.times), m.days === 'daily' ? 'daily' : JSON.stringify(m.days),
      m.start_date, m.end_date, m.stock, m.refill_at_days, m.critical, m.notes, now, old.id);
    if (m.stock !== old.stock) run('UPDATE medications SET refill_alert_at = NULL WHERE id = ?', old.id);
    clearFutureDoses(old.id);
    refreshDoses(profile.id);
    logActivity(profile.id, actorName, 'med', `changed ${old.name}: ${medDiff(old, m)}`);
    return old.id;
  }
  if (kind === 'med_stop') {
    const old = one('SELECT * FROM medications WHERE id = ? AND profile_id = ?', targetId, profile.id);
    if (!old) throw new Error('That medicine no longer exists.');
    run('UPDATE medications SET active = 0, updated_at = ? WHERE id = ?', now, old.id);
    clearFutureDoses(old.id);
    logActivity(profile.id, actorName, 'med', `stopped ${old.name}`);
    return old.id;
  }
  if (kind === 'appt_add') {
    const a = normalizeAppt(payload);
    const result = run(`INSERT INTO appointments (profile_id, doctor, specialty, place, starts_at, purpose, companion_id, notes, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      profile.id, a.doctor, a.specialty, a.place, a.starts_at, a.purpose, a.companion_id, a.notes, actorName, now);
    logActivity(profile.id, actorName, 'appt', `added a visit with ${a.doctor} on ${niceDateTime(a.starts_at)}`);
    return Number(result.lastInsertRowid);
  }
  if (kind === 'appt_edit') {
    const old = one('SELECT * FROM appointments WHERE id = ? AND profile_id = ?', targetId, profile.id);
    if (!old) throw new Error('That visit no longer exists.');
    const a = normalizeAppt({ ...old, ...payload });
    const moved = a.starts_at !== old.starts_at;
    run(`UPDATE appointments SET doctor = ?, specialty = ?, place = ?, starts_at = ?, purpose = ?, companion_id = ?, notes = ?,
      sent_day = ?, sent_soon = ? WHERE id = ?`,
      a.doctor, a.specialty, a.place, a.starts_at, a.purpose, a.companion_id, a.notes,
      moved ? 0 : old.sent_day, moved ? 0 : old.sent_soon, old.id);
    logActivity(profile.id, actorName, 'appt', moved ? `moved the visit with ${a.doctor} to ${niceDateTime(a.starts_at)}` : `updated the visit with ${a.doctor}`);
    return old.id;
  }
  if (kind === 'appt_cancel') {
    const old = one('SELECT * FROM appointments WHERE id = ? AND profile_id = ?', targetId, profile.id);
    if (!old) throw new Error('That visit no longer exists.');
    run("UPDATE appointments SET status = 'cancelled' WHERE id = ?", old.id);
    logActivity(profile.id, actorName, 'appt', `cancelled the visit with ${old.doctor}`);
    return old.id;
  }
  throw new Error('Unknown change.');
}

// ---------------------------------------------------------------- people

// Everyone in the circle who should get an email, filtered by role.
export function circle(profileId, { roles = ['caretaker', 'family', 'elder'], excludeId = null, managersOnly = false } = {}) {
  const members = all("SELECT * FROM members WHERE profile_id = ? AND status = 'active'", profileId);
  return members.filter((m) => {
    if (!roles.includes(m.role)) return false;
    if (excludeId && m.id === excludeId) return false;
    if (managersOnly && !(m.permission === 'owner' || m.permission === 'manage')) return false;
    return true;
  });
}

export function elderOf(profileId) {
  return one("SELECT * FROM members WHERE profile_id = ? AND role = 'elder' AND status != 'removed'", profileId);
}

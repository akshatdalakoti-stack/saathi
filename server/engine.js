// The reminder engine. Every 20 seconds it looks at every elder's profile and decides
// whether anyone needs an email. Missed doses climb an "escalation ladder":
//
//   due time - 10 min : "your medicines are coming up"           -> elder
//   due time + 30 min : "did you take them?" with one-tap buttons -> elder
//   due time + 60 min : "please check in"                         -> caretakers
//   due time + 120 min: marked missed, "missed dose"              -> whole circle
//
// Critical medicines climb twice as fast. Demo mode compresses the ladder to minutes.
import { all, one, run, logActivity, alreadySent, markSent } from './db.js';
import { localDate, localTime, niceTime, niceDateTime, weekday, addDays } from './time.js';
import { refreshDoses, escalationOf, circle, elderOf, readMed, stockInfo, callName, insights } from './logic.js';
import { readings, routineAdherence } from './health.js';
import * as notify from './notify.js';

const TICK_MS = 20 * 1000;
const MINUTE = 60 * 1000;
let busy = false;

export function startEngine() {
  setTimeout(tick, 3000);
  setInterval(tick, TICK_MS);
  console.log('[engine] reminder engine running every', TICK_MS / 1000, 'seconds');
}

export async function tick() {
  if (busy) return;
  busy = true;
  try {
    const profiles = all('SELECT * FROM profiles');
    for (const profile of profiles) {
      try {
        await processProfile(profile);
      } catch (err) {
        console.error('[engine] profile', profile.id, err);
      }
    }
  } finally {
    busy = false;
  }
}

async function processProfile(profile) {
  const now = Date.now();
  refreshDoses(profile.id);
  const steps = escalationOf(profile);
  const elder = elderOf(profile.id);
  await upcoming(profile, elder, steps, now);
  await escalate(profile, elder, steps, now);
  await appointments(profile, now);
  await refills(profile, now);
  await wellness(profile, now);
  await sundayDigest(profile, now);
}

// ---------------------------------------------------------------- weekly summary

function averageText(kind, list) {
  if (list.length === 0) return null;
  const avg1 = Math.round(list.reduce((s, r) => s + r.value1, 0) / list.length);
  const high = list.filter((r) => r.level !== 'ok').length;
  const flag = high ? `, ${high} outside the normal range` : '';
  if (kind === 'bp') {
    const avg2 = Math.round(list.reduce((s, r) => s + r.value2, 0) / list.length);
    return `average ${avg1}/${avg2}${flag}`;
  }
  return `average ${avg1} mg/dL${flag}`;
}

export async function sendDigest(profile) {
  const ins = insights(profile);
  const next = one("SELECT * FROM appointments WHERE profile_id = ? AND status = 'upcoming' AND starts_at > ? ORDER BY starts_at", profile.id, Date.now());
  const low = all('SELECT * FROM medications WHERE profile_id = ? AND active = 1 AND stock IS NOT NULL', profile.id)
    .map(readMed).filter((m) => { const s = stockInfo(m); return s && s.low; }).map((m) => m.name);
  const unwellDays = one("SELECT COUNT(*) AS n FROM checkins WHERE profile_id = ? AND mood = 'unwell' AND date >= ?", profile.id, addDays(localDate(), -6)).n;
  const data = {
    week: ins.week, prevWeek: ins.prevWeek, notes: ins.notes,
    routines: routineAdherence(profile.id, 7),
    bp: averageText('bp', readings(profile.id, 'bp', 7)),
    sugar: averageText('sugar', readings(profile.id, 'sugar', 7)),
    next: next ? `${next.doctor}, ${niceDateTime(next.starts_at)}` : null,
    low, unwellDays,
  };
  logActivity(profile.id, 'Saathi', 'digest', 'sent the weekly summary to the family');
  await notify.weeklyDigest(profile, data, circle(profile.id, { roles: ['caretaker', 'family'] }));
}

async function sundayDigest(profile, now) {
  const today = localDate(now);
  if (weekday(today) !== 0 || localTime(now) < '19:00') return;
  const key = `digest:${profile.id}:${today}`;
  if (alreadySent(key)) return;
  markSent(key);
  await sendDigest(profile);
}

// Groups dose rows that share a time slot, because people take them together.
function groupBySlot(rows) {
  const groups = new Map();
  for (const r of rows) {
    const key = `${r.date}|${r.time}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  return [...groups.values()];
}

const DOSE_QUERY = `SELECT d.*, m.name, m.strength, m.form, m.amount, m.purpose, m.category, m.pill_color, m.food, m.critical
  FROM doses d JOIN medications m ON m.id = d.med_id`;

async function upcoming(profile, elder, steps, now) {
  const rows = all(`${DOSE_QUERY} WHERE d.profile_id = ? AND d.status = 'due' AND d.upcoming_sent = 0 AND d.due_at <= ?`,
    profile.id, now + steps.lead * MINUTE);
  for (const group of groupBySlot(rows)) {
    const ids = group.map((d) => d.id);
    for (const id of ids) run('UPDATE doses SET upcoming_sent = 1 WHERE id = ?', id);
    // Only send the "coming up" email if the dose is actually still ahead of us.
    if (elder && group[0].due_at >= now - MINUTE) await notify.upcomingDose(profile, elder, group, group[0].time);
  }
}

async function escalate(profile, elder, steps, now) {
  const rows = all(`${DOSE_QUERY} WHERE d.profile_id = ? AND d.status = 'due' AND d.due_at <= ?`, profile.id, now);
  for (const group of groupBySlot(rows)) {
    const critical = group.some((d) => d.critical);
    const speed = critical && !profile.demo_fast ? 0.5 : 1;
    let startedAt = group[0].due_at;
    for (const d of group) if (d.snooze_until && d.snooze_until > startedAt) startedAt = d.snooze_until;
    const waited = (now - startedAt) / MINUTE;

    let target = 0;
    if (waited >= steps.family * speed) target = 3;
    else if (waited >= steps.caretaker * speed) target = 2;
    else if (waited >= steps.remind * speed) target = 1;

    const current = Math.min(...group.map((d) => d.level || 0));
    if (target <= current) continue;

    // If the server was asleep we may jump several steps; only send the latest one.
    const ids = group.map((d) => d.id);
    const time = group[0].time;
    const stale = waited > steps.family * speed + 6 * 60;

    if (target === 3) {
      for (const id of ids) run("UPDATE doses SET status = 'missed', level = 3, acted_at = ?, acted_by = 'Saathi' WHERE id = ?", now, id);
      logActivity(profile.id, 'Saathi', 'missed', `marked ${niceTime(time)} medicines as missed (${group.map((d) => d.name).join(', ')})`);
      if (!stale) await notify.missedDose(profile, group, time, circle(profile.id, { roles: ['caretaker', 'family'] }));
    } else if (target === 2) {
      for (const id of ids) run('UPDATE doses SET level = 2 WHERE id = ?', id);
      let helpers = circle(profile.id, { roles: ['caretaker'] });
      if (helpers.length === 0) helpers = circle(profile.id, { roles: ['family'], managersOnly: true });
      logActivity(profile.id, 'Saathi', 'escalate', `asked ${helpers.map((h) => h.name).join(', ') || 'the circle'} to check on the ${niceTime(time)} medicines`);
      await notify.caretakerAlert(profile, group, time, helpers);
    } else {
      for (const id of ids) run('UPDATE doses SET level = 1 WHERE id = ?', id);
      logActivity(profile.id, 'Saathi', 'nudge', `sent ${callName(profile)} a gentle reminder for the ${niceTime(time)} medicines`);
      if (elder) await notify.nudgeElder(profile, elder, group, time);
    }
  }
}

async function appointments(profile, now) {
  const upcomingAppts = all("SELECT * FROM appointments WHERE profile_id = ? AND status = 'upcoming'", profile.id);
  for (const appt of upcomingAppts) {
    const until = appt.starts_at - now;
    if (until < -3 * 60 * MINUTE) {
      run("UPDATE appointments SET status = 'done' WHERE id = ?", appt.id);
      continue;
    }
    const companion = appt.companion_id ? one('SELECT * FROM members WHERE id = ?', appt.companion_id) : null;
    if (!appt.sent_day && until > 0 && until <= 24 * 60 * MINUTE) {
      run('UPDATE appointments SET sent_day = 1 WHERE id = ?', appt.id);
      if (until > 2 * 60 * MINUTE) {
        await notify.appointmentReminder(profile, appt, 'day', circle(profile.id), companion);
      }
    }
    if (!appt.sent_soon && until > 0 && until <= 2 * 60 * MINUTE) {
      run('UPDATE appointments SET sent_soon = 1, sent_day = 1 WHERE id = ?', appt.id);
      const people = [elderOf(profile.id)];
      if (companion) people.push(companion);
      await notify.appointmentReminder(profile, appt, 'soon', people.filter(Boolean), companion);
    }
  }
}

async function refills(profile, now) {
  const meds = all('SELECT * FROM medications WHERE profile_id = ? AND active = 1 AND stock IS NOT NULL', profile.id).map(readMed);
  for (const med of meds) {
    const info = stockInfo(med);
    if (!info || !info.low) continue;
    if (med.refill_alert_at && now - med.refill_alert_at < 3 * 24 * 60 * MINUTE) continue;
    run('UPDATE medications SET refill_alert_at = ? WHERE id = ?', now, med.id);
    logActivity(profile.id, 'Saathi', 'refill', `warned that ${med.name} runs out in about ${info.daysLeft} days`);
    await notify.refillAlert(profile, med, info, circle(profile.id, { roles: ['caretaker', 'family'], managersOnly: true }));
  }
}

// The "silent alarm": no check-in and no medicine marked by the check-in time.
async function wellness(profile, now) {
  const today = localDate(now);
  if (localTime(now) < (profile.checkin_by || '11:00')) return;
  const key = `nocheckin:${profile.id}:${today}`;
  if (alreadySent(key)) return;
  const elder = elderOf(profile.id);
  const checkedIn = one('SELECT id FROM checkins WHERE profile_id = ? AND date = ?', profile.id, today);
  const acted = elder ? one("SELECT id FROM doses WHERE profile_id = ? AND date = ? AND acted_by = ?", profile.id, today, elder.name) : null;
  const helped = one('SELECT id FROM messages WHERE profile_id = ? AND from_elder = 1 AND created_at >= ?', profile.id, new Date(today + 'T00:00').getTime());
  markSent(key);
  if (checkedIn || acted || helped) return;
  logActivity(profile.id, 'Saathi', 'checkin', `noticed no check-in from ${callName(profile)} by ${niceTime(profile.checkin_by || '11:00')}`);
  await notify.noCheckin(profile, circle(profile.id, { roles: ['caretaker', 'family'] }));
}

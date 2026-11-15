// Demo data: Kamla ji (79) and her care circle, with four weeks of believable history.
// Run on its own with `npm run seed`, or automatically when the server starts empty.
import './env.js';
import { fileURLToPath } from 'node:url';
import { one, all, run, transaction } from './db.js';
import { hashSecret, randomToken } from './auth.js';
import { materializeDoses, describeChange } from './logic.js';
import { localDate, addDays, toMs, weekday, partOfDay } from './time.js';

export const DEMO_CARE_ID = 'KAMLA-4821';

// A tiny seeded random number generator, so the demo history is the same every time.
function makeRandom(seed) {
  let a = seed;
  return function random() {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function deleteProfile(profileId) {
  for (const table of ['activity', 'checkins', 'messages', 'questions', 'outbox', 'proposals', 'doses', 'appointments', 'medications', 'routine_logs', 'routines']) {
    run(`DELETE FROM ${table} WHERE profile_id = ?`, profileId);
  }
  run('DELETE FROM sessions WHERE member_id IN (SELECT id FROM members WHERE profile_id = ?)', profileId);
  run('DELETE FROM members WHERE profile_id = ?', profileId);
  run('DELETE FROM profiles WHERE id = ?', profileId);
}

// Demo emails go to example.com (never really sent) unless DEMO_EMAIL is set,
// in which case they go to that inbox using +tags, e.g. you+ravi@gmail.com.
function demoEmail(tag) {
  const real = process.env.DEMO_EMAIL;
  if (!real || !real.includes('@')) return `${tag}@example.com`;
  const [user, domain] = real.split('@');
  return `${user}+${tag}@${domain}`;
}

export function seedDemo() {
  const existing = one('SELECT id FROM profiles WHERE care_id = ?', DEMO_CARE_ID);
  if (existing) deleteProfile(existing.id);

  const random = makeRandom(4821);
  const now = Date.now();
  const today = localDate(now);
  const DAY = 24 * 3600 * 1000;

  transaction(() => {
    const p = run(`INSERT INTO profiles (care_id, name, call_name, birth_year, language, text_size, conditions, allergies, blood_group,
      doctor_name, doctor_phone, passcode_hash, checkin_by, routine, card_token, created_at)
      VALUES (?, ?, ?, ?, 'en', 1, ?, ?, ?, ?, ?, ?, '11:00', ?, ?, ?)`,
    DEMO_CARE_ID, 'Kamla Devi Sharma', 'Kamla ji', 1947,
    'Type 2 diabetes, high blood pressure, knee arthritis', 'Penicillin', 'B+',
    'Dr. Arvind Sharma (heart)', '+91 90000 00000', hashSecret('246810'),
    JSON.stringify({ wake: '06:30', breakfast: '08:00', lunch: '13:00', tea: '17:00', dinner: '20:00', bed: '22:00' }),
    randomToken(12), now - 40 * DAY);
    const profileId = Number(p.lastInsertRowid);
    const profile = one('SELECT * FROM profiles WHERE id = ?', profileId);

    const addMember = (name, email, phone, relation, role, permission, status, pin) => Number(run(`INSERT INTO members
      (profile_id, name, email, phone, relation, role, permission, status, pin_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    profileId, name, email, phone, relation, role, permission, status, hashSecret(pin), now - 39 * DAY).lastInsertRowid);

    const kamla = addMember('Kamla Devi Sharma', demoEmail('kamla'), '+91 90000 11111', 'self', 'elder', 'owner', 'active', '1234');
    const ravi = addMember('Ravi Sharma', demoEmail('ravi'), '+91 90000 22222', 'son', 'family', 'manage', 'active', '1111');
    const priya = addMember('Priya Nair', demoEmail('priya'), '+91 90000 33333', 'home nurse', 'caretaker', 'manage', 'active', '2222');
    const anjali = addMember('Anjali Sharma', demoEmail('anjali'), '+91 90000 44444', 'granddaughter', 'family', 'suggest', 'active', '3333');
    addMember('Sunita Sharma', demoEmail('sunita'), '+91 90000 55555', 'daughter-in-law', 'family', 'view', 'pending', '4444');
    run('UPDATE members SET created_at = ? WHERE status = ? AND profile_id = ?', now - 3 * 3600 * 1000, 'pending', profileId);

    const meds = [
      ['Pantoprazole', '40 mg', 'tablet', 1, 'for acidity', 'yellow', 'oval', 'empty', ['07:30'], 22, 0, 'acidity'],
      ['Metformin', '500 mg', 'tablet', 1, 'for blood sugar', 'white', 'round', 'after', ['08:30', '20:30'], 7, 0, 'sugar'],
      ['Amlodipine', '5 mg', 'tablet', 1, 'for blood pressure', 'pink', 'round', 'any', ['08:30'], 26, 1, 'bp'],
      ['Ecosprin', '75 mg', 'tablet', 1, 'keeps blood thin, for the heart', 'orange', 'round', 'after', ['13:30'], 30, 0, 'thinner'],
      ['Shelcal (Calcium + D3)', '500 mg', 'tablet', 1, 'for strong bones', 'white', 'oblong', 'after', ['13:30'], 45, 0, 'bones'],
      ['Atorvastatin', '10 mg', 'tablet', 1, 'for cholesterol', 'blue', 'oval', 'any', ['22:00'], 25, 0, 'cholesterol'],
    ];
    const medIds = {};
    for (const m of meds) {
      const r = run(`INSERT INTO medications (profile_id, name, strength, form, amount, purpose, pill_color, pill_shape, food, times,
        days, stock, refill_at_days, critical, category, active, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'daily', ?, 5, ?, ?, 1, 'Priya Nair', ?, ?)`,
      profileId, m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], JSON.stringify(m[8]), m[9], m[10], m[11], now - 38 * DAY, now - 38 * DAY);
      medIds[m[0]] = Number(r.lastInsertRowid);
    }

    // Four weeks of history. Evening doses slip more often, especially at weekends.
    for (let i = 27; i >= 0; i--) {
      const date = addDays(today, -i);
      materializeDoses(profileId, date);
      const doses = all('SELECT * FROM doses WHERE profile_id = ? AND date = ?', profileId, date);
      const wd = weekday(date);
      const weekend = wd === 0 || wd === 6;
      for (const d of doses) {
        if (d.due_at > now - 10 * 60 * 1000) continue; // leave anything still to come
        const part = partOfDay(d.time);
        let chance = { morning: 0.97, afternoon: 0.94, evening: weekend ? 0.6 : 0.9, night: 0.93 }[part];
        if (i === 0) chance = 1; // today has gone well so far
        const roll = random();
        const lateBy = Math.floor(3 + random() * 25) * 60 * 1000;
        if (roll < chance) {
          const helper = random() < 0.12 ? 'Priya Nair (checked)' : 'Kamla Devi Sharma';
          run("UPDATE doses SET status = 'taken', acted_at = ?, acted_by = ?, upcoming_sent = 1, level = 0 WHERE id = ?", d.due_at + lateBy, helper, d.id);
        } else if (roll < chance + 0.02) {
          run("UPDATE doses SET status = 'skipped', acted_at = ?, acted_by = 'Kamla Devi Sharma', upcoming_sent = 1 WHERE id = ?", d.due_at + lateBy, d.id);
        } else {
          run("UPDATE doses SET status = 'missed', acted_at = ?, acted_by = 'Saathi', upcoming_sent = 1, level = 3 WHERE id = ?", d.due_at + 2 * 3600 * 1000, d.id);
        }
      }
    }

    // How Kamla ji has been feeling
    for (let i = 27; i >= 1; i--) {
      const date = addDays(today, -i);
      let mood = random() < 0.75 ? 'good' : 'okay';
      let symptoms = [];
      if (i === 6) { mood = 'unwell'; symptoms = ['dizziness']; }
      if (i === 11) { mood = 'unwell'; symptoms = ['pain', 'tiredness']; }
      if (i === 2) { mood = 'unwell'; symptoms = ['dizziness']; }
      run('INSERT INTO checkins (profile_id, date, mood, symptoms, created_at) VALUES (?, ?, ?, ?, ?)',
        profileId, date, mood, JSON.stringify(symptoms), toMs(date, '09:15'));
    }

    // Health routines and four weeks of readings
    const addRoutine = (kind, title, time, days) => Number(run(`INSERT INTO routines (profile_id, kind, title, time, days, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, 'Priya Nair', ?)`, profileId, kind, title, time, days, now - 38 * DAY).lastInsertRowid);
    const sugarId = addRoutine('sugar', 'Fasting sugar', '07:00', 'daily');
    const bpId = addRoutine('bp', 'Morning BP', '08:00', 'daily');
    const walkId = addRoutine('walk', 'Evening walk', '17:30', 'daily');
    const weightId = addRoutine('weight', 'Weight', '07:15', JSON.stringify([0]));
    const addLog = (routineId, kind, date, time, v1, v2, by) => run(`INSERT INTO routine_logs
      (profile_id, routine_id, kind, date, value1, value2, by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    profileId, routineId, kind, date, v1, v2, by, toMs(date, time) + Math.floor(random() * 20) * 60000);
    for (let i = 27; i >= 1; i--) {
      const date = addDays(today, -i);
      const by = random() < 0.2 ? 'Priya Nair' : 'Kamla Devi Sharma';
      if (random() < 0.9) addLog(sugarId, 'sugar', date, '07:00', Math.round(108 + random() * 34 + (i === 6 || i === 13 ? 70 : 0)), null, by);
      if (random() < 0.92) {
        const spike = i === 6 || i === 2 ? 22 : 0; // the dizzy days line up with high BP
        addLog(bpId, 'bp', date, '08:00', Math.round(126 + random() * 14 + spike), Math.round(78 + random() * 8 + spike / 2), by);
      }
      if (random() < 0.7) addLog(walkId, 'walk', date, '17:30', null, null, 'Kamla Devi Sharma');
      if (weekday(date) === 0) addLog(weightId, 'weight', date, '07:15', Number((61.8 - (27 - i) * 0.03 + random() * 0.4).toFixed(1)), null, 'Priya Nair');
    }
    if (toMs(today, '07:20') < now) addLog(sugarId, 'sugar', today, '07:00', 124, null, 'Kamla Devi Sharma');

    // Doctor visits
    const heartDay = addDays(today, 3);
    const eyeDay = addDays(today, 11);
    const addAppt = (doctor, specialty, place, date, time, purpose, companion, status, by) => run(`INSERT INTO appointments
      (profile_id, doctor, specialty, place, starts_at, purpose, companion_id, status, sent_day, sent_soon, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, profileId, doctor, specialty, place, toMs(date, time), purpose, companion, status,
    status === 'done' ? 1 : 0, status === 'done' ? 1 : 0, by, now - 20 * DAY);
    addAppt('Dr. Arvind Sharma', 'Cardiologist', 'City Heart Clinic, Sector 15', heartDay, '11:00', '3-month blood pressure and heart check-up', ravi, 'upcoming', 'Ravi Sharma');
    addAppt('Dr. Meera Iyer', 'Eye specialist', 'Vision Care Centre, MG Road', eyeDay, '10:30', 'Cataract follow-up', priya, 'upcoming', 'Priya Nair');
    addAppt('Dr. Arvind Sharma', 'Cardiologist', 'City Heart Clinic, Sector 15', addDays(today, -30), '11:00', 'Routine check-up', ravi, 'done', 'Ravi Sharma');

    // Questions Kamla ji wants to ask the doctor
    const addQ = (text, by, ago) => run('INSERT INTO questions (profile_id, text, asked_by, created_at) VALUES (?, ?, ?, ?)', profileId, text, by, now - ago);
    addQ('Can I stop the acidity tablet now? My stomach feels fine.', 'Kamla Devi Sharma', 9 * DAY);
    addQ('My knees hurt in the morning. Is the calcium tablet enough?', 'Kamla Devi Sharma', 4 * DAY);
    addQ('Is Ecosprin safe with the knee pain tablets she sometimes takes?', 'Ravi Sharma', 2 * DAY);

    // Family notes
    const weekdayName = new Date(toMs(heartDay, '11:00')).toLocaleDateString('en-IN', { weekday: 'long' });
    const addMsg = (member, fromElder, text, ago, hearted) => run('INSERT INTO messages (profile_id, member_id, from_elder, text, hearted, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      profileId, member, fromElder, text, hearted, now - ago);
    addMsg(kamla, 1, "I'm okay today", 26 * 3600 * 1000, 0);
    addMsg(ravi, 0, `Ma, I'll pick you up at 10:15 on ${weekdayName} for Dr. Sharma. Keep your BP diary ready.`, 20 * 3600 * 1000, 1);
    addMsg(priya, 0, 'Fasting sugar this morning was 132. Better than last week!', 3 * 3600 * 1000, 0);
    addMsg(anjali, 0, 'Dadi, exams are over! Coming home this weekend.', 50 * 60 * 1000, 0);

    // A suggestion waiting for Kamla ji's decision
    const payload = { times: ['21:00'], reason: 'Dadi has been going to bed earlier, so she sometimes misses the 10 PM tablet.' };
    const summary = describeChange(profile, 'med_edit', payload, medIds.Atorvastatin);
    run(`INSERT INTO proposals (profile_id, member_id, kind, target_id, payload, summary, reason, created_at)
      VALUES (?, ?, 'med_edit', ?, ?, ?, ?, ?)`, profileId, anjali, medIds.Atorvastatin, JSON.stringify(payload), summary, payload.reason, now - 5 * 3600 * 1000);

    // Some history for the activity feed
    const addAct = (actor, kind, text, ago) => run('INSERT INTO activity (profile_id, actor, kind, text, created_at) VALUES (?, ?, ?, ?, ?)', profileId, actor, kind, text, now - ago);
    addAct('Ravi Sharma', 'setup', 'set up Saathi for Kamla Devi Sharma and can manage it (the elder can change this anytime)', 40 * DAY);
    addAct('Kamla Devi Sharma', 'circle', 'let Priya Nair join. They now can manage the care plan', 39 * DAY);
    addAct('Priya Nair', 'med', 'added 6 medicines from the prescription photo', 38 * DAY);
    addAct('Kamla Devi Sharma', 'consent', 'said no to: Stop taking Shelcal (Calcium + D3)', 12 * DAY);
    addAct('Kamla Devi Sharma', 'checkin', "isn't feeling well (dizziness)", 6 * DAY);
    addAct('Ravi Sharma', 'question', 'added a question for the doctor: "Is Ecosprin safe with the knee pain tablets she sometimes takes?"', 2 * DAY);
    addAct('Anjali Sharma', 'proposal', `suggested: ${summary}`, 5 * 3600 * 1000);
    addAct('Sunita Sharma', 'join', 'asked to join the care circle as daughter-in-law', 3 * 3600 * 1000);
  });
  console.log(`[seed] demo profile ${DEMO_CARE_ID} ready`);
}

// When run directly: `node server/seed.js --reset`
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  seedDemo();
}

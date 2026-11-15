// Small server-rendered pages that must work straight from an email or a QR code,
// without logging in: the one-tap "I took it" links and the emergency card.
import express from 'express';
import { one, all, run } from './db.js';
import { actOnDoses, readMed, amountText, foodText, circle, callName, safeJson } from './logic.js';
import { esc, unsureDose } from './notify.js';
import { niceTime, localTime } from './time.js';
import { categoryOf } from '../shared/categories.js';
import { startSession } from './auth.js';
import { elderOf } from './logic.js';
import { DEMO_MODE } from './env.js';
import { seedDemo, DEMO_CARE_ID } from './seed.js';

export const pages = express.Router();

function page(title, inner) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Saathi</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&display=swap" rel="stylesheet">
<style>
  body{margin:0;background:#FBF7F0;color:#1F2A2E;font-family:'Atkinson Hyperlegible',Arial,sans-serif;font-size:20px;line-height:1.5}
  main{max-width:560px;margin:0 auto;padding:28px 18px 48px}
  .brand{color:#0F6E64;font-weight:700;font-size:17px;margin-bottom:18px}
  h1{font-size:30px;line-height:1.25;margin:0 0 10px}
  .card{background:#fff;border:1px solid #E8E1D5;border-radius:18px;padding:18px 20px;margin:18px 0}
  .row{padding:12px 0;border-bottom:1px solid #F0EBE2}.row:last-child{border:0}
  .muted{color:#5B6B70;font-size:17px}
  button,.btn{display:block;width:100%;box-sizing:border-box;text-align:center;font:inherit;font-size:22px;font-weight:700;
    padding:20px;border-radius:16px;border:0;background:#0F6E64;color:#fff;cursor:pointer;text-decoration:none;margin-top:12px}
  .btn.light{background:#fff;color:#0F6E64;border:2px solid #0F6E64}
  .big{font-size:64px;line-height:1;margin:6px 0 12px}
  .pill{display:inline-block;width:26px;height:14px;border-radius:8px;border:1px solid #cfc8bb;vertical-align:middle;margin-right:10px}
  dt{color:#5B6B70;font-size:16px;margin-top:12px}dd{margin:2px 0 0;font-weight:700}
  .warn{background:#FBE9E7;border-color:#F3C3BD}
</style></head><body><main><div class="brand">&#9679; Saathi</div>${inner}</main></body></html>`;
}

const PILL = { white: '#F4F1EA', yellow: '#F2C94C', pink: '#F4A7B9', orange: '#F2994A', blue: '#7FB2E5', green: '#8BC98F', red: '#E57373', brown: '#A47551', purple: '#B39DDB' };

function loadToken(token) {
  const row = one('SELECT * FROM action_tokens WHERE token = ?', token);
  if (!row) return { error: 'This link is not valid.' };
  if (row.expires_at < Date.now()) return { error: 'This link has expired.' };
  const ids = safeJson(row.dose_ids, []);
  if (ids.length === 0) return { error: 'This link is not valid.' };
  const doses = all(`SELECT d.*, m.name, m.strength, m.form, m.amount, m.purpose, m.category, m.pill_color, m.food FROM doses d
    JOIN medications m ON m.id = d.med_id WHERE d.id IN (${ids.map(() => '?').join(',')})`, ...ids);
  if (doses.length === 0) return { error: 'These medicines are no longer scheduled.' };
  const profile = one('SELECT * FROM profiles WHERE id = ?', doses[0].profile_id);
  return { row, doses, profile };
}

function doseRows(doses) {
  return doses.map((d) => `<div class="row"><span class="pill" style="background:${PILL[d.pill_color] || '#ddd'}"></span>
    <b>${categoryOf(d.category).emoji} ${esc(d.name)} ${esc(d.strength || '')}</b> <span style="color:#0F6E64">(${esc(categoryOf(d.category).label.toLowerCase())})</span>
    <div class="muted" style="padding-left:38px">${esc(amountText(d.amount, d.form))}${foodText(d.food) ? ' · ' + foodText(d.food) : ''}</div></div>`).join('');
}

const LABELS = {
  taken: { button: 'Yes, they were taken', done: 'Marked as taken' },
  snooze: { button: 'Remind me in a little while', done: "Okay, Saathi will remind you again soon" },
  unsure: { button: "I'm not sure", done: 'Saathi has asked the family to check the pill box' },
  missed: { button: 'Mark as not taken', done: 'Marked as not taken' },
};

pages.get('/act/:token', (req, res) => {
  const data = loadToken(req.params.token);
  if (data.error) return res.status(410).send(page('Link expired', `<h1>${esc(data.error)}</h1><p class="muted">You can still mark medicines in the Saathi app.</p><a class="btn" href="/">Open Saathi</a>`));
  const { row, doses, profile } = data;
  const label = LABELS[row.action] || LABELS.taken;
  const time = niceTime(doses[0].time);
  if (row.used_at) {
    return res.send(page('Already done', `<h1>Already done</h1><p>This button was already used at ${niceTime(localTime(row.used_at))}. Nothing more to do.</p><div class="card">${doseRows(doses)}</div><a class="btn light" href="/">Open Saathi</a>`));
  }
  const allTaken = doses.every((d) => d.status === 'taken');
  res.send(page(`${time} medicines`, `
    <h1>${esc(callName(profile))}'s ${time} medicines</h1>
    ${allTaken ? `<p class="muted">These were already marked as taken at ${niceTime(localTime(doses[0].acted_at))}. Don't take them again.</p>` : ''}
    <div class="card">${doseRows(doses)}</div>
    <form method="post"><button type="submit">${label.button}</button></form>`));
});

pages.post('/act/:token', (req, res) => {
  const data = loadToken(req.params.token);
  if (data.error) return res.status(410).send(page('Link expired', `<h1>${esc(data.error)}</h1><a class="btn" href="/">Open Saathi</a>`));
  const { row, doses, profile } = data;
  const label = LABELS[row.action] || LABELS.taken;
  if (!row.used_at) {
    run('UPDATE action_tokens SET used_at = ? WHERE token = ?', Date.now(), row.token);
    actOnDoses(profile, doses.map((d) => d.id), row.action, row.actor || 'Email link');
    if (row.action === 'unsure') unsureDose(profile, doses, circle(profile.id, { roles: ['caretaker', 'family'] }));
  }
  const tick = row.action === 'taken' ? '<div class="big" aria-hidden="true">&#10003;</div>' : '';
  res.send(page('Done', `${tick}<h1>${label.done}</h1>
    <p class="muted">${row.action === 'taken' ? `Well done, ${esc(callName(profile))}. Your family can see it.` : 'Thank you for letting us know.'}</p>
    <div class="card">${doseRows(doses)}</div><a class="btn light" href="/">Open Saathi</a>`));
});

// One-click demo links for judges, e.g. /demo/elder or /demo/ravi?next=/care/health
const DEMO_PEOPLE = { elder: null, ravi: 'Ravi Sharma', priya: 'Priya Nair', anjali: 'Anjali Sharma' };
pages.get('/demo/:as', (req, res) => {
  if (!DEMO_MODE || !(req.params.as in DEMO_PEOPLE)) return res.redirect('/');
  let profile = one('SELECT * FROM profiles WHERE care_id = ?', DEMO_CARE_ID);
  if (!profile) {
    seedDemo();
    profile = one('SELECT * FROM profiles WHERE care_id = ?', DEMO_CARE_ID);
  }
  const who = DEMO_PEOPLE[req.params.as];
  const member = who ? one('SELECT * FROM members WHERE profile_id = ? AND name = ?', profile.id, who) : elderOf(profile.id);
  if (!member) return res.redirect('/');
  startSession(res, member.id, 7);
  const next = String(req.query.next || '');
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : null;
  res.redirect(safeNext || (member.role === 'elder' ? '/elder' : '/care'));
});

// Emergency card: for a paramedic or a neighbour who scans the QR code on the fridge.
pages.get('/card/:token', (req, res) => {
  const profile = one('SELECT * FROM profiles WHERE card_token = ?', req.params.token);
  if (!profile) return res.status(404).send(page('Not found', '<h1>This card is no longer active.</h1>'));
  const meds = all('SELECT * FROM medications WHERE profile_id = ? AND active = 1 ORDER BY name', profile.id).map(readMed);
  const contacts = circle(profile.id, { roles: ['family', 'caretaker'] }).filter((m) => m.phone);
  const age = profile.birth_year ? new Date().getFullYear() - profile.birth_year : null;
  res.send(page('Emergency card', `
    <h1>${esc(profile.name)}${age ? `, ${age}` : ''}</h1>
    <p class="muted">Emergency medical card from Saathi. Shared by ${esc(callName(profile))}'s family.</p>
    <div class="card warn"><dl style="margin:0">
      <dt>Allergies</dt><dd>${esc(profile.allergies || 'None recorded')}</dd>
      <dt>Conditions</dt><dd>${esc(profile.conditions || 'None recorded')}</dd>
      ${profile.blood_group ? `<dt>Blood group</dt><dd>${esc(profile.blood_group)}</dd>` : ''}
    </dl></div>
    <div class="card"><b>Current medicines</b>${meds.map((m) => `<div class="row"><span class="pill" style="background:${PILL[m.pill_color] || '#ddd'}"></span><b>${esc(m.name)} ${esc(m.strength || '')}</b>
      <div class="muted" style="padding-left:38px">${esc(amountText(m.amount, m.form))} at ${m.times.map(niceTime).join(', ')}${m.purpose ? ' · ' + esc(m.purpose) : ''}</div></div>`).join('') || '<p class="muted">None</p>'}</div>
    <div class="card"><b>Call</b>
      ${contacts.map((c) => `<a class="btn light" href="tel:${esc(c.phone.replace(/\s+/g, ''))}">${esc(c.name)}${c.relation ? ` (${esc(c.relation)})` : ''}: ${esc(c.phone)}</a>`).join('')}
      ${profile.doctor_phone ? `<a class="btn light" href="tel:${esc(profile.doctor_phone.replace(/\s+/g, ''))}">Doctor: ${esc(profile.doctor_name || '')} ${esc(profile.doctor_phone)}</a>` : ''}
      <a class="btn" style="background:#B3261E" href="tel:112">Emergency: 112</a>
    </div>`));
});

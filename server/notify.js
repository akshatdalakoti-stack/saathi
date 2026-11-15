// Who gets which email, and what it says.
// Emails are written for real people: big text, plain words, one obvious button.
import { run } from './db.js';
import { randomToken } from './auth.js';
import { sendMail } from './mailer.js';
import { baseUrl } from './env.js';
import { niceTime, niceDateTime } from './time.js';
import { amountText, foodText, callName } from './logic.js';
import { categoryOf } from '../shared/categories.js';
import { serverT } from './i18n.js';

const PILL_COLORS = {
  white: '#F4F1EA', yellow: '#F2C94C', pink: '#F4A7B9', orange: '#F2994A', blue: '#7FB2E5',
  green: '#8BC98F', red: '#E57373', brown: '#A47551', purple: '#B39DDB',
};

export function esc(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function button(b) {
  return `<a href="${b.url}" style="display:block;text-align:center;background:${b.bg || '#0B6E62'};color:${b.fg || '#ffffff'};
    font-family:Arial,Helvetica,sans-serif;font-size:19px;font-weight:bold;text-decoration:none;padding:16px 20px;
    border-radius:12px;margin:0 0 10px;${b.border ? `border:2px solid ${b.border};` : ''}">${b.label}</a>`;
}

function layout({ preheader = '', heading, intro, body = '', buttons = [], footer = '', openLabel = 'Open Saathi' }) {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#F4F1EA;">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F1EA;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:540px;background:#ffffff;border-radius:18px;overflow:hidden;">
<tr><td style="background:#0E3B34;padding:16px 28px;font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:bold;color:#ffffff;">
<span style="color:#F4B731;">&#9679;</span> Saathi</td></tr>
<tr><td style="height:12px;line-height:12px;">&nbsp;</td></tr>
<tr><td style="padding:10px 28px 4px;font-family:Arial,Helvetica,sans-serif;font-size:24px;line-height:1.3;font-weight:bold;color:#1F2A2E;">${heading}</td></tr>
<tr><td style="padding:4px 28px 0;font-family:Arial,Helvetica,sans-serif;font-size:18px;line-height:1.55;color:#33413F;">${intro}</td></tr>
${body ? `<tr><td style="padding:16px 28px 0;">${body}</td></tr>` : ''}
${buttons.length ? `<tr><td style="padding:22px 28px 4px;">${buttons.map(button).join('')}</td></tr>` : ''}
<tr><td style="padding:20px 28px 26px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:#7A8784;">${footer}
<br><a href="${baseUrl()}" style="color:#0B6E62;">${openLabel}</a></td></tr>
</table></td></tr></table></body></html>`;
}

// The list of medicines inside an email. With t (the elder's language), the
// "what it's for" words and amounts are translated too.
function doseList(doses, t = null) {
  const rows = doses.map((d) => {
    const cat = categoryOf(d.category);
    const what = t ? t(`cat_${cat.key}`) : cat.label.toLowerCase();
    let how = `${amountText(d.amount, d.form)}${foodText(d.food) ? ' &middot; ' + foodText(d.food) : ''}`;
    if (t) {
      const n = Number(d.amount || 1);
      const unit = d.form === 'capsule' ? t(n > 1 ? 'unit_capsules' : 'unit_capsule') : d.form === 'tablet' ? t(n > 1 ? 'unit_tablets' : 'unit_tablet') : '';
      const food = t(`food_${d.food}`);
      how = `${n === 0.5 ? '½' : n} ${unit}${food ? ' &middot; ' + esc(food) : ''}`;
    }
    return `<tr><td style="padding:10px 0;border-bottom:1px solid #F0EBE2;font-family:Arial,Helvetica,sans-serif;">
    <span style="display:inline-block;width:22px;height:12px;border-radius:7px;background:${PILL_COLORS[d.pill_color] || '#ddd'};border:1px solid #cfc8bb;vertical-align:middle;margin-right:10px;"></span>
    <span style="font-size:18px;font-weight:bold;color:#1F2A2E;">${cat.emoji} ${esc(d.name)} ${esc(d.strength || '')}</span>
    <span style="font-size:16px;color:#0B6E62;">(${esc(what)})</span><br>
    <span style="font-size:15px;color:#5B6B70;padding-left:36px;">${how}</span>
  </td></tr>`;
  }).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>`;
}

function circleFooter(profile) {
  return `You're getting this because you're in ${esc(callName(profile))}'s care circle on Saathi.`;
}

function elderFooter() {
  return 'Saathi sends you gentle reminders. Your family can see when you mark your medicines.';
}

// A one-tap link inside an email (e.g. "I took it"). Single use, expires in 18 hours.
export function actionLink(doseIds, action, actor, hours = 18) {
  const token = randomToken(18);
  run('INSERT INTO action_tokens (token, dose_ids, action, actor, expires_at) VALUES (?, ?, ?, ?, ?)',
    token, JSON.stringify(doseIds), action, actor, Date.now() + hours * 3600 * 1000);
  return `${baseUrl()}/act/${token}`;
}

function send(profile, member, subject, html, kind) {
  if (!member || !member.email) return Promise.resolve();
  return sendMail({ profileId: profile.id, to: member.email, toName: member.name, subject, html, kind })
    .catch((err) => console.error('[notify]', err.message));
}

function sendAll(profile, members, subject, html, kind) {
  return Promise.all(members.filter((m) => m.notify).map((m) => send(profile, m, subject, html, kind)));
}

// ---------------------------------------------------------------- medicine reminders

// The two emails the ELDER receives are written in the elder's own language.
export function upcomingDose(profile, elder, doses, time) {
  const t = serverT(profile.language);
  const when = niceTime(time);
  const html = layout({
    preheader: t('email_upcoming_subject', { time: when }),
    heading: esc(t('email_upcoming_heading', { time: when })),
    intro: esc(t('email_upcoming_intro', { name: callName(profile) })),
    body: doseList(doses, t),
    buttons: [{ label: `&#10003; ${esc(t('email_btn_yes'))}`, url: actionLink(doses.map((d) => d.id), 'taken', elder.name) }],
    footer: esc(t('email_footer')),
    openLabel: esc(t('email_open')),
  });
  return send(profile, elder, t('email_upcoming_subject', { time: when }), html, 'upcoming');
}

export function nudgeElder(profile, elder, doses, time) {
  const t = serverT(profile.language);
  const when = niceTime(time);
  const ids = doses.map((d) => d.id);
  const html = layout({
    preheader: t('email_nudge_subject', { time: when }),
    heading: esc(t('email_nudge_subject', { time: when })),
    intro: esc(t('email_nudge_intro', { name: callName(profile) })),
    body: doseList(doses, t),
    buttons: [
      { label: `&#10003; ${esc(t('email_btn_yes'))}`, url: actionLink(ids, 'taken', elder.name) },
      { label: esc(t('remind_later')), url: actionLink(ids, 'snooze', elder.name), bg: '#ffffff', fg: '#0B6E62', border: '#0B6E62' },
      { label: esc(t('not_sure')), url: actionLink(ids, 'unsure', elder.name), bg: '#ffffff', fg: '#5B6B70', border: '#CFC8BB' },
    ],
    footer: esc(t('email_footer')),
    openLabel: esc(t('email_open')),
  });
  return send(profile, elder, t('email_nudge_subject', { time: when }), html, 'nudge');
}

export function caretakerAlert(profile, doses, time, recipients) {
  const name = esc(callName(profile));
  return Promise.all(recipients.filter((m) => m.notify).map((m) => {
    const html = layout({
      preheader: `${callName(profile)} hasn't confirmed their medicines`,
      heading: `${name} hasn't confirmed the ${niceTime(time)} medicines`,
      intro: `It's been a while since these were due. Could you check in with ${name}?`,
      body: doseList(doses),
      buttons: [
        { label: `They've taken them`, url: actionLink(doses.map((d) => d.id), 'taken', `${m.name} (checked)`) },
      ],
      footer: circleFooter(profile),
    });
    return send(profile, m, `Check on ${callName(profile)}: ${niceTime(time)} medicines not confirmed`, html, 'caretaker');
  }));
}

export function missedDose(profile, doses, time, recipients) {
  const name = esc(callName(profile));
  const html = layout({
    preheader: `Missed medicines at ${niceTime(time)}`,
    heading: `${name} missed the ${niceTime(time)} medicines`,
    intro: `Nobody confirmed these, so Saathi has marked them as missed. Please don't give a double dose later without asking the doctor.`,
    body: doseList(doses),
    buttons: [{ label: 'Open Saathi', url: `${baseUrl()}/care` }],
    footer: circleFooter(profile),
  });
  return sendAll(profile, recipients, `Missed: ${callName(profile)}'s ${niceTime(time)} medicines`, html, 'missed');
}

export function unsureDose(profile, doses, recipients) {
  const name = esc(callName(profile));
  const time = doses[0] ? doses[0].time : '00:00';
  const html = layout({
    preheader: `${callName(profile)} isn't sure about a dose`,
    heading: `${name} isn't sure about the ${niceTime(time)} medicines`,
    intro: `${name} said "I'm not sure" instead of guessing, which is the safe thing to do. Could you check the pill box together?`,
    body: doseList(doses),
    buttons: [
      { label: 'They did take them', url: actionLink(doses.map((d) => d.id), 'taken', 'Family (checked)') },
      { label: 'They did not take them', url: actionLink(doses.map((d) => d.id), 'missed', 'Family (checked)'), bg: '#ffffff', fg: '#B3261E', border: '#B3261E' },
    ],
    footer: circleFooter(profile),
  });
  return sendAll(profile, recipients, `${callName(profile)} isn't sure about the ${niceTime(time)} medicines`, html, 'unsure');
}

// ---------------------------------------------------------------- appointments and refills

export function appointmentReminder(profile, appt, which, recipients, companion) {
  const when = which === 'day' ? 'Tomorrow' : 'In 2 hours';
  const extra = companion ? `<br>${esc(companion.name)} is going along.` : '';
  const html = layout({
    preheader: `${when}: ${appt.doctor}`,
    heading: `${when}: visit with ${esc(appt.doctor)}`,
    intro: `<b>${esc(niceDateTime(appt.starts_at))}</b>${appt.place ? `<br>${esc(appt.place)}` : ''}${extra}`,
    body: appt.purpose ? `<p style="font-family:Arial,sans-serif;font-size:17px;color:#33413F;margin:0;">About: ${esc(appt.purpose)}</p>` : '',
    buttons: [{ label: 'See the visit sheet', url: `${baseUrl()}/care/visit/${appt.id}` }],
    footer: `Bring the medicine list and ${esc(callName(profile))}'s questions for the doctor. ${circleFooter(profile)}`,
  });
  return Promise.all(recipients.filter((m) => m.notify).map((m) =>
    send(profile, m, `${when}: ${callName(profile)}'s visit with ${appt.doctor}`, html, 'appointment')));
}

export function refillAlert(profile, med, info, recipients) {
  const html = layout({
    preheader: `${med.name} is running low`,
    heading: `${esc(med.name)} will run out in about ${info.daysLeft} day${info.daysLeft === 1 ? '' : 's'}`,
    intro: `${esc(callName(profile))} has ${info.stock} left. At the current schedule, that lasts until around <b>${esc(info.runsOut)}</b>. Please arrange a refill.`,
    buttons: [{ label: 'Mark as refilled', url: `${baseUrl()}/care/medicines` }],
    footer: circleFooter(profile),
  });
  return sendAll(profile, recipients, `Refill needed: ${med.name} for ${callName(profile)}`, html, 'refill');
}

// ---------------------------------------------------------------- wellbeing

export function noCheckin(profile, recipients) {
  const name = esc(callName(profile));
  const html = layout({
    preheader: `No word from ${callName(profile)} yet today`,
    heading: `We haven't heard from ${name} today`,
    intro: `${name} hasn't checked in or marked any medicine yet today. It might be nothing, but a quick call would be kind.`,
    buttons: [{ label: 'Open Saathi', url: `${baseUrl()}/care` }],
    footer: circleFooter(profile),
  });
  return sendAll(profile, recipients, `No check-in from ${callName(profile)} yet today`, html, 'checkin');
}

export function notWell(profile, symptoms, recipients) {
  const name = esc(callName(profile));
  const list = symptoms.length ? symptoms.map(esc).join(', ') : 'not feeling well';
  const html = layout({
    preheader: `${callName(profile)} isn't feeling well`,
    heading: `${name} isn't feeling well today`,
    intro: `${name} told Saathi: <b>${list}</b>. Please give them a call.`,
    buttons: [{ label: 'Open Saathi', url: `${baseUrl()}/care` }],
    footer: circleFooter(profile),
  });
  return sendAll(profile, recipients, `${callName(profile)} isn't feeling well`, html, 'unwell');
}

export function helpRequest(profile, recipients) {
  const name = esc(callName(profile));
  const html = layout({
    preheader: 'Pressed the help button',
    heading: `${name} pressed the Help button`,
    intro: `At ${esc(niceDateTime(Date.now()))}, ${name} asked for help from Saathi. Please call them now.`,
    buttons: [{ label: 'Open Saathi', url: `${baseUrl()}/care`, bg: '#B3261E' }],
    footer: circleFooter(profile),
  });
  return sendAll(profile, recipients, `URGENT: ${callName(profile)} needs help`, html, 'help');
}

export function elderOkay(profile, recipients) {
  const name = esc(callName(profile));
  const html = layout({
    preheader: `${callName(profile)} says they're okay`,
    heading: `${name} says: "I'm okay today"`,
    intro: `A small hello from ${name}, sent with one tap from Saathi.`,
    footer: circleFooter(profile),
  });
  return sendAll(profile, recipients, `${callName(profile)} says they're okay today`, html, 'okay');
}

export function heartMessage(profile, member, text) {
  const html = layout({
    preheader: `${callName(profile)} loved your message`,
    heading: `${esc(callName(profile))} loved your message`,
    intro: `"${esc(text)}"`,
    footer: circleFooter(profile),
  });
  return send(profile, member, `${callName(profile)} loved your message`, html, 'heart');
}

// ---------------------------------------------------------------- health readings, refills, weekly summary

export function readingAlert(profile, label, value, judgement, recipients) {
  const name = esc(callName(profile));
  const urgent = judgement.level === 'danger';
  const html = layout({
    preheader: `${label}: ${value}`,
    heading: `${name}'s ${esc(label)} is ${esc(judgement.text)}: ${esc(value)}`,
    intro: urgent
      ? `This reading is far outside the safe range. Please call ${name} now, and their doctor if they feel unwell.`
      : `This reading is outside the usual range. A quick call to check how ${name} feels would help. If it keeps happening, mention it to the doctor.`,
    buttons: [{ label: 'See health readings', url: `${baseUrl()}/care/health`, bg: urgent ? '#B3261E' : '#0B6E62' }],
    footer: circleFooter(profile),
  });
  return sendAll(profile, recipients, `${urgent ? 'URGENT: ' : ''}${callName(profile)}'s ${label} ${value} (${judgement.text})`, html, 'reading');
}

export function refillPickup(profile, med, member, recipients) {
  const html = layout({
    preheader: `${member.name} will pick up ${med.name}`,
    heading: `${esc(member.name)} will pick up ${esc(med.name)}`,
    intro: `No need for anyone else to buy it. ${esc(callName(profile))} can see that ${esc(member.name)} is bringing it.`,
    footer: circleFooter(profile),
  });
  return sendAll(profile, recipients, `${member.name} will pick up ${med.name} for ${callName(profile)}`, html, 'refill');
}

// A Sunday-evening summary of the week for everyone in the circle.
export function weeklyDigest(profile, d, recipients) {
  const name = esc(callName(profile));
  const row = (label, value) => `<tr><td style="padding:8px 0;border-bottom:1px solid #F0EBE2;font-family:Arial,sans-serif;font-size:15px;color:#5B6B70;">${label}</td>
    <td style="padding:8px 0;border-bottom:1px solid #F0EBE2;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;color:#1F2A2E;text-align:right;">${value}</td></tr>`;
  const trend = d.week.pct === null || d.prevWeek.pct === null ? '' : d.week.pct >= d.prevWeek.pct ? ` (up from ${d.prevWeek.pct}%)` : ` (down from ${d.prevWeek.pct}%)`;
  const body = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    ${row('Medicines taken', `${d.week.pct ?? '–'}%${trend}`)}
    ${row('Missed doses', d.week.missed)}
    ${row('Health tasks done', d.routines.pct === null ? '–' : `${d.routines.pct}%`)}
    ${d.bp ? row('BP this week', `${esc(d.bp)}`) : ''}
    ${d.sugar ? row('Sugar this week', `${esc(d.sugar)}`) : ''}
    ${row('Felt unwell', `${d.unwellDays} day${d.unwellDays === 1 ? '' : 's'}`)}
    ${d.next ? row('Next doctor visit', esc(d.next)) : ''}
    ${d.low.length ? row('Running low', esc(d.low.join(', '))) : ''}
  </table>
  ${d.notes.length ? `<p style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#33413F;margin:16px 0 0;">${d.notes.map(esc).join('<br>')}</p>` : ''}`;
  const html = layout({
    preheader: `${callName(profile)}'s week: ${d.week.pct ?? '–'}% of medicines taken`,
    heading: `${name}'s week`,
    intro: `Here's how the week went. A call or a visit means more than any app.`,
    body,
    buttons: [{ label: 'Open the dashboard', url: `${baseUrl()}/care` }],
    footer: circleFooter(profile),
  });
  return sendAll(profile, recipients, `${callName(profile)}'s week: ${d.week.pct ?? '–'}% of medicines taken`, html, 'digest');
}

// ---------------------------------------------------------------- consent

export function joinRequest(profile, newMember, recipients) {
  const html = layout({
    preheader: `${newMember.name} wants to join`,
    heading: `${esc(newMember.name)} wants to join ${esc(callName(profile))}'s care circle`,
    intro: `${esc(newMember.name)}${newMember.relation ? ` (${esc(newMember.relation)})` : ''} used the circle passcode. ${esc(callName(profile))} decides whether they can join and what they can do.`,
    buttons: [{ label: 'Open Saathi', url: baseUrl() }],
    footer: circleFooter(profile),
  });
  return sendAll(profile, recipients, `${newMember.name} wants to join ${callName(profile)}'s care circle`, html, 'join');
}

export function proposalCreated(profile, elder, proposal, proposer) {
  const html = layout({
    preheader: `${proposer.name} suggests a change`,
    heading: `${esc(proposer.name)} suggests a change`,
    intro: `<b>${esc(proposal.summary)}</b><br>Nothing changes unless you say yes. Open Saathi to decide.`,
    buttons: [{ label: 'Open Saathi', url: `${baseUrl()}/elder` }],
    footer: elderFooter(),
  });
  return send(profile, elder, `${proposer.name} suggests a change to your medicines`, html, 'proposal');
}

export function proposalDecided(profile, proposal, approved, proposer) {
  const name = esc(callName(profile));
  const html = layout({
    preheader: approved ? 'Approved' : 'Declined',
    heading: approved ? `${name} said yes` : `${name} said no, for now`,
    intro: `To your suggestion: <b>${esc(proposal.summary)}</b>${approved ? '<br>The change is now in place.' : `<br>Maybe talk it through with ${name}, or ask their doctor together.`}`,
    footer: circleFooter(profile),
  });
  return send(profile, proposer, `${callName(profile)} ${approved ? 'approved' : 'declined'} your suggestion`, html, 'decision');
}

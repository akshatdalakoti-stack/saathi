// Sends email. Every email is first saved in the "outbox" table, so the app can
// show exactly what was sent even when there is no internet or no email account set up.
//
// Delivery options, in order of preference:
//   BREVO_API_KEY  -> Brevo HTTPS API (works on Render's free plan, which blocks SMTP)
//   RESEND_API_KEY -> Resend HTTPS API
//   SMTP_HOST      -> any SMTP server, e.g. Gmail with an app password (good for local runs)
//   none           -> outbox only
import nodemailer from 'nodemailer';
import { run } from './db.js';

// Demo people use addresses like ravi@example.com. Those are never really sent.
export function isDemoAddress(email) {
  if (!email) return true;
  return /@example\.(com|org|net)$/i.test(email) || /\.(test|invalid|local)$/i.test(email);
}

export function mailMode() {
  if (process.env.BREVO_API_KEY) return 'brevo';
  if (process.env.RESEND_API_KEY) return 'resend';
  if (process.env.SMTP_HOST) return 'smtp';
  return 'outbox';
}

function sender() {
  const from = process.env.MAIL_FROM || process.env.SMTP_USER || 'saathi@example.com';
  const match = from.match(/^\s*(.*?)\s*<(.+)>\s*$/);
  if (match) return { name: match[1] || 'Saathi', email: match[2] };
  return { name: 'Saathi', email: from.trim() };
}

let smtpTransport = null;

async function deliver(to, toName, subject, html) {
  const mode = mailMode();
  const from = sender();

  if (mode === 'brevo') {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': process.env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sender: from, to: [{ email: to, name: toName || to }], subject, htmlContent: html }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`Brevo ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return 'sent';
  }

  if (mode === 'resend') {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: `${from.name} <${from.email}>`, to: [to], subject, html }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return 'sent';
  }

  if (mode === 'smtp') {
    if (!smtpTransport) {
      const port = Number(process.env.SMTP_PORT || 587);
      smtpTransport = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port,
        secure: port === 465,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
        connectionTimeout: 15000,
      });
    }
    await smtpTransport.sendMail({ from: `${from.name} <${from.email}>`, to: toName ? `${toName} <${to}>` : to, subject, html });
    return 'sent';
  }

  return 'outbox';
}

export async function sendMail({ profileId, to, toName, subject, html, kind }) {
  const result = run(`INSERT INTO outbox (profile_id, to_email, to_name, subject, html, kind, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'queued', ?)`, profileId, to || '', toName || '', subject, html, kind, Date.now());
  const id = Number(result.lastInsertRowid);
  if (isDemoAddress(to)) {
    run("UPDATE outbox SET status = 'demo' WHERE id = ?", id);
    return;
  }
  try {
    const status = await deliver(to, toName, subject, html);
    run('UPDATE outbox SET status = ? WHERE id = ?', status, id);
  } catch (err) {
    console.error('[mail] failed:', err.message);
    run("UPDATE outbox SET status = 'failed', error = ? WHERE id = ?", String(err.message || err).slice(0, 500), id);
  }
}

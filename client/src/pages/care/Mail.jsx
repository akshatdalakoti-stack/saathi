// Every email Saathi sent (or would have sent), plus the full activity log.
import { useState } from 'react';
import { Mail as MailIcon, History } from 'lucide-react';
import { api } from '../../api.js';
import { Card, Badge, Modal, Spinner, usePolling, timeAgo } from '../../ui.jsx';

const KIND = {
  upcoming: ['brand', 'Coming up'], nudge: ['sun', 'Nudge'], caretaker: ['sun', 'Caretaker'], missed: ['bad', 'Missed'],
  unsure: ['sun', 'Not sure'], appointment: ['calm', 'Visit'], refill: ['dusk', 'Refill'], checkin: ['sun', 'Silent alarm'],
  unwell: ['bad', 'Unwell'], help: ['bad', 'Help'], okay: ['ok', "I'm okay"], heart: ['ok', 'Heart'], join: ['calm', 'Join'],
  proposal: ['brand', 'Suggestion'], decision: ['brand', 'Decision'],
};
const STATUS = { sent: ['ok', 'Delivered'], demo: ['gray', 'Demo address'], outbox: ['gray', 'Saved here'], failed: ['bad', 'Failed'], queued: ['gray', 'Sending'] };
const MODE_TEXT = {
  brevo: 'Emails are delivered through Brevo.',
  resend: 'Emails are delivered through Resend.',
  smtp: 'Emails are delivered through SMTP.',
  outbox: 'No email service is set up, so emails are saved here instead.',
};

export default function Mail() {
  const [mail, setMail] = useState(null);
  const [activity, setActivity] = useState([]);
  const [open, setOpen] = useState(null);

  async function load() {
    const [m, a] = await Promise.all([api('/care/outbox'), api('/care/activity')]);
    setMail(m);
    setActivity(a.items);
  }
  usePolling(load, 5000);
  if (!mail) return <Spinner />;

  async function show(id) {
    setOpen(await api(`/care/outbox/${id}`));
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold">Emails and activity</h1>
        <p className="text-ink-2">{MODE_TEXT[mail.mode]} Demo people use example.com addresses, which are never really sent. Put your own email in Care circle to receive them.</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <Card className="p-5">
          <h2 className="flex items-center gap-2 text-lg font-bold"><MailIcon size={18} className="text-brand-700" /> Emails</h2>
          {mail.items.length === 0 ? <p className="mt-3 text-ink-2">No emails yet. Try "Make medicines due now" on the Today page with fast mode on.</p> : null}
          <ul className="mt-3 divide-y divide-line">
            {mail.items.map((m) => {
              const [kt, kl] = KIND[m.kind] || ['gray', m.kind];
              const [st, sl] = STATUS[m.status] || ['gray', m.status];
              return (
                <li key={m.id}>
                  <button onClick={() => show(m.id)} className="w-full py-3 text-left hover:bg-paper/60">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={kt}>{kl}</Badge>
                      <span className="min-w-0 flex-1 truncate font-semibold">{m.subject}</span>
                      <span className="text-xs text-ink-3">{timeAgo(m.created_at)}</span>
                    </div>
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-2">To {m.to_name} &lt;{m.to_email}&gt; <Badge tone={st}>{sl}</Badge></p>
                    {m.error ? <p className="mt-1 text-xs text-bad-600">{m.error}</p> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
        <Card className="h-fit p-5">
          <h2 className="flex items-center gap-2 text-lg font-bold"><History size={18} className="text-brand-700" /> Who did what</h2>
          <p className="text-sm text-ink-2">Every change is recorded, so nothing happens behind anyone's back.</p>
          <ul className="mt-3 space-y-3">
            {activity.map((a) => (
              <li key={a.id} className="text-[15px]">
                <b>{a.actor}</b> {a.text}
                <span className="block text-xs text-ink-3">{timeAgo(a.created_at)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      {open ? (
        <Modal open onClose={() => setOpen(null)} title={open.subject} wide>
          <p className="mb-3 text-sm text-ink-2">To {open.to_name} &lt;{open.to_email}&gt;</p>
          <iframe title="Email preview" srcDoc={open.html} className="h-[70vh] w-full rounded-xl border border-line bg-white" sandbox="" />
        </Modal>
      ) : null}
    </div>
  );
}

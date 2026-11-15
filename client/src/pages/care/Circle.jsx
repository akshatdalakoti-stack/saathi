// The care circle: who is in it, how to invite people, the emergency card and settings.
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { ShieldCheck, Copy, KeyRound, QrCode, Printer, RefreshCw, Save, Bell } from 'lucide-react';
import { api } from '../../api.js';
import { Button, Card, Badge, Avatar, Field, ErrorNote, Spinner, useToast } from '../../ui.jsx';
import { PERMISSION_TEXT } from '../Care.jsx';
import { LANGUAGES } from '../../../../shared/languages.js';

export default function Circle({ ov, reload }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [card, setCard] = useState(null);
  const [qr, setQr] = useState('');
  const name = ov.profile.call_name || ov.profile.name;

  async function load() {
    const [c, e] = await Promise.all([api('/care/circle'), api('/care/card')]);
    setData(c);
    setCard(e.url);
    setQr(await QRCode.toDataURL(e.url, { margin: 1, width: 320, color: { dark: '#083B35', light: '#ffffff' } }));
  }
  useEffect(() => { load(); }, []);
  if (!data) return <Spinner />;

  const joinLink = `${window.location.origin}/join?care=${data.care_id}`;
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { toast(text); }
  }
  async function rotateCard() {
    if (!window.confirm('Make a new emergency card link? The old QR code will stop working.')) return;
    await api('/care/card/rotate', { method: 'POST' });
    load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold">Care circle</h1>
        <p className="flex items-center gap-2 text-ink-2"><ShieldCheck size={18} className="text-brand-700" /> Only {name} decides who joins and what each person can do, from their own Saathi screen.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <Card className="p-5">
          <h2 className="text-lg font-bold">People</h2>
          <ul className="mt-3 divide-y divide-line">
            {data.members.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-3 py-3">
                <Avatar name={m.name} size={42} tone={m.role === 'elder' ? 'sun' : m.role === 'caretaker' ? 'calm' : 'brand'} />
                <div className="min-w-0 flex-1">
                  <p className="font-bold">{m.name} {m.id === data.me.id ? <span className="font-normal text-ink-3">(you)</span> : null}</p>
                  <p className="text-sm text-ink-2">{m.relation} · {PERMISSION_TEXT[m.permission]}</p>
                </div>
                {m.status === 'pending' ? <Badge tone="sun">Waiting for {name}</Badge> : <Badge tone={m.role === 'elder' ? 'sun' : m.role === 'caretaker' ? 'calm' : 'brand'}>{m.role}</Badge>}
              </li>
            ))}
          </ul>
        </Card>

        <div className="space-y-6">
          <Card className="p-5">
            <h2 className="flex items-center gap-2 text-lg font-bold"><KeyRound size={18} className="text-brand-700" /> Invite someone</h2>
            <p className="mt-1 text-sm text-ink-2">Send them this link and the circle passcode. They ask to join, and {name} decides.</p>
            <div className="mt-3 flex gap-2">
              <input className="input text-sm" readOnly value={joinLink} />
              <Button variant="secondary" onClick={() => copy(joinLink)} aria-label="Copy link"><Copy size={16} /></Button>
            </div>
            <p className="mt-2 text-sm">Care ID: <b className="tracking-wider">{data.care_id}</b></p>
            {data.can.manage ? <PasscodeForm /> : null}
          </Card>

          <Card className="p-5">
            <h2 className="flex items-center gap-2 text-lg font-bold"><QrCode size={18} className="text-bad-600" /> Emergency card</h2>
            <p className="mt-1 text-sm text-ink-2">Print this and stick it on the fridge. A paramedic or neighbour scans it to see allergies, current medicines and who to call. No login needed.</p>
            {qr ? <img src={qr} alt="Emergency card QR code" className="mx-auto mt-3 w-44 rounded-xl border border-line" /> : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <a href={card} target="_blank" rel="noreferrer"><Button size="sm" variant="secondary">Open card</Button></a>
              <Button size="sm" variant="secondary" onClick={() => { const w = window.open(''); w.document.write(`<div style="font-family:sans-serif;text-align:center;padding:40px"><h1>${ov.profile.name}</h1><p>Emergency medical card. Scan for medicines, allergies and contacts.</p><img src="${qr}" width="320"/><p>${card}</p></div>`); w.print(); }}><Printer size={15} /> Print</Button>
              {data.can.manage ? <Button size="sm" variant="ghost" onClick={rotateCard}><RefreshCw size={15} /> New link</Button> : null}
            </div>
          </Card>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <MySettings me={data.me} reload={load} />
        {data.can.manage ? <ElderSettings ov={ov} reload={reload} /> : null}
      </div>
    </div>
  );
}

function PasscodeForm() {
  const toast = useToast();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  async function save() {
    setError('');
    try {
      await api('/care/passcode', { method: 'POST', body: { passcode: code } });
      toast('Passcode changed');
      setCode('');
    } catch (err) { setError(err.message); }
  }
  return (
    <div className="mt-4 border-t border-line pt-4">
      <Field label="Change the circle passcode" hint="6 numbers. People already in the circle are not affected.">
        <div className="flex gap-2">
          <input className="input tracking-[0.3em]" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} placeholder="••••••" />
          <Button variant="secondary" onClick={save}>Change</Button>
        </div>
      </Field>
      <div className="mt-2"><ErrorNote error={error} /></div>
    </div>
  );
}

function MySettings({ me, reload }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: me.name, email: me.email || '', phone: me.phone || '', notify: me.notify, pin: '' });
  const [error, setError] = useState('');
  async function save() {
    setError('');
    try {
      await api('/care/me', { method: 'PUT', body: { ...form, pin: form.pin || undefined } });
      toast('Saved');
      setForm({ ...form, pin: '' });
      reload();
    } catch (err) { setError(err.message); }
  }
  return (
    <Card className="space-y-4 p-5">
      <h2 className="flex items-center gap-2 text-lg font-bold"><Bell size={18} className="text-brand-700" /> Your details</h2>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Phone"><input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
      </div>
      <Field label="Email for alerts" hint="Try your own email here to receive the real reminder emails."><input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
      <label className="flex items-center gap-3"><input type="checkbox" className="h-5 w-5 accent-[#0F6E64]" checked={form.notify} onChange={(e) => setForm({ ...form, notify: e.target.checked })} /> Send me email alerts</label>
      <Field label="New PIN (optional)"><input className="input tracking-[0.3em]" type="password" inputMode="numeric" value={form.pin} onChange={(e) => setForm({ ...form, pin: e.target.value })} /></Field>
      <ErrorNote error={error} />
      <Button onClick={save}><Save size={16} /> Save</Button>
    </Card>
  );
}

function ElderSettings({ ov, reload }) {
  const toast = useToast();
  const p = ov.profile;
  const [form, setForm] = useState({
    call_name: p.call_name || '', language: p.language || 'en', conditions: p.conditions || '', allergies: p.allergies || '', blood_group: p.blood_group || '',
    doctor_name: p.doctor_name || '', doctor_phone: p.doctor_phone || '', checkin_by: p.checkin_by || '11:00',
    routine: p.routine, escalation: { remind: p.escalation.remind, caretaker: p.escalation.caretaker, family: p.escalation.family },
  });
  const [error, setError] = useState('');
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  async function save() {
    setError('');
    try {
      const esc = { remind: Number(form.escalation.remind), caretaker: Number(form.escalation.caretaker), family: Number(form.escalation.family) };
      await api('/care/profile', { method: 'PUT', body: { ...form, escalation: esc } });
      toast('Saved');
      reload();
    } catch (err) { setError(err.message); }
  }
  const routineNames = { wake: 'Wakes up', breakfast: 'Breakfast', lunch: 'Lunch', tea: 'Evening tea', dinner: 'Dinner', bed: 'Bedtime' };
  return (
    <Card className="space-y-4 p-5">
      <h2 className="text-lg font-bold">{p.call_name || p.name}'s settings</h2>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Saathi calls them"><input className="input" value={form.call_name} onChange={set('call_name')} /></Field>
        <Field label="Blood group"><input className="input" value={form.blood_group} onChange={set('blood_group')} /></Field>
      </div>
      <Field label="Language on their screen and voice" hint="They can also change it themselves with the globe button.">
        <select className="input" value={form.language} onChange={set('language')}>
          {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.native}{l.native !== l.english ? ` (${l.english})` : ''}</option>)}
        </select>
      </Field>
      <Field label="Conditions"><input className="input" value={form.conditions} onChange={set('conditions')} /></Field>
      <Field label="Allergies"><input className="input" value={form.allergies} onChange={set('allergies')} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Main doctor"><input className="input" value={form.doctor_name} onChange={set('doctor_name')} /></Field>
        <Field label="Doctor's phone"><input className="input" value={form.doctor_phone} onChange={set('doctor_phone')} /></Field>
      </div>
      <div>
        <span className="label">Daily routine</span>
        <div className="grid grid-cols-3 gap-2">
          {Object.keys(routineNames).map((k) => (
            <Field key={k} label={routineNames[k]}>
              <input className="input" type="time" value={form.routine[k]} onChange={(e) => setForm({ ...form, routine: { ...form.routine, [k]: e.target.value } })} />
            </Field>
          ))}
        </div>
      </div>
      <Field label="Silent alarm: tell the family if there's no sign of them by" hint="No check-in and no medicine marked by this time sends one gentle email.">
        <input className="input !w-36" type="time" value={form.checkin_by} onChange={set('checkin_by')} />
      </Field>
      <div>
        <span className="label">Escalation ladder (minutes after a dose is due)</span>
        <div className="grid grid-cols-3 gap-2">
          {[['remind', 'Nudge the elder'], ['caretaker', 'Tell caretaker'], ['family', 'Missed, tell family']].map(([k, label]) => (
            <Field key={k} label={label}>
              <input className="input" type="number" min="1" value={form.escalation[k]} onChange={(e) => setForm({ ...form, escalation: { ...form.escalation, [k]: e.target.value } })} />
            </Field>
          ))}
        </div>
      </div>
      <ErrorNote error={error} />
      <Button onClick={save}><Save size={16} /> Save settings</Button>
    </Card>
  );
}

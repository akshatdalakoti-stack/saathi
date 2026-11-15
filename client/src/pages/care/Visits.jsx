// Doctor visits and the running list of questions for the doctor.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, ClipboardList, Car, MapPin, Pencil, X, Check, MessageCircleQuestion } from 'lucide-react';
import { api } from '../../api.js';
import { Button, Card, Badge, Modal, Field, ErrorNote, Spinner, useToast, clock, dayDate, daysUntil, timeAgo } from '../../ui.jsx';

function toDateInput(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function toTimeInput(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function Visits({ ov }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [editing, setEditing] = useState(null);
  const [q, setQ] = useState('');
  const name = ov.profile.call_name || ov.profile.name;

  async function load() {
    const [a, qs] = await Promise.all([api('/care/appointments'), api('/care/questions')]);
    setData(a);
    setQuestions(qs.questions);
  }
  useEffect(() => { load(); }, []);
  if (!data) return <Spinner />;

  async function cancel(v) {
    if (!window.confirm(`Cancel the visit with ${v.doctor}?`)) return;
    try {
      const res = await api(`/care/appointments/${v.id}`, { method: 'DELETE' });
      toast(res.proposed ? `Sent to ${name} to approve` : 'Visit cancelled');
      load();
    } catch (err) { toast(err.message, { tone: 'bad' }); }
  }
  async function goAlong(v) {
    await api(`/care/appointments/${v.id}/companion`, { method: 'POST' });
    toast(`Thanks. ${name} will see that you're going.`);
    load();
  }
  async function addQuestion() {
    if (!q.trim()) return;
    await api('/care/questions', { method: 'POST', body: { text: q } });
    setQ('');
    load();
  }
  async function toggleQuestion(item) {
    await api(`/care/questions/${item.id}`, { method: 'PUT', body: { done: !item.done } });
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold">Doctor visits</h1>
          <p className="text-ink-2">Reminders go out a day before and two hours before, to {name} and whoever is going along.</p>
        </div>
        {data.can.suggest ? <Button onClick={() => setEditing({})}><Plus size={18} /> Add visit</Button> : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-4">
          {data.upcoming.length === 0 ? <Card className="p-6 text-ink-2">No upcoming visits.</Card> : null}
          {data.upcoming.map((v) => {
            const n = daysUntil(v.starts_at);
            return (
              <Card key={v.id} className="flex gap-4 p-5">
                <div className="flex h-20 w-20 shrink-0 flex-col items-center justify-center rounded-2xl bg-calm-50 text-calm-800">
                  <span className="text-xs font-bold uppercase">{dayDate(v.starts_at, 'en', { month: 'short' })}</span>
                  <span className="text-3xl font-bold leading-none">{new Date(v.starts_at).getDate()}</span>
                  <span className="text-xs">{dayDate(v.starts_at, 'en', { weekday: 'short' })}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-lg font-bold">{v.doctor} <span className="font-normal text-ink-2">· {v.specialty}</span></p>
                  <p className="text-[15px]">{clock(v.starts_at)} <Badge tone="calm">{n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`}</Badge></p>
                  {v.place ? <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-2"><MapPin size={14} /> {v.place}</p> : null}
                  {v.purpose ? <p className="mt-1 text-sm text-ink-2">{v.purpose}</p> : null}
                  <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-brand-700"><Car size={14} /> {v.companion_name ? `${v.companion_name} is going` : 'Nobody going yet'}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link to={`/care/visit/${v.id}`}><Button size="sm" variant="soft"><ClipboardList size={15} /> Visit sheet</Button></Link>
                    {v.companion_id !== ov.me.id ? <Button size="sm" variant="secondary" onClick={() => goAlong(v)}><Car size={15} /> I'll go along</Button> : null}
                    {data.can.suggest ? <Button size="sm" variant="secondary" onClick={() => setEditing(v)}><Pencil size={15} /> Edit</Button> : null}
                    {data.can.suggest ? <Button size="sm" variant="ghost" className="!text-bad-600" onClick={() => cancel(v)}><X size={15} /> Cancel</Button> : null}
                  </div>
                </div>
              </Card>
            );
          })}
          {data.past.length ? (
            <details className="rounded-2xl border border-line bg-white/60 p-4">
              <summary className="cursor-pointer font-semibold text-ink-2">Past visits</summary>
              <ul className="mt-2 space-y-1 text-sm text-ink-2">
                {data.past.map((v) => <li key={v.id}>{dayDate(v.starts_at)} · {v.doctor} ({v.specialty}) {v.status === 'cancelled' ? '· cancelled' : ''}</li>)}
              </ul>
            </details>
          ) : null}
        </div>

        <Card className="h-fit p-5">
          <h2 className="flex items-center gap-2 text-lg font-bold"><MessageCircleQuestion size={20} className="text-brand-700" /> Questions for the doctor</h2>
          <p className="text-sm text-ink-2">{name} adds questions by voice or typing whenever they think of them. They print first on the visit sheet.</p>
          <ul className="mt-4 space-y-2">
            {questions.map((item) => (
              <li key={item.id} className="flex gap-3 rounded-xl bg-paper p-3">
                <button onClick={() => toggleQuestion(item)} className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border ${item.done ? 'border-ok-600 bg-ok-600 text-white' : 'border-line-2 bg-white'}`} aria-label="Asked">
                  {item.done ? <Check size={14} /> : null}
                </button>
                <div className={item.done ? 'text-ink-3 line-through' : ''}>
                  <p className="text-[15px]">{item.text}</p>
                  <p className="text-xs text-ink-3">{item.asked_by} · {timeAgo(item.created_at)}</p>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex gap-2">
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addQuestion()} placeholder="Is the BP dose still right?" />
            <Button onClick={addQuestion}>Add</Button>
          </div>
        </Card>
      </div>

      {editing ? (
        <VisitForm visit={editing.id ? editing : null} members={data.members} canManage={data.can.manage} name={name}
          onClose={() => setEditing(null)} onSaved={(res) => { toast(res.proposed ? `Sent to ${name} to approve` : 'Saved'); setEditing(null); load(); }} />
      ) : null}
    </div>
  );
}

function VisitForm({ visit, members, canManage, name, onClose, onSaved }) {
  const tomorrow = Date.now() + 86400000;
  const [form, setForm] = useState({
    doctor: visit?.doctor || '', specialty: visit?.specialty || '', place: visit?.place || '',
    date: toDateInput(visit?.starts_at || tomorrow), time: visit ? toTimeInput(visit.starts_at) : '11:00',
    purpose: visit?.purpose || '', companion_id: visit?.companion_id || '', notes: visit?.notes || '', reason: '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  async function save() {
    setBusy(true);
    setError('');
    try {
      const res = visit ? await api(`/care/appointments/${visit.id}`, { method: 'PUT', body: form }) : await api('/care/appointments', { method: 'POST', body: form });
      onSaved(res);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title={visit ? 'Edit visit' : 'Add a doctor visit'}
      footer={<div className="flex items-center gap-3"><ErrorNote error={error} /><Button className="ml-auto" busy={busy} onClick={save}>{canManage ? 'Save' : `Send to ${name} to approve`}</Button></div>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Doctor"><input className="input" value={form.doctor} onChange={set('doctor')} placeholder="Dr. Arvind Sharma" /></Field>
          <Field label="Speciality"><input className="input" value={form.specialty} onChange={set('specialty')} placeholder="Cardiologist" /></Field>
        </div>
        <Field label="Place"><input className="input" value={form.place} onChange={set('place')} placeholder="City Heart Clinic, Sector 15" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date"><input className="input" type="date" value={form.date} onChange={set('date')} /></Field>
          <Field label="Time"><input className="input" type="time" value={form.time} onChange={set('time')} /></Field>
        </div>
        <Field label="What is it for?"><input className="input" value={form.purpose} onChange={set('purpose')} placeholder="3-month check-up" /></Field>
        <Field label="Who is going along?">
          <select className="input" value={form.companion_id} onChange={set('companion_id')}>
            <option value="">Not decided</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.relation})</option>)}
          </select>
        </Field>
        {!canManage ? <Field label={`Why? (${name} will read this)`}><textarea className="input" value={form.reason} onChange={set('reason')} /></Field> : null}
      </div>
    </Modal>
  );
}

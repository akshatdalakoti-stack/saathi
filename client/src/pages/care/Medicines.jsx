// Medicines: list, add/edit form, refill, prescription scan (AI) and clash check (AI).
import { useEffect, useState } from 'react';
import {
  Plus, ScanLine, ShieldAlert, Pencil, Ban, Package, Flame, Camera, Sparkles, Check, FileImage, MessageCircleQuestion,
} from 'lucide-react';
import { api, shrinkImage } from '../../api.js';
import { Button, Card, Badge, Modal, Field, ErrorNote, PillIcon, Spinner, useToast, niceTime, PILL_COLORS } from '../../ui.jsx';
import { CATEGORIES, categoryOf } from '../../../../shared/categories.js';

const FOOD = { before: 'Before food', after: 'After food', with: 'With food', empty: 'Empty stomach', any: 'Any time' };
const FORMS = ['tablet', 'capsule', 'syrup', 'injection', 'drops', 'inhaler'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function addMinutes(hhmm, mins) {
  const [h, m] = hhmm.split(':').map(Number);
  const total = (h * 60 + m + mins + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function quickTimes(routine) {
  return [
    ['On waking', routine.wake],
    ['Before breakfast', addMinutes(routine.breakfast, -30)],
    ['After breakfast', addMinutes(routine.breakfast, 30)],
    ['After lunch', addMinutes(routine.lunch, 30)],
    ['Evening tea', routine.tea],
    ['After dinner', addMinutes(routine.dinner, 30)],
    ['Bedtime', routine.bed],
  ];
}

function applyResult(res, toast, name) {
  if (res.proposed) toast(`Sent to ${name} to approve`);
  else toast('Saved');
}

export default function Medicines({ ov, reload }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(null);
  const [scan, setScan] = useState(false);
  const [clash, setClash] = useState(false);
  const [refill, setRefill] = useState(null);
  const name = ov.profile.call_name || ov.profile.name;

  async function load() {
    setData(await api('/care/meds'));
  }
  useEffect(() => { load(); }, []);

  if (!data) return <Spinner />;
  const active = data.meds.filter((m) => m.active);
  const stopped = data.meds.filter((m) => !m.active);
  const canChange = data.can.suggest;

  async function stop(med) {
    if (!window.confirm(`Stop ${med.name}? ${data.can.manage ? '' : `${name} will be asked to approve.`}`)) return;
    try {
      const res = await api(`/care/meds/${med.id}`, { method: 'DELETE' });
      applyResult(res, toast, name);
      load();
      reload();
    } catch (err) { toast(err.message, { tone: 'bad' }); }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold">Medicines</h1>
          <p className="text-ink-2">{active.length} active · shown to {name} by colour, shape and what each one is for.</p>
        </div>
        {canChange ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setClash(true)}><ShieldAlert size={18} /> Check for clashes</Button>
            <Button variant="secondary" onClick={() => setScan(true)}><ScanLine size={18} /> Scan prescription</Button>
            <Button onClick={() => setEditing({})}><Plus size={18} /> Add medicine</Button>
          </div>
        ) : null}
      </div>

      {!data.can.manage && canChange ? (
        <p className="flex items-center gap-2 rounded-2xl border border-sun-100 bg-sun-50 px-4 py-3 font-semibold text-sun-800">
          <Sparkles size={18} /> Changes you make are sent to {name} to approve. Nothing changes without their yes.
        </p>
      ) : null}
      {!canChange ? <p className="rounded-2xl bg-paper-2 px-4 py-3 text-ink-2">You can view this care plan. {name} can give you more access.</p> : null}

      <div className="grid gap-4 md:grid-cols-2">
        {active.map((m) => {
          const s = m.stock_info;
          const pct = s ? Math.min(100, Math.round((s.daysLeft / 30) * 100)) : 0;
          return (
            <Card key={m.id} className="p-5">
              <div className="flex items-start gap-4">
                <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-paper-2"><PillIcon color={m.pill_color} shape={m.pill_shape} form={m.form} size={46} /></span>
                <div className="min-w-0 flex-1">
                  <p className="text-lg font-bold leading-tight">{m.name} <span className="font-normal text-ink-2">{m.strength}</span></p>
                  <p className="font-semibold text-brand-700">{categoryOf(m.category).emoji} {categoryOf(m.category).label}{m.purpose ? <span className="font-normal text-ink-2"> · {m.purpose}</span> : null}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {m.times.map((t) => <Badge key={t} tone="brand">{niceTime(t)}</Badge>)}
                    <Badge>{FOOD[m.food] || m.food}</Badge>
                    {m.days !== 'daily' ? <Badge tone="calm">{m.days.map((d) => WEEKDAYS[d]).join(', ')}</Badge> : null}
                    {m.critical ? <Badge tone="bad"><Flame size={12} /> Critical</Badge> : null}
                  </div>
                </div>
              </div>
              {s ? (
                <div className="mt-4">
                  <div className="flex justify-between text-sm">
                    <span className={s.low ? 'font-bold text-sun-800' : 'text-ink-2'}>{s.stock} left · about {s.daysLeft} days</span>
                    <span className="text-ink-3">runs out {s.runsOut}</span>
                  </div>
                  <div className="mt-1.5 h-2 rounded-full bg-paper-2"><div className={`h-2 rounded-full ${s.low ? 'bg-sun-500' : 'bg-ok-500'}`} style={{ width: `${Math.max(4, pct)}%` }} /></div>
                </div>
              ) : <p className="mt-4 text-sm text-ink-3">Pill count not tracked</p>}
              {m.notes ? <p className="mt-3 rounded-xl bg-paper px-3 py-2 text-sm text-ink-2">{m.notes}</p> : null}
              {canChange ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setEditing(m)}><Pencil size={15} /> Edit</Button>
                  <Button size="sm" variant="secondary" onClick={() => setRefill(m)}><Package size={15} /> Refilled</Button>
                  <Button size="sm" variant="ghost" className="ml-auto !text-bad-600" onClick={() => stop(m)}><Ban size={15} /> Stop</Button>
                </div>
              ) : null}
            </Card>
          );
        })}
      </div>

      {stopped.length ? (
        <details className="rounded-2xl border border-line bg-white/60 p-4">
          <summary className="cursor-pointer font-semibold text-ink-2">Stopped medicines ({stopped.length})</summary>
          <ul className="mt-3 space-y-1 text-ink-2">{stopped.map((m) => <li key={m.id}>{m.name} {m.strength}</li>)}</ul>
        </details>
      ) : null}

      {editing ? (
        <MedForm
          med={editing.id ? editing : null}
          routine={data.routine}
          canManage={data.can.manage}
          elderName={name}
          onClose={() => setEditing(null)}
          onSaved={(res) => { applyResult(res, toast, name); setEditing(null); load(); reload(); }}
        />
      ) : null}
      {scan ? <ScanModal name={name} onClose={() => setScan(false)} onDone={() => { load(); reload(); }} /> : null}
      {clash ? <ClashModal onClose={() => setClash(false)} /> : null}
      {refill ? <RefillModal med={refill} onClose={() => setRefill(null)} onDone={() => { setRefill(null); load(); reload(); toast('Refill recorded'); }} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------- add / edit

export function MedForm({ med, routine, canManage, elderName, onClose, onSaved, initial }) {
  const start = med || initial || {};
  const [form, setForm] = useState({
    name: start.name || '', strength: start.strength || '', form: start.form || 'tablet', amount: start.amount || 1,
    purpose: start.purpose || '', category: start.category || '', pill_color: start.pill_color || 'white', pill_shape: start.pill_shape || 'round',
    food: start.food || 'after', times: start.times || [], days: start.days || 'daily',
    stock: start.stock ?? '', refill_at_days: start.refill_at_days || 5, critical: !!start.critical, notes: start.notes || '', reason: '',
  });
  const [custom, setCustom] = useState('09:00');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  function toggleTime(time) {
    const times = form.times.includes(time) ? form.times.filter((t) => t !== time) : [...form.times, time].sort();
    setForm({ ...form, times });
  }
  function toggleDay(d) {
    const days = form.days === 'daily' ? [0, 1, 2, 3, 4, 5, 6] : form.days;
    const next = days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort();
    setForm({ ...form, days: next.length === 7 || next.length === 0 ? 'daily' : next });
  }

  async function save() {
    setBusy(true);
    setError('');
    try {
      const body = { ...form, amount: Number(form.amount), stock: form.stock === '' ? null : Number(form.stock) };
      const res = med ? await api(`/care/meds/${med.id}`, { method: 'PUT', body }) : await api('/care/meds', { method: 'POST', body });
      onSaved(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={med ? `Edit ${med.name}` : 'Add a medicine'} wide
      footer={<div className="flex items-center gap-3"><ErrorNote error={error} /><Button className="ml-auto" busy={busy} onClick={save}>{canManage ? 'Save' : `Send to ${elderName} to approve`}</Button></div>}>
      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-4">
          <div className="grid grid-cols-[2fr_1fr] gap-3">
            <Field label="Medicine name"><input className="input" value={form.name} onChange={set('name')} placeholder="Metformin" /></Field>
            <Field label="Strength"><input className="input" value={form.strength} onChange={set('strength')} placeholder="500 mg" /></Field>
          </div>
          <div>
            <span className="label">What is it for?</span>
            <p className="hint !mt-0 mb-2">{elderName} sees this picture and word in their own language, next to the name: "{form.name || 'Metformin'} ({categoryOf(form.category).label.toLowerCase()})".</p>
            <div className="grid max-h-56 grid-cols-2 gap-1.5 overflow-y-auto rounded-xl border border-line bg-white p-2 sm:grid-cols-3">
              {CATEGORIES.map((c) => (
                <button key={c.key} type="button" onClick={() => setForm({ ...form, category: c.key })}
                  className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${form.category === c.key ? 'bg-brand-700 font-semibold text-white' : 'hover:bg-paper-2'}`}>
                  <span className="text-lg">{c.emoji}</span> {c.label}
                </button>
              ))}
            </div>
          </div>
          <Field label="Extra note for the family (optional)">
            <input className="input" value={form.purpose} onChange={set('purpose')} placeholder="for blood sugar, started by Dr. Sharma" />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Type"><select className="input capitalize" value={form.form} onChange={set('form')}>{FORMS.map((f) => <option key={f}>{f}</option>)}</select></Field>
            <Field label="How many"><input className="input" type="number" min="0.5" step="0.5" value={form.amount} onChange={set('amount')} /></Field>
            <Field label="Food"><select className="input" value={form.food} onChange={set('food')}>{Object.entries(FOOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          </div>
          <div>
            <span className="label">What it looks like</span>
            <div className="flex flex-wrap items-center gap-2">
              {Object.keys(PILL_COLORS).map((c) => (
                <button key={c} type="button" onClick={() => setForm({ ...form, pill_color: c })} aria-label={c} title={c}
                  className={`h-8 w-8 rounded-full border-2 ${form.pill_color === c ? 'border-brand-700 ring-2 ring-brand-100' : 'border-line-2'}`} style={{ background: PILL_COLORS[c] }} />
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              {['round', 'oval', 'oblong'].map((s) => (
                <button key={s} type="button" onClick={() => setForm({ ...form, pill_shape: s })}
                  className={`flex items-center gap-1 rounded-xl border-2 px-2 py-1 text-sm capitalize ${form.pill_shape === s ? 'border-brand-700 bg-brand-50' : 'border-line'}`}>
                  <PillIcon color={form.pill_color} shape={s} form={form.form === 'capsule' ? 'tablet' : form.form} size={28} /> {s}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="space-y-4">
          <div>
            <span className="label">When (based on {elderName}'s routine)</span>
            <div className="flex flex-wrap gap-2">
              {quickTimes(routine).map(([label, time]) => (
                <button key={label} type="button" onClick={() => toggleTime(time)}
                  className={`rounded-xl border-2 px-3 py-1.5 text-sm font-semibold ${form.times.includes(time) ? 'border-brand-700 bg-brand-700 text-white' : 'border-line bg-white'}`}>
                  {label} <span className="font-normal opacity-80">{niceTime(time)}</span>
                </button>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <input type="time" className="input !w-36" value={custom} onChange={(e) => setCustom(e.target.value)} />
              <Button type="button" variant="secondary" onClick={() => custom && !form.times.includes(custom) && toggleTime(custom)}><Plus size={16} /> Other time</Button>
            </div>
            {form.times.length ? <p className="hint">Chosen: {form.times.map(niceTime).join(', ')}</p> : null}
          </div>
          <div>
            <span className="label">Which days</span>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map((d, i) => {
                const on = form.days === 'daily' || form.days.includes(i);
                return <button key={d} type="button" onClick={() => toggleDay(i)} className={`h-9 w-11 rounded-lg border text-sm font-semibold ${on ? 'border-brand-700 bg-brand-50 text-brand-800' : 'border-line bg-white text-ink-3'}`}>{d}</button>;
              })}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Pills left (optional)" hint="Saathi warns before they run out"><input className="input" type="number" min="0" value={form.stock} onChange={set('stock')} /></Field>
            <Field label="Warn when days left"><input className="input" type="number" min="1" value={form.refill_at_days} onChange={set('refill_at_days')} /></Field>
          </div>
          <label className="flex items-center gap-3 rounded-xl border border-line bg-white p-3">
            <input type="checkbox" className="h-5 w-5 accent-[#C2413A]" checked={form.critical} onChange={set('critical')} />
            <span><b>Critical medicine</b><span className="block text-xs text-ink-3">Missed doses escalate to family twice as fast</span></span>
          </label>
          <Field label="Notes"><textarea className="input" value={form.notes} onChange={set('notes')} placeholder="Swallow whole. Do not crush." /></Field>
          {!canManage ? (
            <Field label={`Why are you suggesting this? (${elderName} will read this)`}>
              <textarea className="input" value={form.reason} onChange={set('reason')} placeholder="Dr. Sharma asked to add this at the last visit." />
            </Field>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- prescription scan

// A sample prescription drawn on the fly, so the scanner can be tried without a real one.
function samplePrescription() {
  const canvas = document.createElement('canvas');
  canvas.width = 1000;
  canvas.height = 760;
  const g = canvas.getContext('2d');
  g.fillStyle = '#fffdf7';
  g.fillRect(0, 0, 1000, 760);
  g.fillStyle = '#1d3f72';
  g.font = 'bold 34px Georgia, serif';
  g.fillText('Dr. Meera Iyer, MBBS, MD (Medicine)', 50, 70);
  g.font = '22px Georgia, serif';
  g.fillText('City Care Clinic, MG Road  ·  Reg. No. 48213', 50, 105);
  g.strokeStyle = '#1d3f72';
  g.lineWidth = 3;
  g.beginPath(); g.moveTo(50, 125); g.lineTo(950, 125); g.stroke();
  g.fillStyle = '#222';
  g.font = '24px Georgia, serif';
  g.fillText('Patient: Kamla Devi Sharma    Age: 79 / F    Date: ' + new Date().toLocaleDateString('en-IN'), 50, 170);
  g.font = 'bold 54px Georgia, serif';
  g.fillText('Rx', 50, 250);
  g.font = '26px "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive';
  const lines = [
    ['1. Tab. Telmisartan 40 mg', '1 - 0 - 0', 'after food, 30 days'],
    ['2. Tab. Glimepiride 1 mg', '1 - 0 - 0', 'before breakfast'],
    ['3. Cap. Vitamin D3 60000 IU', 'once a week', 'Sunday'],
    ['4. Tab. Paracetamol 650 mg', 'SOS', 'for knee pain'],
  ];
  lines.forEach((cols, i) => {
    g.fillText(cols[0], 60, 320 + i * 75);
    g.fillText(cols[1], 500, 320 + i * 75);
    g.fillText(cols[2], 700, 320 + i * 75);
  });
  g.font = '24px Georgia, serif';
  g.fillText('Review after 1 month with sugar reports.', 70, 650);
  g.font = 'italic 28px "Segoe Print", cursive';
  g.fillText('M. Iyer', 760, 720);
  return canvas.toDataURL('image/jpeg', 0.9);
}

function ScanModal({ name, onClose, onDone }) {
  const toast = useToast();
  const [image, setImage] = useState(null);
  const [result, setResult] = useState(null);
  const [picked, setPicked] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function choose(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setError('');
    try { setImage(await shrinkImage(file)); setResult(null); } catch (err) { setError(err.message); }
  }

  async function read() {
    setBusy(true);
    setError('');
    try {
      const res = await api('/care/scan', { method: 'POST', body: { image } });
      setResult(res);
      // "Only when needed" (SOS) medicines are not put on a schedule unless someone ticks them.
      setPicked(res.medicines.map((m) => !m.as_needed));
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  function update(i, key, value) {
    const meds = [...result.medicines];
    meds[i] = { ...meds[i], [key]: value };
    setResult({ ...result, medicines: meds });
  }

  async function addAll() {
    setBusy(true);
    let applied = 0;
    let proposed = 0;
    try {
      for (let i = 0; i < result.medicines.length; i++) {
        if (!picked[i]) continue;
        const m = result.medicines[i];
        const res = await api('/care/meds', { method: 'POST', body: { ...m, notes: [m.notes, m.duration_days ? `For ${m.duration_days} days` : ''].filter(Boolean).join(' · '), reason: 'Read from the prescription photo' } });
        if (res.proposed) proposed += 1; else applied += 1;
      }
      toast(proposed ? `${proposed} sent to ${name} to approve` : `${applied} medicines added`);
      onDone();
      onClose();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title="Scan a prescription" wide
      footer={result ? <div className="flex items-center gap-3"><ErrorNote error={error} /><Button className="ml-auto" busy={busy} onClick={addAll}><Check size={18} /> Add {picked.filter(Boolean).length} medicines</Button></div> : null}>
      {!result ? (
        <div className="space-y-4">
          <p className="text-ink-2">Take a photo of a prescription, a medicine strip or a box. Saathi's AI reads it and fills in the form. You check everything before it's saved.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line-2 bg-white p-8 text-center hover:border-brand-500">
              <Camera size={32} className="text-brand-700" />
              <span className="font-bold">Take or choose a photo</span>
              <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={choose} />
            </label>
            <button onClick={() => { setImage(samplePrescription()); setResult(null); }} className="flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line-2 bg-white p-8 hover:border-brand-500">
              <FileImage size={32} className="text-sun-600" />
              <span className="font-bold">Use a sample prescription</span>
              <span className="text-xs text-ink-3">Handy for a quick demo</span>
            </button>
          </div>
          {image ? (
            <div className="space-y-3">
              <img src={image} alt="Prescription to read" className="max-h-80 w-full rounded-2xl border border-line object-contain bg-white" />
              <Button size="lg" className="w-full" busy={busy} onClick={read}><Sparkles size={18} /> {busy ? 'Reading the prescription…' : 'Read it with AI'}</Button>
            </div>
          ) : null}
          <ErrorNote error={error} />
        </div>
      ) : (
        <div className="space-y-3">
          {result.doctor ? <p className="text-sm text-ink-2">Prescribed by <b>{result.doctor}</b></p> : null}
          {result.unclear ? <p className="rounded-xl bg-sun-50 px-3 py-2 text-sm text-sun-800">Couldn't read clearly: {result.unclear}</p> : null}
          {result.medicines.length === 0 ? <p>No medicines found. Try a clearer photo.</p> : null}
          {result.medicines.map((m, i) => (
            <div key={i} className={`rounded-2xl border p-4 ${picked[i] ? 'border-brand-200 bg-white' : 'border-line bg-paper opacity-60'}`}>
              <div className="flex flex-wrap items-center gap-3">
                <input type="checkbox" className="h-5 w-5 accent-[#0F6E64]" checked={picked[i]} onChange={(e) => setPicked(picked.map((p, j) => (j === i ? e.target.checked : p)))} aria-label="Include" />
                <PillIcon color={m.pill_color} form={m.form} size={32} />
                <input className="input !min-h-9 !w-44 font-bold" value={m.name} onChange={(e) => update(i, 'name', e.target.value)} />
                <input className="input !min-h-9 !w-28" value={m.strength} onChange={(e) => update(i, 'strength', e.target.value)} />
                <select className="input !min-h-9 min-w-40 flex-1" value={m.category} onChange={(e) => update(i, 'category', e.target.value)} aria-label="What it's for">
                  {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.emoji} {c.label}</option>)}
                </select>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 pl-8 text-sm">
                {m.as_needed ? <Badge tone="sun">Only when needed, not scheduled</Badge> : m.times.map((t) => <Badge key={t} tone="brand">{niceTime(t)}</Badge>)}
                {m.days && m.days.length ? <Badge tone="calm">{m.days.map((d) => WEEKDAYS[d]).join(', ')} only</Badge> : null}
                <Badge>{FOOD[m.food]}</Badge>
                {m.duration_days ? <Badge tone="calm">{m.duration_days} days</Badge> : null}
                {m.notes ? <span className="text-ink-3">{m.notes}</span> : null}
              </div>
            </div>
          ))}
          <p className="text-xs text-ink-3">AI can make mistakes. Check every line against the prescription. You can fine-tune times and pill colours after adding.</p>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------- clash check

function ClashModal({ onClose }) {
  const toast = useToast();
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [added, setAdded] = useState([]);
  useEffect(() => {
    api('/care/clashes', { method: 'POST' }).then((r) => setItems(r.items)).catch((err) => setError(err.message));
  }, []);
  async function addQuestion(i, question) {
    await api('/care/questions', { method: 'POST', body: { text: question } });
    setAdded([...added, i]);
    toast('Added to the questions for the doctor');
  }
  return (
    <Modal open onClose={onClose} title="Check for clashes">
      <p className="mb-4 text-sm text-ink-2">Saathi's AI looks for well-known interactions, doubled ingredients and allergy conflicts, and turns each one into a question for the doctor. It's not medical advice.</p>
      {error ? <ErrorNote error={error} /> : null}
      {!items && !error ? <Spinner label="Checking the medicine list…" /> : null}
      {items && items.length === 0 ? <p className="rounded-xl bg-ok-50 px-4 py-3 font-semibold text-ok-800">Nothing notable found. Still worth reviewing the list with the doctor.</p> : null}
      <div className="space-y-3">
        {(items || []).map((it, i) => (
          <div key={i} className={`rounded-2xl border p-4 ${it.level === 'important' ? 'border-bad-100 bg-bad-50' : 'border-sun-100 bg-sun-50'}`}>
            <p className="text-sm font-bold">{(it.medicines || []).join(' + ')}</p>
            <p className="mt-1">{it.concern}</p>
            <p className="mt-2 flex gap-2 font-semibold"><MessageCircleQuestion size={18} className="mt-0.5 shrink-0" /> {it.question}</p>
            <Button size="sm" variant="secondary" className="mt-3" disabled={added.includes(i)} onClick={() => addQuestion(i, it.question)}>
              {added.includes(i) ? <><Check size={15} /> Added</> : 'Ask the doctor this'}
            </Button>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function RefillModal({ med, onClose, onDone }) {
  const [stock, setStock] = useState(String((med.stock || 0) + 30));
  const [error, setError] = useState('');
  async function save() {
    try {
      await api(`/care/meds/${med.id}/refill`, { method: 'POST', body: { stock: Number(stock) } });
      onDone();
    } catch (err) { setError(err.message); }
  }
  return (
    <Modal open onClose={onClose} title={`Refill ${med.name}`}>
      <Field label="How many are there now?" hint={`Before the refill there were ${med.stock ?? 'no'} left.`}>
        <input className="input" type="number" min="0" value={stock} onChange={(e) => setStock(e.target.value)} autoFocus />
      </Field>
      <div className="mt-4"><ErrorNote error={error} /></div>
      <Button className="mt-4 w-full" onClick={save}>Save</Button>
    </Modal>
  );
}

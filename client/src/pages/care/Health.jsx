// Health readings: BP and sugar over the last 30 days, weight, and the daily health tasks.
// Charts follow the dataviz rules: one axis, thin lines, the normal range as a quiet band,
// a hover tooltip, direct labels, and a table view. Out-of-range points get a ring + a word.
import { useEffect, useMemo, useRef, useState } from 'react';
import { HeartPulse, Droplet, Scale, Plus, Trash2, Check, Table2 } from 'lucide-react';
import { api } from '../../api.js';
import { Button, Card, Badge, Modal, Field, ErrorNote, Spinner, useToast, niceTime, dayDate, timeAgo } from '../../ui.jsx';

const SERIES = { upper: '#2a78d6', lower: '#eb6834', sugar: '#2a78d6', weight: '#2a78d6' }; // validated palette slots 1 and 2
const STATUS = { high: ['#C97714', 'high'], low: ['#2F64A8', 'low'], danger: ['#C2413A', 'urgent'] };
const KINDS = [
  ['bp', '🩺', 'BP check'], ['sugar', '🩸', 'Sugar check'], ['weight', '⚖️', 'Weight check'],
  ['walk', '🚶', 'Walk'], ['exercise', '🧘', 'Exercise'], ['water', '💧', 'Water'], ['other', '✅', 'Other'],
];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function LineChart({ points, lines, band, unit, yMin, yMax, label }) {
  const [hover, setHover] = useState(null);
  const [W, setW] = useState(640);
  const svgRef = useRef(null);
  const boxRef = useRef(null);
  // Draw at the real width, so labels stay a readable size on any screen.
  useEffect(() => {
    if (!boxRef.current) return undefined;
    const observer = new ResizeObserver(([entry]) => setW(Math.max(280, Math.round(entry.contentRect.width))));
    observer.observe(boxRef.current);
    return () => observer.disconnect();
  }, []);
  const H = 240;
  const pad = { l: 40, r: 64, t: 16, b: 28 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  if (points.length === 0) return <p ref={boxRef} className="py-10 text-center text-ink-3">No readings yet.</p>;
  const t0 = points[0].created_at;
  const t1 = Math.max(points[points.length - 1].created_at, t0 + 1);
  const x = (t) => pad.l + ((t - t0) / (t1 - t0)) * plotW;
  const y = (v) => pad.t + (1 - (v - yMin) / (yMax - yMin)) * plotH;
  const ticks = [];
  const step = (yMax - yMin) / 4;
  for (let i = 0; i <= 4; i++) ticks.push(Math.round(yMin + step * i));
  const dateTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => t0 + f * (t1 - t0));

  function onMove(e) {
    const rect = svgRef.current.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(x(points[i].created_at) - px) < Math.abs(x(points[best].created_at) - px)) best = i;
    setHover(best);
  }

  const hp = hover === null ? null : points[hover];
  return (
    <div className="relative" ref={boxRef}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block max-w-full touch-none" role="img" aria-label={label}
        onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        {band ? (
          <g>
            <rect x={pad.l} width={plotW} y={y(band[1])} height={y(band[0]) - y(band[1])} fill="var(--color-ok-50)" />
            <text x={pad.l + 6} y={y(band[1]) + 14} fontSize="11" fill="var(--color-ok-800)">normal range</text>
          </g>
        ) : null}
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={pad.l + plotW} y1={y(v)} y2={y(v)} stroke="var(--color-line)" strokeWidth="1" />
            <text x={pad.l - 8} y={y(v) + 4} fontSize="11" textAnchor="end" fill="var(--color-ink-3)">{v}</text>
          </g>
        ))}
        {dateTicks.map((t, i) => (
          <text key={i} x={x(t)} y={H - 8} fontSize="11" textAnchor={i === 0 ? 'start' : i === 4 ? 'end' : 'middle'} fill="var(--color-ink-3)">
            {new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
          </text>
        ))}
        {hp ? <line x1={x(hp.created_at)} x2={x(hp.created_at)} y1={pad.t} y2={pad.t + plotH} stroke="var(--color-ink-3)" strokeWidth="1" strokeDasharray="3 3" /> : null}
        {lines.map((line) => {
          const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.created_at).toFixed(1)},${y(p[line.key]).toFixed(1)}`).join(' ');
          const last = points[points.length - 1];
          return (
            <g key={line.key}>
              <path d={d} fill="none" stroke={line.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              {points.map((p, i) => {
                const flag = p.level && p.level !== 'ok' ? STATUS[p.level] : null;
                return (
                  <g key={i}>
                    {flag ? <circle cx={x(p.created_at)} cy={y(p[line.key])} r="7.5" fill="none" stroke={flag[0]} strokeWidth="2" /> : null}
                    <circle cx={x(p.created_at)} cy={y(p[line.key])} r={hover === i ? 5.5 : 4} fill={line.color} stroke="#fff" strokeWidth="2" />
                  </g>
                );
              })}
              <text x={x(last.created_at) + 10} y={y(last[line.key]) + 4} fontSize="12" fontWeight="700" fill="var(--color-ink-2)">{line.label}</text>
            </g>
          );
        })}
      </svg>
      {hp ? (
        <div className="pointer-events-none absolute top-0 rounded-xl bg-ink px-3 py-2 text-sm text-white shadow-lift"
          style={{ left: `${Math.min(70, Math.max(0, (x(hp.created_at) / W) * 100 - 10))}%` }}>
          <p className="font-semibold">{dayDate(hp.created_at, 'en', { weekday: 'short', day: 'numeric', month: 'short' })}</p>
          <p>{lines.map((l) => `${Math.round(hp[l.key])}`).join('/')} {unit}{hp.level && hp.level !== 'ok' ? ` · ${STATUS[hp.level][1]}` : ''}</p>
        </div>
      ) : null}
    </div>
  );
}

function ReadingTable({ points, kind }) {
  return (
    <details className="mt-3">
      <summary className="flex cursor-pointer items-center gap-1.5 text-sm font-semibold text-ink-2"><Table2 size={15} /> Show as a table</summary>
      <table className="mt-2 w-full text-left text-sm">
        <thead><tr className="border-b border-line text-ink-3"><th className="py-1">Date</th><th>Reading</th><th>Status</th></tr></thead>
        <tbody>
          {[...points].reverse().map((p, i) => (
            <tr key={i} className="border-b border-line">
              <td className="py-1.5">{dayDate(p.created_at)}</td>
              <td>{kind === 'bp' ? `${Math.round(p.value1)}/${Math.round(p.value2)}` : Math.round(p.value1 * 10) / 10}</td>
              <td>{p.level === 'ok' || !p.level ? 'normal' : STATUS[p.level][1]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

function summary(points, kind) {
  if (!points.length) return null;
  const avg = (k) => Math.round(points.reduce((s, p) => s + p[k], 0) / points.length);
  const out = points.filter((p) => p.level && p.level !== 'ok').length;
  return { avg: kind === 'bp' ? `${avg('value1')}/${avg('value2')}` : `${avg('value1')}`, out };
}

export default function Health({ ov }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [adding, setAdding] = useState(false);
  const [logging, setLogging] = useState(null);
  const name = ov.profile.call_name || ov.profile.name;

  async function load() { setData(await api('/care/health')); }
  useEffect(() => { load(); }, []);
  const bpSum = useMemo(() => (data ? summary(data.bp, 'bp') : null), [data]);
  const sugarSum = useMemo(() => (data ? summary(data.sugar, 'sugar') : null), [data]);
  if (!data) return <Spinner />;

  async function remove(r) {
    if (!window.confirm(`Remove "${r.title}" from ${name}'s day?`)) return;
    await api(`/care/routines/${r.id}`, { method: 'DELETE' });
    toast('Removed');
    load();
  }

  const bpValues = data.bp.flatMap((p) => [p.value1, p.value2]);
  const sugarValues = data.sugar.map((p) => p.value1);
  const weightValues = data.weight.map((p) => p.value1);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-4xl font-bold">Health readings</h1>
          <p className="text-ink-2">{name} records these on the big number pad, or a caretaker does. Out-of-range readings email the family at once.</p>
        </div>
        {data.can.suggest ? <Button onClick={() => setAdding(true)}><Plus size={18} /> Add health task</Button> : null}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-bold"><HeartPulse size={19} className="text-bad-600" /> Blood pressure, last 30 days</h2>
              <p className="text-sm text-ink-2">mmHg · normal range shaded (under 140/90)</p>
            </div>
            {bpSum ? <Badge tone={bpSum.out ? 'sun' : 'ok'}>avg {bpSum.avg} · {bpSum.out} out of range</Badge> : null}
          </div>
          <div className="mt-2 flex gap-4 text-sm text-ink-2" aria-hidden>
            <span className="flex items-center gap-1.5"><span className="h-0.5 w-5 rounded" style={{ background: SERIES.upper }} /> Upper</span>
            <span className="flex items-center gap-1.5"><span className="h-0.5 w-5 rounded" style={{ background: SERIES.lower }} /> Lower</span>
            <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full border-2" style={{ borderColor: STATUS.high[0] }} /> Out of range</span>
          </div>
          <LineChart label="Blood pressure readings" points={data.bp} unit="mmHg" band={[60, 140]}
            yMin={Math.min(60, ...bpValues) - 5} yMax={Math.max(160, ...bpValues) + 5}
            lines={[{ key: 'value1', label: 'Upper', color: SERIES.upper }, { key: 'value2', label: 'Lower', color: SERIES.lower }]} />
          <ReadingTable points={data.bp} kind="bp" />
        </Card>

        <Card className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-bold"><Droplet size={19} className="text-bad-600" /> Fasting sugar, last 30 days</h2>
              <p className="text-sm text-ink-2">mg/dL · normal range shaded (70 to 180)</p>
            </div>
            {sugarSum ? <Badge tone={sugarSum.out ? 'sun' : 'ok'}>avg {sugarSum.avg} · {sugarSum.out} out of range</Badge> : null}
          </div>
          <LineChart label="Sugar readings" points={data.sugar} unit="mg/dL" band={[70, 180]}
            yMin={Math.min(60, ...sugarValues) - 5} yMax={Math.max(200, ...sugarValues) + 10}
            lines={[{ key: 'value1', label: 'Sugar', color: SERIES.sugar }]} />
          <ReadingTable points={data.sugar} kind="sugar" />
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <Card className="p-5">
          <h2 className="flex items-center gap-2 text-lg font-bold"><Scale size={19} className="text-calm-600" /> Weight</h2>
          {data.weight.length ? (
            <>
              <p className="mt-1 font-display text-4xl font-bold">{data.weight[data.weight.length - 1].value1} <span className="text-xl text-ink-3">kg</span></p>
              <p className="text-sm text-ink-2">
                {data.weight.length > 1 ? `${(data.weight[data.weight.length - 1].value1 - data.weight[0].value1).toFixed(1)} kg since ${dayDate(data.weight[0].created_at)}` : 'First reading'}
              </p>
              <LineChart label="Weight readings" points={data.weight} unit="kg"
                yMin={Math.floor(Math.min(...weightValues) - 2)} yMax={Math.ceil(Math.max(...weightValues) + 2)}
                lines={[{ key: 'value1', label: 'kg', color: SERIES.weight }]} />
            </>
          ) : <p className="mt-2 text-ink-3">No weight recorded yet.</p>}
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">{name}'s health tasks</h2>
            {data.adherence.pct !== null ? <Badge tone={data.adherence.pct >= 80 ? 'ok' : 'sun'}>{data.adherence.pct}% done last 7 days</Badge> : null}
          </div>
          <ul className="mt-3 divide-y divide-line">
            {data.today.length === 0 && data.routines.length === 0 ? <li className="py-3 text-ink-3">No health tasks yet.</li> : null}
            {data.routines.map((r) => {
              const today = data.today.find((x) => x.id === r.id);
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-3 py-3">
                  <span className="text-3xl" aria-hidden>{KINDS.find((k) => k[0] === r.kind)?.[1]}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold">{r.title}</p>
                    <p className="text-sm text-ink-2">{niceTime(r.time)} · {r.days === 'daily' ? 'every day' : r.days.map((d) => WEEKDAYS[d]).join(', ')}</p>
                  </div>
                  {today ? (today.done ? <Badge tone="ok"><Check size={12} /> {today.done.value || 'done'} · {timeAgo(today.done.at)}</Badge> : <Badge tone="sun">not yet today</Badge>) : <Badge>not today</Badge>}
                  {data.can.suggest && today && !today.done ? <Button size="sm" variant="secondary" onClick={() => setLogging(today)}>Record</Button> : null}
                  {data.can.suggest ? <button onClick={() => remove(r)} className="rounded-lg p-2 text-ink-3 hover:bg-paper-2" aria-label="Remove"><Trash2 size={16} /></button> : null}
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      {adding ? <AddRoutine onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); toast(`Added. It shows on ${name}'s "My day".`); }} /> : null}
      {logging ? <LogReading routine={logging} onClose={() => setLogging(null)} onSaved={(res) => { setLogging(null); load(); toast(res.level === 'ok' ? 'Saved' : `Saved. It's ${res.text}, so the family has been told.`); }} /> : null}
    </div>
  );
}

function AddRoutine({ onClose, onSaved }) {
  const [form, setForm] = useState({ kind: 'bp', title: '', time: '08:00', days: [] });
  const [error, setError] = useState('');
  async function save() {
    setError('');
    try {
      await api('/care/routines', { method: 'POST', body: form });
      onSaved();
    } catch (err) { setError(err.message); }
  }
  return (
    <Modal open onClose={onClose} title="Add a health task" footer={<div className="flex items-center gap-3"><ErrorNote error={error} /><Button className="ml-auto" onClick={save}>Add</Button></div>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {KINDS.map(([k, emoji, label]) => (
            <button key={k} type="button" onClick={() => setForm({ ...form, kind: k })}
              className={`flex flex-col items-center gap-1 rounded-xl border-2 p-3 text-sm font-semibold ${form.kind === k ? 'border-brand-700 bg-brand-50' : 'border-line bg-white'}`}>
              <span className="text-2xl">{emoji}</span>{label}
            </button>
          ))}
        </div>
        <Field label="Name (optional)"><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Morning BP" /></Field>
        <Field label="Time"><input className="input !w-40" type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} /></Field>
        <div>
          <span className="label">Days (none picked = every day)</span>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAYS.map((d, i) => {
              const on = form.days.includes(i);
              return <button key={d} type="button" onClick={() => setForm({ ...form, days: on ? form.days.filter((x) => x !== i) : [...form.days, i] })}
                className={`h-9 w-11 rounded-lg border text-sm font-semibold ${on ? 'border-brand-700 bg-brand-50 text-brand-800' : 'border-line bg-white text-ink-3'}`}>{d}</button>;
            })}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function LogReading({ routine, onClose, onSaved }) {
  const [v1, setV1] = useState('');
  const [v2, setV2] = useState('');
  const [error, setError] = useState('');
  async function save() {
    setError('');
    try {
      onSaved(await api(`/care/routines/${routine.id}/log`, { method: 'POST', body: routine.numbers ? { value1: v1, value2: v2 } : {} }));
    } catch (err) { setError(err.message); }
  }
  return (
    <Modal open onClose={onClose} title={`${routine.emoji} ${routine.title}`}>
      {routine.numbers ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label={routine.kind === 'bp' ? 'Upper' : routine.kind === 'weight' ? 'kg' : 'mg/dL'}><input className="input text-lg" inputMode="decimal" value={v1} onChange={(e) => setV1(e.target.value)} autoFocus /></Field>
          {routine.numbers === 2 ? <Field label="Lower"><input className="input text-lg" inputMode="numeric" value={v2} onChange={(e) => setV2(e.target.value)} /></Field> : null}
        </div>
      ) : <p>Mark this as done for today?</p>}
      <div className="mt-4"><ErrorNote error={error} /></div>
      <Button className="mt-4 w-full" onClick={save}>Save</Button>
    </Modal>
  );
}

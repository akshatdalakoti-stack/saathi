// A printable one-page summary to take to the doctor. The elder's own questions come first.
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Printer, ArrowLeft } from 'lucide-react';
import { api } from '../api.js';
import { Button, Spinner, PillIcon, niceTime, clock, dayDate } from '../ui.jsx';

const FOOD = { before: 'before food', after: 'after food', with: 'with food', empty: 'empty stomach', any: '' };

export default function VisitSheet() {
  const { id } = useParams();
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api(`/care/visit/${id}`).then(setD).catch((err) => setError(err.message)); }, [id]);
  if (error) return <p className="p-10">{error} <Link to="/care" className="underline">Back</Link></p>;
  if (!d) return <Spinner />;
  const p = d.profile;
  const age = p.birth_year ? new Date().getFullYear() - p.birth_year : null;
  const elderQs = d.questions.filter((q) => q.asked_by === p.name);
  const familyQs = d.questions.filter((q) => q.asked_by !== p.name);

  return (
    <div className="min-h-screen bg-paper-2 py-8 print:bg-white print:py-0">
      <div className="no-print mx-auto mb-4 flex max-w-3xl items-center justify-between px-4">
        <Link to="/care/visits" className="inline-flex items-center gap-1.5 font-semibold text-ink-2"><ArrowLeft size={16} /> Back</Link>
        <Button onClick={() => window.print()}><Printer size={16} /> Print</Button>
      </div>
      <article className="mx-auto max-w-3xl bg-white px-10 py-10 shadow-soft print:shadow-none">
        <header className="flex items-start justify-between border-b-2 border-brand-700 pb-4">
          <div>
            <p className="text-sm font-bold text-brand-700">Saathi · doctor visit sheet</p>
            <h1 className="mt-1 text-3xl font-bold">{p.name}{age ? `, ${age}` : ''}</h1>
            <p className="text-ink-2">{p.conditions}</p>
          </div>
          <div className="text-right text-sm">
            <p className="font-bold">{d.appt.doctor}</p>
            <p>{d.appt.specialty}</p>
            <p>{dayDate(d.appt.starts_at, 'en', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}, {clock(d.appt.starts_at)}</p>
          </div>
        </header>

        <section className="mt-5 grid grid-cols-3 gap-4 text-sm">
          <div className="rounded-xl bg-bad-50 p-3"><p className="text-xs font-bold text-bad-800">Allergies</p><p className="font-semibold">{p.allergies || 'None recorded'}</p></div>
          <div className="rounded-xl bg-paper p-3"><p className="text-xs font-bold text-ink-3">Blood group</p><p className="font-semibold">{p.blood_group || '–'}</p></div>
          <div className="rounded-xl bg-ok-50 p-3"><p className="text-xs font-bold text-ok-800">Doses taken since {d.since}</p><p className="font-semibold">{d.adherence.pct === null ? '–' : `${d.adherence.pct}%`} ({d.adherence.taken}/{d.adherence.total}, {d.adherence.missed} missed)</p></div>
        </section>

        <section className="mt-6">
          <h2 className="text-lg font-bold">{p.call_name || p.name}'s own questions</h2>
          {elderQs.length ? <ol className="mt-2 list-decimal space-y-1 pl-6">{elderQs.map((q) => <li key={q.id}>{q.text}</li>)}</ol> : <p className="text-ink-3">None this time.</p>}
          {familyQs.length ? (
            <>
              <h3 className="mt-3 font-bold text-ink-2">Questions from the family</h3>
              <ol className="mt-1 list-decimal space-y-1 pl-6 text-ink-2">{familyQs.map((q) => <li key={q.id}>{q.text} <span className="text-xs">({q.asked_by})</span></li>)}</ol>
            </>
          ) : null}
        </section>

        <section className="mt-6">
          <h2 className="text-lg font-bold">Current medicines</h2>
          <table className="mt-2 w-full text-left text-sm">
            <thead><tr className="border-b border-line text-ink-3"><th className="py-1.5">Medicine</th><th>Dose</th><th>When</th><th>For</th></tr></thead>
            <tbody>
              {d.meds.map((m) => (
                <tr key={m.id} className="border-b border-line">
                  <td className="py-2"><span className="inline-flex items-center gap-2"><PillIcon color={m.pill_color} shape={m.pill_shape} form={m.form} size={22} /><b>{m.name}</b> {m.strength}</span></td>
                  <td className="pr-4">{m.amount} {m.form}</td>
                  <td className="pr-4">{m.times.map(niceTime).join(', ')} {FOOD[m.food] ? `· ${FOOD[m.food]}` : ''}</td>
                  <td className="text-ink-2">{m.purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="mt-6 grid grid-cols-2 gap-6">
          <div>
            <h2 className="text-lg font-bold">Patterns noticed</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{d.notes.map((n) => <li key={n}>{n}</li>)}</ul>
            <div className="mt-3 space-y-1 text-sm">
              {d.patterns.filter((x) => x.total).map((x) => <p key={x.part} className="capitalize">{x.part}: {x.pct}% taken</p>)}
            </div>
          </div>
          <div>
            <h2 className="text-lg font-bold">Days felt unwell</h2>
            {d.unwell.length ? <ul className="mt-2 space-y-1 text-sm">{d.unwell.map((u) => <li key={u.date}>{u.date}: {u.symptoms.join(', ') || 'unwell'}</li>)}</ul> : <p className="mt-2 text-sm text-ink-3">None reported.</p>}
            <h3 className="mt-3 font-bold">Recently missed doses</h3>
            <ul className="mt-1 space-y-0.5 text-sm text-ink-2">{d.missed.slice(0, 8).map((m, i) => <li key={i}>{m.date} {niceTime(m.time)}: {m.name}</li>)}</ul>
          </div>
        </section>

        <section className="mt-8">
          <h2 className="text-lg font-bold">Doctor's notes</h2>
          {[0, 1, 2, 3, 4].map((i) => <div key={i} className="mt-7 border-b border-dashed border-line-2" />)}
        </section>
        <p className="mt-8 text-xs text-ink-3">Generated by Saathi from {p.call_name || p.name}'s own medicine log. Adherence is self-reported or confirmed by family.</p>
      </article>
    </div>
  );
}

// Adherence over time, patterns by time of day, and how the elder has been feeling.
import { useEffect, useState } from 'react';
import { Sunrise, Sun, Sunset, Moon, Lightbulb } from 'lucide-react';
import { api } from '../../api.js';
import { Card, Spinner, PART_STYLE } from '../../ui.jsx';

const PART_ICON = { morning: Sunrise, afternoon: Sun, evening: Sunset, night: Moon };
const MOOD_COLOR = { good: 'bg-ok-500', okay: 'bg-sun-500', unwell: 'bg-bad-500' };

function cellColor(day) {
  if (!day.total) return 'bg-paper-2';
  if (day.pct === 100) return 'bg-ok-500';
  if (day.pct >= 80) return 'bg-ok-100';
  if (day.pct >= 60) return 'bg-sun-100';
  return 'bg-bad-100';
}

export default function Insights({ ov }) {
  const [data, setData] = useState(null);
  const name = ov.profile.call_name || ov.profile.name;
  useEffect(() => { api('/care/insights').then(setData); }, []);
  if (!data) return <Spinner />;

  const stats = [
    ['This week', data.week.pct === null ? '–' : `${data.week.pct}%`, `${data.week.taken} of ${data.week.total} doses`],
    ['Last week', data.prevWeek.pct === null ? '–' : `${data.prevWeek.pct}%`, `${data.prevWeek.taken} of ${data.prevWeek.total} doses`],
    ['Last 30 days', data.month.pct === null ? '–' : `${data.month.pct}%`, `${data.month.missed} missed, ${data.month.skipped} skipped by choice`],
  ];
  const firstDay = new Date(`${data.heatmap[0].date}T00:00`).getDay();
  const moodsByDate = Object.fromEntries(data.moods.map((m) => [m.date, m]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold">Insights</h1>
        <p className="text-ink-2">Patterns that help the family, and the doctor, support {name}.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {stats.map(([label, value, sub]) => (
          <Card key={label} className="p-5">
            <p className="text-sm font-semibold text-ink-3">{label}</p>
            <p className="mt-1 text-4xl font-bold">{value}</p>
            <p className="text-sm text-ink-2">{sub}</p>
          </Card>
        ))}
      </div>

      {data.notes.length ? (
        <Card className="space-y-2 border-sun-100 bg-sun-50 p-5">
          {data.notes.map((n) => <p key={n} className="flex gap-2 text-sun-800"><Lightbulb size={18} className="mt-0.5 shrink-0" /> {n}</p>)}
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-lg font-bold">Last 4 weeks</h2>
          <p className="text-sm text-ink-2">Each square is a day. Dark green means every dose was taken.</p>
          <div className="mt-4 grid grid-cols-7 gap-1.5 text-center text-xs text-ink-3">
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <span key={i}>{d}</span>)}
            {Array.from({ length: firstDay }).map((_, i) => <span key={`pad${i}`} />)}
            {data.heatmap.map((day) => {
              const mood = moodsByDate[day.date];
              return (
                <div key={day.date} title={`${day.date}: ${day.taken}/${day.total} taken${mood ? `, felt ${mood.mood}` : ''}`}
                  className={`relative flex aspect-square items-center justify-center rounded-lg text-[11px] font-semibold ${cellColor(day)} ${day.pct === 100 ? 'text-white' : 'text-ink-2'}`}>
                  {Number(day.date.slice(8))}
                  {mood ? <span className={`absolute bottom-1 right-1 h-1.5 w-1.5 rounded-full ${MOOD_COLOR[mood.mood]}`} /> : null}
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-3 text-xs text-ink-3">
            <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-ok-500" /> all taken</span>
            <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-ok-100" /> 80%+</span>
            <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-sun-100" /> 60–80%</span>
            <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-bad-100" /> under 60%</span>
            <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-bad-500" /> felt unwell</span>
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="text-lg font-bold">By time of day</h2>
          <p className="text-sm text-ink-2">Last 30 days. A low bar is a good time for a family call.</p>
          <div className="mt-5 space-y-4">
            {data.patterns.map((p) => {
              const Icon = PART_ICON[p.part];
              const style = PART_STYLE[p.part];
              return (
                <div key={p.part}>
                  <div className="flex items-center justify-between text-sm">
                    <span className={`flex items-center gap-2 font-bold capitalize ${style.text}`}><Icon size={16} /> {p.part}</span>
                    <span className="text-ink-2">{p.pct === null ? 'no doses' : `${p.pct}% · ${p.misses} missed${p.weekendMisses ? ` (${p.weekendMisses} at weekends)` : ''}`}</span>
                  </div>
                  <div className="mt-1.5 h-3 rounded-full bg-paper-2">
                    <div className={`h-3 rounded-full ${style.dot}`} style={{ width: `${p.pct || 0}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}

// The family and caretaker dashboard.
import { useState } from 'react';
import { NavLink, Routes, Route, useNavigate, Link } from 'react-router-dom';
import {
  LayoutDashboard, Pill, Stethoscope, ChartLine, Users, Inbox, LogOut, Check, X, TriangleAlert, Info, CircleAlert,
  Smile, Meh, Frown, Flame, Send, ShieldCheck, Zap, Play, RefreshCw, Clock, Car, MapPin, Heart, Package, ClipboardList,
  HeartPulse, Droplet, Footprints, Mail as MailIcon, Bike,
} from 'lucide-react';
import { api } from '../api.js';
import {
  Button, Card, Badge, Avatar, Spinner, PillIcon, useToast, usePolling, clock, dayDate, daysUntil, timeAgo, PART_STYLE,
} from '../ui.jsx';
import Medicines from './care/Medicines.jsx';
import Visits from './care/Visits.jsx';
import Insights from './care/Insights.jsx';
import Circle from './care/Circle.jsx';
import Mail from './care/Mail.jsx';
import Health from './care/Health.jsx';
import { categoryOf } from '../../../shared/categories.js';

const NAV = [
  { to: '/care', label: 'Today', Icon: LayoutDashboard, end: true },
  { to: '/care/medicines', label: 'Medicines', Icon: Pill },
  { to: '/care/health', label: 'Health readings', Icon: HeartPulse },
  { to: '/care/visits', label: 'Doctor visits', Icon: Stethoscope },
  { to: '/care/insights', label: 'Insights', Icon: ChartLine },
  { to: '/care/circle', label: 'Care circle', Icon: Users },
  { to: '/care/mail', label: 'Emails and activity', Icon: Inbox },
];

export const PERMISSION_TEXT = {
  owner: 'The elder: decides everything',
  manage: 'Can manage the care plan',
  suggest: 'Changes go to the elder to approve',
  view: 'Can view only',
};

export default function Care() {
  const navigate = useNavigate();
  const [ov, setOv] = useState(null);

  async function load() {
    try {
      setOv(await api('/care/overview'));
    } catch (err) {
      if (err.status === 401) navigate('/login');
      else if (err.status === 403 && err.data && err.data.pending) navigate('/waiting');
    }
  }
  usePolling(load, 6000);

  if (!ov) return <Spinner />;
  const { profile, me } = ov;
  const age = profile.birth_year ? new Date().getFullYear() - profile.birth_year : null;

  async function logout() {
    await api('/logout', { method: 'POST' });
    navigate('/');
  }

  return (
    <div className="min-h-screen lg:flex">
      <aside className="no-print bg-brand-900 text-white lg:sticky lg:top-0 lg:h-screen lg:w-72 lg:shrink-0">
        <div className="flex items-center gap-3 px-5 pb-3 pt-5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-lg" aria-hidden>💚</span>
          <span className="font-display text-2xl font-bold">Saathi</span>
          <button onClick={logout} className="ml-auto rounded-lg p-2 text-brand-100 hover:bg-white/10 lg:hidden" aria-label="Log out"><LogOut size={18} /></button>
        </div>
        <div className="mx-4 mb-4 flex items-center gap-3 rounded-2xl bg-white/8 p-3.5 ring-1 ring-white/10">
          <Avatar name={profile.name} size={46} tone="sun" />
          <div className="min-w-0">
            <p className="truncate font-display text-lg font-bold leading-tight">{profile.call_name || profile.name}{age ? <span className="font-normal text-brand-100">, {age}</span> : null}</p>
            <p className="text-xs text-brand-100">Care ID {profile.care_id}</p>
          </div>
        </div>
        <nav className="no-scrollbar flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-visible">
          {NAV.map(({ to, label, Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => `flex shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-semibold transition ${isActive ? 'bg-sun-500 text-brand-950' : 'text-brand-100 hover:bg-white/10 hover:text-white'}`}
            >
              <Icon size={19} /> {label}
              {label === 'Today' && ov.alerts.some((a) => a.level === 'red') ? <span className="ml-auto h-2.5 w-2.5 rounded-full bg-bad-500 ring-2 ring-brand-900" /> : null}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto hidden px-5 py-4 lg:absolute lg:bottom-0 lg:block lg:w-72">
          <div className="flex items-center gap-3">
            <Avatar name={me.name} size={36} />
            <div className="min-w-0">
              <p className="truncate text-sm font-bold">{me.name}</p>
              <p className="truncate text-xs text-brand-100">{PERMISSION_TEXT[me.permission]}</p>
            </div>
            <button onClick={logout} className="ml-auto rounded-lg p-2 text-brand-100 hover:bg-white/10" aria-label="Log out"><LogOut size={18} /></button>
          </div>
          {me.role === 'elder' ? <Link to="/elder" className="mt-3 block text-sm font-semibold text-sun-500">Back to my simple screen</Link> : null}
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-4 py-6 sm:px-8 lg:py-8">
        <div className="mx-auto max-w-6xl">
          <Routes>
            <Route index element={<Today ov={ov} reload={load} />} />
            <Route path="medicines" element={<Medicines ov={ov} reload={load} />} />
            <Route path="visits" element={<Visits ov={ov} />} />
            <Route path="health" element={<Health ov={ov} reload={load} />} />
            <Route path="insights" element={<Insights ov={ov} />} />
            <Route path="circle" element={<Circle ov={ov} reload={load} />} />
            <Route path="mail" element={<Mail ov={ov} />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------- Today

const STATUS_BADGE = {
  done: ['ok', 'Taken'], now: ['sun', 'Due now'], snoozed: ['calm', 'Snoozed'], later: ['gray', 'Later'],
  missed: ['bad', 'Missed'], unsure: ['sun', 'Not sure'], skipped: ['gray', 'Skipped by choice'],
};

function Today({ ov, reload }) {
  const toast = useToast();
  const { profile, me } = ov;
  const name = profile.call_name || profile.name;
  const canAct = me.permission !== 'view';
  const reds = ov.alerts.filter((a) => a.level === 'red');
  const ambers = ov.alerts.filter((a) => a.level === 'amber');

  async function markDoses(ids, action) {
    try {
      await api('/care/doses', { method: 'POST', body: { ids, action } });
      toast(action === 'taken' ? 'Marked as taken' : 'Marked as not taken');
      reload();
    } catch (err) { toast(err.message, { tone: 'bad' }); }
  }

  async function pickUp(medId) {
    try {
      await api(`/care/meds/${medId}/pickup`, { method: 'POST' });
      toast(`Thanks. ${name} will see that you're bringing it.`);
      reload();
    } catch (err) { toast(err.message, { tone: 'bad' }); }
  }

  let headline = `${name} is on track today`;
  let tone = 'bg-ok-50 text-ok-800 border-ok-100';
  let HeadIcon = ShieldCheck;
  if (reds.length) { headline = `${name} needs attention`; tone = 'bg-bad-50 text-bad-800 border-bad-100'; HeadIcon = CircleAlert; }
  else if (ambers.length) { headline = `A few things to check for ${name}`; tone = 'bg-sun-50 text-sun-800 border-sun-100'; HeadIcon = TriangleAlert; }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-ink-3">{dayDate(ov.now, 'en', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          <h1 className="font-display text-3xl font-semibold sm:text-4xl">{name}'s day</h1>
        </div>
        <span className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 font-bold ${tone}`}><HeadIcon size={18} /> {headline}</span>
      </div>

      <StatRow ov={ov} />

      {ov.config.demo ? <DemoPanel ov={ov} reload={reload} /> : null}

      {ov.alerts.length ? (
        <div className="space-y-2">
          {ov.alerts.map((a, i) => {
            const styles = { red: 'border-bad-100 bg-bad-50 text-bad-800', amber: 'border-sun-100 bg-sun-50 text-sun-800', blue: 'border-calm-100 bg-calm-50 text-calm-800' };
            const Icon = a.level === 'red' ? CircleAlert : a.level === 'amber' ? TriangleAlert : Info;
            return (
              <div key={i} className={`flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 ${styles[a.level]}`}>
                <Icon size={20} className="shrink-0" />
                <p className="min-w-0 flex-1 font-semibold">{a.text}</p>
                {canAct && a.ids && a.kind === 'unsure' ? (
                  <div className="flex gap-2">
                    <Button size="sm" variant="success" onClick={() => markDoses(a.ids, 'taken')}><Check size={16} /> They took it</Button>
                    <Button size="sm" variant="secondary" onClick={() => markDoses(a.ids, 'missed')}>They didn't</Button>
                  </div>
                ) : null}
                {canAct && a.ids && a.kind === 'late' ? (
                  <Button size="sm" variant="secondary" onClick={() => markDoses(a.ids, 'taken')}><Check size={16} /> Mark as given</Button>
                ) : null}
                {a.kind === 'refill' && !a.picked ? (
                  <Button size="sm" variant="secondary" onClick={() => pickUp(a.med_id)}><Bike size={16} /> I'll pick it up</Button>
                ) : null}
                {a.kind === 'refill' ? <Link to="/care/medicines"><Button size="sm" variant="ghost"><Package size={16} /> Record refill</Button></Link> : null}
                {a.kind === 'reading' ? <Link to="/care/health"><Button size="sm" variant="secondary"><HeartPulse size={16} /> See readings</Button></Link> : null}
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-bold">Today's medicines</h2>
            <span className="text-sm text-ink-3">Updates live</span>
          </div>
          <ol className="relative space-y-3">
            {ov.slots.map((s) => {
              const [badgeTone, badgeText] = STATUS_BADGE[s.status] || ['gray', s.status];
              const style = PART_STYLE[s.part];
              const open = s.doses.filter((d) => d.status === 'due').map((d) => d.id);
              return (
                <li key={s.time} className={`flex flex-wrap items-center gap-4 rounded-2xl border p-3.5 ${s.status === 'now' ? 'border-sun-500 bg-sun-50/60' : 'border-line bg-white'}`}>
                  <div className="w-28 shrink-0">
                    <p className="text-lg font-bold">{s.nice}</p>
                    <p className={`text-xs font-semibold capitalize ${style.text}`}>{s.label}</p>
                  </div>
                  <div className="flex min-w-0 flex-1 flex-wrap gap-x-4 gap-y-1">
                    {s.doses.map((d) => (
                      <span key={d.id} className={`flex items-center gap-1.5 text-[15px] ${d.status === 'taken' ? 'text-ink-2' : ''}`}>
                        <PillIcon color={d.pill_color} shape={d.pill_shape} form={d.form} size={26} />
                        <b>{d.name}</b> <span className="text-ink-3">{d.strength}</span>
                        <span title={categoryOf(d.category).label} aria-label={categoryOf(d.category).label}>{categoryOf(d.category).emoji}</span>
                        {d.critical ? <Flame size={14} className="text-bad-500" aria-label="critical" /> : null}
                      </span>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={badgeTone}>{badgeText}{s.status === 'now' && s.late_minutes > 0 ? ` · ${s.late_minutes} min` : ''}</Badge>
                    {s.status === 'done' && s.acted_at ? <span className="text-xs text-ink-3">{clock(s.acted_at)} · {s.acted_by}</span> : null}
                    {canAct && (s.status === 'now' || s.status === 'snoozed') ? (
                      <Button size="sm" variant="secondary" onClick={() => markDoses(open, 'taken')}><Check size={15} /> Mark as given</Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
          {ov.notes.length ? (
            <div className="mt-5 space-y-2 rounded-2xl bg-paper p-4">
              <p className="text-sm font-bold text-ink-2">What Saathi noticed</p>
              {ov.notes.map((n) => <p key={n} className="text-[15px] text-ink-2">• {n}</p>)}
            </div>
          ) : null}
        </Card>

        <div className="space-y-6">
          <WeekCard ov={ov} />
          <MoodCard ov={ov} name={name} />
          <NextVisitCard ov={ov} />
          <ProposalsCard ov={ov} name={name} />
        </div>
      </div>

      <MessagesCard ov={ov} name={name} reload={reload} />
    </div>
  );
}

// The four numbers a family member wants first. Status always comes with an icon and a word, never colour alone.
const READING_STYLE = {
  ok: ['text-ok-600', '✓', 'Normal'], high: ['text-sun-600', '▲', 'High'], low: ['text-calm-600', '▼', 'Low'], danger: ['text-bad-600', '!', 'Urgent'],
};

function StatRow({ ov }) {
  const h = ov.health || {};
  const routines = h.routines || [];
  const done = routines.filter((r) => r.done).length;
  const reading = (r, label, Icon) => {
    const [cls, mark, word] = r ? READING_STYLE[r.level] || READING_STYLE.ok : ['text-ink-3', '', ''];
    return (
      <Link to="/care/health" className="block">
        <Card className="h-full p-4 transition hover:shadow-lift">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-ink-3"><Icon size={15} /> {label}</p>
          <p className="mt-1 font-display text-3xl font-bold leading-none">{r ? r.value.replace(' mmHg', '').replace(' mg/dL', '') : '–'}</p>
          <p className={`mt-1 text-sm font-semibold ${cls}`}>{r ? `${mark} ${word} · ${timeAgo(r.at)}` : 'No reading yet'}</p>
        </Card>
      </Link>
    );
  };
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Link to="/care/insights" className="block">
        <Card className="h-full p-4 transition hover:shadow-lift">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-ink-3"><Pill size={15} /> Medicines this week</p>
          <p className="mt-1 font-display text-3xl font-bold leading-none">{ov.week.pct === null ? '–' : `${ov.week.pct}%`}</p>
          <p className="mt-1 text-sm text-ink-2">{ov.week.taken} of {ov.week.total} doses taken</p>
        </Card>
      </Link>
      <Link to="/care/health" className="block">
        <Card className="h-full p-4 transition hover:shadow-lift">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-ink-3"><Footprints size={15} /> Health tasks today</p>
          <p className="mt-1 font-display text-3xl font-bold leading-none">{done}<span className="text-xl text-ink-3">/{routines.length}</span></p>
          <p className="mt-1 truncate text-sm text-ink-2">{routines.map((r) => `${r.emoji}${r.done ? '✓' : ''}`).join('  ')}</p>
        </Card>
      </Link>
      {reading(h.bp, 'Latest BP', HeartPulse)}
      {reading(h.sugar, 'Latest sugar', Droplet)}
    </div>
  );
}

function DemoPanel({ ov, reload }) {
  const toast = useToast();
  const [busy, setBusy] = useState(null);
  async function run(key, path, body, msg) {
    setBusy(key);
    try {
      await api(path, { method: path.includes('profile') ? 'PUT' : 'POST', body });
      toast(msg);
      reload();
    } catch (err) { toast(err.message, { tone: 'bad' }); } finally { setBusy(null); }
  }
  const fast = ov.profile.demo_fast;
  return (
    <Card className="border-dashed border-brand-200 bg-brand-50/50 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-700 text-white"><Zap size={18} /></span>
        <div className="min-w-0 flex-1 basis-72">
          <p className="font-bold">Live demo controls</p>
          <p className="text-sm text-ink-2">
            {fast ? 'Fast mode is on: reminder after 1 min, caretaker after 2 min, marked missed and family told after 3 min.' : 'Normal timing: reminder at 30 min, caretaker at 60 min, family at 2 hours (critical medicines twice as fast).'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" busy={busy === 'due'} onClick={() => run('due', '/care/demo/due-now', undefined, 'Medicines are due now. Open Kamla ji\'s screen.')}><Play size={15} /> Make medicines due now</Button>
          <Button size="sm" variant="secondary" busy={busy === 'tick'} onClick={() => run('tick', '/care/demo/tick', undefined, 'Reminder check done')}><RefreshCw size={15} /> Run reminder check</Button>
          <Button size="sm" variant="secondary" busy={busy === 'digest'} onClick={() => run('digest', '/care/demo/digest', undefined, 'Weekly summary sent. See Emails and activity.')}><MailIcon size={15} /> Send weekly summary</Button>
          {ov.me.permission === 'manage' || ov.me.permission === 'owner' ? (
            <Button size="sm" variant="secondary" busy={busy === 'fast'} onClick={() => run('fast', '/care/profile', { demo_fast: !fast }, fast ? 'Normal timing' : 'Fast mode on')}>
              <Clock size={15} /> {fast ? 'Normal timing' : 'Fast mode'}
            </Button>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

function Ring({ pct }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const value = pct ?? 0;
  const color = value >= 90 ? 'var(--color-ok-500)' : value >= 75 ? 'var(--color-sun-500)' : 'var(--color-bad-500)';
  return (
    <svg width="88" height="88" viewBox="0 0 88 88" role="img" aria-label={`${value}% taken`}>
      <circle cx="44" cy="44" r={r} fill="none" stroke="var(--color-paper-2)" strokeWidth="9" />
      <circle cx="44" cy="44" r={r} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round"
        strokeDasharray={`${(c * value) / 100} ${c}`} transform="rotate(-90 44 44)" />
      <text x="44" y="50" textAnchor="middle" fontSize="19" fontWeight="700" fill="var(--color-ink)">{pct === null ? '–' : `${value}%`}</text>
    </svg>
  );
}

function WeekCard({ ov }) {
  return (
    <Card className="flex items-center gap-4 p-5">
      <Ring pct={ov.week.pct} />
      <div>
        <p className="font-bold">Taken this week</p>
        <p className="text-sm text-ink-2">{ov.week.taken} of {ov.week.total} doses</p>
        {ov.streak > 0 ? <p className="mt-1 text-sm font-semibold text-ok-600">{ov.streak} full days in a row</p> : null}
        <Link to="/care/insights" className="mt-1 inline-block text-sm font-semibold text-brand-700">See insights</Link>
      </div>
    </Card>
  );
}

function MoodCard({ ov, name }) {
  const MOOD = { good: [Smile, 'text-ok-600', 'Good'], okay: [Meh, 'text-sun-600', 'Okay'], unwell: [Frown, 'text-bad-600', 'Not well'] };
  const today = ov.checkin;
  return (
    <Card className="p-5">
      <p className="font-bold">How {name} feels</p>
      {today ? (
        <p className={`mt-2 flex items-center gap-2 text-lg font-bold ${MOOD[today.mood][1]}`}>
          {(() => { const I = MOOD[today.mood][0]; return <I size={26} />; })()} {MOOD[today.mood][2]} today
          {today.symptoms && JSON.parse(today.symptoms).length ? <span className="text-sm font-semibold">({JSON.parse(today.symptoms).join(', ')})</span> : null}
        </p>
      ) : <p className="mt-2 text-ink-2">No check-in yet today.</p>}
      <div className="mt-3 flex gap-1.5">
        {[...ov.checkins].reverse().map((c) => {
          const [I, cls] = MOOD[c.mood] || MOOD.okay;
          return <span key={c.id} title={`${c.date}: ${c.mood}`} className={`flex h-8 w-8 items-center justify-center rounded-full bg-paper ${cls}`}><I size={18} /></span>;
        })}
      </div>
      <p className="mt-1 text-xs text-ink-3">Last 7 check-ins</p>
    </Card>
  );
}

function NextVisitCard({ ov }) {
  const v = ov.appointments[0];
  if (!v) return null;
  const n = daysUntil(v.starts_at);
  return (
    <Card className="p-5">
      <p className="flex items-center gap-2 font-bold"><Stethoscope size={18} className="text-calm-600" /> Next doctor visit</p>
      <p className="mt-2 text-lg font-bold">{v.doctor}</p>
      <p className="text-sm text-ink-2">{v.specialty}</p>
      <p className="mt-1 text-[15px]">{dayDate(v.starts_at, 'en', { weekday: 'long', day: 'numeric', month: 'short' })}, {clock(v.starts_at)} <Badge tone="calm">{n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`}</Badge></p>
      {v.place ? <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-2"><MapPin size={14} /> {v.place}</p> : null}
      <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-2"><Car size={14} /> {v.companion_name ? `${v.companion_name} is going` : 'Nobody going yet'}</p>
      <Link to={`/care/visit/${v.id}`}><Button size="sm" variant="soft" className="mt-3 w-full"><ClipboardList size={16} /> Open visit sheet</Button></Link>
    </Card>
  );
}

function ProposalsCard({ ov, name }) {
  if (!ov.proposals.length) return null;
  return (
    <Card className="p-5">
      <p className="flex items-center gap-2 font-bold"><ShieldCheck size={18} className="text-brand-700" /> Waiting for {name}'s yes</p>
      <ul className="mt-3 space-y-3">
        {ov.proposals.map((p) => (
          <li key={p.id} className="rounded-xl bg-paper p-3 text-sm">
            <p className="font-semibold">{p.summary}</p>
            <p className="mt-1 text-xs text-ink-3">Suggested by {p.proposer} · {timeAgo(p.created_at)}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function MessagesCard({ ov, name, reload }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  async function send() {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await api('/care/messages', { method: 'POST', body: { text } });
      setText('');
      toast(`Sent. It will show on ${name}'s screen.`);
      reload();
    } catch (err) { toast(err.message, { tone: 'bad' }); } finally { setBusy(false); }
  }
  return (
    <Card className="p-5">
      <h2 className="flex items-center gap-2 text-lg font-bold"><Heart size={18} className="text-bad-500" /> Notes with {name}</h2>
      <p className="text-sm text-ink-2">Short notes appear in big text on {name}'s screen. They can send a heart back.</p>
      <div className="mt-4 flex gap-2">
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder={`Coming to see you on Sunday, ${name}!`} />
        <Button busy={busy} onClick={send}><Send size={16} /> Send</Button>
      </div>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {ov.messages.map((m) => (
          <li key={m.id} className={`flex gap-3 rounded-2xl p-3 ${m.from_elder ? 'bg-brand-50' : 'bg-paper'}`}>
            <Avatar name={m.sender || name} size={34} tone={m.from_elder ? 'brand' : 'dusk'} />
            <div className="min-w-0">
              <p className="text-xs text-ink-3">{m.from_elder ? name : m.sender} · {timeAgo(m.created_at)}</p>
              <p className="text-[15px]">{m.text}</p>
              {m.hearted ? <p className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-bad-600"><Heart size={12} fill="currentColor" /> {name} loved this</p> : null}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

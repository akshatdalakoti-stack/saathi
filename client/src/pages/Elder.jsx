// The elder's own screen. Built for older people, including those who can't read well:
// - pictures first: pill drawings, picture of the meal (🍛 = after lunch), a clock face, big emoji
// - every medicine says what it's for, in their language: "Metformin (sugar medicine)"
// - Saathi speaks everything aloud; it reads "sugar medicine", not hard names
// - one big action at a time, big tiles instead of long pages
// - the elder stays in charge: family changes need their yes
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Check, Clock, CircleHelp, Volume2, VolumeX, Mic, Phone, Heart, HeartHandshake, Stethoscope, MapPin, Car,
  LifeBuoy, ShieldCheck, SkipForward, Undo2, Users, Sparkles, Globe, LoaderCircle,
} from 'lucide-react';
import { api } from '../api.js';
import {
  useLocale, slotLabel, slotEmoji, amountLabel, doseSpoken, timeIn, dateIn, SYMPTOMS, SYMPTOM_EMOJI,
  PART_EMOJI, FOOD_EMOJI,
} from '../i18n.js';
import { speak, canListen, listen, quickIntent, stopSpeaking, prefetchSpeech } from '../speech.js';
import { categoryOf } from '../../../shared/categories.js';
import { LANGUAGES } from '../../../shared/languages.js';
import { Button, Modal, PillIcon, Avatar, Spinner, useToast, usePolling, daysUntil, PART_STYLE } from '../ui.jsx';

const FONT_SIZES = [18, 20, 23];

function useNow(ms = 30000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

// ---------------------------------------------------------------- offline helpers

function readSavedHome() {
  try { return JSON.parse(localStorage.getItem('saathi_home')); } catch { return null; }
}
function readQueue() {
  try { return JSON.parse(localStorage.getItem('saathi_queue')) || []; } catch { return []; }
}
function writeQueue(list) {
  try { localStorage.setItem('saathi_queue', JSON.stringify(list)); } catch { /* ignore */ }
}

// Shows a tap on screen right away, before the server has heard about it.
function markLocally(data, ids, action) {
  if (!data) return data;
  const status = { taken: 'taken', skipped: 'skipped', unsure: 'unsure' }[action];
  const slots = data.slots.map((slot) => {
    const doses = slot.doses.map((d) => {
      if (!ids.includes(d.id)) return d;
      if (action === 'snooze') return { ...d, snooze_until: Date.now() + 15 * 60000 };
      if (action === 'undo') return { ...d, status: 'due', acted_at: null };
      return { ...d, status, acted_at: Date.now() };
    });
    const open = doses.filter((d) => d.status === 'due');
    let s = slot.status;
    if (open.length === 0) s = doses.every((d) => d.status === 'taken') ? 'done' : status || s;
    else if (action === 'snooze') s = 'snoozed';
    return { ...slot, doses, status: s, acted_at: open.length === 0 ? Date.now() : slot.acted_at };
  });
  const done = slots.flatMap((s) => s.doses).filter((d) => d.status === 'taken').length;
  return { ...data, slots, stats: { ...data.stats, done } };
}

// A soft two-note bell, made in the browser (no sound file needed).
function playChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioCtx();
    [[660, 0], [880, 0.35], [660, 0.9], [880, 1.25]].forEach(([freq, at]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + at + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.6);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + 0.65);
    });
  } catch { /* sound not allowed yet */ }
}

function partNow(now) {
  const h = new Date(now).getHours();
  if (h >= 4 && h < 12) return 'morning';
  if (h >= 12 && h < 17) return 'afternoon';
  if (h >= 17 && h < 21) return 'evening';
  return 'night';
}

// ---------------------------------------------------------------- small picture helpers

// A clock with hands: many elders read a clock face more easily than "13:30".
function ClockFace({ time, size = 56 }) {
  const [h, m] = time.split(':').map(Number);
  const hourAngle = ((h % 12) + m / 60) * 30;
  const minuteAngle = m * 6;
  const isNight = h < 6 || h >= 19;
  return (
    <svg width={size} height={size} viewBox="0 0 60 60" role="img" aria-label={time}>
      <circle cx="30" cy="30" r="27" fill={isNight ? '#262D5A' : '#fff'} stroke={isNight ? '#262D5A' : '#D8CDBB'} strokeWidth="3" />
      {Array.from({ length: 12 }).map((_, i) => (
        <line key={i} x1="30" y1="6.5" x2="30" y2={i % 3 === 0 ? 11.5 : 9.5} stroke={isNight ? '#D4D8EE' : '#75837F'} strokeWidth={i % 3 === 0 ? 2.4 : 1.4} transform={`rotate(${i * 30} 30 30)`} strokeLinecap="round" />
      ))}
      <line x1="30" y1="30" x2="30" y2="17" stroke={isNight ? '#fff' : '#1E2A2D'} strokeWidth="4" strokeLinecap="round" transform={`rotate(${hourAngle} 30 30)`} />
      <line x1="30" y1="30" x2="30" y2="11" stroke={isNight ? '#FBE5BC' : '#0F6E64'} strokeWidth="2.6" strokeLinecap="round" transform={`rotate(${minuteAngle} 30 30)`} />
      <circle cx="30" cy="30" r="2.6" fill={isNight ? '#fff' : '#1E2A2D'} />
    </svg>
  );
}

// "2 tablets" shown as two pill pictures.
function PillStack({ d, size = 40 }) {
  const n = Number(d.amount || 1);
  const count = n === 0.5 ? 1 : Math.min(3, Math.round(n));
  return (
    <span className="flex shrink-0 items-center -space-x-2" aria-hidden>
      {Array.from({ length: count }).map((_, i) => <PillIcon key={i} color={d.pill_color} shape={d.pill_shape} form={d.form} size={size} />)}
      {n > 3 ? <span className="ml-3 text-xl font-bold">×{n}</span> : null}
      {n === 0.5 ? <span className="ml-3 text-xl font-bold">½</span> : null}
    </span>
  );
}

// Medicine name with what it's for in brackets, in the elder's own language.
function MedName({ d, t, big = true }) {
  const cat = categoryOf(d.category);
  return (
    <p className={`${big ? 'text-[1.45rem]' : 'text-lg'} break-words font-bold leading-snug`}>
      {d.name} <span className="text-brand-700">({t(`cat_${cat.key}`)})</span>
    </p>
  );
}

function CategoryBadge({ d, size = 'text-3xl' }) {
  return <span className={`${size} leading-none`} aria-hidden>{categoryOf(d.category).emoji}</span>;
}

// ---------------------------------------------------------------- page

export default function Elder() {
  const navigate = useNavigate();
  const toast = useToast();
  const now = useNow();
  const [data, setData] = useState(null);
  const [code, setCode] = useState('en');
  const [size, setSize] = useState(1);
  const [voiceOn, setVoiceOn] = useState(false);
  const [voiceLoading, setVoiceLoading] = useState(false);
  const [sheet, setSheet] = useState(null);
  const [celebrate, setCelebrate] = useState(false);
  const [offline, setOffline] = useState(false);
  const { t, fontFamily, dir, lang } = useLocale(code);
  const lastDueKey = useRef(undefined);

  // Works without internet: the last copy of the day is kept on the phone, and any
  // "I took it" taps wait in a queue until the connection is back.
  async function load() {
    try {
      const d = await api('/elder/home');
      setData(d);
      setOffline(false);
      try { localStorage.setItem('saathi_home', JSON.stringify(d)); } catch { /* storage full or blocked */ }
      flushQueue();
    } catch (err) {
      if (err.status === 401 || err.status === 403) { navigate('/elder/login'); return; }
      if (!err.status) {
        setOffline(true);
        setData((cur) => cur || readSavedHome());
      }
    }
  }
  usePolling(load, 8000);

  async function flushQueue() {
    const queue = readQueue();
    if (queue.length === 0) return;
    const left = [];
    for (const item of queue) {
      try { await api('/elder/doses', { method: 'POST', body: item }); } catch { left.push(item); }
    }
    writeQueue(left);
    if (left.length < queue.length) {
      toast(t('back_online'), { big: true });
      setData(await api('/elder/home'));
    }
  }

  // A gentle chime (and a buzz) the moment medicines become due, while this screen is open.
  useEffect(() => {
    if (!data) return;
    const due = data.slots.find((s) => s.status === 'now');
    const key = due ? `${data.date}|${due.time}` : null;
    const firstLoad = lastDueKey.current === undefined;
    if (key && key !== lastDueKey.current && (!firstLoad || due.late_minutes < 2)) {
      playChime();
      if (navigator.vibrate) navigator.vibrate([300, 150, 300]);
      if (voiceOn) speak(`${makeAnnouncement(due)}`, code, setVoiceLoading);
    }
    lastDueKey.current = key;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  useEffect(() => {
    if (!data) return;
    setCode(data.me.language || 'en');
    setSize(data.me.text_size ?? 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.me.language, data?.me.text_size]);

  useEffect(() => {
    document.documentElement.style.fontSize = `${FONT_SIZES[size]}px`;
    return () => { document.documentElement.style.fontSize = ''; stopSpeaking(); };
  }, [size]);

  function makeAnnouncement(slot) {
    const words = slot.doses.filter((d) => d.status === 'due').map((d) => doseSpoken(d, t)).join('. ');
    return `${t('time_for')}. ${words}`;
  }

  if (!data) return <Spinner />;

  const say = (text) => speak(text, code, setVoiceLoading);
  const sayIfOn = (text) => { if (voiceOn) say(text); };
  const slots = data.slots;
  const current = slots.find((s) => s.status === 'now') || slots.find((s) => s.status === 'snoozed');
  const next = slots.find((s) => s.status === 'later');
  const lastTaken = [...slots].reverse().find((s) => s.status === 'done' && s.acted_at);
  const part = partNow(now);
  const greet = t(`greet_${part}`);

  function slotSentence(slot) {
    return slot.doses.filter((d) => d.status === 'due' || slot.status !== 'now').map((d) => doseSpoken(d, t)).join('. ');
  }
  const nowAnnouncement = current ? `${t('time_for')}. ${slotSentence(current)}` : '';
  prefetchSpeech(nowAnnouncement, code);

  async function act(ids, action) {
    try {
      try {
        await api('/elder/doses', { method: 'POST', body: { ids, action } });
        await load();
      } catch (err) {
        if (err.status) throw err;
        // No internet: remember it on the phone and show it as done straight away.
        writeQueue([...readQueue(), { ids, action }]);
        setData((cur) => markLocally(cur, ids, action));
        toast(t('will_sync'), { big: true });
        if (action !== 'taken') return;
      }
      if (action === 'taken') {
        if (navigator.vibrate) navigator.vibrate(180);
        setCelebrate(true);
        setTimeout(() => setCelebrate(false), 1800);
        toast(t('marked_taken'), { big: true, duration: 9000, action: { label: t('undo'), onClick: () => act(ids, 'undo') } });
        sayIfOn(t('marked_taken'));
      } else if (action === 'snooze') {
        toast(t('reminder_set'), { big: true });
        sayIfOn(t('reminder_set'));
      } else if (action === 'unsure') {
        toast(t('unsure_sent'), { big: true });
        sayIfOn(t('unsure_sent'));
      } else if (action === 'skipped') {
        toast(t('skipped_done'), { big: true });
      }
    } catch (err) {
      toast(err.message, { tone: 'bad' });
    }
  }

  async function saveSettings(change) {
    if (change.language) setCode(change.language);
    if (change.text_size !== undefined) setSize(change.text_size);
    try {
      await api('/elder/settings', { method: 'POST', body: { language: change.language ?? code, text_size: change.text_size ?? size } });
    } catch { /* not critical */ }
  }

  function didIAnswer() {
    const lines = [];
    if (current) lines.push(t('did_waiting', { label: slotLabel(current, t) }));
    if (lastTaken) lines.push(`${t('did_yes', { label: slotLabel(lastTaken, t), time: timeIn(lastTaken.acted_at, code) })} ${t('dont_again')}`);
    if (lines.length === 0) lines.push(t('did_nothing'));
    return lines;
  }

  function daySummary() {
    const date = dateIn(now, code, { weekday: 'long', day: 'numeric', month: 'long' });
    const parts = [t('summary_intro', { greet, name: data.me.call_name, date })];
    parts.push(t('summary_done', { done: data.stats.done, total: data.stats.total }));
    if (current) parts.push(t('summary_now', { meds: slotSentence(current) }));
    else if (next) parts.push(t('summary_next', { label: slotLabel(next, t), time: timeIn(next.time, code), meds: slotSentence(next) }));
    const visit = data.appointments[0];
    if (visit) {
      const n = daysUntil(visit.starts_at);
      parts.push(t('summary_visit', { when: n === 0 ? t('today') : n === 1 ? t('tomorrow') : t('in_days', { n }) }));
    }
    return parts.join(' ');
  }

  async function handleVoice(text) {
    let intent = quickIntent(text);
    if (intent === 'other' && code !== 'en') {
      try { intent = (await api('/elder/voice', { method: 'POST', body: { text, lang: code } })).intent; } catch { intent = 'other'; }
    }
    if (intent === 'taken') {
      setSheet(null);
      if (current) await act(current.doses.filter((d) => d.status === 'due').map((d) => d.id), 'taken');
      say(current ? t('marked_taken') : t('nothing_now'));
      return true;
    }
    if (intent === 'snooze' && current) { setSheet(null); await act(current.doses.map((d) => d.id), 'snooze'); say(t('reminder_set')); return true; }
    if (intent === 'check') { setSheet('did'); say(didIAnswer().join(' ')); return true; }
    if (intent === 'help') { setSheet('help'); return true; }
    if (intent === 'read') { setSheet(null); say(daySummary()); return true; }
    if (intent === 'okay') { setSheet(null); await sendOkay(); return true; }
    return false;
  }

  async function sendOkay(text) {
    try {
      await api('/elder/okay', { method: 'POST', body: text ? { text } : {} });
      toast(text ? t('message_sent') : t('okay_sent'), { big: true });
      sayIfOn(text ? t('message_sent') : t('okay_sent'));
      load();
    } catch (err) {
      toast(err.message, { tone: 'bad' });
    }
  }

  const familyNew = data.messages.filter((m) => !m.from_elder && Date.now() - m.created_at < 36 * 3600 * 1000).length;
  const routines = data.routines || [];
  const healthLeft = routines.filter((r) => !r.done).length;
  const healthSub = routines.length ? `${routines.length - healthLeft}/${routines.length} ✓` : null;
  const visit = data.appointments[0];
  const visitDays = visit ? daysUntil(visit.starts_at) : null;

  return (
    <div className="min-h-screen bg-paper pb-40" dir={dir} lang={code} style={{ fontFamily }}>
      {/* Dark green band: which day it is, in big letters. Helps people who lose track of days. */}
      <header className="rounded-b-[2.25rem] bg-brand-900 pb-16 text-white">
        <div className="mx-auto flex max-w-2xl items-center gap-1.5 px-3 pt-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-xl" aria-hidden>💚</span>
          <div className="ms-auto flex min-w-0 items-center gap-1.5">
            <button onClick={() => setSheet('language')} className="flex min-w-0 items-center gap-1.5 rounded-2xl bg-white/12 px-3 py-2 text-base font-bold ring-1 ring-white/20" aria-label={t('language')}>
              <Globe size={20} className="shrink-0 text-sun-500" /> <span className="truncate">{lang.native}</span>
            </button>
            <button onClick={() => saveSettings({ text_size: (size + 1) % 3 })} className="shrink-0 rounded-2xl bg-white/12 px-3 py-2 text-base font-bold ring-1 ring-white/20" aria-label={t('text_size')}>
              A<span className="text-[0.75em]">A</span>{'+'.repeat(size)}
            </button>
            <button
              onClick={() => { const on = !voiceOn; setVoiceOn(on); if (on) say(daySummary()); else stopSpeaking(); }}
              className={`shrink-0 rounded-2xl px-3 py-2 ring-1 ${voiceOn ? 'bg-sun-500 text-brand-950 ring-sun-500' : 'bg-white/12 ring-white/20'}`}
              aria-pressed={voiceOn}
              aria-label={t('listen')}
            >
              {voiceLoading ? <LoaderCircle size={22} className="animate-spin" /> : voiceOn ? <Volume2 size={22} /> : <VolumeX size={22} />}
            </button>
          </div>
        </div>
        <div className="mx-auto flex max-w-2xl items-center gap-4 px-5 pt-5">
          <span className="text-6xl leading-none" aria-hidden>{PART_EMOJI[part]}</span>
          <div className="min-w-0">
            <p className="text-lg text-brand-100">{greet}, <span className="font-bold text-white">{data.me.call_name}</span></p>
            <h1 className="break-words font-display text-[clamp(1.9rem,9vw,2.7rem)] font-bold leading-none">{dateIn(now, code, { weekday: 'long' })}</h1>
            <p className="mt-1 text-xl text-brand-100">{dateIn(now, code, { day: 'numeric', month: 'long' })} · <span className="font-bold text-sun-500">{timeIn(now, code)}</span></p>
          </div>
        </div>
      </header>

      <main className="relative mx-auto -mt-12 max-w-2xl space-y-6 px-4">
        {offline ? (
          <p className="flex items-center gap-2 rounded-2xl bg-ink px-4 py-3 text-lg font-semibold text-white" role="status">📵 {t('offline')}</p>
        ) : null}

        <NowCard
          t={t} code={code} current={current} next={next} lastTaken={lastTaken} data={data} now={now}
          onAct={act} onSkip={() => setSheet('skip')} onListen={() => say(nowAnnouncement)} voiceLoading={voiceLoading}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <Button variant="secondary" size="lg" className="justify-start py-3 text-start leading-tight" onClick={() => { setSheet('did'); sayIfOn(didIAnswer().join(' ')); }}>
            <CircleHelp size={26} className="shrink-0 text-brand-700" /> {t('did_i')}
          </Button>
          <Button variant="secondary" size="lg" className="justify-start py-3 text-start leading-tight" onClick={() => say(daySummary())}>
            <Volume2 size={26} className="shrink-0 text-brand-700" /> {t('read_aloud')}
          </Button>
        </div>

        <FamilyAsks t={t} data={data} reload={load} toast={toast} say={say} />

        <MyDay t={t} code={code} slots={slots} routines={data.routines || []} stats={data.stats}
          onSlot={(slot) => setSheet({ slot: slot.time })} onRoutine={(r) => setSheet({ routine: r.id })} />

        {/* Big, bold picture tiles instead of long pages (like Apple's Assistive Access) */}
        <section className="grid grid-cols-2 gap-3">
          <Tile emoji="💌" label={t('tile_family')} badge={familyNew || null} color="bg-tile-coral" onClick={() => setSheet('family')} />
          <Tile emoji={data.checkin ? { good: '😊', okay: '😐', unwell: '🤒' }[data.checkin.mood] : '🙂'} label={t('tile_feeling')} badge={data.checkin ? '✓' : '?'} color="bg-tile-leaf" onClick={() => setSheet('feeling')} pulse={!data.checkin} />
          <Tile emoji="🩺" label={t('tile_doctor')} sub={visit ? (visitDays === 0 ? t('today') : visitDays === 1 ? t('tomorrow') : t('in_days', { n: visitDays })) : null} color="bg-tile-sky" onClick={() => setSheet('doctor')} />
          <Tile emoji="❤️‍🩹" label={t('tile_health')} sub={healthSub} color="bg-tile-haldi" onClick={() => setSheet('health')} />
          <Tile emoji="👨‍👩‍👧" label={t('tile_people')} sub={`${data.circle.length}`} color="bg-tile-plum" wide onClick={() => setSheet('people')} />
        </section>

        {data.low.length > 0 ? (
          <section className="rounded-3xl border-2 border-sun-100 bg-sun-50 p-5">
            <h2 className="flex items-center gap-2 text-xl font-bold text-sun-800"><span aria-hidden>📦</span> {t('running_low')}</h2>
            <ul className="mt-2 space-y-2 text-lg text-sun-800">
              {data.low.map((m) => (
                <li key={m.id}>
                  {categoryOf(m.category).emoji} {t('low_line', { name: `${m.name} (${t(`cat_${m.category || 'other'}`)})`, n: m.daysLeft })}
                  {m.refill_by_name ? <span className="mt-1 block font-bold text-ok-800">🛵 {t('refill_coming', { name: m.refill_by_name.split(' ')[0] })}</span> : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <p className="pt-2 text-center text-sm text-ink-3">
          Care ID {data.me.care_id} · <Link to="/" className="underline">{t('switch_user')}</Link>
        </p>
      </main>

      {/* Always-there buttons: Help and Speak */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-paper/95 backdrop-blur">
        <div className="mx-auto grid max-w-2xl grid-cols-2 gap-3 px-3 py-3">
          <Button variant="dangerOutline" size="xl" className="min-w-0 !flex-col !gap-0.5 !px-2 py-2 !text-[1.15rem] leading-tight" onClick={() => setSheet('help')}>
            <LifeBuoy size={30} className="shrink-0" aria-hidden /> <span className="min-w-0 text-center">{t('help')}</span>
          </Button>
          {canListen() ? (
            <Button size="xl" className="min-w-0 !flex-col !gap-0.5 !px-2 py-2 !text-[1.15rem] leading-tight" onClick={() => { stopSpeaking(); setSheet('voice'); }}>
              <Mic size={30} className="shrink-0" aria-hidden /> <span className="min-w-0 text-center">{t('speak')}</span>
            </Button>
          ) : (
            <Button size="xl" className="min-w-0 !flex-col !gap-0.5 !px-2 py-2 !text-[1.15rem] leading-tight" onClick={() => say(daySummary())}>
              <Volume2 size={30} aria-hidden /> <span className="min-w-0 text-center">{t('read_aloud')}</span>
            </Button>
          )}
        </div>
      </nav>

      {celebrate ? (
        <div className="pointer-events-none fixed inset-0 z-[70] flex flex-col items-center justify-center bg-ok-600/90 text-white">
          <span className="animate-pop flex h-40 w-40 items-center justify-center rounded-full bg-white text-ok-600"><Check size={110} strokeWidth={3.5} /></span>
          <p className="animate-rise mt-6 max-w-md px-6 text-center text-3xl font-bold leading-snug">{t('marked_taken')}</p>
        </div>
      ) : null}

      {sheet === 'language' ? (
        <Modal open onClose={() => setSheet(null)} title={t('pick_language')} wide>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {LANGUAGES.map((l) => (
              <button key={l.code} onClick={() => { saveSettings({ language: l.code }); setSheet(null); }}
                className={`rounded-2xl border-2 px-3 py-4 text-center ${l.code === code ? 'border-brand-700 bg-brand-50' : 'border-line bg-white hover:border-brand-200'}`}>
                <span className="block text-2xl font-bold" style={l.font ? { fontFamily: `"${l.font}", sans-serif` } : undefined}>{l.native}</span>
                <span className="block text-sm text-ink-3">{l.english}</span>
              </button>
            ))}
          </div>
        </Modal>
      ) : null}

      {sheet === 'did' ? (
        <Modal open onClose={() => setSheet(null)} title={t('did_i')}>
          <div className="space-y-4 text-2xl leading-snug">
            {didIAnswer().map((line) => <p key={line} className="font-semibold">{line}</p>)}
          </div>
          {lastTaken ? (
            <div className="mt-5 flex flex-wrap gap-3">
              {lastTaken.doses.map((d) => (
                <span key={d.id} className="flex items-center gap-2 rounded-2xl bg-ok-50 px-3 py-2 text-lg text-ok-800">
                  <PillIcon color={d.pill_color} shape={d.pill_shape} form={d.form} size={30} /> {t(`cat_${d.category || 'other'}`)} ✓
                </span>
              ))}
            </div>
          ) : null}
          <Button size="lg" variant="secondary" className="mt-6 w-full" onClick={() => say(didIAnswer().join(' '))}>
            <Volume2 size={22} /> {t('listen')}
          </Button>
        </Modal>
      ) : null}

      {sheet === 'skip' && current ? (
        <Modal open onClose={() => setSheet(null)} title={t('skip')}>
          <p className="text-xl leading-relaxed">{t('skip_confirm')}</p>
          <div className="mt-6 grid gap-3">
            <Button size="lg" variant="secondary" onClick={() => setSheet(null)}>{t('go_back')}</Button>
            <Button size="lg" variant="sun" onClick={() => { setSheet(null); act(current.doses.filter((d) => d.status === 'due').map((d) => d.id), 'skipped'); }}>
              <SkipForward size={22} /> {t('yes_skip')}
            </Button>
          </div>
        </Modal>
      ) : null}

      {sheet && sheet.slot ? <SlotSheet t={t} code={code} slots={slots.filter((s) => s.time === sheet.slot)} onClose={() => setSheet(null)} onAct={act} /> : null}
      {sheet === 'health' ? <HealthSheet t={t} code={code} routines={routines} onPick={(r) => setSheet({ routine: r.id })} onClose={() => setSheet(null)} /> : null}
      {sheet && sheet.routine ? (
        <RoutineSheet t={t} code={code} routine={routines.find((r) => r.id === sheet.routine)} toast={toast} sayIfOn={sayIfOn}
          onClose={() => setSheet(null)} onSaved={load} />
      ) : null}
      {sheet === 'family' ? <FamilySheet t={t} messages={data.messages} reload={load} onOkay={() => sendOkay()} onClose={() => setSheet(null)} say={say} /> : null}
      {sheet === 'feeling' ? <FeelingSheet t={t} checkin={data.checkin} reload={load} toast={toast} sayIfOn={sayIfOn} onClose={() => setSheet(null)} /> : null}
      {sheet === 'doctor' ? <DoctorSheet t={t} code={code} visit={visit} questions={data.questions} reload={load} toast={toast} onClose={() => setSheet(null)} say={say} /> : null}
      {sheet === 'people' ? <PeopleSheet t={t} circle={data.circle} reload={load} toast={toast} onClose={() => setSheet(null)} /> : null}
      {sheet === 'help' ? <HelpSheet t={t} onClose={() => setSheet(null)} /> : null}
      {sheet === 'voice' ? (
        <VoiceSheet t={t} code={code} onClose={() => setSheet(null)} onIntent={handleVoice}
          onQuestion={async (text) => { await api('/elder/questions', { method: 'POST', body: { text } }); toast(t('question_saved'), { big: true }); load(); setSheet(null); }}
          onSend={async (text) => { setSheet(null); await sendOkay(text); }}
        />
      ) : null}
    </div>
  );
}

function Tile({ emoji, label, sub, badge, color, onClick, pulse, wide }) {
  return (
    <button onClick={onClick} className={`relative flex min-h-40 flex-col items-center justify-center gap-1.5 rounded-[1.75rem] p-4 text-center text-white shadow-lift transition active:scale-[.97] ${color} ${wide ? 'col-span-2 !min-h-28 !flex-row !gap-4' : ''}`}>
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/18 text-[2.6rem] leading-none" aria-hidden>{emoji}</span>
      <span className="text-[1.35rem] font-bold leading-tight">{label}</span>
      {sub ? <span className="rounded-full bg-black/15 px-3 text-base font-semibold">{sub}</span> : null}
      {badge ? <span className={`absolute end-3 top-3 flex h-9 min-w-9 items-center justify-center rounded-full px-2 text-lg font-bold ring-2 ring-white ${badge === '✓' ? 'bg-white text-ok-800' : 'bg-sun-500 text-brand-950'} ${pulse ? 'animate-pulse' : ''}`}>{badge}</span> : null}
    </button>
  );
}

// ---------------------------------------------------------------- the "now" card

function DoseRow({ d, t, faded }) {
  const food = t(`food_${d.food}`);
  return (
    <li className={`flex items-center gap-3 py-3 ${faded ? 'opacity-50' : ''}`}>
      <span className="relative flex h-16 w-[4.5rem] shrink-0 items-center justify-center rounded-2xl bg-paper-2">
        <PillStack d={d} size={36} />
        <span className="absolute -end-2 -top-2 flex h-10 w-10 items-center justify-center rounded-full border-2 border-white bg-white text-2xl shadow-soft">
          <CategoryBadge d={d} size="text-2xl" />
        </span>
      </span>
      <div className="min-w-0">
        <MedName d={d} t={t} />
        <p className="text-lg text-ink-2">
          {amountLabel(d.amount, d.form, t)}{food ? <> · <span aria-hidden>{FOOD_EMOJI[d.food]}</span> {food}</> : null}
        </p>
        {d.status === 'taken' ? <p className="text-lg font-bold text-ok-600">✓ {t('st_done')}</p> : null}
      </div>
      {d.critical ? <span className="ms-auto rounded-full bg-bad-50 px-2.5 py-1 text-sm font-bold text-bad-800">{t('important')}</span> : null}
    </li>
  );
}

function NowCard({ t, code, current, next, lastTaken, data, onAct, onSkip, onListen, voiceLoading }) {
  if (current) {
    const open = current.doses.filter((d) => d.status === 'due');
    const ids = open.map((d) => d.id);
    const snoozedUntil = Math.max(0, ...open.map((d) => d.snooze_until || 0));
    return (
      <section aria-labelledby="now-title" className="animate-pop rounded-[2rem] border-2 border-brand-200 bg-white p-4 shadow-lift sm:p-6">
        <h2 id="now-title" className="font-display text-[1.8rem] font-semibold leading-tight">{t('time_for')}</h2>
        <div className="mt-3 flex items-center gap-3 rounded-2xl bg-paper px-3 py-2">
          <span className="shrink-0 text-4xl leading-none" aria-hidden>{slotEmoji(current)}</span>
          <div className="min-w-0 flex-1">
            <p className="text-xl font-bold leading-tight text-brand-700 [overflow-wrap:anywhere]">{slotLabel(current, t)}</p>
            <p className="text-lg text-ink-2">{timeIn(current.time, code)}</p>
          </div>
          <span className="shrink-0"><ClockFace time={current.time} size={48} /></span>
        </div>
        {current.status === 'snoozed' ? (
          <p className="mt-3 rounded-2xl bg-calm-50 px-4 py-2 text-lg font-semibold text-calm-800">⏰ {t('snoozed_until', { time: timeIn(snoozedUntil, code) })}</p>
        ) : current.late_minutes >= 5 ? (
          <p className="mt-3 rounded-2xl bg-sun-50 px-4 py-2 text-lg font-semibold text-sun-800">⏰ {t('late_by', { n: current.late_minutes })}</p>
        ) : null}
        <button onClick={onListen} className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-50 py-3 text-lg font-bold text-brand-800">
          {voiceLoading ? <LoaderCircle size={24} className="animate-spin" /> : <Volume2 size={24} />} {voiceLoading ? t('voice_loading') : t('listen')}
        </button>
        <ul className="mt-2 divide-y divide-line">
          {current.doses.map((d) => <DoseRow key={d.id} d={d} t={t} faded={d.status !== 'due'} />)}
        </ul>
        <Button variant="success" size="xl" className="mt-4 w-full !min-h-24 text-[1.6rem]" onClick={() => onAct(ids, 'taken')}>
          <Check size={40} strokeWidth={3.5} aria-hidden /> {t(open.length > 1 ? 'took_them' : 'took_it')}
        </Button>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Button variant="secondary" size="lg" className="leading-tight" onClick={() => onAct(ids, 'snooze')}>
            <Clock size={24} className="shrink-0 text-calm-600" aria-hidden /> {t('remind_later')}
          </Button>
          <Button variant="secondary" size="lg" className="leading-tight" onClick={() => onAct(ids, 'unsure')}>
            <CircleHelp size={24} className="shrink-0 text-sun-600" aria-hidden /> {t('not_sure')}
          </Button>
        </div>
        <button onClick={onSkip} className="mt-4 w-full text-center text-base text-ink-3 underline underline-offset-4">{t('skip')}</button>
      </section>
    );
  }

  if (next) {
    const style = PART_STYLE[next.part];
    return (
      <section className="rounded-[2rem] border border-line bg-white p-6 shadow-soft">
        <div className="flex items-center gap-3">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-ok-50 text-ok-600"><Check size={34} strokeWidth={3} /></span>
          <h2 className="min-w-0 break-words font-display text-[1.7rem] font-semibold leading-tight">{t('all_done_now')}</h2>
        </div>
        {lastTaken ? <p className="mt-2 text-lg text-ink-2">{t('did_yes', { label: slotLabel(lastTaken, t), time: timeIn(lastTaken.acted_at, code) })}</p> : null}
        <div className={`mt-5 rounded-2xl border ${style.ring} ${style.bg} p-4`}>
          <div className="flex items-center gap-3">
            <span className="text-4xl leading-none" aria-hidden>{slotEmoji(next)}</span>
            <div className="min-w-0 flex-1">
              <p className={`text-lg font-semibold ${style.text}`}>{t('next')}</p>
              <p className="text-xl font-bold">{slotLabel(next, t)} · {timeIn(next.time, code)}</p>
            </div>
            <ClockFace time={next.time} size={54} />
          </div>
          <ul className="mt-3 space-y-2">
            {next.doses.map((d) => (
              <li key={d.id} className="flex items-center gap-3 rounded-xl bg-white/80 px-3 py-2">
                <PillStack d={d} size={30} />
                <span className="text-lg"><b>{d.name}</b> <span className="text-brand-700">({t(`cat_${d.category || 'other'}`)})</span></span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    );
  }

  const first = data.tomorrow_first;
  return (
    <section className="rounded-[2rem] border border-ok-100 bg-ok-50 p-6 text-center">
      <Sparkles className="mx-auto text-ok-600" size={44} aria-hidden />
      <h2 className="mt-2 font-display text-[1.9rem] font-semibold text-ok-800">{t('all_done_day')}</h2>
      {data.stats.streak > 0 ? <p className="mt-2 text-xl font-semibold text-ok-800">🔥 {t('streak', { n: data.stats.streak + 1 })}</p> : null}
      {first ? <p className="mt-3 text-lg text-ok-800">{slotEmoji(first)} {t('tomorrow_first', { label: slotLabel(first, t), time: timeIn(first.time, code) })}</p> : null}
    </section>
  );
}

// ---------------------------------------------------------------- pill box

function statusText(slot, t, code) {
  if (slot.status === 'done') return `✓ ${timeIn(slot.acted_at, code)}`;
  return t(`st_${slot.status}`);
}

const STATUS_CHIP = {
  done: 'bg-ok-600 text-white', now: 'bg-sun-500 text-brand-950', snoozed: 'bg-calm-600 text-white',
  later: 'bg-paper-2 text-ink-2', missed: 'bg-bad-600 text-white', unsure: 'bg-sun-100 text-sun-800', skipped: 'bg-paper-2 text-ink-2',
};

// "My day": medicines AND health tasks (BP, sugar, walk...) in one list, in time order.
function MyDay({ t, code, slots, routines, stats, onSlot, onRoutine }) {
  const items = [
    ...slots.map((s) => ({ type: 'med', time: s.time, slot: s })),
    ...routines.map((r) => ({ type: 'routine', time: r.time, routine: r })),
  ].sort((a, b) => a.time.localeCompare(b.time));
  const doses = slots.flatMap((s) => s.doses);
  return (
    <section aria-labelledby="day-title">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
        <h2 id="day-title" className="font-display text-[1.9rem] font-bold leading-none">{t('todays_plan')}</h2>
        <p className="text-lg font-semibold text-ink-2">💊 {t('done_of', { done: stats.done, total: stats.total })}</p>
      </div>
      <div className="mb-4 flex gap-1" aria-hidden>
        {doses.map((d) => (
          <span key={d.id} className={`h-3 flex-1 rounded-full ${d.status === 'taken' ? 'bg-ok-500' : d.status === 'missed' ? 'bg-bad-500' : d.status === 'due' ? 'bg-line-2' : 'bg-sun-500'}`} />
        ))}
      </div>
      <ol className="relative space-y-3 ps-7 before:absolute before:inset-y-3 before:start-[13px] before:w-1 before:rounded-full before:bg-line">
        {items.map((item) => {
          if (item.type === 'med') {
            const s = item.slot;
            return (
              <li key={`m${s.time}`} className="relative">
                <span className={`absolute -start-7 top-5 h-7 w-7 rounded-full border-4 border-paper ${s.status === 'done' ? 'bg-ok-600' : s.status === 'now' ? 'bg-sun-500' : s.status === 'missed' ? 'bg-bad-600' : 'bg-line-2'}`} aria-hidden />
                <button onClick={() => onSlot(s)} className={`flex w-full items-center gap-3 rounded-3xl border-2 bg-white p-3 text-start shadow-soft transition active:scale-[.99] ${s.status === 'now' ? 'glow border-sun-500' : 'border-transparent'}`}>
                  <ClockFace time={s.time} size={50} />
                  <div className="min-w-0 flex-1">
                    <p className="text-lg font-bold leading-tight">{slotEmoji(s)} {slotLabel(s, t)}</p>
                    <p className="truncate text-base text-ink-2">{s.doses.map((d) => `${categoryOf(d.category).emoji} ${d.name}`).join(' · ')}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-3 py-1 text-base font-bold ${STATUS_CHIP[s.status] || STATUS_CHIP.later}`}>
                    {s.status === 'done' ? '✓' : t(`st_${s.status}`)}
                  </span>
                </button>
              </li>
            );
          }
          const r = item.routine;
          return (
            <li key={`r${r.id}`} className="relative">
              <span className={`absolute -start-7 top-5 h-7 w-7 rounded-full border-4 border-paper ${r.done ? 'bg-ok-600' : 'bg-tile-haldi/60'}`} aria-hidden />
              <button onClick={() => onRoutine(r)} className="flex w-full items-center gap-3 rounded-3xl border-2 border-dashed border-sun-100 bg-sun-50/60 p-3 text-start transition active:scale-[.99]">
                <ClockFace time={r.time} size={50} />
                <div className="min-w-0 flex-1">
                  <p className="text-lg font-bold leading-tight">{r.emoji} {t(`rt_${r.kind}`)}</p>
                  <p className="truncate text-base text-ink-2">{r.done ? (r.done.value || timeIn(r.done.at, code)) : (r.last ? t('last_reading', { value: r.last.value }) : timeIn(r.time, code))}</p>
                </div>
                <span className={`shrink-0 rounded-full px-3 py-1 text-base font-bold ${r.done ? STATUS_CHIP.done : 'bg-white text-sun-800 ring-2 ring-sun-100'}`}>
                  {r.done ? '✓' : t('mark_done')}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// ---------------------------------------------------------------- health: BP, sugar, weight, walks

function HealthSheet({ t, code, routines, onPick, onClose }) {
  return (
    <Modal open onClose={onClose} title={`❤️‍🩹 ${t('tile_health')}`}>
      <div className="grid gap-3">
        {routines.map((r) => (
          <button key={r.id} onClick={() => onPick(r)} className={`flex items-center gap-4 rounded-3xl p-4 text-start ${r.done ? 'bg-ok-50' : 'bg-white ring-2 ring-sun-100'}`}>
            <span className="text-5xl leading-none" aria-hidden>{r.emoji}</span>
            <div className="min-w-0 flex-1">
              <p className="text-xl font-bold">{t(`rt_${r.kind}`)}</p>
              <p className="text-base text-ink-2">{timeIn(r.time, code)}{r.last ? ` · ${t('last_reading', { value: r.last.value })}` : ''}</p>
            </div>
            <span className={`rounded-full px-3 py-1 text-base font-bold ${r.done ? 'bg-ok-600 text-white' : 'bg-sun-500 text-brand-950'}`}>{r.done ? `✓ ${r.done.value || ''}` : t('mark_done')}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

// A big number pad: easier than a phone keyboard for shaky hands.
function NumberPad({ value, onChange, allowDot }) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', allowDot ? '.' : '', '0', '⌫'];
  return (
    <div className="grid grid-cols-3 gap-2" dir="ltr">
      {keys.map((k, i) => (k === '' ? <span key={i} /> : (
        <button key={i} type="button" onClick={() => onChange(k === '⌫' ? value.slice(0, -1) : (value + k).slice(0, 5))}
          className="h-16 rounded-2xl bg-white text-3xl font-bold shadow-soft ring-1 ring-line active:scale-95">{k}</button>
      )))}
    </div>
  );
}

function RoutineSheet({ t, code, routine, toast, sayIfOn, onClose, onSaved }) {
  const [v1, setV1] = useState('');
  const [v2, setV2] = useState('');
  const [field, setField] = useState(1);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  if (!routine) return null;
  const numbers = routine.numbers;

  async function save(withNumber) {
    setBusy(true);
    try {
      const body = withNumber ? { value1: v1, value2: v2 } : {};
      const res = await api(`/elder/routines/${routine.id}`, { method: 'POST', body });
      const msg = res.level === 'ok' ? t('reading_saved') : t('reading_alert');
      setResult({ ...res, msg });
      toast(msg, { big: true, tone: res.level === 'ok' ? undefined : 'bad' });
      sayIfOn(msg);
      onSaved();
      if (res.level === 'ok') setTimeout(onClose, 1200);
    } catch (err) {
      toast(err.message, { tone: 'bad' });
    } finally {
      setBusy(false);
    }
  }

  const label = routine.kind === 'bp' ? (field === 1 ? t('bp_upper') : t('bp_lower')) : routine.kind === 'weight' ? t('weight_number') : t('sugar_number');
  return (
    <Modal open onClose={onClose} title={`${routine.emoji} ${t(`rt_${routine.kind}`)}`}>
      {routine.last ? <p className="mb-3 text-lg text-ink-2">{t('last_reading', { value: routine.last.value })}</p> : null}
      {result ? (
        <div className={`rounded-3xl p-5 text-center ${result.level === 'ok' ? 'bg-ok-50 text-ok-800' : 'bg-bad-50 text-bad-800'}`}>
          <p className="text-4xl font-bold">{result.value || '✓'}</p>
          <p className="mt-2 text-xl font-semibold">{result.msg}</p>
        </div>
      ) : numbers ? (
        <div className="space-y-4">
          <div className={`grid gap-3 ${numbers === 2 ? 'grid-cols-2' : ''}`} dir="ltr">
            <button type="button" onClick={() => setField(1)} className={`rounded-2xl border-4 bg-white p-3 text-center ${field === 1 ? 'border-brand-600' : 'border-line'}`}>
              <span className="block text-base text-ink-2">{routine.kind === 'bp' ? t('bp_upper') : label}</span>
              <span className="block min-h-12 text-5xl font-bold">{v1 || '–'}</span>
            </button>
            {numbers === 2 ? (
              <button type="button" onClick={() => setField(2)} className={`rounded-2xl border-4 bg-white p-3 text-center ${field === 2 ? 'border-brand-600' : 'border-line'}`}>
                <span className="block text-base text-ink-2">{t('bp_lower')}</span>
                <span className="block min-h-12 text-5xl font-bold">{v2 || '–'}</span>
              </button>
            ) : null}
          </div>
          <NumberPad value={field === 1 ? v1 : v2} allowDot={routine.kind === 'weight'}
            onChange={(val) => { if (field === 1) { setV1(val); if (numbers === 2 && val.length === 3) setField(2); } else setV2(val); }} />
          <Button variant="success" size="xl" className="w-full" busy={busy} disabled={!v1 || (numbers === 2 && !v2)} onClick={() => save(true)}>
            <Check size={28} /> {t('save_number')}
          </Button>
          <button className="w-full text-center text-base text-ink-3 underline" onClick={() => save(false)}>{t('done_no_number')}</button>
        </div>
      ) : (
        <Button variant="success" size="xl" className="w-full !min-h-24" busy={busy} onClick={() => save(false)}>
          <span className="text-4xl" aria-hidden>{routine.emoji}</span> {t('mark_done')}
        </Button>
      )}
      <p className="mt-3 text-center text-base text-ink-3">{timeIn(routine.time, code)}</p>
    </Modal>
  );
}

function SlotSheet({ t, code, slots, onClose, onAct }) {
  const inPart = slots;
  if (inPart.length === 0) return null;
  return (
    <Modal open onClose={onClose} title={`${slotEmoji(inPart[0])} ${slotLabel(inPart[0], t)}`}>
      <div className="space-y-5">
        {inPart.map((s) => (
          <div key={s.time} className="rounded-2xl border border-line bg-white p-4">
            <div className="flex items-center gap-3">
              <span className="text-3xl" aria-hidden>{slotEmoji(s)}</span>
              <div className="flex-1">
                <p className="text-xl font-bold">{slotLabel(s, t)}</p>
                <p className="text-base text-ink-2">{timeIn(s.time, code)} · {statusText(s, t, code)}</p>
              </div>
              <ClockFace time={s.time} size={46} />
            </div>
            <ul className="divide-y divide-line">{s.doses.map((d) => <DoseRow key={d.id} d={d} t={t} />)}</ul>
            {(s.status === 'now' || s.status === 'snoozed') ? (
              <Button variant="success" size="lg" className="mt-3 w-full" onClick={() => { onClose(); onAct(s.doses.filter((d) => d.status === 'due').map((d) => d.id), 'taken'); }}>
                <Check size={26} /> {t('took_them')}
              </Button>
            ) : null}
            {(s.status === 'missed' || s.status === 'unsure') ? (
              <div className="mt-3">
                <p className="mb-2 text-base text-ink-2">{t('only_if_sure')}</p>
                <Button variant="secondary" size="lg" className="w-full" onClick={() => { onClose(); onAct(s.doses.filter((d) => d.status !== 'taken').map((d) => d.id), 'taken'); }}>
                  <Check size={22} /> {t('i_did_take')}
                </Button>
              </div>
            ) : null}
            {s.status === 'done' ? (
              <button className="mt-3 inline-flex items-center gap-1.5 text-base text-ink-3 underline" onClick={() => { onClose(); onAct(s.doses.map((d) => d.id), 'undo'); }}>
                <Undo2 size={16} /> {t('undo')}
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- consent: the elder decides

function FamilyAsks({ t, data, reload, toast, say }) {
  const [busy, setBusy] = useState(null);
  if (data.proposals.length === 0 && data.joins.length === 0) return null;
  const phoneOf = (name) => (data.circle.find((m) => m.name === name) || {}).phone;

  async function decide(id, approve) {
    setBusy(id);
    try {
      await api(`/elder/proposals/${id}`, { method: 'POST', body: { approve } });
      toast(approve ? `✓ ${t('yes_ok')}` : t('no'), { big: true });
      await reload();
    } catch (err) { toast(err.message, { tone: 'bad' }); } finally { setBusy(null); }
  }
  async function allow(id, permission) {
    setBusy(`j${id}`);
    try {
      await api(`/elder/members/${id}`, { method: 'POST', body: { permission } });
      await reload();
    } catch (err) { toast(err.message, { tone: 'bad' }); } finally { setBusy(null); }
  }

  return (
    <section aria-labelledby="asks-title" className="space-y-4">
      <h2 id="asks-title" className="flex items-center gap-2 text-2xl font-bold"><ShieldCheck className="text-brand-700" size={28} aria-hidden /> {t('family_asks')}</h2>
      {data.proposals.map((p) => {
        const first = p.proposer.split(' ')[0];
        const phone = phoneOf(p.proposer);
        return (
          <div key={p.id} className="animate-pop rounded-3xl border-2 border-sun-100 bg-white p-5 shadow-soft">
            <div className="flex min-w-0 items-center gap-3">
              <Avatar name={p.proposer} size={48} tone="sun" />
              <p className="min-w-0 flex-1 text-lg text-ink-2">{t('suggests', { name: `${first}${p.relation ? ` (${p.relation})` : ''}` })}</p>
              <button onClick={() => say(`${p.summary}. ${p.reason || ''}`)} className="shrink-0 rounded-full bg-brand-50 p-3 text-brand-800" aria-label={t('listen')}><Volume2 size={22} /></button>
            </div>
            <p className="mt-3 text-[1.35rem] font-bold leading-snug">{p.summary}</p>
            {p.reason ? <p className="mt-2 text-lg text-ink-2"><b>{t('why')}</b> {p.reason}</p> : null}
            <p className="mt-2 text-base text-brand-700">{t('you_decide')}</p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Button variant="success" size="xl" busy={busy === p.id} onClick={() => decide(p.id, true)}><Check size={28} /> {t('yes_ok')}</Button>
              <Button variant="secondary" size="xl" disabled={busy === p.id} onClick={() => decide(p.id, false)}>✕ {t('no')}</Button>
            </div>
            {phone ? (
              <a href={`tel:${phone.replace(/\s+/g, '')}`} className="mt-3 flex items-center justify-center gap-2 rounded-2xl py-2 text-lg font-semibold text-brand-700 hover:bg-brand-50">
                <Phone size={20} /> {t('call', { name: first })}
              </a>
            ) : null}
          </div>
        );
      })}
      {data.joins.map((j) => {
        const first = j.name.split(' ')[0];
        return (
          <div key={j.id} className="animate-pop rounded-3xl border-2 border-calm-100 bg-white p-5 shadow-soft">
            <div className="flex items-center gap-3">
              <Avatar name={j.name} size={48} tone="calm" />
              <p className="text-[1.25rem] font-bold leading-snug">{t('wants_join', { name: j.name, relation: j.relation || j.role })}</p>
            </div>
            <p className="mt-3 text-lg text-ink-2">{t('what_may', { name: first })}</p>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Button variant="soft" size="lg" busy={busy === `j${j.id}`} onClick={() => allow(j.id, 'view')}>👀 {t('perm_view')}</Button>
              <Button variant="soft" size="lg" disabled={busy === `j${j.id}`} onClick={() => allow(j.id, 'suggest')}>💬 {t('perm_suggest')}</Button>
              <Button variant="soft" size="lg" disabled={busy === `j${j.id}`} onClick={() => allow(j.id, 'manage')}>🤝 {t('perm_manage')}</Button>
              <Button variant="secondary" size="lg" disabled={busy === `j${j.id}`} onClick={() => allow(j.id, 'remove')}>✕ {t('perm_deny')}</Button>
            </div>
          </div>
        );
      })}
    </section>
  );
}

// ---------------------------------------------------------------- tiles' sheets

function FeelingSheet({ t, checkin, reload, toast, sayIfOn, onClose }) {
  const [mood, setMood] = useState(null);
  const [symptoms, setSymptoms] = useState([]);
  const [busy, setBusy] = useState(false);

  async function send(m, list) {
    setBusy(true);
    try {
      await api('/elder/checkin', { method: 'POST', body: { mood: m, symptoms: list } });
      const msg = m === 'unwell' ? t('family_told') : t('thanks_feeling', { mood: t(`mood_${m}`) });
      toast(msg, { big: true });
      sayIfOn(msg);
      await reload();
      onClose();
    } catch (err) { toast(err.message, { tone: 'bad' }); } finally { setBusy(false); }
  }

  const MOODS = [
    { key: 'good', emoji: '😊', cls: 'bg-ok-50 text-ok-800 border-ok-100' },
    { key: 'okay', emoji: '😐', cls: 'bg-sun-50 text-sun-800 border-sun-100' },
    { key: 'unwell', emoji: '🤒', cls: 'bg-bad-50 text-bad-800 border-bad-100' },
  ];
  return (
    <Modal open onClose={onClose} title={t('feeling_q')}>
      {checkin ? <p className="mb-4 rounded-2xl bg-paper-2 px-4 py-3 text-lg">{t('thanks_feeling', { mood: t(`mood_${checkin.mood}`) })}</p> : null}
      <div className="grid grid-cols-3 gap-3">
        {MOODS.map(({ key, emoji, cls }) => (
          <button key={key} disabled={busy} onClick={() => (key === 'unwell' ? setMood('unwell') : send(key, []))}
            className={`flex flex-col items-center gap-2 rounded-3xl border-2 px-2 py-5 text-lg font-bold transition active:scale-95 ${cls} ${mood === key ? 'ring-4 ring-bad-100' : ''}`}>
            <span className="text-6xl leading-none" aria-hidden>{emoji}</span> {t(`mood_${key}`)}
          </button>
        ))}
      </div>
      {mood === 'unwell' ? (
        <div className="animate-rise mt-5">
          <p className="text-xl font-semibold">{t('what_wrong')}</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {SYMPTOMS.map((s) => {
              const on = symptoms.includes(s);
              return (
                <button key={s} onClick={() => setSymptoms(on ? symptoms.filter((x) => x !== s) : [...symptoms, s])}
                  className={`flex items-center gap-2 rounded-2xl border-2 px-3 py-3 text-start text-lg font-semibold ${on ? 'border-bad-500 bg-bad-50 text-bad-800' : 'border-line-2 bg-white'}`} aria-pressed={on}>
                  <span className="text-3xl" aria-hidden>{SYMPTOM_EMOJI[s]}</span> {t(`sym_${s}`)}
                </button>
              );
            })}
          </div>
          <Button variant="danger" size="xl" className="mt-4 w-full" busy={busy} onClick={() => send('unwell', symptoms)}>
            <HeartHandshake size={26} /> {t('tell_family')}
          </Button>
        </div>
      ) : null}
    </Modal>
  );
}

function FamilySheet({ t, messages, reload, onOkay, onClose, say }) {
  async function heart(id) {
    await api(`/elder/messages/${id}/heart`, { method: 'POST' });
    reload();
  }
  return (
    <Modal open onClose={onClose} title={`💌 ${t('from_family')}`}>
      <ul className="space-y-4">
        {messages.map((m) => (
          m.from_elder ? (
            <li key={m.id} className="ms-10 rounded-2xl bg-brand-50 px-4 py-3 text-lg text-brand-800">{m.text}</li>
          ) : (
            <li key={m.id} className="flex gap-3">
              <Avatar name={m.sender || '?'} size={48} tone="dusk" />
              <div className="min-w-0 flex-1">
                <p className="text-base text-ink-3">{m.sender}{m.relation ? ` · ${m.relation}` : ''}</p>
                <p className="text-xl leading-snug">{m.text}</p>
                <div className="mt-2 flex gap-2">
                  <button onClick={() => !m.hearted && heart(m.id)}
                    className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-lg font-semibold ${m.hearted ? 'bg-bad-50 text-bad-600' : 'border-2 border-line-2 text-ink-2'}`}>
                    <Heart size={20} fill={m.hearted ? 'currentColor' : 'none'} /> {m.hearted ? t('loved') : t('love_it')}
                  </button>
                  <button onClick={() => say(m.text)} className="rounded-full border-2 border-line-2 p-2.5 text-ink-2" aria-label={t('listen')}><Volume2 size={20} /></button>
                </div>
              </div>
            </li>
          )
        ))}
      </ul>
      <Button variant="soft" size="xl" className="mt-6 w-full" onClick={() => { onOkay(); onClose(); }}>
        😊 {t('send_okay')}
      </Button>
    </Modal>
  );
}

function DoctorSheet({ t, code, visit, questions, reload, toast, onClose, say }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  async function add() {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await api('/elder/questions', { method: 'POST', body: { text } });
      setText('');
      toast(t('question_saved'), { big: true });
      reload();
    } catch (err) { toast(err.message, { tone: 'bad' }); } finally { setBusy(false); }
  }
  const n = visit ? daysUntil(visit.starts_at) : 0;
  const when = n === 0 ? t('today') : n === 1 ? t('tomorrow') : t('in_days', { n });
  return (
    <Modal open onClose={onClose} title={`🩺 ${t('next_visit')}`}>
      {visit ? (
        <div className="rounded-2xl border border-calm-100 bg-calm-50 p-4">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[1.4rem] font-bold">{visit.doctor}</p>
              {visit.specialty ? <p className="text-lg text-ink-2">{visit.specialty}</p> : null}
              <p className="mt-1 text-xl">{dateIn(visit.starts_at, code, { weekday: 'long', day: 'numeric', month: 'long' })}, {timeIn(visit.starts_at, code)}</p>
              <span className="mt-1 inline-block rounded-full bg-white px-3 py-0.5 text-lg font-bold text-calm-800">{when}</span>
            </div>
            <ClockFace time={`${new Date(visit.starts_at).getHours()}:${new Date(visit.starts_at).getMinutes()}`} size={56} />
          </div>
          {visit.place ? <p className="mt-2 flex items-center gap-2 text-lg text-ink-2"><MapPin size={18} aria-hidden /> {visit.place}</p> : null}
          {visit.companion_name ? <p className="mt-1 flex items-center gap-2 text-lg font-semibold text-brand-700"><Car size={18} aria-hidden /> {t('going_with', { name: visit.companion_name })}</p> : null}
          <Button variant="secondary" size="lg" className="mt-3 w-full" onClick={() => say(`${t('next_visit')}: ${visit.doctor}, ${when}, ${timeIn(visit.starts_at, code)}`)}><Volume2 size={22} /> {t('listen')}</Button>
        </div>
      ) : null}
      <h3 className="mt-5 flex items-center gap-2 text-xl font-bold"><Stethoscope size={22} className="text-calm-600" /> {t('my_questions')}</h3>
      <ul className="mt-2 space-y-2">
        {questions.map((q) => <li key={q.id} className="rounded-2xl bg-paper px-4 py-2.5 text-lg">“{q.text}”</li>)}
      </ul>
      <div className="mt-3 flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder={t('question_ph')} className="input !min-h-14 !text-lg" aria-label={t('add_question')} />
        <Button size="lg" busy={busy} onClick={add}>{t('save')}</Button>
      </div>
    </Modal>
  );
}

function PeopleSheet({ t, circle, reload, toast, onClose }) {
  const [editing, setEditing] = useState(null);
  const perm = (p) => (p === 'manage' ? `🤝 ${t('can_manage')}` : p === 'suggest' ? `💬 ${t('can_suggest')}` : `👀 ${t('can_view')}`);
  async function set(member, permission) {
    try {
      await api(`/elder/members/${member.id}`, { method: 'POST', body: { permission } });
      setEditing(null);
      reload();
    } catch (err) { toast(err.message, { tone: 'bad' }); }
  }
  return (
    <Modal open onClose={onClose} title={`👨‍👩‍👧 ${t('my_circle')}`}>
      <p className="text-lg text-ink-2">{t('circle_note')}</p>
      <ul className="mt-4 space-y-3">
        {circle.map((m) => (
          <li key={m.id} className="rounded-2xl border border-line bg-white p-3">
            <div className="flex flex-wrap items-center gap-3">
              <Avatar name={m.name} size={48} />
              <div className="min-w-0 flex-1">
                <p className="text-xl font-bold">{m.name}</p>
                <p className="text-base text-ink-2">{m.relation} · {perm(m.permission)}</p>
              </div>
              {m.phone ? <a href={`tel:${m.phone.replace(/\s+/g, '')}`} className="rounded-2xl bg-ok-600 p-3 text-white" aria-label={t('call', { name: m.name })}><Phone size={24} /></a> : null}
              <Button variant="secondary" onClick={() => setEditing(editing === m.id ? null : m.id)}>{t('change')}</Button>
            </div>
            {editing === m.id ? (
              <div className="mt-3 grid gap-2">
                {['view', 'suggest', 'manage'].map((p) => (
                  <Button key={p} size="lg" variant={m.permission === p ? 'primary' : 'soft'} onClick={() => set(m, p)}>
                    {m.permission === p ? '✓ ' : ''}{t(`perm_${p}`)}
                  </Button>
                ))}
                <Button size="lg" variant="dangerOutline" onClick={() => set(m, 'remove')}>✕ {t('remove')}</Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </Modal>
  );
}

function HelpSheet({ t, onClose }) {
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  async function send() {
    setBusy(true);
    try {
      setResult(await api('/elder/help', { method: 'POST' }));
    } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title={`🆘 ${t('help')}`}>
      {!result ? (
        <div className="space-y-4">
          <p className="text-[1.7rem] font-bold">{t('help_q')}</p>
          <Button variant="danger" size="xl" className="w-full !min-h-24" busy={busy} onClick={send}><LifeBuoy size={32} /> {t('help_yes')}</Button>
          <Button variant="secondary" size="lg" className="w-full" onClick={onClose}>{t('help_no')}</Button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xl font-bold text-ok-800">✓ {t('help_sent', { names: result.told.join(', ') })}</p>
          {result.phones.map((p) => (
            <a key={p.phone} href={`tel:${p.phone.replace(/\s+/g, '')}`} className="flex items-center justify-center gap-2 rounded-2xl bg-ok-600 px-4 py-5 text-xl font-bold text-white">
              <Phone size={26} /> {t('call', { name: p.name.split(' ')[0] })}
            </a>
          ))}
          <a href="tel:112" className="flex items-center justify-center gap-2 rounded-2xl border-2 border-bad-500 px-4 py-5 text-xl font-bold text-bad-600">
            🚑 {t('emergency')}
          </a>
        </div>
      )}
    </Modal>
  );
}

function VoiceSheet({ t, code, onClose, onIntent, onQuestion, onSend }) {
  const [text, setText] = useState('');
  const [listening, setListening] = useState(true);
  const [thinking, setThinking] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const stopRef = useRef(null);
  const finalRef = useRef('');

  useEffect(() => {
    stopRef.current = listen(code, (heard, isFinal) => {
      setText(heard);
      if (isFinal) finalRef.current = heard;
    }, async () => {
      setListening(false);
      const heard = finalRef.current;
      if (!heard) return;
      setThinking(true);
      const handled = await onIntent(heard);
      setThinking(false);
      if (!handled) setUnknown(true);
    });
    return () => { if (stopRef.current) stopRef.current(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Modal open onClose={onClose} title={`🎤 ${t('speak')}`}>
      <div className="flex flex-col items-center text-center">
        <span className={`flex h-28 w-28 items-center justify-center rounded-full ${listening ? 'pulse-ring bg-brand-700 text-white' : 'bg-paper-2 text-ink-2'}`}>
          {thinking ? <LoaderCircle size={48} className="animate-spin" /> : <Mic size={52} />}
        </span>
        <p className="mt-4 text-xl font-semibold">{listening ? t('listening') : t('heard')}</p>
        {text ? <p className="mt-2 text-2xl">“{text}”</p> : <p className="mt-2 text-lg text-ink-3">{t('voice_hint')}</p>}
      </div>
      {unknown && text ? (
        <div className="mt-6 grid gap-3">
          <Button size="lg" variant="soft" onClick={() => onQuestion(text)}>🩺 {t('save_as_question')}</Button>
          <Button size="lg" variant="soft" onClick={() => onSend(text)}>💌 {t('send_to_family')}</Button>
        </div>
      ) : null}
    </Modal>
  );
}

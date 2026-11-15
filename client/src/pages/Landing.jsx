import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Sunrise, CircleHelp, ShieldCheck, BellRing, ScanLine, ClipboardList, HeartHandshake, Users, UserPlus, KeyRound,
  ArrowRight, LifeBuoy, Languages, Mic, HeartPulse, WifiOff, Mail, Bike,
} from 'lucide-react';
import { api } from '../api.js';
import { Button, useToast } from '../ui.jsx';

const DEMO = [
  { as: 'elder', name: 'Kamla ji', role: 'The elder, 79', note: 'Her own big, simple screen', tone: 'bg-sun-50 border-sun-100' },
  { as: 'ravi', name: 'Ravi', role: 'Son', note: 'Manages the care plan', tone: 'bg-brand-50 border-brand-100' },
  { as: 'priya', name: 'Priya', role: 'Home nurse', note: 'Caretaker, gets escalations', tone: 'bg-calm-50 border-calm-100' },
  { as: 'anjali', name: 'Anjali', role: 'Granddaughter', note: 'Can only suggest changes', tone: 'bg-dusk-50 border-dusk-100' },
];

const IDEAS = [
  { Icon: Sunrise, title: 'Pictures, not paperwork', text: '🍛 means after lunch, a clock face shows the time, pills are drawn as they look, and every medicine says what it\'s for: Metformin (sugar medicine).' },
  { Icon: CircleHelp, title: '"Did I take it?"', text: 'One tap answers the question elders worry about most, and stops double doses.' },
  { Icon: ShieldCheck, title: 'The elder decides', text: 'Family can suggest changes, but nothing changes without the elder\'s yes. They choose who joins.' },
  { Icon: BellRing, title: 'Escalation ladder', text: 'Reminder, then a nudge, then the caretaker, then the family. Emails have one-tap "I took it" buttons.' },
  { Icon: ScanLine, title: 'Reads prescriptions', text: 'Photograph a prescription and AI fills in the medicines. A person always checks before saving.' },
  { Icon: ClipboardList, title: 'Doctor visit sheet', text: 'Adherence, missed-dose patterns, symptoms and the elder\'s own questions on one printable page.' },
  { Icon: HeartPulse, title: 'Health routines', text: 'BP, sugar, weight and walks sit in "My day" next to the medicines. A big number pad for readings, charts for the family, an alert if a number is out of range.' },
  { Icon: WifiOff, title: 'Works offline', text: 'No internet? The elder\'s screen still opens, and "I took it" is saved on the phone until the connection is back. A chime rings when medicine is due.' },
  { Icon: Mail, title: 'Weekly family summary', text: 'Every Sunday evening the circle gets one calm email: medicines taken, readings, how they felt, refills and the next visit.' },
  { Icon: Bike, title: '"I\'ll pick it up"', text: 'When a medicine runs low, one person takes the refill, so nobody buys it twice and the elder sees who is bringing it.' },
  { Icon: LifeBuoy, title: 'Help and silent alarm', text: 'A Help button tells everyone at once. No sign of life by 11 AM? The family gets a gentle nudge.' },
  { Icon: Languages, title: '20 languages, spoken', text: 'Hindi, Tamil, Bengali, Urdu, Spanish, Arabic and more. Saathi reads everything aloud and understands spoken commands, so reading isn\'t needed.' },
];

export default function Landing() {
  const navigate = useNavigate();
  const toast = useToast();
  const [config, setConfig] = useState({ demo: true });
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    api('/config').then(setConfig).catch(() => {});
    // Already logged in? Go straight to the right screen.
    api('/me').then((me) => {
      if (me.member.status === 'pending') navigate('/waiting');
      else navigate(me.member.role === 'elder' ? '/elder' : '/care');
    }).catch(() => {});
  }, [navigate]);

  async function demo(as) {
    setBusy(as);
    try {
      const res = await api('/demo/login', { method: 'POST', body: { as } });
      navigate(res.kind === 'elder' ? '/elder' : '/care');
    } catch (err) {
      toast(err.message, { tone: 'bad' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="min-h-screen">
      <div className="rounded-b-[3rem] bg-brand-900 text-white">
      <header className="mx-auto flex max-w-6xl items-center gap-3 px-5 py-5">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-xl" aria-hidden>💚</span>
        <span className="font-display text-2xl font-bold">Saathi</span>
        <nav className="ml-auto flex gap-2">
          <Link to="/login"><Button variant="ghost" size="sm" className="!text-brand-100 hover:!bg-white/10">Family login</Button></Link>
          <Link to="/elder/login"><Button variant="sun" size="sm">Elder login</Button></Link>
        </nav>
      </header>

      <section className="mx-auto grid max-w-6xl gap-10 px-5 pb-16 pt-6 lg:grid-cols-[1.1fr_1fr] lg:items-center">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-sm font-semibold text-sun-100">
            <HeartHandshake size={16} /> Saathi means companion
          </p>
          <h1 className="mt-4 font-display text-5xl font-bold leading-[1.02] sm:text-7xl">
            Care that keeps elders <span className="text-sun-500">in charge.</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-brand-100">
            Medicines, health routines, doctor visits and family in one place, in 20 languages. Built around how older people really think:
            pictures and voice, not paperwork, and the final say on their own care.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link to="/setup"><Button size="lg" variant="sun" className="!text-brand-950">Set up Saathi <ArrowRight size={20} /></Button></Link>
            <Link to="/join"><Button size="lg" variant="secondary" className="!border-white/30 !bg-white/10 !text-white hover:!bg-white/20"><UserPlus size={20} /> Join a care circle</Button></Link>
          </div>
        </div>

        {config.demo ? (
          <div className="rounded-[2rem] bg-white p-6 text-ink shadow-lift">
            <p className="text-sm font-bold uppercase tracking-wider text-ink-3">Live demo</p>
            <h2 className="mt-1 text-2xl font-bold">Meet Kamla ji's care circle</h2>
            <p className="mt-1 text-ink-2">Open the app as any of them. Everything is live and shared.</p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {DEMO.map((d) => (
                <button
                  key={d.as}
                  onClick={() => demo(d.as)}
                  disabled={busy !== null}
                  className={`group rounded-2xl border-2 p-4 text-left transition hover:-translate-y-0.5 hover:shadow-soft ${d.tone}`}
                >
                  <p className="text-lg font-bold">{d.name} <span className="font-normal text-ink-2">· {d.role}</span></p>
                  <p className="text-sm text-ink-2">{d.note}</p>
                  <p className="mt-2 inline-flex items-center gap-1 text-sm font-bold text-brand-700">
                    {busy === d.as ? 'Opening…' : 'Open'} <ArrowRight size={14} className="transition group-hover:translate-x-0.5" />
                  </p>
                </button>
              ))}
            </div>
            <p className="mt-4 text-xs text-ink-3">
              Tip: open Kamla ji in one window and Ravi in another, then mark a medicine and watch the family view update.
            </p>
          </div>
        ) : null}
      </section>
      </div>

      <section>
        <div className="mx-auto max-w-6xl px-5 py-14">
          <h2 className="font-display text-4xl font-bold">More than a reminder app</h2>
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {IDEAS.map(({ Icon, title, text }) => (
              <div key={title} className="rounded-3xl bg-white p-5 shadow-soft">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-700"><Icon size={22} /></span>
                <h3 className="mt-3 text-lg font-bold">{title}</h3>
                <p className="mt-1 text-[15px] leading-relaxed text-ink-2">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-5 px-5 py-14 md:grid-cols-3">
        {[
          { Icon: Users, title: '1. Family sets it up', text: 'Add medicines (or photograph the prescription), routine times and the elder\'s PIN. You get a Care ID.' },
          { Icon: KeyRound, title: '2. Others join with a passcode', text: 'Caretakers and relatives enter the Care ID and circle passcode. The elder approves each person.' },
          { Icon: Mic, title: '3. The elder just uses it', text: 'Big buttons, voice, Hindi. One tap for "I took it". Everyone else stays informed by email.' },
        ].map(({ Icon, title, text }) => (
          <div key={title} className="rounded-2xl bg-brand-800 p-6 text-white">
            <Icon size={26} className="text-sun-100" />
            <h3 className="mt-3 text-xl font-bold">{title}</h3>
            <p className="mt-1 text-brand-100">{text}</p>
          </div>
        ))}
      </section>

      <footer className="border-t border-line py-8 text-center text-sm text-ink-3">
        Saathi · made for the Elderly Care and Medication Management challenge. Not a substitute for medical advice.
      </footer>
    </div>
  );
}

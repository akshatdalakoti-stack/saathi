// Logging in, joining a circle, and setting Saathi up.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Delete, ArrowLeft, Check, Hourglass, ShieldCheck, Dices } from 'lucide-react';
import { api } from '../api.js';
import { Button, Field, ErrorNote, Card } from '../ui.jsx';
import { LANGUAGES } from '../../../shared/languages.js';

function Shell({ title, subtitle, children, back = '/' }) {
  return (
    <div className="min-h-screen px-4 py-8">
      <div className="mx-auto max-w-lg">
        <Link to={back} className="mb-6 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-2 hover:text-ink">
          <ArrowLeft size={16} /> Back
        </Link>
        <div className="mb-6 flex items-center gap-3">
          <img src="/favicon.svg" alt="" className="h-10 w-10" />
          <span className="font-display text-2xl font-semibold text-brand-700">Saathi</span>
        </div>
        <h1 className="font-display text-3xl font-semibold">{title}</h1>
        {subtitle ? <p className="mt-2 text-ink-2">{subtitle}</p> : null}
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- elder login: big keypad, no typing needed

export function ElderLogin() {
  const navigate = useNavigate();
  const [careId, setCareId] = useState(() => localStorage.getItem('saathi_care_id') || '');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(fullPin) {
    setBusy(true);
    setError('');
    try {
      await api('/login/elder', { method: 'POST', body: { care_id: careId, pin: fullPin } });
      try { localStorage.setItem('saathi_care_id', careId.toUpperCase()); } catch { /* fine */ }
      navigate('/elder');
    } catch (err) {
      setError(err.message);
      setPin('');
    } finally {
      setBusy(false);
    }
  }

  function press(digit) {
    if (pin.length >= 6) return;
    const next = pin + digit;
    setPin(next);
    if (next.length === 4 && careId) submit(next);
  }

  return (
    <Shell title="Open my Saathi" subtitle="Your family can tell you your Care ID and PIN. You only need to do this once on this phone.">
      <Field label="Care ID">
        <input className="input !min-h-14 !text-xl font-bold tracking-wider uppercase" value={careId} onChange={(e) => setCareId(e.target.value)} placeholder="KAMLA-4821" autoCapitalize="characters" />
      </Field>
      <p className="label mt-6">PIN</p>
      <div className="mb-5 flex justify-center gap-3" aria-live="polite">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={`h-5 w-5 rounded-full border-2 ${pin.length > i ? 'border-brand-700 bg-brand-700' : 'border-line-2'}`} />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} onClick={() => press(d)} disabled={busy} className="h-20 rounded-2xl border border-line-2 bg-white text-3xl font-bold shadow-soft active:scale-95">{d}</button>
        ))}
        <button onClick={() => setPin(pin.slice(0, -1))} className="flex h-20 items-center justify-center rounded-2xl text-ink-2" aria-label="Delete"><Delete size={30} /></button>
        <button onClick={() => press('0')} disabled={busy} className="h-20 rounded-2xl border border-line-2 bg-white text-3xl font-bold shadow-soft active:scale-95">0</button>
        <button onClick={() => submit(pin)} disabled={busy || pin.length < 4} className="flex h-20 items-center justify-center rounded-2xl bg-brand-700 text-white disabled:opacity-40" aria-label="Open"><Check size={32} /></button>
      </div>
      <div className="mt-4"><ErrorNote error={error} /></div>
    </Shell>
  );
}

// ---------------------------------------------------------------- family / caretaker login

export function MemberLogin() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [pin, setPin] = useState('');
  const [choose, setChoose] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(memberId) {
    setBusy(true);
    setError('');
    try {
      const res = await api('/login/member', { method: 'POST', body: { email, pin, member_id: memberId } });
      if (res.choose) return setChoose(res.choose);
      navigate(res.pending ? '/waiting' : '/care');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell title="Family and caretaker login" subtitle="Use the email and PIN you chose when you joined.">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Field label="Email"><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required /></Field>
        <Field label="PIN"><input className="input tracking-[0.4em]" type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="••••" required /></Field>
        <ErrorNote error={error} />
        <Button size="lg" className="w-full" busy={busy}>Log in</Button>
      </form>
      {choose ? (
        <Card className="mt-6 p-5">
          <p className="font-bold">You're in more than one care circle. Which one?</p>
          <div className="mt-3 grid gap-2">
            {choose.map((c) => <Button key={c.member_id} variant="secondary" onClick={() => submit(c.member_id)}>{c.profile_name} · {c.care_id}</Button>)}
          </div>
        </Card>
      ) : null}
      <p className="mt-6 text-sm text-ink-2">New here? <Link className="font-semibold text-brand-700" to="/join">Join a care circle</Link> or <Link className="font-semibold text-brand-700" to="/setup">set up Saathi</Link>.</p>
    </Shell>
  );
}

// ---------------------------------------------------------------- join with Care ID + passcode

export function Join() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [form, setForm] = useState({ care_id: params.get('care') || '', passcode: '', name: '', relation: '', role: 'family', email: '', phone: '', pin: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/join', { method: 'POST', body: form });
      navigate('/waiting');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell title="Join a care circle" subtitle="Ask the family for the Care ID and circle passcode. The elder will decide whether you can join, and what you can do.">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Care ID"><input className="input font-bold uppercase" value={form.care_id} onChange={set('care_id')} placeholder="KAMLA-4821" required /></Field>
          <Field label="Circle passcode"><input className="input tracking-widest" inputMode="numeric" value={form.passcode} onChange={set('passcode')} placeholder="6 numbers" required /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Your name"><input className="input" value={form.name} onChange={set('name')} placeholder="Sunita Sharma" required /></Field>
          <Field label="How are you related?"><input className="input" value={form.relation} onChange={set('relation')} placeholder="daughter-in-law" /></Field>
        </div>
        <div>
          <span className="label">You are</span>
          <div className="grid grid-cols-2 gap-3">
            {[['family', 'Family', 'Get updates and alerts'], ['caretaker', 'Caretaker', 'Gets missed-dose escalations first']].map(([value, title, text]) => (
              <button type="button" key={value} onClick={() => setForm({ ...form, role: value })}
                className={`rounded-xl border-2 p-3 text-left ${form.role === value ? 'border-brand-600 bg-brand-50' : 'border-line bg-white'}`}>
                <p className="font-bold">{title}</p><p className="text-xs text-ink-2">{text}</p>
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Email (for alerts)"><input className="input" type="email" value={form.email} onChange={set('email')} placeholder="you@example.com" required /></Field>
          <Field label="Phone"><input className="input" value={form.phone} onChange={set('phone')} placeholder="+91 98xxx xxxxx" /></Field>
        </div>
        <Field label="Choose your PIN" hint="4 to 6 numbers. You'll use it with your email to log in.">
          <input className="input tracking-[0.4em]" type="password" inputMode="numeric" value={form.pin} onChange={set('pin')} required />
        </Field>
        <ErrorNote error={error} />
        <Button size="lg" className="w-full" busy={busy}>Ask to join</Button>
      </form>
    </Shell>
  );
}

export function Waiting() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  useEffect(() => {
    let alive = true;
    async function check() {
      try {
        const me = await api('/me');
        if (!alive) return;
        setName(me.profile.call_name || me.profile.name);
        if (me.member.status === 'active') navigate(me.member.role === 'elder' ? '/elder' : '/care');
      } catch {
        navigate('/');
      }
    }
    check();
    const id = setInterval(check, 4000);
    return () => { alive = false; clearInterval(id); };
  }, [navigate]);
  return (
    <Shell title={`Waiting for ${name || 'the elder'} to say yes`} subtitle="Your request has been sent. As soon as they allow you in, this page opens the care dashboard by itself.">
      <Card className="flex items-center gap-4 p-6">
        <Hourglass className="animate-pulse text-sun-500" size={36} />
        <p className="text-ink-2">In Saathi, the elder decides who joins their care circle and what each person can do.</p>
      </Card>
      <button className="mt-6 text-sm font-semibold text-ink-2 underline" onClick={async () => { await api('/logout', { method: 'POST' }); navigate('/'); }}>Log out</button>
    </Shell>
  );
}

// ---------------------------------------------------------------- set up a new profile

function randomPasscode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function Setup() {
  const navigate = useNavigate();
  const [self, setSelf] = useState(false);
  const [elder, setElder] = useState({ name: '', call_name: '', birth_year: '', language: 'en', conditions: '', allergies: '', email: '', phone: '' });
  const [routine, setRoutine] = useState({ wake: '06:30', breakfast: '08:00', lunch: '13:00', tea: '17:00', dinner: '20:00', bed: '22:00' });
  const [you, setYou] = useState({ name: '', relation: '', role: 'family', email: '', phone: '', pin: '' });
  const [elderPin, setElderPin] = useState('');
  const [passcode, setPasscode] = useState(randomPasscode());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api('/setup', { method: 'POST', body: { self, elder: { ...elder, routine }, elder_pin: elderPin, passcode, you } });
      setDone(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Shell title="Saathi is ready" subtitle="Write these down and keep them somewhere safe.">
        <Card className="space-y-4 p-6">
          <div><p className="label">Care ID</p><p className="text-3xl font-bold tracking-wider text-brand-700">{done.care_id}</p></div>
          <div><p className="label">Circle passcode (to invite others)</p><p className="text-2xl font-bold tracking-[0.3em]">{passcode}</p></div>
          <div><p className="label">{elder.call_name || elder.name}'s PIN</p><p className="text-2xl font-bold tracking-[0.3em]">{elderPin}</p></div>
          <p className="flex gap-2 rounded-xl bg-brand-50 p-3 text-sm text-brand-800"><ShieldCheck size={18} className="shrink-0" /> On {elder.call_name || elder.name}'s phone, open Saathi, tap Elder login and enter the Care ID and PIN.</p>
        </Card>
        <Button size="lg" className="mt-6 w-full" onClick={() => navigate(done.kind === 'elder' ? '/elder' : '/care/medicines')}>
          {done.kind === 'elder' ? 'Open my Saathi' : 'Add medicines next'}
        </Button>
      </Shell>
    );
  }

  const setE = (key) => (e) => setElder({ ...elder, [key]: e.target.value });
  const setY = (key) => (e) => setYou({ ...you, [key]: e.target.value });

  return (
    <Shell title="Set up Saathi" subtitle="It takes about two minutes. You can change everything later.">
      <form onSubmit={submit} className="space-y-8">
        <section>
          <p className="label">Who is Saathi for?</p>
          <div className="grid grid-cols-2 gap-3">
            {[[false, 'Someone I care for', 'A parent or grandparent'], [true, 'Myself', "I'll manage my own medicines"]].map(([value, title, text]) => (
              <button type="button" key={title} onClick={() => setSelf(value)} className={`rounded-xl border-2 p-3 text-left ${self === value ? 'border-brand-600 bg-brand-50' : 'border-line bg-white'}`}>
                <p className="font-bold">{title}</p><p className="text-xs text-ink-2">{text}</p>
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-bold">{self ? 'About you' : 'About them'}</h2>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Full name"><input className="input" value={elder.name} onChange={setE('name')} placeholder="Kamla Devi Sharma" required /></Field>
            <Field label="What should Saathi call them?" hint='Like "Kamla ji" or "Nanaji"'><input className="input" value={elder.call_name} onChange={setE('call_name')} placeholder="Kamla ji" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Year of birth"><input className="input" inputMode="numeric" value={elder.birth_year} onChange={setE('birth_year')} placeholder="1947" /></Field>
            <Field label="Language">
              <select className="input" value={elder.language} onChange={setE('language')}>
                {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.native}{l.native !== l.english ? ` (${l.english})` : ''}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Health conditions"><input className="input" value={elder.conditions} onChange={setE('conditions')} placeholder="Diabetes, high blood pressure" /></Field>
          <Field label="Allergies"><input className="input" value={elder.allergies} onChange={setE('allergies')} placeholder="Penicillin" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Their email (optional)" hint="For gentle reminders"><input className="input" type="email" value={elder.email} onChange={setE('email')} /></Field>
            <Field label="Their phone (optional)"><input className="input" value={elder.phone} onChange={setE('phone')} /></Field>
          </div>
        </section>

        <section>
          <h2 className="text-lg font-bold">Their daily routine</h2>
          <p className="mb-3 text-sm text-ink-2">Saathi uses these to say "after lunch" instead of "1:30 PM".</p>
          <div className="grid grid-cols-3 gap-3">
            {Object.keys(routine).map((key) => (
              <Field key={key} label={{ wake: 'Wakes up', breakfast: 'Breakfast', lunch: 'Lunch', tea: 'Evening tea', dinner: 'Dinner', bed: 'Bedtime' }[key]}>
                <input className="input" type="time" value={routine[key]} onChange={(e) => setRoutine({ ...routine, [key]: e.target.value })} />
              </Field>
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-bold">Access</h2>
          <div className="grid grid-cols-2 gap-3">
            <Field label={self ? 'Your PIN' : 'Their PIN'} hint="4 numbers, easy to remember">
              <input className="input tracking-[0.4em]" inputMode="numeric" value={elderPin} onChange={(e) => setElderPin(e.target.value)} placeholder="1234" required />
            </Field>
            <Field label="Circle passcode" hint="Others need this to ask to join">
              <div className="flex gap-2">
                <input className="input tracking-[0.25em]" inputMode="numeric" value={passcode} onChange={(e) => setPasscode(e.target.value)} required />
                <button type="button" className="rounded-xl border border-line-2 bg-white px-3" onClick={() => setPasscode(randomPasscode())} aria-label="New passcode"><Dices size={18} /></button>
              </div>
            </Field>
          </div>
        </section>

        {!self ? (
          <section className="space-y-4">
            <h2 className="text-lg font-bold">About you</h2>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Your name"><input className="input" value={you.name} onChange={setY('name')} placeholder="Ravi Sharma" required /></Field>
              <Field label="Relation"><input className="input" value={you.relation} onChange={setY('relation')} placeholder="son" /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Your email"><input className="input" type="email" value={you.email} onChange={setY('email')} required /></Field>
              <Field label="Your phone"><input className="input" value={you.phone} onChange={setY('phone')} /></Field>
            </div>
            <Field label="Your PIN" hint="4 to 6 numbers"><input className="input tracking-[0.4em]" type="password" inputMode="numeric" value={you.pin} onChange={setY('pin')} required /></Field>
            <p className="rounded-xl bg-sun-50 p-3 text-sm text-sun-800">You'll be able to manage the care plan. {elder.call_name || 'The elder'} can change that, and decide who else joins, at any time.</p>
          </section>
        ) : null}

        <ErrorNote error={error} />
        <Button size="lg" className="w-full" busy={busy}>Create Saathi</Button>
      </form>
    </Shell>
  );
}

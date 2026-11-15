// End-to-end check of Saathi's main flows against a running server.
const BASE = process.argv[2] || 'http://localhost:3100';
let failures = 0;
function check(label, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
  if (!ok) failures++;
}
function client() {
  let cookie = '';
  return async function call(path, method = 'GET', body) {
    const res = await fetch(BASE + path, {
      method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined, redirect: 'manual',
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let data = text;
    try { data = JSON.parse(text); } catch { /* html */ }
    return { status: res.status, data };
  };
}

const elder = client();
const ravi = client();
const anjali = client();
const sunita = client();

let r = await elder('/api/login/elder', 'POST', { care_id: 'kamla-4821', pin: '1234' });
check('elder logs in with Care ID + PIN (case-insensitive ID)', r.status === 200);
let home = (await elder('/api/elder/home')).data;
check('elder sees 1 proposal and 1 join request', home.proposals.length === 1 && home.joins.length === 1);
check('slots are labelled by routine', home.slots.some((s) => s.anchor === 'breakfast' && s.rel === 'after'), home.slots.map((s) => s.label).join(' | '));

await ravi('/api/login/member', 'POST', { email: 'ravi@example.com', pin: '1111' });
await anjali('/api/login/member', 'POST', { email: 'anjali@example.com', pin: '3333' });

// Anjali can only suggest
r = await anjali('/api/care/meds', 'POST', { name: 'Vitamin B12', strength: '500 mcg', times: ['08:30'], purpose: 'for nerves', reason: 'Doctor mentioned it' });
check('suggest-only member creates a proposal, not a change', r.data.proposed === true, r.data.summary);
r = await ravi('/api/care/meds', 'POST', { name: 'Isabgol', strength: '1 spoon', form: 'syrup', times: ['22:00'], purpose: 'for constipation' });
check('manager adds a medicine directly', r.data.applied === true);

// Elder approves Anjali's earlier suggestion and declines the new one
home = (await elder('/api/elder/home')).data;
const atorva = home.proposals.find((p) => p.summary.startsWith('Atorvastatin'));
const b12 = home.proposals.find((p) => p.summary.includes('Vitamin B12'));
r = await elder(`/api/elder/proposals/${atorva.id}`, 'POST', { approve: true });
check('elder approves a proposal', r.status === 200);
r = await elder(`/api/elder/proposals/${b12.id}`, 'POST', { approve: false });
check('elder declines a proposal', r.status === 200);
const meds = (await ravi('/api/care/meds')).data.meds;
check('approved change applied (Atorvastatin now 21:00)', meds.find((m) => m.name === 'Atorvastatin').times.join() === '21:00');
check('declined change not applied (no Vitamin B12)', !meds.some((m) => m.name === 'Vitamin B12'));

// Elder decides who joins
const sunitaId = home.joins[0].id;
r = await sunita('/api/login/member', 'POST', { email: 'sunita@example.com', pin: '4444' });
r = await sunita('/api/care/overview');
check('pending member is blocked until elder approves', r.status === 403);
await elder(`/api/elder/members/${sunitaId}`, 'POST', { permission: 'view' });
r = await sunita('/api/care/overview');
check('after elder allows, member can view', r.status === 200);
r = await sunita('/api/care/meds', 'POST', { name: 'X', times: ['08:00'] });
check('view-only member cannot change medicines', r.status === 403);

// Wrong passcode and PIN lockout
r = await client()('/api/join', 'POST', { care_id: 'KAMLA-4821', passcode: '000000', name: 'X', email: 'x@example.com', pin: '1234' });
check('join with wrong passcode is refused', r.status === 401);
const guesser = client();
let last = null;
for (let i = 0; i < 6; i++) last = await guesser('/api/login/elder', 'POST', { care_id: 'KAMLA-4821', pin: '9999' });
check('PIN guessing locks out after 5 tries', last.status === 429);

// Dose actions, double-dose guard via undo/taken, and one-tap email links
await elder('/api/elder/settings', 'POST', { language: 'hi' }); // the elder's own emails should come in Hindi
r = await ravi('/api/care/demo/due-now', 'POST');
check('demo: medicines due now', r.status === 200);
home = (await elder('/api/elder/home')).data;
const now = home.slots.find((s) => s.status === 'now');
check('elder home shows a "now" slot', !!now);
const ids = now.doses.map((d) => d.id);
await elder('/api/elder/doses', 'POST', { ids, action: 'unsure' });
let outbox = (await ravi('/api/care/outbox')).data.items;
check('"not sure" emails the family', outbox.some((m) => m.kind === 'unsure'));
await ravi('/api/care/doses', 'POST', { ids, action: 'undo' });

// Make an action link the same way the engine does, by sending a nudge after fast-mode minute passes
console.log('...waiting 65 s for the fast-mode nudge');
await new Promise((res) => setTimeout(res, 65000));
await ravi('/api/care/demo/tick', 'POST');
outbox = (await ravi('/api/care/outbox')).data.items;
const nudge = outbox.find((m) => m.kind === 'nudge');
check('engine sends a nudge with one-tap buttons', !!nudge);
check("the elder's nudge email is in the elder's language (Hindi)", /[ऀ-ॿ]/.test(nudge.subject), nudge.subject);
await elder('/api/elder/settings', 'POST', { language: 'en' });
const full = (await ravi(`/api/care/outbox/${nudge.id}`)).data;
const link = full.html.match(/\/act\/([a-f0-9]+)/)[1];
r = await client()(`/act/${link}`);
check('one-tap link opens a confirm page without login', r.status === 200 && String(r.data).includes('Yes, they were taken'));
r = await client()(`/act/${link}`, 'POST');
check('confirming the link marks the doses taken', r.status === 200 && String(r.data).includes('Marked as taken'));
home = (await elder('/api/elder/home')).data;
check('elder home now shows that slot as done', home.slots.find((s) => s.time === now.time).status === 'done');
r = await client()(`/act/${link}`);
check('link cannot be reused', String(r.data).includes('Already done'));

// Elder wellbeing
await elder('/api/elder/checkin', 'POST', { mood: 'unwell', symptoms: ['dizziness'] });
await elder('/api/elder/help', 'POST');
outbox = (await ravi('/api/care/outbox')).data.items;
check('unwell check-in and Help both email the circle', outbox.some((m) => m.kind === 'unwell') && outbox.some((m) => m.kind === 'help'));
const ov = (await ravi('/api/care/overview')).data;
check('family dashboard shows the Help alert first', ov.alerts[0].kind === 'help', ov.alerts[0].text);

// Categories, languages and voice
home = (await elder('/api/elder/home')).data;
const metformin = home.slots.flatMap((s) => s.doses).find((d) => d.name === 'Metformin');
check('doses carry what they are for (Metformin = sugar)', metformin && metformin.category === 'sugar');
r = await ravi('/api/care/meds', 'POST', { name: 'Glimepiride', strength: '1 mg', times: ['07:30'] });
const glim = (await ravi('/api/care/meds')).data.meds.find((m) => m.name === 'Glimepiride');
check('category is guessed from the name when not picked', glim && glim.category === 'sugar', glim && glim.category);
await elder('/api/elder/settings', 'POST', { language: 'ta' });
check('elder can switch to Tamil', (await elder('/api/elder/home')).data.me.language === 'ta');
await elder('/api/elder/settings', 'POST', { language: 'xx' });
check('unknown language is ignored', (await elder('/api/elder/home')).data.me.language === 'ta');
r = await elder('/api/elder/voice', 'POST', { text: 'நான் மாத்திரை சாப்பிட்டேன்', lang: 'ta' });
check('Tamil voice command is understood ("I took my tablet" -> taken)', r.data.intent === 'taken', r.data.intent);
r = await elder('/api/elder/voice', 'POST', { text: 'আমার সাহায্য দরকার', lang: 'bn' });
check('Bengali voice command is understood ("I need help" -> help)', r.data.intent === 'help', r.data.intent);
await elder('/api/elder/settings', 'POST', { language: 'en' });

// Health routines and readings
home = (await elder('/api/elder/home')).data;
check('elder sees health tasks in "My day" (sugar, weight, BP, walk)', home.routines.length >= 3, home.routines.map((x) => x.kind).join(','));
const bpTask = home.routines.find((x) => x.kind === 'bp');
r = await elder(`/api/elder/routines/${bpTask.id}`, 'POST', { value1: 176, value2: 104 });
check('a high BP reading is flagged', r.data.level === 'high', r.data.value);
const sugarTask = home.routines.find((x) => x.kind === 'sugar');
r = await elder(`/api/elder/routines/${sugarTask.id}`, 'POST', { value1: 2000 });
check('an impossible number is refused', r.status === 400);
const walkTask = home.routines.find((x) => x.kind === 'walk');
r = await elder(`/api/elder/routines/${walkTask.id}`, 'POST', {});
check('a task without a number can be marked done', r.data.ok === true);
outbox = (await ravi('/api/care/outbox')).data.items;
check('the family is emailed about the high reading', outbox.some((m) => m.kind === 'reading' && m.subject.includes('176/104')));
const ov2 = (await ravi('/api/care/overview')).data;
check('the dashboard shows the reading alert and latest BP', ov2.alerts.some((a) => a.kind === 'reading') && ov2.health.bp.value.startsWith('176/104'));
const health = (await ravi('/api/care/health')).data;
check('health page has 30 days of BP and sugar for the charts', health.bp.length > 15 && health.sugar.length > 15, `${health.bp.length} BP, ${health.sugar.length} sugar`);

// Refill pickup and weekly summary
const metId = (await ravi('/api/care/meds')).data.meds.find((m) => m.name === 'Metformin').id;
await ravi(`/api/care/meds/${metId}/pickup`, 'POST');
home = (await elder('/api/elder/home')).data;
check('the elder sees who is bringing the refill', home.low.some((m) => m.refill_by_name === 'Ravi Sharma'));
await ravi('/api/care/demo/digest', 'POST');
outbox = (await ravi('/api/care/outbox')).data.items;
check('the weekly family summary is sent', outbox.some((m) => m.kind === 'digest'));

// Visit sheet, card, insights
const appts = (await ravi('/api/care/appointments')).data.upcoming;
r = await ravi(`/api/care/visit/${appts[0].id}`);
check('visit sheet has elder questions and meds', r.data.questions.length >= 2 && r.data.meds.length >= 6);
const card = (await ravi('/api/care/card')).data.url;
r = await client()(new URL(card).pathname);
check('emergency card opens without login and shows allergies', String(r.data).includes('Penicillin'));

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);

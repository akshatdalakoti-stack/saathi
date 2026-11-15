// Uses Google's Gemini model for two jobs:
//   1. Reading a photo of a prescription or medicine strip into a filled-in form.
//   2. Spotting medicines that might clash, phrased as QUESTIONS FOR THE DOCTOR (never as advice).
// A person always reviews the result before anything is saved.
import { CATEGORIES, CATEGORY_KEYS, guessCategory } from '../shared/categories.js';

// Tried in order. gemini-3.5-flash reads images well (~10 s); flash-lite is the fast fallback.
const MODELS = [process.env.GEMINI_MODEL || 'gemini-3.5-flash', 'gemini-flash-lite-latest'];

export function geminiReady() {
  return !!process.env.GEMINI_API_KEY;
}

async function askGemini(parts, models = MODELS) {
  if (!geminiReady()) throw new Error('The AI helper is not set up (GEMINI_API_KEY is missing).');
  let lastError = null;
  for (const model of models) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
        }),
        signal: AbortSignal.timeout(30000),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || `Gemini error ${res.status}`);
      const candidateParts = data.candidates?.[0]?.content?.parts || [];
      const text = candidateParts.filter((p) => !p.thought).map((p) => p.text || '').join('');
      return JSON.parse(text.replace(/^```json\s*|\s*```$/g, ''));
    } catch (err) {
      lastError = err;
      console.error(`[gemini] ${model} failed:`, err.message);
    }
  }
  throw new Error(`The AI helper couldn't read that: ${lastError ? lastError.message : 'unknown error'}`);
}

const SCAN_PROMPT = `You are helping a family set up medicine reminders for an elderly person in India.
Read this photo of a prescription, medicine strip, or medicine box. List every medicine you can see.
Return JSON only, in this exact shape:
{"medicines":[{"name":"","strength":"","form":"tablet|capsule|syrup|injection|drops|inhaler","amount":1,
"times":["HH:MM"],"days":[],"as_needed":false,"category":"","food":"before|after|with|empty|any","purpose":"","duration_days":null,"pill_color":"white|yellow|pink|orange|blue|green|red|brown|purple","notes":""}],
"doctor":"","unclear":""}
Rules:
- Indian prescriptions often write frequency as 1-0-1 (morning-afternoon-night), OD (once a day), BD (twice), TDS (three times), HS (bedtime), SOS (only when needed).
  Map them to 24h times: morning 08:30, afternoon 13:30, night 20:30, bedtime 22:00. OD = 08:30 unless it says night.
- AC means before food, PC means after food.
- "days" lists weekday numbers (0 = Sunday ... 6 = Saturday) when it is NOT taken every day, e.g. "once a week on Sunday" -> [0]. Leave it empty for daily medicines.
- "as_needed" is true for SOS / PRN / "when required" medicines.
- "category" is what the medicine is for, picked from: ${CATEGORIES.map((c) => `${c.key} (${c.label})`).join(', ')}.
- "purpose" is a short plain-English phrase an elderly person understands, like "for blood pressure" or "for sugar". Leave it empty if unsure.
- If the colour of the pill is not visible, use "white".
- Never invent medicines. If something is unreadable, describe it in "unclear".`;

export async function scanPrescription(dataUrl) {
  const match = String(dataUrl || '').match(/^data:(image\/[a-z+.-]+);base64,(.+)$/i);
  if (!match) throw new Error('Please choose a photo (JPG or PNG).');
  const result = await askGemini([
    { inlineData: { mimeType: match[1], data: match[2] } },
    { text: SCAN_PROMPT },
  ]);
  const medicines = Array.isArray(result.medicines) ? result.medicines : [];
  return {
    medicines: medicines.filter((m) => m && m.name).map((m) => ({
      name: String(m.name).trim(),
      strength: String(m.strength || '').trim(),
      form: ['tablet', 'capsule', 'syrup', 'injection', 'drops', 'inhaler'].includes(m.form) ? m.form : 'tablet',
      amount: Number(m.amount) > 0 ? Number(m.amount) : 1,
      times: Array.isArray(m.times) && m.times.length ? m.times.filter((t) => /^\d{2}:\d{2}$/.test(t)) : ['08:30'],
      days: Array.isArray(m.days) ? m.days.map(Number).filter((d) => d >= 0 && d <= 6) : [],
      category: CATEGORY_KEYS.includes(m.category) ? m.category : guessCategory(m.name, m.purpose),
      as_needed: !!m.as_needed,
      food: ['before', 'after', 'with', 'empty', 'any'].includes(m.food) ? m.food : 'any',
      purpose: String(m.purpose || '').trim(),
      pill_color: m.pill_color || 'white',
      duration_days: Number(m.duration_days) > 0 ? Number(m.duration_days) : null,
      notes: String(m.notes || '').trim(),
    })),
    doctor: String(result.doctor || ''),
    unclear: String(result.unclear || ''),
  };
}

// Understands what an elder said, in any language, and maps it to one of a few actions.
export async function voiceIntent(text, languageName) {
  const prompt = `An elderly person said this to their medicine app, in ${languageName}: "${String(text).slice(0, 300)}"
What do they want? Answer with JSON only: {"intent":"taken|check|help|snooze|read|okay|other"}
taken = they say they took / ate their medicine. check = they ask whether they took it. help = they need help or feel in danger.
snooze = remind me later. read = tell me my day / my medicines. okay = they say they are fine. other = anything else.`;
  const result = await askGemini([{ text: prompt }], ['gemini-flash-lite-latest', 'gemini-3.5-flash']);
  const allowed = ['taken', 'check', 'help', 'snooze', 'read', 'okay', 'other'];
  return allowed.includes(result.intent) ? result.intent : 'other';
}

export async function checkClashes(meds, allergies) {
  const list = meds.map((m) => `- ${m.name} ${m.strength || ''} (${m.times.length} times a day)`).join('\n');
  const prompt = `An elderly person takes these medicines:
${list}
Known allergies: ${allergies || 'none recorded'}.
Point out well-known possible problems: two medicines that may interact, the same ingredient twice,
or a medicine that conflicts with an allergy. Only mention widely documented concerns. Do not give dosing advice.
Write each one as a gentle question the family can ask the doctor.
Return JSON only: {"items":[{"medicines":["A","B"],"concern":"one short sentence in plain words","question":"Doctor, ...?","level":"check|important"}]}
Return {"items":[]} if there is nothing notable.`;
  const result = await askGemini([{ text: prompt }]);
  return Array.isArray(result.items) ? result.items.slice(0, 6) : [];
}

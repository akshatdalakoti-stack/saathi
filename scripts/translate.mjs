// Translates the elder screen's English text into every language in shared/languages.js,
// using Gemini, and saves one JSON file per language in client/src/locales.
// Run: node scripts/translate.mjs            (only missing languages)
//      node scripts/translate.mjs ta hi      (redo just these)
import fs from 'node:fs';
import path from 'node:path';
import { LANGUAGES } from '../shared/languages.js';

const KEY = process.env.GEMINI_API_KEY;
if (!KEY) { console.error('Set GEMINI_API_KEY first.'); process.exit(1); }

const dir = path.join(process.cwd(), 'client', 'src', 'locales');
const english = JSON.parse(fs.readFileSync(path.join(dir, 'en.json'), 'utf8'));
const MODELS = ['gemini-3.5-flash', 'gemini-flash-lite-latest'];

function placeholders(text) {
  return (String(text).match(/\{[a-z]+\}/g) || []).sort().join(',');
}

// "source" holds only the English keys this language still needs.
async function translate(lang, source) {
  const english = source;
  const prompt = `Translate the JSON values below from English into ${lang.english} (${lang.native}).
These words appear on a medicine app for ELDERLY people in ${lang.code === 'en' ? 'India' : 'their home country'}, many with little schooling.
Rules:
- Use the simplest everyday spoken words a grandparent uses at home, not formal or medical words.
  For example in Hindi "sugar" stays "शुगर" and "BP" stays "बीपी", because that is what people say.
- Keep it short, polite and warm. Use the respectful form of "you".
- Keep every {placeholder} exactly as it is, e.g. {name}, {time}, {n}.
- Keep the same JSON keys. Return JSON only.
${JSON.stringify(english, null, 1)}`;
  let lastError;
  for (const model of MODELS) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': KEY },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.2 } }),
        signal: AbortSignal.timeout(150000),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || res.status);
      const text = (data.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
      const out = JSON.parse(text);
      // Fill anything missing or broken with English, so the screen never shows a raw key.
      const fixed = {};
      let repaired = 0;
      for (const key of Object.keys(english)) {
        const value = out[key];
        if (typeof value !== 'string' || placeholders(value) !== placeholders(english[key])) { fixed[key] = english[key]; repaired++; } else fixed[key] = value;
      }
      return { fixed, repaired, model };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

// Which English keys does each language still need? (Named languages are redone completely.)
const only = process.argv.slice(2);
function existing(code) {
  const file = path.join(dir, `${code}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
}
const todo = [];
for (const lang of LANGUAGES) {
  if (lang.code === 'en') continue;
  const have = only.includes(lang.code) ? {} : existing(lang.code);
  const missing = {};
  for (const key of Object.keys(english)) if (!(key in have)) missing[key] = english[key];
  if (Object.keys(missing).length) todo.push({ lang, have, missing });
}
console.log('Translating:', todo.map((x) => `${x.lang.code}(${Object.keys(x.missing).length})`).join(' ') || '(nothing to do)');

// A few at a time, to stay within the free tier's rate limits.
for (let i = 0; i < todo.length; i += 7) {
  await Promise.all(todo.slice(i, i + 7).map(async ({ lang, have, missing }) => {
    const started = Date.now();
    try {
      const { fixed: added, repaired, model } = await translate(lang, missing);
      // Keep the key order the same as en.json.
      const fixed = {};
      for (const key of Object.keys(english)) fixed[key] = key in added ? added[key] : have[key];
      fs.writeFileSync(path.join(dir, `${lang.code}.json`), JSON.stringify(fixed, null, 2) + '\n');
      console.log(`${lang.code} done in ${Math.round((Date.now() - started) / 1000)}s with ${model}${repaired ? ` (${repaired} kept in English)` : ''}`);
    } catch (err) {
      console.log(`${lang.code} FAILED: ${err.message}`);
    }
  }));
}

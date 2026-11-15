// Words on the elder's screen, in 20 languages. English is built in; the others load when chosen.
// The translations live in ./locales/*.json (made by scripts/translate.mjs and reviewed by people).
import { useEffect, useMemo, useState } from 'react';
import en from './locales/en.json';
import { languageOf } from '../../shared/languages.js';

const loaders = import.meta.glob('./locales/*.json', { import: 'default' });
const loaded = { en };

export async function loadLanguage(code) {
  if (loaded[code]) return loaded[code];
  const loader = loaders[`./locales/${code}.json`];
  if (!loader) return en;
  loaded[code] = await loader();
  return loaded[code];
}

export function makeT(dict) {
  return function t(key, vars) {
    let text = dict[key] ?? en[key] ?? key;
    if (vars) for (const name of Object.keys(vars)) text = text.split(`{${name}}`).join(String(vars[name]));
    return text;
  };
}

// Loads a script font (Tamil, Bengali, Urdu...) only when that language is picked.
function loadFont(family) {
  if (!family) return;
  const id = `font-${family.replace(/\s+/g, '-')}`;
  if (document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${family.replace(/\s+/g, '+')}:wght@400;600;700&display=swap`;
  document.head.appendChild(link);
}

// React hook: gives back t() for the chosen language, plus details like right-to-left.
export function useLocale(code) {
  const [dict, setDict] = useState(loaded[code] || en);
  const lang = languageOf(code);
  useEffect(() => {
    let alive = true;
    loadFont(lang.font);
    loadLanguage(code).then((d) => { if (alive) setDict(d); });
    return () => { alive = false; };
  }, [code, lang.font]);
  const t = useMemo(() => makeT(dict), [dict]);
  // Baloo 2 covers English and Devanagari; the script's own Baloo (or Noto) fills in the rest.
  const extra = lang.font && lang.font !== 'Baloo 2' ? `"${lang.font}", ` : '';
  const fontFamily = `"Baloo 2", ${extra}"Atkinson Hyperlegible Next", system-ui, sans-serif`;
  return { t, lang, fontFamily, dir: lang.rtl ? 'rtl' : 'ltr' };
}

// "13:30" or a timestamp -> "1:30 pm" written the local way.
export function timeIn(value, code) {
  let date;
  if (typeof value === 'string') {
    const [h, m] = value.split(':').map(Number);
    date = new Date();
    date.setHours(h, m, 0, 0);
  } else {
    date = new Date(value);
  }
  return date.toLocaleTimeString(languageOf(code).speech, { hour: 'numeric', minute: '2-digit' });
}

export function dateIn(ms, code, options) {
  return new Date(ms).toLocaleDateString(languageOf(code).speech, options);
}

// "after lunch" etc. from the slot's anchor + relation.
export function slotLabel(slot, t) {
  if (!slot.anchor) return t(`part_${slot.part}`);
  if (slot.anchor === 'wake') return t('at_wake');
  if (slot.anchor === 'bed') return t('at_bed');
  if (slot.anchor === 'tea') return t('with_tea');
  return t(`${slot.rel}_${slot.anchor}`);
}

// Pictures for daily routines, so the time makes sense without reading.
export const ROUTINE_EMOJI = { wake: '🌅', breakfast: '🍳', lunch: '🍛', tea: '☕', dinner: '🍲', bed: '🛏️' };
export const PART_EMOJI = { morning: '🌅', afternoon: '☀️', evening: '🌇', night: '🌙' };
export const FOOD_EMOJI = { before: '⏳🍽️', after: '🍽️✅', with: '🍽️', empty: '🚫🍽️', any: '' };

export function slotEmoji(slot) {
  return slot.anchor ? ROUTINE_EMOJI[slot.anchor] : PART_EMOJI[slot.part];
}

export function unitWord(amount, form, t) {
  const n = Number(amount || 1);
  if (form === 'tablet') return t(n > 1 ? 'unit_tablets' : 'unit_tablet');
  if (form === 'capsule') return t(n > 1 ? 'unit_capsules' : 'unit_capsule');
  if (form === 'syrup') return t('unit_spoon');
  if (form === 'drops') return t('unit_drop');
  if (form === 'inhaler') return t('unit_puff');
  if (form === 'injection') return t('unit_injection');
  return '';
}

export function amountLabel(amount, form, t) {
  const n = Number(amount || 1);
  return `${n === 0.5 ? '½' : n} ${unitWord(n, form, t)}`;
}

// What Saathi says out loud for one dose: "Sugar medicine: 1 white tablet". No hard medicine names.
export function doseSpoken(d, t) {
  const n = Number(d.amount || 1);
  const sentence = t('dose_spoken', {
    category: t(`cat_${d.category || 'other'}`),
    amount: n === 0.5 ? '½' : n,
    color: d.form === 'tablet' || d.form === 'capsule' ? t(`color_${d.pill_color}`) : '',
    unit: unitWord(n, d.form, t),
  });
  const food = t(`food_${d.food}`);
  return food ? `${sentence}, ${food}` : sentence;
}

export const SYMPTOMS = ['dizziness', 'pain', 'tiredness', 'breathlessness', 'stomach upset', 'poor sleep', 'feeling low', 'fever'];
export const SYMPTOM_EMOJI = {
  dizziness: '😵‍💫', pain: '🤕', tiredness: '😩', breathlessness: '😮‍💨', 'stomach upset': '🤢', 'poor sleep': '😴', 'feeling low': '😔', fever: '🤒',
};

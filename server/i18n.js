// The server uses the same translation files as the app, so the elder's own
// emails (and the one-tap pages) are in the elder's language.
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.join(process.cwd(), 'client', 'src', 'locales');
const cache = {};

function load(code) {
  if (cache[code]) return cache[code];
  try {
    cache[code] = JSON.parse(fs.readFileSync(path.join(DIR, `${code}.json`), 'utf8'));
  } catch {
    cache[code] = {};
  }
  return cache[code];
}

export function serverT(code = 'en') {
  const english = load('en');
  const dict = load(code);
  return function t(key, vars) {
    let text = dict[key] ?? english[key] ?? key;
    if (vars) for (const name of Object.keys(vars)) text = text.split(`{${name}}`).join(String(vars[name]));
    return text;
  };
}

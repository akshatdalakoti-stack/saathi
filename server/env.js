// Loads settings from a .env file (if there is one) and sets safe defaults.
// This file is imported FIRST so every other file sees the same settings.
import fs from 'node:fs';
import path from 'node:path';

const envFile = path.join(process.cwd(), '.env');
if (fs.existsSync(envFile)) {
  const lines = fs.readFileSync(envFile, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2];
    const quoted = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
    if (quoted) value = value.slice(1, -1);
    // Real environment variables (like the ones Render sets) always win.
    if (process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
}

// All times in the app are Indian Standard Time unless told otherwise.
if (!process.env.TZ) process.env.TZ = 'Asia/Kolkata';

// In development (npm run dev) the API always uses 3000; Vite serves the web app on 5173.
const DEV = process.argv.includes('--dev');
export const PORT = DEV ? 3000 : Number(process.env.PORT || 3000);
export const IS_PROD = process.env.NODE_ENV === 'production';
export const DEMO_MODE = process.env.DEMO_MODE !== 'false';

// The public address of the app, used for links inside emails.
export function baseUrl() {
  const url = process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  return url.replace(/\/$/, '');
}

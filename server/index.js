// Saathi server: serves the API, the email action pages, and the built React app.
import './env.js';
import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import { PORT, DEMO_MODE, baseUrl } from './env.js';
import { one } from './db.js';
import { api } from './routes.js';
import { pages } from './pages.js';
import { startEngine } from './engine.js';
import { seedDemo, DEMO_CARE_ID } from './seed.js';
import { mailMode } from './mailer.js';
import { geminiReady } from './gemini.js';

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

// Security headers on every response. The CSP allows only this site, Google Fonts,
// data: images (QR codes) and blob: audio (spoken reminders).
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com",
  "frame-src 'self'",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()');
  next();
});
app.use(express.json({ limit: '8mb' }));
app.use(express.urlencoded({ extended: false }));

app.use('/api', api);
app.use(pages);

// Serve the built React app (npm run build puts it in /dist).
const distDir = path.join(process.cwd(), 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir, { index: false, maxAge: '1h' }));
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    res.sendFile(path.join(distDir, 'index.html'));
  });
} else {
  app.get('/', (req, res) => res.send('Saathi API is running. Start the web app with "npm run dev" and open http://localhost:5173'));
}

// On a fresh database (e.g. every new deploy on Render's free plan) create the demo family.
if (DEMO_MODE && !one('SELECT id FROM profiles WHERE care_id = ?', DEMO_CARE_ID)) {
  seedDemo();
}

app.listen(PORT, () => {
  console.log(`Saathi running on port ${PORT} (${baseUrl()})`);
  console.log(`  email: ${mailMode()}   AI helper: ${geminiReady() ? 'on' : 'off'}   demo: ${DEMO_MODE ? 'on' : 'off'}`);
  startEngine();
});

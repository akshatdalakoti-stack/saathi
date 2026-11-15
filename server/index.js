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

// The JSON API, mounted at /api. Each area of the app has its own route module
// in ./routes/, so every file stays small and focused.
import express from 'express';
import authRoutes from './routes/auth.js';
import demoRoutes from './routes/demo.js';
import elderRoutes from './routes/elder.js';
import careRoutes from './routes/care.js';
import medicinesRoutes from './routes/medicines.js';
import healthRoutes from './routes/health.js';
import visitsRoutes from './routes/visits.js';
import settingsRoutes from './routes/settings.js';

export const api = express.Router();

api.use(authRoutes, demoRoutes, elderRoutes, careRoutes, medicinesRoutes, healthRoutes, visitsRoutes, settingsRoutes);

// ================================================================ errors

api.use((req, res) => res.status(404).json({ error: 'Not found.' }));

// eslint-disable-next-line no-unused-vars
api.use((err, req, res, next) => {
  const status = err.status || 400;
  if (!err.status) console.error('[api]', req.method, req.path, err.message);
  res.status(status).json({ error: err.message || 'Something went wrong.' });
});

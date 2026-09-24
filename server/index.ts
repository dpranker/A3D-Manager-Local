import 'dotenv/config';
import express from 'express';
import path from 'path';
import { mkdir } from 'fs/promises';

import syncRouter from './routes/sync.js';
import labelsRouter from './routes/labels.js';
import cartridgesRouter from './routes/cartridges.js';
import sdCardRouter from './routes/sd-card.js';
import localDataRouter from './routes/local-data.js';
import firmwareRouter from './routes/firmware.js';
import libraryRouter from './routes/library.js';
import { removeLeftoverPartials } from './lib/safe-write.js';
import { sdCardPathGuard, webOriginGuard } from './lib/request-guards.js';
import screenshotsRouter from './routes/screenshots.js';

export const app = express();
const PORT = process.env.PORT || 3001;

// Middleware. Browser/Docker mode: only the app's own pages may call the API (the
// desktop app checks this itself before requests get here)
if (!process.env.A3D_EMBEDDED) {
  app.use('/api', webOriginGuard);
}
app.use(express.json());
// Any sdCardPath given to the API must be an Analogue 3D card
app.use('/api', sdCardPathGuard);

// Ensure local directory structure exists
export async function ensureLocalDirs() {
  const localPath = path.join(process.cwd(), '.local', 'Library', 'N64');
  await mkdir(path.join(localPath, 'Games'), { recursive: true });
  await mkdir(path.join(localPath, 'Images'), { recursive: true });
  // Leftovers from writes interrupted by a crash; the files they were replacing are intact
  const removed = await removeLeftoverPartials(path.join(process.cwd(), '.local'));
  if (removed.length) console.log(`Removed ${removed.length} unfinished .partial file(s) from interrupted writes`);
}

// Routes
app.use('/api/sync', syncRouter);
app.use('/api/labels', labelsRouter);
app.use('/api/cartridges', cartridgesRouter);
app.use('/api/sd-card', sdCardRouter);
app.use('/api/local-data', localDataRouter);
app.use('/api/firmware', firmwareRouter);
app.use('/api/library', libraryRouter);
app.use('/api/screenshots', screenshotsRouter);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(process.cwd(), 'dist');
  app.use(express.static(distPath));

  // SPA fallback - serve index.html for all non-API routes
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// Start server
async function start() {
  await ensureLocalDirs();

  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    if (process.env.READ_LABELS_FROM_SD === 'true') {
      console.log('📀 SD Card label reading enabled (READ_LABELS_FROM_SD=true)');
    }
  });
}

// The Electron shell (electron/) imports this module and listens itself
if (!process.env.A3D_EMBEDDED) {
  start().catch(console.error);
}

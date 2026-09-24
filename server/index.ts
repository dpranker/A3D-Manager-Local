/**
 * The API, run inside the Electron main process by electron/embedded-server.ts
 * (which also serves the client and checks that requests come from the app's window).
 */
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
import { sdCardPathGuard } from './lib/request-guards.js';
import screenshotsRouter from './routes/screenshots.js';

export const app = express();

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

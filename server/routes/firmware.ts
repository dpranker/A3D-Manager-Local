import { Router, type Response } from 'express';
import {
  compareVersions,
  downloadFirmware,
  fetchFirmwareFeed,
  getSDFirmwareStatus,
  installFirmwareToSD,
  type FirmwarePhase,
} from '../lib/firmware.js';
import { formatBytes, formatSpeed, formatTime, type FileProgress } from '../lib/file-transfer.js';
import { isValidAnalogueDir } from '../lib/sd-card.js';

const router = Router();

// Only one download/copy at a time: two writers on the same card would clash
let installInProgress = false;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// GET /api/firmware/status?sdCardPath=...&refresh=1
// Latest 3Dos release (from Analogue's feed, cached for an hour) plus what's on the card.
// Either half can fail independently (offline, no card) and is reported as null + error.
router.get('/status', async (req, res) => {
  const sdCardPath = typeof req.query.sdCardPath === 'string' ? req.query.sdCardPath : '';
  const refresh = req.query.refresh === '1';

  const [feedResult, sdResult] = await Promise.allSettled([
    fetchFirmwareFeed({ force: refresh }),
    (async () => {
      if (!sdCardPath) return null;
      if (!(await isValidAnalogueDir(sdCardPath))) throw new Error('Not an Analogue 3D SD card');
      return getSDFirmwareStatus(sdCardPath);
    })(),
  ]);

  const feed = feedResult.status === 'fulfilled' ? feedResult.value : null;
  const sdCard = sdResult.status === 'fulfilled' ? sdResult.value : null;
  const latest = feed?.releases[0] ?? null;
  // Compare against the pending file if one is waiting, so a copied update doesn't still read as "available"
  const onCard = sdCard ? (sdCard.pendingVersion ?? sdCard.installedVersion) : null;

  res.json({
    latest,
    // Every release newer than what's on the card, for a combined "what's new" list
    newerReleases: feed && onCard ? feed.releases.filter((r) => compareVersions(r.version, onCard) > 0) : [],
    checkedAt: feed?.checkedAt ?? null,
    feedError: feedResult.status === 'rejected' ? errorMessage(feedResult.reason) : null,
    sdCard,
    sdCardError: sdResult.status === 'rejected' ? errorMessage(sdResult.reason) : null,
    updateAvailable: Boolean(latest && onCard && compareVersions(latest.version, onCard) > 0),
  });
});

function progressEvent(phase: FirmwarePhase, progress: FileProgress): object {
  return {
    type: 'progress',
    phase,
    percentage: Math.round(progress.percentage),
    bytesWrittenFormatted: formatBytes(progress.bytesWritten),
    totalBytesFormatted: formatBytes(progress.totalBytes),
    speed: formatSpeed(progress.bytesPerSecond),
    eta: formatTime(progress.estimatedTimeRemainingMs),
  };
}

// GET /api/firmware/install-stream?sdCardPath=... (SSE)
// Downloads the latest release (reusing a cached copy) and writes it to the card root.
router.get('/install-stream', async (req, res: Response) => {
  const sdCardPath = typeof req.query.sdCardPath === 'string' ? req.query.sdCardPath : '';
  if (!sdCardPath || !(await isValidAnalogueDir(sdCardPath))) {
    res.status(400).json({ error: 'Invalid Analogue 3D SD card' });
    return;
  }
  if (installInProgress) {
    res.status(409).json({ error: 'A firmware update is already being copied' });
    return;
  }
  installInProgress = true;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    // Always re-check right before downloading
    const release = (await fetchFirmwareFeed({ force: true })).releases[0];
    send({ type: 'start', version: release.version });

    const localPath = await downloadFirmware(release, (p) => send(progressEvent('download', p)));
    const result = await installFirmwareToSD(localPath, release.version, sdCardPath, (p) => send(progressEvent('copy', p)));
    console.log(`Copied 3Dos ${release.version} to ${sdCardPath}`);

    send({ type: 'complete', version: release.version, ...result });
  } catch (error) {
    console.error('Firmware install failed:', error);
    send({ type: 'error', error: errorMessage(error) });
  } finally {
    installInProgress = false;
    res.end();
  }
});

export default router;

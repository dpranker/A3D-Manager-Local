import { readdir, stat, access, constants } from 'fs/promises';
import { statSync } from 'fs';
import os from 'os';
import path from 'path';
import { copyFileAtomic, withFileLock } from './safe-write.js';
import {
  type ProgressCallback,
  type BatchProgressCallback,
  type FileProgress,
  type BatchProgress,
} from './file-transfer.js';
import { parseLabelsDb, getLocalLabelsDbPath, hasLocalLabelsDb } from './labels-db-core.js';

// Re-export progress types for convenience
export type { ProgressCallback, BatchProgressCallback, FileProgress, BatchProgress };

export interface SDCardInfo {
  name: string;
  path: string;
  gamesPath: string;
  libraryDbPath: string;
  labelsDbPath: string;
}

/**
 * Where to look for cards: the folder chosen in the app (SD_VOLUMES_PATH), then the
 * platform's removable-media locations. Evaluated on every detection, since the
 * Linux mount folders are created on the first mount after boot (/run is tmpfs).
 * Windows has no defaults: the card is chosen in the app.
 */
export function getSearchRoots(): string[] {
  const chosen = process.env.SD_VOLUMES_PATH;
  return [...new Set([...(chosen ? [chosen] : []), ...defaultSearchRoots()])];
}

export function defaultSearchRoots(platform: NodeJS.Platform = process.platform): string[] {
  switch (platform) {
    case 'darwin':
      return ['/Volumes'];
    case 'linux': {
      const user = currentUser();
      return [
        // udisks2: Fedora, Arch, openSUSE, SteamOS (/run/media/<user>); Debian, Ubuntu, Mint, Raspberry Pi OS (/media/<user>)
        ...(user ? [`/run/media/${user}`, `/media/${user}`] : []),
        // Mounts not under a user folder: older SteamOS (/run/media/mmcblk0p1), usbmount and manual mounts (/media/<label>)
        '/run/media',
        '/media',
        // ChromeOS Linux (Crostini), once the card is shared with Linux
        '/mnt/chromeos/removable',
      ];
    }
    default:
      return [];
  }
}

function currentUser(): string | undefined {
  try {
    return os.userInfo().username;
  } catch {
    // No passwd entry for the uid (some containers and sandboxes)
    return process.env.USER || undefined;
  }
}

/**
 * Check if a path is an Analogue 3D SD card root
 */
async function isAnalogue3DRoot(volumePath: string): Promise<SDCardInfo | null> {
  const libraryPath = path.join(volumePath, 'Library', 'N64');
  const libraryDbPath = path.join(libraryPath, 'library.db');

  try {
    await access(libraryDbPath, constants.R_OK);
    const volumeStat = await stat(volumePath);
    if (volumeStat.isDirectory()) {
      return {
        name: path.basename(volumePath) || volumePath,
        path: volumePath,
        gamesPath: path.join(libraryPath, 'Games'),
        libraryDbPath,
        labelsDbPath: path.join(libraryPath, 'Images', 'labels.db'),
      };
    }
  } catch {
    // Not an Analogue 3D SD card
  }
  return null;
}

/** Cards at root itself, or one level below it (e.g. /Volumes/ANALOGUE 3D under /Volumes) */
async function findCardsIn(root: string): Promise<SDCardInfo[]> {
  const directCard = await isAnalogue3DRoot(root);
  if (directCard) return [directCard];

  let volumes: string[];
  try {
    volumes = await readdir(root);
  } catch {
    return []; // Missing, unmounted or not readable (e.g. a user folder that doesn't exist yet)
  }
  const cards = await Promise.all(volumes.map((volume) => isAnalogue3DRoot(path.join(root, volume))));
  return cards.filter((card): card is SDCardInfo => card !== null);
}

let detecting: Promise<SDCardInfo[]> | null = null;

/**
 * Detect Analogue 3D SD cards in every location from getSearchRoots(). Each can be:
 * - The SD card itself (e.g., /Volumes/ANALOGUE 3D or E:\ as chosen on Windows)
 * - A parent directory containing SD cards (e.g., /Volumes)
 * Locations are probed in parallel, so one slow mount doesn't hold up the rest. Calls
 * made while a detection runs share it: a stale network mount can take many seconds
 * to fail, and the window polls every few seconds.
 */
export function detectSDCards(): Promise<SDCardInfo[]> {
  detecting ??= (async () => {
    const found = (await Promise.all(getSearchRoots().map(findCardsIn))).flat();
    const seen = new Set<string>();
    return found.filter((card) => !seen.has(card.path) && seen.add(card.path));
  })().finally(() => {
    detecting = null;
  });
  return detecting;
}

/**
 * Check if a path is a valid Analogue 3D data directory
 */
export async function isValidAnalogueDir(dirPath: string): Promise<boolean> {
  const libraryDbPath = path.join(dirPath, 'Library', 'N64', 'library.db');
  try {
    await access(libraryDbPath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

// =============================================================================
// Progress-Enabled File Operations
// =============================================================================

/**
 * Export labels.db result
 */
export interface ExportLabelsResult {
  entryCount: number;
  fileSize: number;
}

/**
 * Export local labels.db to SD card with progress tracking
 *
 * @param sdLabelsPath - Full path to labels.db on SD card (e.g., /Volumes/SD/Library/N64/Images/labels.db)
 * @param onProgress - Callback for progress updates
 * @returns Entry count and file size
 */
export async function exportLabelsToSDWithProgress(
  sdLabelsPath: string,
  onProgress: ProgressCallback
): Promise<ExportLabelsResult> {
  // Check if local labels.db exists
  const hasLocal = await hasLocalLabelsDb();
  if (!hasLocal) {
    throw new Error('No local labels.db found. Import labels first.');
  }

  const localPath = getLocalLabelsDbPath();
  const stats = statSync(localPath);

  // Get entry count before copying
  const { readFile } = await import('fs/promises');
  const data = await readFile(localPath);
  const db = parseLabelsDb(data);

  // Copy with progress - use 50ms throttle for smoother updates. Atomic, so a pulled
  // card keeps its old labels.db, and the replaced one is kept as labels.db.bak.
  // The lock keeps label edits from changing the local file mid-copy.
  await withFileLock(localPath, () =>
    copyFileAtomic(localPath, sdLabelsPath, { onProgress, throttleMs: 50, keepBackup: true }),
  );

  return {
    entryCount: db.entryCount,
    fileSize: stats.size,
  };
}

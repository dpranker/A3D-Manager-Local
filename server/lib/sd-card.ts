import { readdir, stat, access, constants } from 'fs/promises';
import { statSync } from 'fs';
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
 * Get the path where the Analogue 3D SD card is mounted
 * Defaults to /Volumes/ANALOGUE 3D (standard macOS mount), can be overridden via SD_VOLUMES_PATH env var
 */
export function getVolumesPath(): string {
  return process.env.SD_VOLUMES_PATH || '/Volumes/ANALOGUE 3D';
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
        name: path.basename(volumePath),
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

/**
 * Detect Analogue 3D SD cards by scanning volumes path for the expected structure
 * Supports both:
 * - Direct SD card path (e.g., /Volumes/ANALOGUE 3D)
 * - Parent directory containing SD cards (e.g., /Volumes)
 */
export async function detectSDCards(): Promise<SDCardInfo[]> {
  const volumesPath = getVolumesPath();
  const sdCards: SDCardInfo[] = [];

  try {
    // First, check if volumesPath itself is an Analogue 3D SD card
    const directCard = await isAnalogue3DRoot(volumesPath);
    if (directCard) {
      sdCards.push(directCard);
      return sdCards;
    }

    // Otherwise, scan volumesPath as a parent directory containing volumes
    const volumes = await readdir(volumesPath);

    for (const volume of volumes) {
      const volumePath = path.join(volumesPath, volume);
      const card = await isAnalogue3DRoot(volumePath);
      if (card) {
        sdCards.push(card);
      }
    }
  } catch (error) {
    console.error('Error scanning volumes:', error);
  }

  return sdCards;
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

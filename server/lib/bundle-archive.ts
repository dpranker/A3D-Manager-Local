/**
 * Bundle Archive Library
 *
 * Handles creation and parsing of .a3d bundle archives.
 * These are ZIP files containing:
 * - manifest.json (metadata about contents)
 * - labels.db (the label database)
 * - settings/<cartId>/settings.json (per-game settings)
 * - game-paks/<cartId>/controller_pak.img (per-game save data)
 * - owned-carts.json (ownership list)
 */

import archiver from 'archiver';
import AdmZip from 'adm-zip';
import { existsSync } from 'fs';
import { readFile, readdir, mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { Writable } from 'stream';
import { getLabelsDbImage, updateLabelImage, addCartridge, getAllEntries, createEmptyLabelsDb } from './labels-db-core.js';
import { findGameFolder, ensureLocalGameFolder, normalizeSettings, serializeSettings, isLegacySettings } from './cartridge-settings.js';
import {
  getAllBackupsForExport,
  importBackups,
  type GamePakBackupsMetadata,
} from './game-pak.js';

// Paths
const LOCAL_DIR = path.join(process.cwd(), '.local');
const LABELS_DB_PATH = path.join(LOCAL_DIR, 'labels.db');
const OWNED_CARTS_PATH = path.join(LOCAL_DIR, 'owned-carts.json');
const LOCAL_GAMES_DIR = path.join(LOCAL_DIR, 'Library', 'N64', 'Games');

export interface BundleManifest {
  version: 1;
  createdAt: string;
  appVersion: string;
  contents: {
    hasLabelsDb: boolean;
    hasOwnedCarts: boolean;
    settingsCount: number;
    gamePaksCount: number;
    gamePakBackupsCount: number;
    labelsCount?: number; // Individual label images (for selection exports)
    cartIds: string[];
  };
}

export interface BundleContents {
  manifest: BundleManifest;
  labelsDb?: Buffer;
  labels: Map<string, Buffer>; // Individual label images (cartId -> PNG buffer)
  ownedCarts?: {
    version: number;
    cartridges: Array<{ cartId: string; addedAt: string; source: string }>;
  };
  settings: Map<string, object>;
  gamePaks: Map<string, Buffer>;
  gamePakBackups: Map<string, { metadata: GamePakBackupsMetadata; files: Map<string, Buffer> }>;
}

export type MergeStrategy = 'skip' | 'overwrite' | 'keep-both';

export interface ImportOptions {
  importLabels: boolean;
  importOwnership: boolean;
  importSettings: boolean;
  importGamePaks: boolean;
  importGamePakBackups: boolean;
  mergeStrategy: MergeStrategy;
}

export interface ImportResult {
  success: boolean;
  labelsImported: boolean;
  individualLabelsImported: { added: number; updated: number; skipped: number };
  ownershipMerged: { added: number; skipped: number };
  /** legacy: pre-3Dos 1.5.1 settings in the bundle, which are never imported */
  settingsImported: { added: number; skipped: number; overwritten: number; legacy: number };
  gamePaksImported: { added: number; skipped: number; overwritten: number };
  gamePakBackupsImported: { added: number; skipped: number; merged: number };
  errors: string[];
}

/**
 * Create a bundle archive containing selected data
 */
export async function createBundle(options: {
  includeLabels?: boolean;
  includeOwnership?: boolean;
  includeSettings?: boolean;
  includeGamePaks?: boolean;
  includeGamePakBackups?: boolean;
  cartIds?: string[]; // If provided, only include these carts' settings/paks
}): Promise<Buffer> {
  const {
    includeLabels = true,
    includeOwnership = true,
    includeSettings = true,
    includeGamePaks = true,
    includeGamePakBackups = true,
    cartIds: rawCartIds,
  } = options;

  // Normalize cartIds to lowercase for consistent comparison
  const cartIds = rawCartIds?.map(id => id.toLowerCase());

  // Collect data
  const settingsMap = new Map<string, Buffer>();
  const gamePaksMap = new Map<string, Buffer>();
  const labelsMap = new Map<string, Buffer>(); // Individual label images
  const allCartIds = new Set<string>();

  // Collect settings and game paks from game folders
  if ((includeSettings || includeGamePaks) && existsSync(LOCAL_GAMES_DIR)) {
    const gameFolders = await readdir(LOCAL_GAMES_DIR);

    for (const folder of gameFolders) {
      // Extract cart ID from folder name (e.g., "Mario Kart 64 03cc04ee" -> "03cc04ee")
      const match = folder.match(/([0-9a-fA-F]{8})$/);
      if (!match) continue;

      const cartId = match[1].toLowerCase();
      if (cartIds && !cartIds.includes(cartId)) continue;

      const folderPath = path.join(LOCAL_GAMES_DIR, folder);

      // Collect settings
      if (includeSettings) {
        const settingsPath = path.join(folderPath, 'settings.json');
        if (existsSync(settingsPath)) {
          settingsMap.set(cartId, await readFile(settingsPath));
          allCartIds.add(cartId);
        }
      }

      // Collect game paks
      if (includeGamePaks) {
        const pakPath = path.join(folderPath, 'controller_pak.img');
        if (existsSync(pakPath)) {
          gamePaksMap.set(cartId, await readFile(pakPath));
          allCartIds.add(cartId);
        }
      }
    }
  }

  // Collect individual labels (for selection exports) or full labels.db
  const isSelectionExport = cartIds && cartIds.length > 0;
  let hasLabelsDb = false;

  if (includeLabels) {
    if (isSelectionExport) {
      // For selection exports, collect individual label images
      for (const cartId of cartIds) {
        try {
          const labelImage = await getLabelsDbImage(cartId);
          if (labelImage) {
            labelsMap.set(cartId.toLowerCase(), labelImage);
            allCartIds.add(cartId.toLowerCase());
          }
        } catch {
          // Label not found, skip
        }
      }
    } else {
      // For full exports, include the entire labels.db
      hasLabelsDb = existsSync(LABELS_DB_PATH);
    }
  }

  // Collect ownership data (filtered for selection exports)
  let ownedCartsData: Buffer | null = null;
  if (includeOwnership && existsSync(OWNED_CARTS_PATH)) {
    const rawData = await readFile(OWNED_CARTS_PATH, 'utf8');
    const ownedCarts = JSON.parse(rawData);

    if (isSelectionExport && cartIds) {
      // Filter to only include selected cart IDs
      const cartIdSet = new Set(cartIds);
      const filteredCarts = {
        ...ownedCarts,
        cartridges: ownedCarts.cartridges.filter((c: { cartId: string }) =>
          cartIdSet.has(c.cartId.toLowerCase())
        ),
      };
      if (filteredCarts.cartridges.length > 0) {
        ownedCartsData = Buffer.from(JSON.stringify(filteredCarts, null, 2));
      }
    } else {
      // Full export - include all
      ownedCartsData = Buffer.from(rawData);
    }
  }
  const hasOwnedCarts = ownedCartsData !== null;

  // Collect game pak backups
  let gamePakBackupsMap = new Map<string, { metadata: GamePakBackupsMetadata; files: Map<string, Buffer> }>();
  let totalBackupsCount = 0;
  if (includeGamePakBackups) {
    gamePakBackupsMap = await getAllBackupsForExport(cartIds);
    for (const [cartId, data] of gamePakBackupsMap) {
      totalBackupsCount += data.metadata.backups.length;
      allCartIds.add(cartId);
    }
  }

  // Create manifest
  const manifest: BundleManifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    appVersion: '1.0.0',
    contents: {
      hasLabelsDb,
      hasOwnedCarts,
      settingsCount: settingsMap.size,
      gamePaksCount: gamePaksMap.size,
      gamePakBackupsCount: totalBackupsCount,
      labelsCount: labelsMap.size,
      cartIds: Array.from(allCartIds).sort(),
    },
  };

  // Create ZIP archive
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const writable = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk);
        callback();
      },
    });

    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.on('error', reject);
    archive.on('end', () => {
      resolve(Buffer.concat(chunks));
    });

    archive.pipe(writable);

    // Add manifest
    archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });

    // Add labels.db (full export)
    if (hasLabelsDb) {
      archive.file(LABELS_DB_PATH, { name: 'labels.db' });
    }

    // Add individual label images (selection export)
    for (const [cartId, buffer] of labelsMap) {
      archive.append(buffer, { name: `labels/${cartId}.png` });
    }

    // Add owned-carts.json
    if (hasOwnedCarts && ownedCartsData) {
      archive.append(ownedCartsData, { name: 'owned-carts.json' });
    }

    // Add settings
    for (const [cartId, buffer] of settingsMap) {
      archive.append(buffer, { name: `settings/${cartId}/settings.json` });
    }

    // Add game paks
    for (const [cartId, buffer] of gamePaksMap) {
      archive.append(buffer, { name: `game-paks/${cartId}/controller_pak.img` });
    }

    // Add game pak backups
    for (const [cartId, data] of gamePakBackupsMap) {
      // Add metadata
      archive.append(JSON.stringify(data.metadata, null, 2), {
        name: `game-pak-backups/${cartId}/metadata.json`,
      });
      // Add backup files
      for (const [backupId, buffer] of data.files) {
        archive.append(buffer, { name: `game-pak-backups/${cartId}/${backupId}.img` });
      }
    }

    archive.finalize();
  });
}

/**
 * Parse a bundle archive and return its contents
 */
export async function parseBundle(buffer: Buffer): Promise<BundleContents> {
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();

  let manifest: BundleManifest | null = null;
  let labelsDb: Buffer | undefined;
  let ownedCarts: BundleContents['ownedCarts'] | undefined;
  const labels = new Map<string, Buffer>();
  const settings = new Map<string, object>();
  const gamePaks = new Map<string, Buffer>();
  const gamePakBackups = new Map<string, { metadata: GamePakBackupsMetadata; files: Map<string, Buffer> }>();

  // First pass: collect all entries
  const backupMetadatas = new Map<string, GamePakBackupsMetadata>();
  const backupFiles = new Map<string, Map<string, Buffer>>();

  for (const entry of entries) {
    const name = entry.entryName;

    if (name === 'manifest.json') {
      const content = entry.getData().toString('utf8');
      manifest = JSON.parse(content) as BundleManifest;
    } else if (name === 'labels.db') {
      labelsDb = entry.getData();
    } else if (name.startsWith('labels/') && name.endsWith('.png')) {
      // Individual label image: labels/<cartId>.png
      const cartId = name.slice(7, -4); // Remove 'labels/' and '.png'
      labels.set(cartId.toLowerCase(), entry.getData());
    } else if (name === 'owned-carts.json') {
      const content = entry.getData().toString('utf8');
      ownedCarts = JSON.parse(content);
    } else if (name.startsWith('settings/') && name.endsWith('/settings.json')) {
      const cartId = name.split('/')[1];
      const content = entry.getData().toString('utf8');
      settings.set(cartId, JSON.parse(content));
    } else if (name.startsWith('game-paks/') && name.endsWith('/controller_pak.img')) {
      const cartId = name.split('/')[1];
      gamePaks.set(cartId, entry.getData());
    } else if (name.startsWith('game-pak-backups/') && name.endsWith('/metadata.json')) {
      // game-pak-backups/<cartId>/metadata.json
      const cartId = name.split('/')[1].toLowerCase();
      const content = entry.getData().toString('utf8');
      backupMetadatas.set(cartId, JSON.parse(content) as GamePakBackupsMetadata);
    } else if (name.startsWith('game-pak-backups/') && name.endsWith('.img')) {
      // game-pak-backups/<cartId>/<backupId>.img
      const parts = name.split('/');
      const cartId = parts[1].toLowerCase();
      const backupId = parts[2].slice(0, -4); // Remove '.img'
      if (!backupFiles.has(cartId)) {
        backupFiles.set(cartId, new Map());
      }
      backupFiles.get(cartId)!.set(backupId, entry.getData());
    }
  }

  // Combine backup metadata and files
  for (const [cartId, metadata] of backupMetadatas) {
    const files = backupFiles.get(cartId) || new Map();
    gamePakBackups.set(cartId, { metadata, files });
  }

  if (!manifest) {
    throw new Error('Invalid bundle: missing manifest.json');
  }

  return {
    manifest,
    labelsDb,
    labels,
    ownedCarts,
    settings,
    gamePaks,
    gamePakBackups,
  };
}

/**
 * Get information about a bundle without fully extracting it
 */
export async function getBundleInfo(buffer: Buffer): Promise<BundleManifest> {
  const zip = new AdmZip(buffer);
  const manifestEntry = zip.getEntry('manifest.json');

  if (!manifestEntry) {
    throw new Error('Invalid bundle: missing manifest.json');
  }

  const content = manifestEntry.getData().toString('utf8');
  return JSON.parse(content) as BundleManifest;
}

/**
 * Import a bundle with specified options
 */
export async function importBundle(
  buffer: Buffer,
  options: ImportOptions
): Promise<ImportResult> {
  const result: ImportResult = {
    success: false,
    labelsImported: false,
    individualLabelsImported: { added: 0, updated: 0, skipped: 0 },
    ownershipMerged: { added: 0, skipped: 0 },
    settingsImported: { added: 0, skipped: 0, overwritten: 0, legacy: 0 },
    gamePaksImported: { added: 0, skipped: 0, overwritten: 0 },
    gamePakBackupsImported: { added: 0, skipped: 0, merged: 0 },
    errors: [],
  };

  try {
    const bundle = await parseBundle(buffer);

    // Ensure local directory exists
    await mkdir(LOCAL_DIR, { recursive: true });

    // Import labels.db (full database)
    if (options.importLabels && bundle.labelsDb) {
      const existingLabels = existsSync(LABELS_DB_PATH);

      if (!existingLabels || options.mergeStrategy === 'overwrite') {
        await writeFile(LABELS_DB_PATH, bundle.labelsDb);
        result.labelsImported = true;
      } else if (options.mergeStrategy === 'skip') {
        // Skip - labels already exist
      } else {
        // keep-both - for labels.db, we'll just overwrite since merging is complex
        await writeFile(LABELS_DB_PATH, bundle.labelsDb);
        result.labelsImported = true;
      }
    }

    // Import individual label images
    if (options.importLabels && bundle.labels.size > 0) {
      // Create empty labels.db if it doesn't exist
      if (!existsSync(LABELS_DB_PATH)) {
        const emptyDb = createEmptyLabelsDb();
        await writeFile(LABELS_DB_PATH, emptyDb);
      }

      // Get existing cart IDs to check if we're adding or updating
      const existingEntries = await getAllEntries(LABELS_DB_PATH);
      const existingIds = new Set(existingEntries.map(e => e.cartId));

      for (const [cartIdHex, pngBuffer] of bundle.labels) {
        const cartId = parseInt(cartIdHex, 16);
        const exists = existingIds.has(cartId);

        try {
          if (!exists) {
            await addCartridge(LABELS_DB_PATH, cartId, pngBuffer);
            result.individualLabelsImported.added++;
          } else if (options.mergeStrategy === 'overwrite') {
            await updateLabelImage(LABELS_DB_PATH, cartId, pngBuffer);
            result.individualLabelsImported.updated++;
          } else {
            result.individualLabelsImported.skipped++;
          }
        } catch (err) {
          result.errors.push(`Failed to import label for ${cartIdHex}: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
      }
    }

    // Import ownership
    if (options.importOwnership && bundle.ownedCarts) {
      let existingOwned: { version: number; cartridges: Array<{ cartId: string; addedAt: string; source: string }> } = {
        version: 1,
        cartridges: [],
      };

      if (existsSync(OWNED_CARTS_PATH)) {
        const content = await readFile(OWNED_CARTS_PATH, 'utf8');
        existingOwned = JSON.parse(content);
      }

      const existingIds = new Set(existingOwned.cartridges.map(c => c.cartId.toLowerCase()));

      for (const cart of bundle.ownedCarts.cartridges) {
        const normalizedId = cart.cartId.toLowerCase();
        if (existingIds.has(normalizedId)) {
          result.ownershipMerged.skipped++;
        } else {
          existingOwned.cartridges.push({
            ...cart,
            cartId: normalizedId,
          });
          existingIds.add(normalizedId);
          result.ownershipMerged.added++;
        }
      }

      await writeFile(OWNED_CARTS_PATH, JSON.stringify(existingOwned, null, 2));
    }

    // Import settings
    if (options.importSettings && bundle.settings.size > 0) {
      await mkdir(LOCAL_GAMES_DIR, { recursive: true });

      for (const [cartId, settingsObj] of bundle.settings) {
        // Bundles made before 3Dos 1.5.1 carry the old format, which the console no longer uses
        if (isLegacySettings(settingsObj)) {
          result.settingsImported.legacy++;
          continue;
        }
        const { settings, errors } = normalizeSettings(settingsObj);
        if (!settings) {
          result.errors.push(`Settings for ${cartId} skipped: ${errors[0]}`);
          continue;
        }

        const gameFolder = await ensureLocalGameFolder(cartId);
        const settingsPath = path.join(gameFolder, 'settings.json');
        const exists = existsSync(settingsPath);

        if (!exists) {
          await writeFile(settingsPath, serializeSettings(settings));
          result.settingsImported.added++;
        } else if (options.mergeStrategy === 'overwrite') {
          await writeFile(settingsPath, serializeSettings(settings));
          result.settingsImported.overwritten++;
        } else if (options.mergeStrategy === 'skip') {
          result.settingsImported.skipped++;
        } else {
          // keep-both - not really applicable for settings, treat as skip
          result.settingsImported.skipped++;
        }
      }
    }

    // Import game paks
    if (options.importGamePaks && bundle.gamePaks.size > 0) {
      await mkdir(LOCAL_GAMES_DIR, { recursive: true });

      for (const [cartId, pakBuffer] of bundle.gamePaks) {
        // Find existing game folder or create new one
        let gameFolder = await findGameFolder(LOCAL_GAMES_DIR, cartId);
        if (!gameFolder) {
          // Create new folder for unknown cartridge
          gameFolder = path.join(LOCAL_GAMES_DIR, `Unknown Cartridge ${cartId}`);
          await mkdir(gameFolder, { recursive: true });
        }

        const pakPath = path.join(gameFolder, 'controller_pak.img');
        const exists = existsSync(pakPath);

        if (!exists) {
          await writeFile(pakPath, pakBuffer);
          result.gamePaksImported.added++;
        } else if (options.mergeStrategy === 'overwrite') {
          await writeFile(pakPath, pakBuffer);
          result.gamePaksImported.overwritten++;
        } else if (options.mergeStrategy === 'skip') {
          result.gamePaksImported.skipped++;
        } else {
          // keep-both - not really applicable for game paks, treat as skip
          result.gamePaksImported.skipped++;
        }
      }
    }

    // Import game pak backups
    if (options.importGamePakBackups && bundle.gamePakBackups.size > 0) {
      for (const [cartId, data] of bundle.gamePakBackups) {
        try {
          const backupResult = await importBackups(
            cartId,
            data.metadata,
            data.files,
            options.mergeStrategy === 'skip' ? 'skip' : 'merge'
          );
          result.gamePakBackupsImported.added += backupResult.added;
          result.gamePakBackupsImported.skipped += backupResult.skipped;
          result.gamePakBackupsImported.merged += backupResult.merged;
        } catch (err) {
          result.errors.push(`Failed to import backups for ${cartId}: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
      }
    }

    result.success = true;
  } catch (err) {
    result.errors.push(err instanceof Error ? err.message : 'Unknown error');
  }

  return result;
}

/**
 * Create a bundle for specific cartridges (for selection export)
 */
export async function createSelectionBundle(cartIds: string[]): Promise<Buffer> {
  return createBundle({
    includeLabels: false, // Don't include full labels.db for selection
    includeOwnership: false,
    includeSettings: true,
    includeGamePaks: true,
    cartIds: cartIds.map(id => id.toLowerCase()),
  });
}

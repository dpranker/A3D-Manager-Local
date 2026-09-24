import { readFile, stat, unlink, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { createHash, randomUUID } from 'crypto';
import { findGameFolder, ensureLocalGameFolder, ensureSdGameFolder, getLocalGamesDir } from './cartridge-settings.js';
import { copyFileAtomic, updateJsonFile, writeFileAtomic } from './safe-write.js';

// =============================================================================
// Constants
// =============================================================================

/**
 * N64 Controller Pak size: 256Kbit = 32KB = 32,768 bytes
 * This is the standard size for all controller pak images.
 */
export const CONTROLLER_PAK_SIZE = 32768;

/**
 * Controller Pak structure:
 * - 123 pages of 256 bytes each
 * - First pages contain index/allocation tables
 * - Remaining pages store actual save data
 */
export const CONTROLLER_PAK_PAGE_SIZE = 256;
export const CONTROLLER_PAK_PAGE_COUNT = 123;

export const GAME_PAK_FILENAME = 'controller_pak.img';

/**
 * Directory for game pak backups (separate from the active game paks)
 */
export const GAME_PAK_BACKUPS_DIR = path.join(process.cwd(), '.local', 'Library', 'N64', 'GamePakBackups');

// =============================================================================
// Types
// =============================================================================

export interface GamePakSaveDetails {
  pagesUsed: number;
  pagesFree: number;
  percentUsed: number;
}

export interface GamePakInfo {
  exists: boolean;
  source: 'local' | 'sd';
  path: string;
  size?: number;
  lastModified?: string;
  isValidSize?: boolean;
  saveInfo?: GamePakSaveDetails;
  md5Hash?: string;
}

export interface GamePakSyncStatus {
  localHash: string | null;
  sdHash: string | null;
  inSync: boolean;
  hasConflict: boolean;
}

export interface GamePakBackup {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  md5Hash: string;
  size: number;
}

export interface GamePakBackupsMetadata {
  version: 1;
  cartId: string;
  backups: GamePakBackup[];
}

// =============================================================================
// Path Helpers
// =============================================================================

/**
 * Get the game pak path for a cart ID in local storage
 */
export async function getLocalGamePakPath(cartId: string): Promise<string | null> {
  const localGamesDir = getLocalGamesDir();
  const gameFolder = await findGameFolder(localGamesDir, cartId);
  if (!gameFolder) {
    return null;
  }
  return path.join(gameFolder, GAME_PAK_FILENAME);
}

/**
 * Get the game pak path for a cart ID on SD card
 */
export async function getSDGamePakPath(sdCardPath: string, cartId: string): Promise<string | null> {
  const gamesDir = path.join(sdCardPath, 'Library', 'N64', 'Games');
  const gameFolder = await findGameFolder(gamesDir, cartId);
  if (!gameFolder) {
    return null;
  }
  return path.join(gameFolder, GAME_PAK_FILENAME);
}

// =============================================================================
// Validation
// =============================================================================

/**
 * Validate a game pak buffer
 */
export function validateGamePak(buffer: Buffer): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (buffer.length !== CONTROLLER_PAK_SIZE) {
    errors.push(
      `Invalid size: ${buffer.length} bytes (expected ${CONTROLLER_PAK_SIZE} bytes)`
    );
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a game pak file
 */
export async function validateGamePakFile(filePath: string): Promise<{ valid: boolean; errors: string[] }> {
  if (!existsSync(filePath)) {
    return { valid: false, errors: ['File does not exist'] };
  }

  try {
    const stats = await stat(filePath);
    if (stats.size !== CONTROLLER_PAK_SIZE) {
      return {
        valid: false,
        errors: [`Invalid size: ${stats.size} bytes (expected ${CONTROLLER_PAK_SIZE} bytes)`],
      };
    }
    return { valid: true, errors: [] };
  } catch (error) {
    return {
      valid: false,
      errors: [error instanceof Error ? error.message : 'Unknown error'],
    };
  }
}

// =============================================================================
// Hash & Sync
// =============================================================================

/**
 * Compute MD5 hash of a game pak buffer
 */
export function computeGamePakHash(buffer: Buffer): string {
  return createHash('md5').update(buffer).digest('hex');
}

/**
 * Get sync status between local and SD card game paks
 */
export async function getGamePakSyncStatus(
  cartId: string,
  sdCardPath?: string
): Promise<GamePakSyncStatus> {
  let localHash: string | null = null;
  let sdHash: string | null = null;

  // Get local hash
  const localPath = await getLocalGamePakPath(cartId);
  if (localPath && existsSync(localPath)) {
    try {
      const buffer = await readFile(localPath);
      if (buffer.length === CONTROLLER_PAK_SIZE) {
        localHash = computeGamePakHash(buffer);
      }
    } catch {
      // Ignore errors, hash stays null
    }
  }

  // Get SD hash if path provided
  if (sdCardPath) {
    const sdPath = await getSDGamePakPath(sdCardPath, cartId);
    if (sdPath && existsSync(sdPath)) {
      try {
        const buffer = await readFile(sdPath);
        if (buffer.length === CONTROLLER_PAK_SIZE) {
          sdHash = computeGamePakHash(buffer);
        }
      } catch {
        // Ignore errors, hash stays null
      }
    }
  }

  // Determine sync status
  const bothExist = localHash !== null && sdHash !== null;
  const inSync = !bothExist || localHash === sdHash;
  const hasConflict = bothExist && localHash !== sdHash;

  return { localHash, sdHash, inSync, hasConflict };
}

// =============================================================================
// Read Operations
// =============================================================================

export interface GamePakInfoOptions {
  sdCardPath?: string;
  includeHash?: boolean;
}

export interface GamePakInfoResult {
  local: GamePakInfo;
  sd: GamePakInfo | null;
  syncStatus?: GamePakSyncStatus;
}

/**
 * Get game pak info for a cartridge (checks both local and SD)
 */
export async function getGamePakInfo(
  cartId: string,
  options: GamePakInfoOptions | string = {}
): Promise<GamePakInfoResult> {
  // Support legacy signature where second arg was just sdCardPath string
  const opts: GamePakInfoOptions = typeof options === 'string' ? { sdCardPath: options } : options;
  const { sdCardPath, includeHash = false } = opts;

  // Check local
  const localPath = await getLocalGamePakPath(cartId);
  const localInfo: GamePakInfo = {
    exists: false,
    source: 'local',
    path: localPath || '',
  };

  let localBuffer: Buffer | null = null;
  if (localPath && existsSync(localPath)) {
    try {
      const stats = await stat(localPath);
      localInfo.exists = true;
      localInfo.size = stats.size;
      localInfo.lastModified = stats.mtime.toISOString();
      localInfo.isValidSize = stats.size === CONTROLLER_PAK_SIZE;

      // Include save info if valid size
      if (stats.size === CONTROLLER_PAK_SIZE) {
        localBuffer = await readFile(localPath);
        localInfo.saveInfo = getGamePakSaveInfo(localBuffer);
        if (includeHash) {
          localInfo.md5Hash = computeGamePakHash(localBuffer);
        }
      }
    } catch (error) {
      console.error('Error reading local game pak:', error);
    }
  }

  // Check SD card if path provided
  let sdInfo: GamePakInfo | null = null;
  let sdBuffer: Buffer | null = null;
  if (sdCardPath) {
    const sdPath = await getSDGamePakPath(sdCardPath, cartId);
    sdInfo = {
      exists: false,
      source: 'sd',
      path: sdPath || '',
    };

    if (sdPath && existsSync(sdPath)) {
      try {
        const stats = await stat(sdPath);
        sdInfo.exists = true;
        sdInfo.size = stats.size;
        sdInfo.lastModified = stats.mtime.toISOString();
        sdInfo.isValidSize = stats.size === CONTROLLER_PAK_SIZE;

        // Include save info if valid size
        if (stats.size === CONTROLLER_PAK_SIZE) {
          sdBuffer = await readFile(sdPath);
          sdInfo.saveInfo = getGamePakSaveInfo(sdBuffer);
          if (includeHash) {
            sdInfo.md5Hash = computeGamePakHash(sdBuffer);
          }
        }
      } catch (error) {
        console.error('Error reading SD game pak:', error);
      }
    }
  }

  // Build result with optional sync status
  const result: GamePakInfoResult = { local: localInfo, sd: sdInfo };

  if (includeHash) {
    // Compute sync status from already-loaded hashes
    const localHash = localInfo.md5Hash || null;
    const sdHash = sdInfo?.md5Hash || null;
    const bothExist = localHash !== null && sdHash !== null;
    result.syncStatus = {
      localHash,
      sdHash,
      inSync: !bothExist || localHash === sdHash,
      hasConflict: bothExist && localHash !== sdHash,
    };
  }

  return result;
}

/**
 * Read a game pak file
 */
export async function readGamePak(filePath: string): Promise<Buffer> {
  return readFile(filePath);
}

/**
 * Read local game pak for a cartridge
 */
export async function readLocalGamePak(cartId: string): Promise<Buffer | null> {
  const localPath = await getLocalGamePakPath(cartId);

  if (!localPath || !existsSync(localPath)) {
    return null;
  }

  return readFile(localPath);
}

// =============================================================================
// Write Operations
// =============================================================================

/**
 * Save a game pak to local storage
 */
export async function saveLocalGamePak(
  cartId: string,
  buffer: Buffer,
  title: string = 'Unknown Cartridge'
): Promise<string> {
  // Validate the buffer
  const validation = validateGamePak(buffer);
  if (!validation.valid) {
    throw new Error(`Invalid game pak: ${validation.errors.join(', ')}`);
  }

  const folderPath = await ensureLocalGameFolder(cartId, title);
  const gamePakPath = path.join(folderPath, GAME_PAK_FILENAME);

  // The save being replaced is kept as controller_pak.img.bak
  await writeFileAtomic(gamePakPath, buffer, { keepBackup: true });

  return gamePakPath;
}

/**
 * Copy game pak from SD card to local storage
 */
export async function downloadGamePakFromSD(
  cartId: string,
  sdCardPath: string,
  title: string = 'Unknown Cartridge'
): Promise<{ success: boolean; path?: string; error?: string }> {
  const sdGamePakPath = await getSDGamePakPath(sdCardPath, cartId);

  if (!sdGamePakPath || !existsSync(sdGamePakPath)) {
    return { success: false, error: 'Game pak not found on SD card' };
  }

  // Validate the SD card file
  const validation = await validateGamePakFile(sdGamePakPath);
  if (!validation.valid) {
    return { success: false, error: `Invalid game pak: ${validation.errors.join(', ')}` };
  }

  try {
    const folderPath = await ensureLocalGameFolder(cartId, title);
    const localPath = path.join(folderPath, GAME_PAK_FILENAME);

    await copyFileAtomic(sdGamePakPath, localPath, { keepBackup: true });

    return { success: true, path: localPath };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Delete local game pak for a cartridge
 */
export async function deleteLocalGamePak(cartId: string): Promise<boolean> {
  const localPath = await getLocalGamePakPath(cartId);

  if (!localPath || !existsSync(localPath)) {
    return false;
  }

  await unlink(localPath);
  return true;
}

/**
 * Upload local game pak to SD card
 */
export async function uploadGamePakToSD(
  cartId: string,
  sdCardPath: string,
): Promise<{ success: boolean; path?: string; error?: string }> {
  // Get local game pak
  const localPath = await getLocalGamePakPath(cartId);

  if (!localPath || !existsSync(localPath)) {
    return { success: false, error: 'No local game pak found' };
  }

  // Validate the local file
  const validation = await validateGamePakFile(localPath);
  if (!validation.valid) {
    return { success: false, error: `Invalid game pak: ${validation.errors.join(', ')}` };
  }

  try {
    // Named from the cart database like other uploads, not from the display title
    const sdGameFolder = await ensureSdGameFolder(sdCardPath, cartId);
    const sdGamePakPath = path.join(sdGameFolder, GAME_PAK_FILENAME);
    // Atomic only: nothing extra is left in the console's game folder
    await copyFileAtomic(localPath, sdGamePakPath);
    return { success: true, path: sdGamePakPath };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Create an empty (formatted) controller pak
 * This creates a properly formatted empty controller pak with valid header structure
 */
export function createEmptyGamePak(): Buffer {
  const buffer = Buffer.alloc(CONTROLLER_PAK_SIZE, 0x00);

  // The controller pak has a specific header structure
  // First 32 bytes are the label area (usually 0x81 for empty)
  for (let i = 0; i < 32; i++) {
    buffer[i] = 0x81;
  }

  // ID area at offset 0x20-0x3F (repeated at 0x60, 0x80, 0xC0)
  // These contain checksum and format info
  const idAreas = [0x20, 0x60, 0x80, 0xC0];
  for (const offset of idAreas) {
    buffer[offset] = 0xFF;
    buffer[offset + 1] = 0xFF;
    buffer[offset + 2] = 0xFF;
    buffer[offset + 3] = 0xFF;
  }

  // Index table starts at 0x100 (256)
  // Each index entry is 2 bytes
  // First 5 pages (0-4) are reserved for system
  // Mark them as system pages (0x0001)
  for (let i = 0; i < 5; i++) {
    const offset = 0x100 + i * 2;
    buffer[offset] = 0x00;
    buffer[offset + 1] = 0x01;
  }

  // Mark remaining pages as free (0x0003)
  for (let i = 5; i < 128; i++) {
    const offset = 0x100 + i * 2;
    buffer[offset] = 0x00;
    buffer[offset + 1] = 0x03;
  }

  return buffer;
}

/**
 * Check if a game pak is empty (no save data)
 */
export function isGamePakEmpty(buffer: Buffer): boolean {
  if (buffer.length !== CONTROLLER_PAK_SIZE) {
    return false;
  }

  // Check the index table to see if any pages are in use (not 0x0003 = free)
  // Pages 0-4 are system pages, so we check from page 5 onwards
  for (let i = 5; i < 128; i++) {
    const offset = 0x100 + i * 2;
    const status = buffer.readUInt16BE(offset);

    // 0x0003 means free, anything else means in use
    if (status !== 0x0003) {
      return false;
    }
  }

  return true;
}

/**
 * Get information about save data in a game pak
 */
export function getGamePakSaveInfo(buffer: Buffer): {
  pagesUsed: number;
  pagesFree: number;
  percentUsed: number;
} {
  if (buffer.length !== CONTROLLER_PAK_SIZE) {
    return { pagesUsed: 0, pagesFree: 0, percentUsed: 0 };
  }

  let pagesUsed = 0;
  let pagesFree = 0;

  // Check pages 5-127 (0-4 are system pages)
  for (let i = 5; i < 128; i++) {
    const offset = 0x100 + i * 2;
    const status = buffer.readUInt16BE(offset);

    if (status === 0x0003) {
      pagesFree++;
    } else {
      pagesUsed++;
    }
  }

  const totalUserPages = 123; // 128 - 5 system pages
  const percentUsed = Math.round((pagesUsed / totalUserPages) * 100);

  return { pagesUsed, pagesFree, percentUsed };
}

// =============================================================================
// Backup Operations
// =============================================================================

const BACKUPS_METADATA_FILENAME = 'metadata.json';

/**
 * Get the backups directory for a cartridge
 */
export function getBackupsDir(cartId: string): string {
  return path.join(GAME_PAK_BACKUPS_DIR, cartId.toLowerCase());
}

/**
 * Get the metadata file path for a cartridge's backups
 */
function getBackupsMetadataPath(cartId: string): string {
  return path.join(getBackupsDir(cartId), BACKUPS_METADATA_FILENAME);
}

/**
 * Read backups metadata for a cartridge
 */
export async function getBackupsMetadata(cartId: string): Promise<GamePakBackupsMetadata | null> {
  const metadataPath = getBackupsMetadataPath(cartId);

  if (!existsSync(metadataPath)) {
    return null;
  }

  try {
    const content = await readFile(metadataPath, 'utf-8');
    return JSON.parse(content) as GamePakBackupsMetadata;
  } catch {
    return null;
  }
}

const isBackupsMetadata = (value: unknown): value is GamePakBackupsMetadata =>
  !!value && typeof value === 'object' && Array.isArray((value as GamePakBackupsMetadata).backups);

/**
 * Change a cartridge's backups metadata: one change at a time, written atomically.
 * An unreadable metadata file is kept as metadata.json.corrupt-<time> and the change fails.
 */
async function mutateBackupsMetadata<R>(
  cartId: string,
  change: (metadata: GamePakBackupsMetadata) => R | Promise<R>,
): Promise<R> {
  await mkdir(getBackupsDir(cartId), { recursive: true });
  return updateJsonFile(
    getBackupsMetadataPath(cartId),
    (): GamePakBackupsMetadata => ({ version: 1, cartId: cartId.toLowerCase(), backups: [] }),
    change,
    isBackupsMetadata,
  );
}

/**
 * List all backups for a cartridge
 */
export async function listBackups(cartId: string): Promise<GamePakBackup[]> {
  const metadata = await getBackupsMetadata(cartId);
  return metadata?.backups || [];
}

/**
 * Create a backup of the current local game pak
 */
export async function createBackup(
  cartId: string,
  name?: string,
  description?: string
): Promise<GamePakBackup> {
  // Read the local game pak
  const localBuffer = await readLocalGamePak(cartId);
  if (!localBuffer) {
    throw new Error('No local game pak to backup');
  }

  // Validate the buffer
  const validation = validateGamePak(localBuffer);
  if (!validation.valid) {
    throw new Error(`Invalid game pak: ${validation.errors.join(', ')}`);
  }

  // Generate backup ID and hash
  const id = randomUUID();
  const md5Hash = computeGamePakHash(localBuffer);
  const createdAt = new Date().toISOString();

  // Create backup entry
  const backup: GamePakBackup = {
    id,
    name: name || `Backup ${createdAt.split('T')[0]}`,
    description,
    createdAt,
    md5Hash,
    size: localBuffer.length,
  };

  // Ensure backups directory exists
  const backupsDir = getBackupsDir(cartId);
  await mkdir(backupsDir, { recursive: true });

  // Write backup file
  const backupPath = path.join(backupsDir, `${id}.img`);
  await writeFileAtomic(backupPath, localBuffer);

  // Update metadata
  await mutateBackupsMetadata(cartId, (metadata) => {
    metadata.backups.push(backup);
  });

  return backup;
}

/**
 * Get the buffer for a specific backup
 */
export async function getBackupBuffer(cartId: string, backupId: string): Promise<Buffer | null> {
  const backupsDir = getBackupsDir(cartId);
  const backupPath = path.join(backupsDir, `${backupId}.img`);

  if (!existsSync(backupPath)) {
    return null;
  }

  return readFile(backupPath);
}

/**
 * Update a backup's name or description
 */
export async function updateBackup(
  cartId: string,
  backupId: string,
  updates: { name?: string; description?: string }
): Promise<GamePakBackup | null> {
  if (!(await getBackupsMetadata(cartId))) {
    return null;
  }

  return mutateBackupsMetadata(cartId, (metadata) => {
    const backup = metadata.backups.find(b => b.id === backupId);
    if (!backup) return null;

    if (updates.name !== undefined) {
      backup.name = updates.name;
    }
    if (updates.description !== undefined) {
      backup.description = updates.description;
    }
    return backup;
  });
}

/**
 * Delete a backup
 */
export async function deleteBackup(cartId: string, backupId: string): Promise<boolean> {
  if (!(await getBackupsMetadata(cartId))) {
    return false;
  }

  // Remove from metadata
  const removed = await mutateBackupsMetadata(cartId, (metadata) => {
    const backupIndex = metadata.backups.findIndex(b => b.id === backupId);
    if (backupIndex === -1) return false;
    metadata.backups.splice(backupIndex, 1);
    return true;
  });
  if (!removed) {
    return false;
  }

  // Delete the backup file
  const backupsDir = getBackupsDir(cartId);
  const backupPath = path.join(backupsDir, `${backupId}.img`);
  if (existsSync(backupPath)) {
    await unlink(backupPath);
  }

  return true;
}

/**
 * Restore a backup to local storage (and optionally SD card)
 */
export async function restoreBackup(
  cartId: string,
  backupId: string,
  title: string = 'Unknown Cartridge',
  sdCardPath?: string
): Promise<{ local: boolean; sd: boolean }> {
  const backupBuffer = await getBackupBuffer(cartId, backupId);
  if (!backupBuffer) {
    throw new Error('Backup not found');
  }

  // Validate the backup
  const validation = validateGamePak(backupBuffer);
  if (!validation.valid) {
    throw new Error(`Invalid backup: ${validation.errors.join(', ')}`);
  }

  // Restore to local
  await saveLocalGamePak(cartId, backupBuffer, title);
  const result = { local: true, sd: false };

  // Optionally restore to SD card
  if (sdCardPath) {
    const sdResult = await uploadGamePakToSD(cartId, sdCardPath);
    result.sd = sdResult.success;
  }

  return result;
}

/**
 * Get all backups for export (used by bundle system)
 */
export async function getAllBackupsForExport(
  cartIds?: string[]
): Promise<Map<string, { metadata: GamePakBackupsMetadata; files: Map<string, Buffer> }>> {
  const result = new Map<string, { metadata: GamePakBackupsMetadata; files: Map<string, Buffer> }>();

  if (!existsSync(GAME_PAK_BACKUPS_DIR)) {
    return result;
  }

  const { readdir } = await import('fs/promises');
  const dirs = await readdir(GAME_PAK_BACKUPS_DIR);

  for (const dir of dirs) {
    // Filter by cartIds if provided
    if (cartIds && !cartIds.includes(dir.toLowerCase())) {
      continue;
    }

    const metadata = await getBackupsMetadata(dir);
    if (!metadata || metadata.backups.length === 0) {
      continue;
    }

    const files = new Map<string, Buffer>();
    for (const backup of metadata.backups) {
      const buffer = await getBackupBuffer(dir, backup.id);
      if (buffer) {
        files.set(backup.id, buffer);
      }
    }

    if (files.size > 0) {
      result.set(dir.toLowerCase(), { metadata, files });
    }
  }

  return result;
}

/**
 * Import backups (used by bundle system)
 */
export async function importBackups(
  cartId: string,
  importMetadata: GamePakBackupsMetadata,
  files: Map<string, Buffer>,
  mergeStrategy: 'skip' | 'merge' = 'merge'
): Promise<{ added: number; skipped: number; merged: number }> {
  const result = { added: 0, skipped: 0, merged: 0 };

  await mutateBackupsMetadata(cartId, async (existingMetadata) => {
    // Build a set of existing hashes for deduplication
    const existingHashes = new Set(existingMetadata.backups.map(b => b.md5Hash));

    // Process each backup from import
    for (const backup of importMetadata.backups) {
      const buffer = files.get(backup.id);
      if (!buffer) {
        result.skipped++;
        continue;
      }

      // Check for duplicate by hash
      if (existingHashes.has(backup.md5Hash)) {
        if (mergeStrategy === 'skip') {
          result.skipped++;
          continue;
        }
        // For merge, we still skip if hash matches (no point in duplicate data)
        result.merged++;
        continue;
      }

      // Validate the buffer
      const validation = validateGamePak(buffer);
      if (!validation.valid) {
        result.skipped++;
        continue;
      }

      // Generate new ID to avoid conflicts
      const newId = randomUUID();
      const newBackup: GamePakBackup = {
        ...backup,
        id: newId,
      };

      // Write backup file
      await writeFileAtomic(path.join(getBackupsDir(cartId), `${newId}.img`), buffer);

      // Add to metadata
      existingMetadata.backups.push(newBackup);
      existingHashes.add(backup.md5Hash);
      result.added++;
    }
  });

  return result;
}

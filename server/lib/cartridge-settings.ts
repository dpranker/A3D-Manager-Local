/**
 * Per-game settings.json (3Dos 1.5.1+ format).
 *
 * 3Dos 1.5.1 rewrote settings.json in the format documented at
 * https://www.analogue.co/developer/docs/platform/settings-json (schema:
 * https://schemas.analogue.co/platform/3d/settings.json, copy in
 * docs/analogue-schemas/3d-settings.json): a $schema key, snake_case keys,
 * lowercase values, no title. The update also reset hardware settings, so
 * files in the older camelCase format (written by 1.5.0 and earlier, and by
 * earlier versions of this app) are stale: they're detected and reported as
 * "legacy", never converted or written to a card.
 *
 * Files are written in the same shape and key order as the console writes
 * them. That includes enable_edge_overshoot in the pvm/crt/scanlines modes,
 * which the published schema doesn't list (additionalProperties: false) but
 * which every file written by 3Dos 1.5.1 contains.
 */
import {
  SETTINGS_SCHEMA_URL,
  DISPLAY_MODE_VALUES,
  BEAM_CONVERGENCE_VALUES,
  EDGE_HARDNESS_VALUES,
  IMAGE_FIT_VALUES,
  IMAGE_SIZE_VALUES,
  INTERPOLATION_VALUES,
  GAMMA_TRANSFER_VALUES,
  SHARPNESS_VALUES,
  CARTRIDGE_COLOR_VALUES,
  OVERCLOCK_VALUES,
  REGION_VALUES,
  type CRTModeSettings,
  type CartridgeSettings,
} from '../../shared/settings.js';
export * from '../../shared/settings.js';
import { readFile, mkdir, stat, readdir } from 'fs/promises';
import { writeFileAtomic } from './safe-write.js';
import { existsSync } from 'fs';
import path from 'path';
import { lookupGameName } from './game-lookup.js';
import { compareVersions, getSDFirmwareStatus } from './firmware.js';

/** First firmware that reads (and writes) this settings.json format */
export const SETTINGS_FORMAT_MIN_FIRMWARE = '1.5.1';

/** current: 3Dos 1.5.1+ format; legacy: camelCase format from 1.5.0 and earlier */
export type SettingsFormat = 'current' | 'legacy';

export interface SettingsInfo {
  exists: boolean;
  source: 'local' | 'sd';
  path: string;
  lastModified?: string;
  /** Only set for valid current-format files */
  settings?: CartridgeSettings;
  format?: SettingsFormat;
  /** Why the file couldn't be used (legacy format, invalid JSON, unsupported values) */
  error?: string;
}

export class LegacySettingsError extends Error {
  constructor() {
    super('These settings are in the format used before 3Dos 1.5.1, which the console no longer uses');
    this.name = 'LegacySettingsError';
  }
}

// =============================================================================
// Constants
// =============================================================================

const LOCAL_DIR = path.join(process.cwd(), '.local');
const LOCAL_GAMES_DIR = path.join(LOCAL_DIR, 'Library', 'N64', 'Games');

// =============================================================================
// Path Helpers
// =============================================================================

/**
 * Get the local games directory path
 */
export function getLocalGamesDir(): string {
  return LOCAL_GAMES_DIR;
}

/**
 * Find a game folder by cart ID in a directory
 * Game folders are named like "Game Title hexid"
 */
export async function findGameFolder(gamesDir: string, cartId: string): Promise<string | null> {
  const normalizedId = cartId.toLowerCase();

  if (!existsSync(gamesDir)) {
    return null;
  }

  const { readdir } = await import('fs/promises');
  const folders = await readdir(gamesDir);

  for (const folder of folders) {
    // Extract the hex ID from the end of the folder name
    const match = folder.match(/([0-9a-fA-F]{8})$/);
    if (match && match[1].toLowerCase() === normalizedId) {
      return path.join(gamesDir, folder);
    }
  }

  return null;
}

/**
 * Get the settings.json path for a cart ID in local storage
 */
export async function getLocalSettingsPath(cartId: string): Promise<string | null> {
  const gameFolder = await findGameFolder(LOCAL_GAMES_DIR, cartId);
  if (!gameFolder) {
    return null;
  }
  return path.join(gameFolder, 'settings.json');
}

/**
 * Get the settings.json path for a cart ID on SD card
 */
export async function getSDSettingsPath(sdCardPath: string, cartId: string): Promise<string | null> {
  const gamesDir = path.join(sdCardPath, 'Library', 'N64', 'Games');
  const gameFolder = await findGameFolder(gamesDir, cartId);
  if (!gameFolder) {
    return null;
  }
  return path.join(gameFolder, 'settings.json');
}

// =============================================================================
// Parsing and Validation
// =============================================================================

/**
 * Remove trailing commas from JSON string (3Dos 1.5.0 and earlier wrote invalid JSON with trailing commas)
 */
function sanitizeJson(content: string): string {
  return content.replace(/,(\s*[}\]])/g, '$1');
}

const LEGACY_KEYS = ['title', 'horizontalBeamConvergence', 'virtualExpansionPak', 'enable32BitColor', 'disableDeblur', 'interpolationAlg'];

/** The old format is recognizable by its camelCase keys (and a top-level title) */
export function isLegacySettings(data: unknown): boolean {
  const text = JSON.stringify(data ?? null);
  return LEGACY_KEYS.some((key) => text.includes(`"${key}"`));
}

type Obj = Record<string, unknown>;

function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Rebuild a settings object from an unknown value: known keys only, in the
 * console's key order, with every value checked against the allowed set.
 * Returns the problems found instead of guessing.
 */
export function normalizeSettings(input: unknown): { settings?: CartridgeSettings; errors: string[] } {
  const errors: string[] = [];
  if (!isObj(input)) return { errors: ['Settings must be an object'] };
  if (isLegacySettings(input)) return { errors: [new LegacySettingsError().message] };

  const pick = <T extends string>(obj: unknown, key: string, allowed: readonly T[], at: string): T => {
    const value = isObj(obj) ? obj[key] : undefined;
    if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T;
    errors.push(`${at}.${key}: expected one of ${allowed.join(', ')}, got ${JSON.stringify(value)}`);
    return allowed[0];
  };
  const bool = (obj: unknown, key: string, at: string): boolean => {
    const value = isObj(obj) ? obj[key] : undefined;
    if (typeof value === 'boolean') return value;
    errors.push(`${at}.${key}: expected true or false, got ${JSON.stringify(value)}`);
    return false;
  };
  const section = (obj: unknown, key: string, at: string): Obj => {
    const value = isObj(obj) ? obj[key] : undefined;
    if (isObj(value)) return value;
    errors.push(`${at}.${key}: missing`);
    return {};
  };

  const display = section(input, 'display', 'settings');
  const catalog = section(display, 'catalog', 'display');
  const crtMode = (mode: 'bvm' | 'pvm' | 'crt' | 'scanlines'): CRTModeSettings => {
    const m = section(catalog, mode, 'catalog');
    const at = `catalog.${mode}`;
    return {
      horizontal_beam_convergence: pick(m, 'horizontal_beam_convergence', BEAM_CONVERGENCE_VALUES, at),
      vertical_beam_convergence: pick(m, 'vertical_beam_convergence', BEAM_CONVERGENCE_VALUES, at),
      // Not in the schema outside bvm, but the console writes it; default to the console's locked values
      enable_edge_overshoot:
        mode === 'bvm' || typeof m.enable_edge_overshoot === 'boolean'
          ? bool(m, 'enable_edge_overshoot', at)
          : mode !== 'scanlines',
      enable_edge_hardness: pick(m, 'enable_edge_hardness', EDGE_HARDNESS_VALUES, at),
      image_fit: pick(m, 'image_fit', IMAGE_FIT_VALUES, at),
      image_size: pick(m, 'image_size', IMAGE_SIZE_VALUES, at),
    };
  };
  const clean = section(catalog, 'clean', 'catalog');
  const library = section(input, 'library', 'settings');
  const hardware = section(input, 'hardware', 'settings');
  const hw = 'hardware';

  const settings: CartridgeSettings = {
    $schema: SETTINGS_SCHEMA_URL,
    display: {
      odm: pick(display, 'odm', DISPLAY_MODE_VALUES, 'display'),
      catalog: {
        bvm: crtMode('bvm'),
        pvm: crtMode('pvm'),
        crt: crtMode('crt'),
        scanlines: crtMode('scanlines'),
        clean: {
          interpolation_alg: pick(clean, 'interpolation_alg', INTERPOLATION_VALUES, 'catalog.clean'),
          gamma_transfer_function: pick(clean, 'gamma_transfer_function', GAMMA_TRANSFER_VALUES, 'catalog.clean'),
          sharpness: pick(clean, 'sharpness', SHARPNESS_VALUES, 'catalog.clean'),
          image_fit: pick(clean, 'image_fit', IMAGE_FIT_VALUES, 'catalog.clean'),
          image_size: pick(clean, 'image_size', IMAGE_SIZE_VALUES, 'catalog.clean'),
        },
      },
    },
    library: { cartridge_color: pick(library, 'cartridge_color', CARTRIDGE_COLOR_VALUES, 'library') },
    hardware: {
      disable_antialiasing: bool(hardware, 'disable_antialiasing', hw),
      disable_deblur: bool(hardware, 'disable_deblur', hw),
      disable_texture_filtering: bool(hardware, 'disable_texture_filtering', hw),
      enable_32_bit_color: bool(hardware, 'enable_32_bit_color', hw),
      force_original_hardware: bool(hardware, 'force_original_hardware', hw),
      force_progressive_output: bool(hardware, 'force_progressive_output', hw),
      overclock: pick(hardware, 'overclock', OVERCLOCK_VALUES, hw),
      region: pick(hardware, 'region', REGION_VALUES, hw),
      virtual_expansion_pak: bool(hardware, 'virtual_expansion_pak', hw),
      horizontal_upscaling: bool(hardware, 'horizontal_upscaling', hw),
    },
  };

  return errors.length ? { errors } : { settings, errors };
}

export function validateSettings(settings: unknown): { valid: boolean; errors: string[] } {
  const { errors } = normalizeSettings(settings);
  return { valid: errors.length === 0, errors };
}

/**
 * Parse a settings.json file. Throws LegacySettingsError for the pre-1.5.1
 * format and a plain Error listing the problems for anything else invalid.
 */
export function parseSettings(content: string): CartridgeSettings {
  const data: unknown = JSON.parse(sanitizeJson(content));
  if (isObj(data) && isLegacySettings(data)) throw new LegacySettingsError();
  const { settings, errors } = normalizeSettings(data);
  if (!settings) throw new Error(`Unsupported settings.json: ${errors.slice(0, 3).join('; ')}`);
  return settings;
}

export function serializeSettings(settings: CartridgeSettings): string {
  return `${JSON.stringify(settings, null, 2)}\n`;
}

/**
 * Read settings from a file path
 */
export async function readSettingsFile(filePath: string): Promise<CartridgeSettings> {
  return parseSettings(await readFile(filePath, 'utf-8'));
}

async function readSettingsInfo(filePath: string | null, source: 'local' | 'sd'): Promise<SettingsInfo> {
  const info: SettingsInfo = { exists: false, source, path: filePath || '' };
  if (!filePath || !existsSync(filePath)) return info;

  info.exists = true;
  info.lastModified = (await stat(filePath)).mtime.toISOString();
  try {
    info.settings = await readSettingsFile(filePath);
    info.format = 'current';
  } catch (error) {
    if (error instanceof LegacySettingsError) info.format = 'legacy';
    info.error = error instanceof Error ? error.message : String(error);
  }
  return info;
}

/**
 * Get settings info for a cartridge (checks both local and SD)
 */
export async function getSettingsInfo(
  cartId: string,
  sdCardPath?: string
): Promise<{ local: SettingsInfo; sd: SettingsInfo | null }> {
  const local = await readSettingsInfo(await getLocalSettingsPath(cartId), 'local');
  const sd = sdCardPath ? await readSettingsInfo(await getSDSettingsPath(sdCardPath, cartId), 'sd') : null;
  return { local, sd };
}

// =============================================================================
// SD card compatibility
// =============================================================================

export interface SDSettingsSupport {
  supported: boolean;
  /** Shown to the user when settings can't be written to this card */
  reason?: string;
}

/**
 * Can this card take 1.5.1-format settings? The card's own settings files are
 * the best evidence (3Dos 1.5.1 converts them all at update time); the
 * installed firmware version decides only when there are none.
 */
export async function getSDSettingsSupport(sdCardPath: string): Promise<SDSettingsSupport> {
  const gamesDir = path.join(sdCardPath, 'Library', 'N64', 'Games');
  let current = 0;
  let legacy = 0;
  for (const folder of await readdir(gamesDir).catch(() => [] as string[])) {
    const file = path.join(gamesDir, folder, 'settings.json');
    if (!existsSync(file)) continue;
    try {
      const data: unknown = JSON.parse(sanitizeJson(await readFile(file, 'utf-8')));
      if (isLegacySettings(data)) legacy++;
      else if (isObj(data) && typeof data.$schema === 'string') current++;
    } catch {
      // Unreadable file: no evidence either way
    }
  }
  if (current > 0) return { supported: true };

  const installed = (await getSDFirmwareStatus(sdCardPath).catch(() => null))?.installedVersion ?? null;
  if (legacy > 0 || (installed && compareVersions(installed, SETTINGS_FORMAT_MIN_FIRMWARE) < 0)) {
    return {
      supported: false,
      reason:
        `This SD card's settings are from a console running 3Dos ${installed && compareVersions(installed, SETTINGS_FORMAT_MIN_FIRMWARE) < 0 ? installed : 'older than 1.5.1'}. ` +
        `Install 3Dos ${SETTINGS_FORMAT_MIN_FIRMWARE} or later (Settings → Firmware) and power the console on with this card so it converts them, then settings can sync.`,
    };
  }
  // No settings files and no older firmware: nothing on the card to overwrite
  return { supported: true };
}

// =============================================================================
// Write Operations
// =============================================================================

async function folderTitle(cartId: string, title?: string): Promise<string> {
  const known = title && title !== 'Unknown Cartridge' ? title : await lookupGameName(cartId);
  // Folder names can't contain path separators or characters FAT rejects
  return (known || 'Unknown Cartridge').replace(/[\\/:*?"<>|]/g, '').trim() || 'Unknown Cartridge';
}

/**
 * Ensure a game folder exists locally
 * Reuses an existing folder for this cartId (whatever its title). Otherwise
 * creates one named after the given title, the cart database, or "Unknown Cartridge".
 */
export async function ensureLocalGameFolder(cartId: string, title?: string): Promise<string> {
  const existingFolder = await findGameFolder(LOCAL_GAMES_DIR, cartId);
  if (existingFolder) {
    return existingFolder;
  }

  const folderPath = path.join(LOCAL_GAMES_DIR, `${await folderTitle(cartId, title)} ${cartId.toLowerCase()}`);
  await mkdir(folderPath, { recursive: true });
  return folderPath;
}

/**
 * The card's game folder for a cartridge: the existing one (whatever its title),
 * else a new "<Title> <id>" named from the cart database ("Unknown Cartridge" for
 * carts outside it, as the console names them), with characters FAT rejects removed.
 * Used by every upload that may create the folder, so they all name it the same way.
 */
export async function ensureSdGameFolder(sdCardPath: string, cartId: string): Promise<string> {
  const gamesDir = path.join(sdCardPath, 'Library', 'N64', 'Games');
  const existingFolder = await findGameFolder(gamesDir, cartId);
  if (existingFolder) {
    return existingFolder;
  }

  const folderPath = path.join(gamesDir, `${await folderTitle(cartId)} ${cartId.toLowerCase()}`);
  await mkdir(folderPath, { recursive: true });
  return folderPath;
}

/**
 * Save settings to local storage (validated and normalized first)
 */
export async function saveLocalSettings(
  cartId: string,
  settings: CartridgeSettings,
  title?: string
): Promise<string> {
  const { settings: normalized, errors } = normalizeSettings(settings);
  if (!normalized) throw new Error(`Invalid settings: ${errors.join('; ')}`);

  const folderPath = await ensureLocalGameFolder(cartId, title);
  const settingsPath = path.join(folderPath, 'settings.json');
  await writeFileAtomic(settingsPath, serializeSettings(normalized));
  return settingsPath;
}

/**
 * Copy settings from SD card to local storage
 */
export async function downloadSettingsFromSD(
  cartId: string,
  sdCardPath: string
): Promise<{ success: boolean; path?: string; error?: string }> {
  const sdSettingsPath = await getSDSettingsPath(sdCardPath, cartId);

  if (!sdSettingsPath || !existsSync(sdSettingsPath)) {
    return { success: false, error: 'Settings not found on SD card' };
  }

  try {
    const settings = await readSettingsFile(sdSettingsPath);
    const sdFolderName = path.basename(path.dirname(sdSettingsPath));
    const localPath = await saveLocalSettings(cartId, settings, sdFolderName.replace(/\s+[0-9a-fA-F]{8}$/, ''));
    return { success: true, path: localPath };
  } catch (error) {
    return {
      success: false,
      error: error instanceof LegacySettingsError
        ? 'The settings on the SD card are in the format used before 3Dos 1.5.1'
        : error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Delete local settings for a cartridge
 */
export async function deleteLocalSettings(cartId: string): Promise<boolean> {
  const localPath = await getLocalSettingsPath(cartId);

  if (!localPath || !existsSync(localPath)) {
    return false;
  }

  const { unlink } = await import('fs/promises');
  await unlink(localPath);
  return true;
}

/**
 * Upload local settings to SD card. Refused for cards whose console hasn't
 * switched to the 1.5.1 format (it would reset them to defaults).
 */
export async function uploadSettingsToSD(
  cartId: string,
  sdCardPath: string
): Promise<{ success: boolean; path?: string; error?: string }> {
  const localPath = await getLocalSettingsPath(cartId);

  if (!localPath || !existsSync(localPath)) {
    return { success: false, error: 'No local settings found' };
  }

  let settings: CartridgeSettings;
  try {
    settings = await readSettingsFile(localPath);
  } catch (error) {
    return {
      success: false,
      error: error instanceof LegacySettingsError
        ? 'Your local settings for this cartridge are in the format used before 3Dos 1.5.1 and were not copied to the SD card'
        : error instanceof Error ? error.message : 'Unknown error',
    };
  }

  const support = await getSDSettingsSupport(sdCardPath);
  if (!support.supported) {
    return { success: false, error: support.reason };
  }

  try {
    const sdGameFolder = await ensureSdGameFolder(sdCardPath, cartId);
    const sdSettingsPath = path.join(sdGameFolder, 'settings.json');
    await writeFileAtomic(sdSettingsPath, serializeSettings(settings));
    return { success: true, path: sdSettingsPath };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

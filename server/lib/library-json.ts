/**
 * Per-game library.json (3Dos 1.5.1+): library details for cartridges that aren't
 * in the console's built-in database (title, developers, release year, ...) plus
 * their default settings.
 *
 * Docs: https://www.analogue.co/developer/docs/platform/library-json
 * Schema: https://schemas.analogue.co/platform/3d/library.json (copy in
 * docs/analogue-schemas/3d-library.json). Unlike settings.json, the files the
 * console writes match the schema exactly, so files are written strictly to it,
 * in the console's key order. Limits the schema doesn't encode (at most 4
 * players and 5 accessories) come from the docs page.
 */
import { existsSync } from 'fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'fs/promises';
import path from 'path';
import {
  CARTRIDGE_COLOR_VALUES,
  OVERCLOCK_VALUES,
  REGION_VALUES,
  ensureLocalGameFolder,
  findGameFolder,
  getLocalGamesDir,
  getSDSettingsSupport,
  parseSettings,
  type CartridgeColor,
  type Overclock,
  type Region,
} from './cartridge-settings.js';

export const LIBRARY_SCHEMA_URL = 'https://schemas.analogue.co/platform/3d/library.json';

export const ACCESSORY_VALUES = [
  'controller-pak',
  'expansion-pak',
  'rumble-pak',
  'transfer-pak',
  'voice-recognition-unit-usa',
  'voice-recognition-system-japan',
  'denshadego-controller',
  'bio-sensor',
  'tsurikon-64',
  'n64-mouse',
] as const;
export const LIBRARY_REGION_VALUES = [
  'asia', 'australia', 'brazil', 'germany', 'europe', 'france', 'england', 'italy', 'japan', 'netherlands', 'spain', 'usa',
] as const;
export const VIRTUAL_ACCESSORY_VALUES = ['no-pak', 'controller-pak', 'rumble-pak'] as const;

export const MAX_TITLE_LENGTH = 127;
export const MAX_PLAYERS = 4;
export const MAX_ACCESSORIES = 5;

export type Accessory = (typeof ACCESSORY_VALUES)[number];
export type LibraryRegion = (typeof LIBRARY_REGION_VALUES)[number];
export type VirtualAccessory = (typeof VIRTUAL_ACCESSORY_VALUES)[number];

export interface LibraryData {
  title: string;
  /** 0-based; the console shows revision N as "Rev N" */
  revision: number;
  player_count: number;
  accessories: Accessory[];
  region: LibraryRegion[];
  developers: string[];
  publishers: string[];
  release_year: number;
}

/** Note: disable_anti_aliasing here vs disable_antialiasing in settings.json */
export interface LibraryDefaults {
  virtual_expansion_pak: boolean;
  region: Region;
  disable_deblur: boolean;
  enable_32_bit_color: boolean;
  force_progressive_output: boolean;
  disable_texture_filtering: boolean;
  disable_anti_aliasing: boolean;
  force_original_hardware: boolean;
  horizontal_upscaling: boolean;
  overclock: Overclock;
  virtual_accessory: VirtualAccessory;
  cart_color: CartridgeColor;
}

export interface LibraryJson {
  $schema: string;
  data: LibraryData;
  defaults: LibraryDefaults;
}

export interface LibraryInfo {
  exists: boolean;
  source: 'local' | 'sd';
  path: string;
  lastModified?: string;
  library?: LibraryJson;
  error?: string;
}

/**
 * What 3Dos 1.5.1 writes for a new unknown cartridge (identical in every file
 * seen on a real card), with the release year set to the current year as the
 * console does.
 */
export function createDefaultLibrary(title = 'Unknown Cartridge'): LibraryJson {
  return {
    $schema: LIBRARY_SCHEMA_URL,
    data: {
      title: title.slice(0, MAX_TITLE_LENGTH),
      revision: 0,
      player_count: 1,
      accessories: [],
      region: [],
      developers: ['Unknown'],
      publishers: ['Unknown'],
      release_year: new Date().getFullYear(),
    },
    defaults: {
      virtual_expansion_pak: true,
      region: 'auto',
      disable_deblur: false,
      enable_32_bit_color: false,
      force_progressive_output: false,
      disable_texture_filtering: false,
      disable_anti_aliasing: false,
      force_original_hardware: false,
      horizontal_upscaling: false,
      overclock: 'off',
      virtual_accessory: 'no-pak',
      cart_color: 'gray',
    },
  };
}

// =============================================================================
// Validation
// =============================================================================

type Obj = Record<string, unknown>;

function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Rebuild a library.json from an unknown value: known keys only, console key order, every value checked */
export function normalizeLibrary(input: unknown): { library?: LibraryJson; errors: string[] } {
  const errors: string[] = [];
  if (!isObj(input)) return { errors: ['library.json must be an object'] };
  const data = isObj(input.data) ? input.data : (errors.push('data: missing'), {} as Obj);
  const defaults = isObj(input.defaults) ? input.defaults : (errors.push('defaults: missing'), {} as Obj);

  const int = (obj: Obj, key: string, min: number, max: number): number => {
    const value = obj[key];
    if (typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max) return value;
    errors.push(`data.${key}: expected a whole number from ${min} to ${max}, got ${JSON.stringify(value)}`);
    return min;
  };
  const strings = (obj: Obj, key: string): string[] => {
    const value = obj[key];
    if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
      return value.map((v: string) => v.trim()).filter(Boolean);
    }
    errors.push(`data.${key}: expected a list of names`);
    return [];
  };
  const subset = <T extends string>(obj: Obj, key: string, allowed: readonly T[], max?: number): T[] => {
    const value = obj[key];
    if (!Array.isArray(value)) {
      errors.push(`data.${key}: expected a list`);
      return [];
    }
    const bad = value.filter((v) => !(allowed as readonly unknown[]).includes(v));
    if (bad.length) errors.push(`data.${key}: unknown value(s) ${bad.map((b) => JSON.stringify(b)).join(', ')}`);
    // Keep the schema's order and drop duplicates
    const chosen = allowed.filter((a) => value.includes(a));
    if (max !== undefined && chosen.length > max) errors.push(`data.${key}: at most ${max} allowed`);
    return chosen;
  };
  const pick = <T extends string>(key: string, allowed: readonly T[]): T => {
    const value = defaults[key];
    if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T;
    errors.push(`defaults.${key}: expected one of ${allowed.join(', ')}, got ${JSON.stringify(value)}`);
    return allowed[0];
  };
  const bool = (key: string): boolean => {
    const value = defaults[key];
    if (typeof value === 'boolean') return value;
    errors.push(`defaults.${key}: expected true or false, got ${JSON.stringify(value)}`);
    return false;
  };

  const title = typeof data.title === 'string' ? data.title.trim() : '';
  if (!title) errors.push('data.title: required');
  if (title.length > MAX_TITLE_LENGTH) errors.push(`data.title: at most ${MAX_TITLE_LENGTH} characters`);

  const library: LibraryJson = {
    $schema: LIBRARY_SCHEMA_URL,
    data: {
      title,
      revision: int(data, 'revision', 0, 99),
      player_count: int(data, 'player_count', 1, MAX_PLAYERS),
      accessories: subset(data, 'accessories', ACCESSORY_VALUES, MAX_ACCESSORIES),
      region: subset(data, 'region', LIBRARY_REGION_VALUES),
      developers: strings(data, 'developers'),
      publishers: strings(data, 'publishers'),
      release_year: int(data, 'release_year', 1970, 2100),
    },
    defaults: {
      virtual_expansion_pak: bool('virtual_expansion_pak'),
      region: pick('region', REGION_VALUES),
      disable_deblur: bool('disable_deblur'),
      enable_32_bit_color: bool('enable_32_bit_color'),
      force_progressive_output: bool('force_progressive_output'),
      disable_texture_filtering: bool('disable_texture_filtering'),
      disable_anti_aliasing: bool('disable_anti_aliasing'),
      force_original_hardware: bool('force_original_hardware'),
      horizontal_upscaling: bool('horizontal_upscaling'),
      overclock: pick('overclock', OVERCLOCK_VALUES),
      virtual_accessory: pick('virtual_accessory', VIRTUAL_ACCESSORY_VALUES),
      cart_color: pick('cart_color', CARTRIDGE_COLOR_VALUES),
    },
  };
  return errors.length ? { errors } : { library, errors };
}

export function parseLibrary(content: string): LibraryJson {
  const { library, errors } = normalizeLibrary(JSON.parse(content));
  if (!library) throw new Error(`Unsupported library.json: ${errors.slice(0, 3).join('; ')}`);
  return library;
}

export function serializeLibrary(library: LibraryJson): string {
  return `${JSON.stringify(library, null, 2)}\n`;
}

// =============================================================================
// Files
// =============================================================================

async function readLibraryInfo(filePath: string | null, source: 'local' | 'sd'): Promise<LibraryInfo> {
  const info: LibraryInfo = { exists: false, source, path: filePath ?? '' };
  if (!filePath || !existsSync(filePath)) return info;
  info.exists = true;
  info.lastModified = (await stat(filePath)).mtime.toISOString();
  try {
    info.library = parseLibrary(await readFile(filePath, 'utf-8'));
  } catch (error) {
    info.error = error instanceof Error ? error.message : String(error);
  }
  return info;
}

async function libraryPathIn(gamesDir: string, cartId: string): Promise<string | null> {
  const folder = await findGameFolder(gamesDir, cartId);
  return folder ? path.join(folder, 'library.json') : null;
}

function sdGamesDir(sdCardPath: string): string {
  return path.join(sdCardPath, 'Library', 'N64', 'Games');
}

export async function getLibraryInfo(cartId: string, sdCardPath?: string): Promise<{ local: LibraryInfo; sd: LibraryInfo | null }> {
  const local = await readLibraryInfo(await libraryPathIn(getLocalGamesDir(), cartId), 'local');
  const sd = sdCardPath ? await readLibraryInfo(await libraryPathIn(sdGamesDir(sdCardPath), cartId), 'sd') : null;
  return { local, sd };
}

export async function saveLocalLibrary(cartId: string, input: unknown): Promise<string> {
  const { library, errors } = normalizeLibrary(input);
  if (!library) throw new Error(`Invalid library.json: ${errors.join('; ')}`);
  const folder = await ensureLocalGameFolder(cartId, 'Unknown Cartridge');
  const filePath = path.join(folder, 'library.json');
  await writeFile(filePath, serializeLibrary(library), 'utf-8');
  return filePath;
}

/**
 * Write the local library.json to the card. Refused for cards whose console
 * isn't on 3Dos 1.5.1+ (library.json didn't exist before). A cart without a
 * folder on the card gets one named like the console names unknown carts.
 */
export async function uploadLibraryToSD(cartId: string, sdCardPath: string): Promise<{ success: boolean; path?: string; error?: string }> {
  const localPath = await libraryPathIn(getLocalGamesDir(), cartId);
  if (!localPath || !existsSync(localPath)) {
    return { success: false, error: 'No local library.json found' };
  }
  let library: LibraryJson;
  try {
    library = parseLibrary(await readFile(localPath, 'utf-8'));
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }

  const support = await getSDSettingsSupport(sdCardPath);
  if (!support.supported) {
    return { success: false, error: support.reason };
  }

  try {
    let folder = await findGameFolder(sdGamesDir(sdCardPath), cartId);
    if (!folder) {
      folder = path.join(sdGamesDir(sdCardPath), `Unknown Cartridge ${cartId.toLowerCase()}`);
      await mkdir(folder, { recursive: true });
    }
    const filePath = path.join(folder, 'library.json');
    await writeFile(filePath, serializeLibrary(library), 'utf-8');
    return { success: true, path: filePath };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function downloadLibraryFromSD(cartId: string, sdCardPath: string): Promise<{ success: boolean; path?: string; error?: string }> {
  const sdPath = await libraryPathIn(sdGamesDir(sdCardPath), cartId);
  if (!sdPath || !existsSync(sdPath)) {
    return { success: false, error: 'No library.json for this cartridge on the SD card' };
  }
  try {
    const library = parseLibrary(await readFile(sdPath, 'utf-8'));
    return { success: true, path: await saveLocalLibrary(cartId, library) };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Cartridge color for every locally stored game: the per-game setting
 * (settings.json library.cartridge_color) wins over the library.json default.
 * Files in older formats are skipped. Keys are lowercase cart IDs.
 */
export async function getLocalCartridgeColors(): Promise<Record<string, CartridgeColor>> {
  const colors: Record<string, CartridgeColor> = {};
  const gamesDir = getLocalGamesDir();
  for (const folder of await readdir(gamesDir).catch(() => [] as string[])) {
    const cartId = /([0-9a-fA-F]{8})$/.exec(folder)?.[1]?.toLowerCase();
    if (!cartId) continue;
    const read = async (file: string) => readFile(path.join(gamesDir, folder, file), 'utf-8').catch(() => null);

    const settingsText = await read('settings.json');
    try {
      if (settingsText) {
        colors[cartId] = parseSettings(settingsText).library.cartridge_color;
        continue;
      }
    } catch {
      // Old-format or invalid settings: fall back to library.json
    }
    const libraryText = await read('library.json');
    try {
      if (libraryText) colors[cartId] = parseLibrary(libraryText).defaults.cart_color;
    } catch {
      // Invalid library.json: no color
    }
  }
  return colors;
}

import { readFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { updateJsonFile } from './safe-write.js';

// =============================================================================
// Types
// =============================================================================

export interface OwnedCartridge {
  cartId: string;
  addedAt: string;
  source: 'sd-card' | 'manual';
}

export interface OwnedCartsData {
  version: 1;
  cartridges: OwnedCartridge[];
}

// =============================================================================
// Constants
// =============================================================================

const LOCAL_DIR = path.join(process.cwd(), '.local');
const OWNED_CARTS_PATH = path.join(LOCAL_DIR, 'owned-carts.json');

// =============================================================================
// File Operations
// =============================================================================

const emptyData = (): OwnedCartsData => ({ version: 1, cartridges: [] });

function isOwnedCartsData(value: unknown): value is OwnedCartsData {
  const data = value as OwnedCartsData;
  return !!data && typeof data === 'object' && !!data.version && Array.isArray(data.cartridges) &&
    data.cartridges.every((c) => c && typeof c.cartId === 'string');
}

/**
 * Ensure the .local directory exists
 */
async function ensureLocalDir(): Promise<void> {
  if (!existsSync(LOCAL_DIR)) {
    await mkdir(LOCAL_DIR, { recursive: true });
  }
}

/**
 * Check if the owned carts file exists
 */
export function hasOwnedCartsFile(): boolean {
  return existsSync(OWNED_CARTS_PATH);
}

/**
 * Load owned carts data from disk. For display: an unreadable file reads as empty
 * but is left alone; the next change moves it aside and fails (see mutateOwnedCarts).
 */
export async function loadOwnedCarts(): Promise<OwnedCartsData> {
  if (!hasOwnedCartsFile()) {
    return emptyData();
  }

  try {
    const data: unknown = JSON.parse(await readFile(OWNED_CARTS_PATH, 'utf-8'));
    if (isOwnedCartsData(data)) return data;
    console.warn('Invalid owned-carts.json structure, showing no owned cartridges');
  } catch (error) {
    console.error('Error loading owned carts:', error);
  }
  return emptyData();
}

/**
 * Change owned-carts.json: one change at a time, written atomically. If the file
 * can't be read it's kept as owned-carts.json.corrupt-<time> and the change fails.
 */
async function mutateOwnedCarts<R>(change: (data: OwnedCartsData) => R): Promise<R> {
  await ensureLocalDir();
  return updateJsonFile(OWNED_CARTS_PATH, emptyData, change, isOwnedCartsData);
}

// =============================================================================
// CRUD Operations
// =============================================================================

/**
 * Get all owned cartridge IDs
 */
export async function getOwnedCartIds(): Promise<string[]> {
  const data = await loadOwnedCarts();
  return data.cartridges.map(c => c.cartId);
}

/**
 * Get all owned cartridges with full details
 */
export async function getOwnedCartridges(): Promise<OwnedCartridge[]> {
  const data = await loadOwnedCarts();
  return data.cartridges;
}

/**
 * Check if a cartridge is owned
 */
export async function isCartridgeOwned(cartId: string): Promise<boolean> {
  const normalizedId = cartId.toLowerCase();
  const data = await loadOwnedCarts();
  return data.cartridges.some(c => c.cartId.toLowerCase() === normalizedId);
}

/**
 * Mark a cartridge as owned
 */
export function addOwnedCartridge(
  cartId: string,
  source: 'sd-card' | 'manual' = 'manual'
): Promise<OwnedCartridge> {
  const normalizedId = cartId.toLowerCase();
  return mutateOwnedCarts((data) => {
    const existing = data.cartridges.find(c => c.cartId.toLowerCase() === normalizedId);
    if (existing) return existing;

    const newEntry: OwnedCartridge = {
      cartId: normalizedId,
      addedAt: new Date().toISOString(),
      source,
    };
    data.cartridges.push(newEntry);
    return newEntry;
  });
}

/**
 * Mark multiple cartridges as owned (batch operation)
 */
export function addOwnedCartridges(
  cartIds: string[],
  source: 'sd-card' | 'manual' = 'manual'
): Promise<{ added: string[]; skipped: string[] }> {
  return mutateOwnedCarts((data) => {
    const existingIds = new Set(data.cartridges.map(c => c.cartId.toLowerCase()));
    const added: string[] = [];
    const skipped: string[] = [];
    const now = new Date().toISOString();

    for (const cartId of cartIds) {
      const normalizedId = cartId.toLowerCase();
      if (existingIds.has(normalizedId)) {
        skipped.push(normalizedId);
      } else {
        data.cartridges.push({ cartId: normalizedId, addedAt: now, source });
        existingIds.add(normalizedId);
        added.push(normalizedId);
      }
    }
    return { added, skipped };
  });
}

/**
 * Remove ownership marking from a cartridge
 */
export async function removeOwnedCartridge(cartId: string): Promise<boolean> {
  return (await removeOwnedCartridges([cartId])) > 0;
}

/**
 * Remove ownership from multiple cartridges
 */
export function removeOwnedCartridges(cartIds: string[]): Promise<number> {
  const normalizedIds = new Set(cartIds.map(id => id.toLowerCase()));
  return mutateOwnedCarts((data) => {
    const initialLength = data.cartridges.length;
    data.cartridges = data.cartridges.filter(c => !normalizedIds.has(c.cartId.toLowerCase()));
    return initialLength - data.cartridges.length;
  });
}

/**
 * Clear all ownership data
 */
export function clearOwnedCartridges(): Promise<number> {
  return mutateOwnedCarts((data) => {
    const count = data.cartridges.length;
    data.cartridges = [];
    return count;
  });
}

/** Merge cartridges into the owned list (bundle import); returns how many were new */
export function mergeOwnedCartridges(
  cartridges: OwnedCartridge[],
): Promise<{ added: number; skipped: number }> {
  return mutateOwnedCarts((data) => {
    const existingIds = new Set(data.cartridges.map(c => c.cartId.toLowerCase()));
    let added = 0;
    let skipped = 0;
    for (const cart of cartridges) {
      const normalizedId = cart.cartId.toLowerCase();
      if (existingIds.has(normalizedId)) {
        skipped++;
      } else {
        data.cartridges.push({ ...cart, cartId: normalizedId });
        existingIds.add(normalizedId);
        added++;
      }
    }
    return { added, skipped };
  });
}

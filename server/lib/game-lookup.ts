/**
 * Game name lookup utility
 *
 * Provides a way to look up game names from the cart database.
 */

import { readFile } from 'fs/promises';
import path from 'path';

interface CartNameEntry {
  id: string;
  name: string;
  region?: string;
  languages?: string[];
  videoMode?: 'NTSC' | 'PAL' | 'Unknown';
  gameCode?: string;
}

let cartNameMap: Map<string, CartNameEntry> = new Map();
let loaded = false;

async function ensureLoaded(): Promise<void> {
  if (loaded) return;

  try {
    // cart-database.json isn't shipped in the repo; data/cart-names.json (the database the
    // labels routes use, a plain array of entries) is the fallback
    let carts: CartNameEntry[];
    try {
      const database = JSON.parse(await readFile(path.join(process.cwd(), 'data', 'cart-database.json'), 'utf-8'));
      carts = database.carts || [];
    } catch {
      carts = JSON.parse(await readFile(path.join(process.cwd(), 'data', 'cart-names.json'), 'utf-8'));
    }
    cartNameMap = new Map();

    for (const cart of carts) {
      cartNameMap.set(cart.id.toLowerCase(), cart);
    }
    loaded = true;
  } catch (error) {
    console.error('Error loading cart database for game lookup:', error);
    loaded = true; // Don't try again
  }
}

/**
 * Look up a game name by cart ID
 * @param cartId The 8-character hex cart ID
 * @returns The game name if found, or undefined if not found
 */
export async function lookupGameName(cartId: string): Promise<string | undefined> {
  await ensureLoaded();
  const entry = cartNameMap.get(cartId.toLowerCase());
  return entry?.name;
}

/**
 * Whether the cart ID is in the app's cart database (the closest available proxy
 * for the console's built-in database)
 */
export async function isKnownCart(cartId: string): Promise<boolean> {
  await ensureLoaded();
  return cartNameMap.has(cartId.toLowerCase());
}

/**
 * Custom names for cartridges outside the built-in database (.local/user-carts.json).
 *
 * Changes go through mutateUserCarts: one at a time, written atomically, starting
 * from the file on disk. An unreadable file is kept as user-carts.json.corrupt-<time>
 * and the change fails, instead of being overwritten. Listeners hear about every
 * change (the labels routes keep an in-memory copy and a sorted cache).
 */

import { mkdir, readFile } from 'fs/promises';
import path from 'path';
import { CART_ID_PATTERN } from './request-guards.js';
import { updateJsonFile } from './safe-write.js';

export interface UserCartEntry {
  id: string;
  name: string;
  addedAt: string;
}

export const USER_CARTS_PATH = path.join(process.cwd(), '.local', 'user-carts.json');

export const isUserCartEntries = (value: unknown): value is UserCartEntry[] =>
  Array.isArray(value) &&
  value.every((e) => e && typeof e.id === 'string' && CART_ID_PATTERN.test(e.id) && typeof e.name === 'string');

type Listener = (entries: UserCartEntry[]) => void;
const listeners = new Set<Listener>();

/** Be told about every change (after it's written) */
export function onUserCartsChanged(listener: Listener): void {
  listeners.add(listener);
}

/** For display: an unreadable file reads as empty but is left alone */
export async function readUserCarts(): Promise<UserCartEntry[]> {
  try {
    const parsed: unknown = JSON.parse(await readFile(USER_CARTS_PATH, 'utf-8'));
    return isUserCartEntries(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function mutateUserCarts<R>(change: (entries: UserCartEntry[]) => R): Promise<R> {
  await mkdir(path.dirname(USER_CARTS_PATH), { recursive: true });
  let written: UserCartEntry[] = [];
  const result = await updateJsonFile(USER_CARTS_PATH, () => [] as UserCartEntry[], (entries) => {
    const value = change(entries);
    written = entries;
    return value;
  }, isUserCartEntries);
  for (const listener of listeners) listener(written);
  return result;
}

/** Merge names from a bundle; existing names are replaced only when overwrite is set */
export function mergeUserCarts(
  incoming: UserCartEntry[],
  overwrite: boolean,
): Promise<{ added: number; skipped: number; overwritten: number }> {
  return mutateUserCarts((entries) => {
    const counts = { added: 0, skipped: 0, overwritten: 0 };
    for (const entry of incoming) {
      const id = entry.id.toLowerCase();
      const index = entries.findIndex((e) => e.id.toLowerCase() === id);
      const normalized = { id, name: entry.name, addedAt: entry.addedAt || new Date().toISOString() };
      if (index < 0) {
        entries.push(normalized);
        counts.added++;
      } else if (overwrite) {
        entries[index] = normalized;
        counts.overwritten++;
      } else {
        counts.skipped++;
      }
    }
    return counts;
  });
}

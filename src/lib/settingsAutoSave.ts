/**
 * Settings Auto-Save Manager
 *
 * Saves cartridge settings a couple of seconds after the last change, per cartridge.
 *
 * - One save at a time per cartridge: a change made while a save is running is
 *   saved after it, never alongside it.
 * - A failed save keeps its change: it's retried with the next change, by
 *   retrySave, or when saves are flushed.
 * - cancelPendingSave drops a queued change the user has undone.
 * - flushPendingSaves sends everything now and resolves when done. The desktop app
 *   calls it before quitting; the browser build calls it on unload.
 */

import type { CartridgeSettings } from './defaultSettings';
import { getDesktopBridge } from '../desktop/bridge';

export type SaveStatus = 'pending' | 'saving' | 'saved' | 'error';

interface CartSaveState {
  /** Change waiting to be saved (null when nothing is waiting) */
  pending: { settings: CartridgeSettings; sdCardPath?: string } | null;
  timeoutId: number | null;
  /** The save running now, if any */
  running: Promise<void> | null;
}

/**
 * status: what happened. savedJson: on 'saved', the settings that were written, so
 * an editor can compare its state with what's actually on disk.
 */
type SaveStatusListener = (cartId: string, status: SaveStatus, error?: string, savedJson?: string) => void;

const SAVE_DELAY_MS = 2000; // 2 seconds

// Singleton state
const carts = new Map<string, CartSaveState>();
const saveListeners = new Set<SaveStatusListener>();

function stateFor(cartId: string): CartSaveState {
  let state = carts.get(cartId);
  if (!state) {
    state = { pending: null, timeoutId: null, running: null };
    carts.set(cartId, state);
  }
  return state;
}

function clearTimer(state: CartSaveState): void {
  if (state.timeoutId !== null) {
    window.clearTimeout(state.timeoutId);
    state.timeoutId = null;
  }
}

/**
 * Queue a settings save for a cartridge. Replaces any change still waiting and
 * restarts the delay.
 */
export function queueSettingsSave(
  cartId: string,
  settings: CartridgeSettings,
  sdCardPath?: string
): void {
  const state = stateFor(cartId);
  clearTimer(state);
  state.pending = { settings, sdCardPath };
  notifyListeners(cartId, 'pending');
  state.timeoutId = window.setTimeout(() => {
    state.timeoutId = null;
    void runSave(cartId);
  }, SAVE_DELAY_MS);
}

/** Drop a change that's still waiting (the user undid it). A save already running isn't stopped. */
export function cancelPendingSave(cartId: string): void {
  const state = carts.get(cartId);
  if (!state?.pending) return;
  clearTimer(state);
  state.pending = null;
  if (!state.running) notifyListeners(cartId, 'saved');
}

/** Save a failed (or waiting) change now */
export function retrySave(cartId: string): Promise<void> {
  const state = carts.get(cartId);
  if (!state?.pending) return Promise.resolve();
  clearTimer(state);
  return runSave(cartId);
}

/**
 * Save the cartridge's waiting change, after any save already running for it.
 * Resolves when nothing is left to save for this cartridge (or the save failed).
 */
async function runSave(cartId: string): Promise<void> {
  const state = stateFor(cartId);
  while (state.running) {
    await state.running;
  }
  const job = state.pending;
  if (!job) return;
  state.pending = null;

  const running = saveOnce(cartId, job).then(
    () => {
      notifyListeners(cartId, 'saved', undefined, JSON.stringify(job.settings));
    },
    (err: unknown) => {
      // Keep the change unless a newer one has replaced it
      if (!state.pending) state.pending = job;
      const message = err instanceof Error ? err.message : 'Save failed';
      console.error(`Auto-save failed for ${cartId}:`, message);
      notifyListeners(cartId, 'error', message);
    },
  );
  state.running = running;
  notifyListeners(cartId, 'saving');
  try {
    await running;
  } finally {
    if (state.running === running) state.running = null;
  }
  // A change made during the save has its own timer; nothing more to do here
}

async function saveOnce(cartId: string, job: NonNullable<CartSaveState['pending']>): Promise<void> {
  // keepalive lets the request finish if the page unloads mid-save (browser build)
  const localResponse = await fetch(`/api/cartridges/${cartId}/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(job.settings),
    keepalive: true,
  });
  if (!localResponse.ok) {
    const data = await localResponse.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to save local settings');
  }

  // If SD card connected, also save there
  if (job.sdCardPath) {
    const sdResponse = await fetch(`/api/cartridges/${cartId}/settings/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sdCardPath: job.sdCardPath }),
      keepalive: true,
    });
    if (!sdResponse.ok) {
      const data = await sdResponse.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to sync to SD card');
    }
  }
  console.log(`[Settings] Saved ${cartId}${job.sdCardPath ? ' + SD card' : ''}`);
}

/** Save every waiting change now; resolves when all saves (including running ones) are done */
export async function flushPendingSaves(): Promise<void> {
  const saves: Promise<void>[] = [];
  for (const [cartId, state] of carts) {
    clearTimer(state);
    if (state.pending) saves.push(runSave(cartId));
    else if (state.running) saves.push(state.running);
  }
  await Promise.all(saves);
}

/**
 * Subscribe to save status changes.
 * Returns an unsubscribe function.
 */
export function onSaveStatus(listener: SaveStatusListener): () => void {
  saveListeners.add(listener);
  return () => {
    saveListeners.delete(listener);
  };
}

function notifyListeners(cartId: string, status: SaveStatus, error?: string, savedJson?: string): void {
  for (const listener of saveListeners) {
    try {
      listener(cartId, status, error, savedJson);
    } catch (err) {
      console.error('Save status listener error:', err);
    }
  }
}

if (typeof window !== 'undefined') {
  // Desktop app: the main process asks for this before quitting and waits for it
  getDesktopBridge()?.onFlushSaves(flushPendingSaves);
  // Browser build: can't wait, but keepalive lets the requests finish after unload
  window.addEventListener('beforeunload', () => {
    void flushPendingSaves();
  });
}

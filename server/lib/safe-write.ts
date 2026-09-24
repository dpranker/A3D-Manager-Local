/**
 * Safe file writes, used for everything the app writes locally and to the SD card.
 *
 * - Atomic: data goes to "<name>.partial" next to the target, is flushed, then
 *   renamed over the target, and the directory is flushed. If the app closes or
 *   the card is pulled mid-write, the old file is still there, whole.
 * - Backups: keepBackup copies the file being replaced to "<name>.bak" first.
 * - Serialized: withFileLock runs read-modify-write updates of one file one at a time.
 * - JSON stores: updateJsonFile never treats an unreadable file as empty. It moves
 *   the file aside and fails, so the next save can't silently wipe it.
 * - Tracked: whenWritesIdle resolves once no write is in progress (for shutdown).
 */

import { copyFile, open, readdir, readFile, rename, stat, unlink } from 'fs/promises';
import path from 'path';
import { copyFileWithProgress, type ProgressCallback } from './file-transfer.js';

export const PARTIAL_SUFFIX = '.partial';
export const BACKUP_SUFFIX = '.bak';

export interface SafeWriteOptions {
  /** Copy the file being replaced to "<name>.bak" before replacing it */
  keepBackup?: boolean;
}

// ---------------------------------------------------------------------------
// In-flight tracking
// ---------------------------------------------------------------------------

let activeWrites = 0;
let idleWaiters: (() => void)[] = [];

async function tracked<T>(work: () => Promise<T>): Promise<T> {
  activeWrites++;
  try {
    return await work();
  } finally {
    activeWrites--;
    if (activeWrites === 0) {
      const waiters = idleWaiters;
      idleWaiters = [];
      waiters.forEach((resolve) => resolve());
    }
  }
}

/** Resolves once no safe write is in progress, or after timeoutMs (false then) */
export function whenWritesIdle(timeoutMs: number): Promise<boolean> {
  if (activeWrites === 0) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    idleWaiters.push(() => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

// ---------------------------------------------------------------------------
// Durability
// ---------------------------------------------------------------------------

/**
 * fsync a file or directory. On FAT a rename only changes the directory, which
 * the kernel otherwise writes back up to ~30s later: a card removed in that
 * window keeps the old name.
 *
 * Windows: directories can't be flushed (fsync fails with EPERM; Windows writes
 * removable-media metadata through itself), so they're skipped. Files need write
 * access to be flushed (FlushFileBuffers), so they're opened read-write.
 */
export async function syncToDisk(target: string): Promise<void> {
  const isDirectory = (await stat(target)).isDirectory();
  if (isDirectory && process.platform === 'win32') return;
  const handle = await open(target, isDirectory ? 'r' : 'r+');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function exists(target: string): Promise<boolean> {
  try {
    await (await open(target, 'r')).close();
    return true;
  } catch {
    return false;
  }
}

/** Move a finished .partial into place (backing up the old file first if asked) and make it durable */
async function commit(partialPath: string, target: string, options: SafeWriteOptions): Promise<void> {
  if (options.keepBackup && (await exists(target))) {
    // Copy, not rename: the target stays in place until the new file replaces it
    await copyFile(target, `${target}${BACKUP_SUFFIX}`);
  }
  await rename(partialPath, target);
  await syncToDisk(path.dirname(target));
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** Write data to target atomically */
export function writeFileAtomic(target: string, data: string | Buffer, options: SafeWriteOptions = {}): Promise<void> {
  return tracked(async () => {
    const partialPath = `${target}${PARTIAL_SUFFIX}`;
    try {
      const handle = await open(partialPath, 'w');
      try {
        await handle.writeFile(data);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await commit(partialPath, target, options);
    } catch (error) {
      await unlink(partialPath).catch(() => {});
      throw error;
    }
  });
}

/** Copy source to target atomically, with optional progress (e.g. labels.db to or from the card) */
export function copyFileAtomic(
  source: string,
  target: string,
  options: SafeWriteOptions & { onProgress?: ProgressCallback; throttleMs?: number } = {},
): Promise<void> {
  return tracked(async () => {
    const partialPath = `${target}${PARTIAL_SUFFIX}`;
    try {
      if (options.onProgress) {
        // Flushes the file itself before returning
        await copyFileWithProgress(source, partialPath, options.onProgress, options.throttleMs);
      } else {
        await copyFile(source, partialPath);
        await syncToDisk(partialPath);
      }
      await commit(partialPath, target, options);
    } catch (error) {
      await unlink(partialPath).catch(() => {});
      throw error;
    }
  });
}

/** Delete .partial files left by interrupted writes in dir and its subfolders */
export async function removeLeftoverPartials(dir: string): Promise<string[]> {
  const removed: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return removed;
  }
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      removed.push(...(await removeLeftoverPartials(entryPath)));
    } else if (entry.name.endsWith(PARTIAL_SUFFIX)) {
      await unlink(entryPath).catch(() => {});
      removed.push(entryPath);
    }
  }
  return removed;
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

const fileLocks = new Map<string, Promise<unknown>>();

/** Run fn with exclusive access to target among callers in this process */
export function withFileLock<T>(target: string, fn: () => Promise<T>): Promise<T> {
  const key = path.resolve(target);
  const previous = fileLocks.get(key) ?? Promise.resolve();
  const run = previous.catch(() => {}).then(fn);
  const tail = run.catch(() => {});
  fileLocks.set(key, tail);
  void tail.then(() => {
    if (fileLocks.get(key) === tail) fileLocks.delete(key);
  });
  return run;
}

// ---------------------------------------------------------------------------
// JSON stores
// ---------------------------------------------------------------------------

export class CorruptFileError extends Error {
  constructor(
    readonly filePath: string,
    readonly movedTo: string,
    cause: unknown,
  ) {
    super(
      `${path.basename(filePath)} couldn't be read, so it was kept as ${path.basename(movedTo)} and nothing was changed. ` +
        `(${cause instanceof Error ? cause.message : String(cause)})`,
    );
    this.name = 'CorruptFileError';
  }
}

/**
 * Read a JSON file. A missing file gives fallback. An unreadable one (bad JSON, or
 * failing validate) is moved to "<name>.corrupt-<time>" and CorruptFileError is thrown.
 */
export async function readJsonStrict<T>(
  target: string,
  fallback: () => T,
  validate: (value: unknown) => value is T = (value): value is T => value !== undefined,
): Promise<T> {
  let content: string;
  try {
    content = await readFile(target, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback();
    throw error;
  }
  try {
    const parsed: unknown = JSON.parse(content);
    if (!validate(parsed)) throw new Error('unexpected structure');
    return parsed;
  } catch (cause) {
    const movedTo = `${target}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    await rename(target, movedTo);
    throw new CorruptFileError(target, movedTo, cause);
  }
}

/**
 * Read, change and write a JSON file, one update at a time. change mutates the value
 * it's given; its return value is passed back to the caller.
 */
export function updateJsonFile<T, R = void>(
  target: string,
  fallback: () => T,
  change: (value: T) => R | Promise<R>,
  validate?: (value: unknown) => value is T,
): Promise<R> {
  return withFileLock(target, async () => {
    const value = await readJsonStrict(target, fallback, validate);
    const result = await change(value);
    await writeFileAtomic(target, JSON.stringify(value, null, 2));
    return result;
  });
}

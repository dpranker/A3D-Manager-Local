/**
 * Safe Write Tests
 *
 * Atomic writes and copies, backups of replaced files, per-file serialization,
 * and JSON stores that never treat an unreadable file as empty.
 */

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { test, assert, assertEqual, TestSuite } from '../utils.js';
import {
  CorruptFileError,
  copyFileAtomic,
  removeLeftoverPartials,
  updateJsonFile,
  whenWritesIdle,
  withFileLock,
  writeFileAtomic,
} from '../../server/lib/safe-write.js';

async function inTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'a3d-safe-write-'));
  try {
    await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const read = (file: string) => readFileSync(file, 'utf-8');

export const safeWriteSuite: TestSuite = {
  name: 'Safe Writes',
  tests: [
    test('writeFileAtomic replaces the file and leaves no .partial', () =>
      inTempDir(async (dir) => {
        const file = path.join(dir, 'settings.json');
        writeFileSync(file, 'old');
        await writeFileAtomic(file, 'new');
        assertEqual(read(file), 'new');
        assertEqual(readdirSync(dir).join(','), 'settings.json');
      })),

    test('keepBackup keeps the replaced file as .bak', () =>
      inTempDir(async (dir) => {
        const file = path.join(dir, 'labels.db');
        writeFileSync(file, 'v1');
        await writeFileAtomic(file, 'v2', { keepBackup: true });
        assertEqual(read(file), 'v2');
        assertEqual(read(`${file}.bak`), 'v1');
      })),

    test('keepBackup on a new file makes no .bak', () =>
      inTempDir(async (dir) => {
        const file = path.join(dir, 'labels.db');
        await writeFileAtomic(file, 'v1', { keepBackup: true });
        assert(!existsSync(`${file}.bak`), 'no backup of a file that did not exist');
      })),

    test('a failed copy leaves the destination untouched and cleans up', () =>
      inTempDir(async (dir) => {
        const dest = path.join(dir, 'controller_pak.img');
        writeFileSync(dest, 'precious save');
        let failed = false;
        try {
          await copyFileAtomic(path.join(dir, 'missing.img'), dest);
        } catch {
          failed = true;
        }
        assert(failed, 'copy of a missing source fails');
        assertEqual(read(dest), 'precious save');
        assert(!existsSync(`${dest}.partial`), 'partial removed');
      })),

    test('copyFileAtomic with progress copies and reports completion', () =>
      inTempDir(async (dir) => {
        const source = path.join(dir, 'source.db');
        const dest = path.join(dir, 'card', 'labels.db');
        mkdirSync(path.dirname(dest));
        writeFileSync(source, Buffer.alloc(300_000, 7));
        writeFileSync(dest, 'old');
        let last = 0;
        await copyFileAtomic(source, dest, { onProgress: (p) => (last = p.percentage), keepBackup: true });
        assertEqual(readFileSync(dest).length, 300_000);
        assertEqual(read(`${dest}.bak`), 'old');
        assertEqual(last, 100);
      })),

    test('removeLeftoverPartials deletes only .partial files, in subfolders too', () =>
      inTempDir(async (dir) => {
        mkdirSync(path.join(dir, 'Games', 'Cart 12345678'), { recursive: true });
        writeFileSync(path.join(dir, 'labels.db.partial'), 'x');
        writeFileSync(path.join(dir, 'Games', 'Cart 12345678', 'settings.json.partial'), 'x');
        writeFileSync(path.join(dir, 'Games', 'Cart 12345678', 'settings.json'), 'keep');
        const removed = await removeLeftoverPartials(dir);
        assertEqual(removed.length, 2);
        assertEqual(read(path.join(dir, 'Games', 'Cart 12345678', 'settings.json')), 'keep');
      })),

    test('withFileLock runs updates of one file one at a time', async () => {
      const order: string[] = [];
      const slow = (label: string, ms: number) =>
        withFileLock('/tmp/a3d-lock-test', async () => {
          order.push(`${label} start`);
          await new Promise((r) => setTimeout(r, ms));
          order.push(`${label} end`);
        });
      await Promise.all([slow('a', 20), slow('b', 1), slow('c', 1)]);
      assertEqual(order.join(','), 'a start,a end,b start,b end,c start,c end');
    }),

    test('withFileLock keeps going after a failed update', async () => {
      const failing = withFileLock('/tmp/a3d-lock-test-2', async () => {
        throw new Error('boom');
      });
      const next = withFileLock('/tmp/a3d-lock-test-2', async () => 'ran');
      let failed = false;
      await failing.catch(() => (failed = true));
      assert(failed, 'first update rejects');
      assertEqual(await next, 'ran');
    }),

    test('simultaneous updateJsonFile changes all persist (lost-update repro)', () =>
      inTempDir(async (dir) => {
        const file = path.join(dir, 'owned-carts.json');
        const empty = () => ({ version: 1, cartridges: [] as string[] });
        await Promise.all(
          ['aaaaaaaa', 'bbbbbbbb', 'cccccccc'].map((id) =>
            updateJsonFile(file, empty, (data) => {
              data.cartridges.push(id);
            }),
          ),
        );
        assertEqual(JSON.parse(read(file)).cartridges.sort().join(','), 'aaaaaaaa,bbbbbbbb,cccccccc');
      })),

    test('updateJsonFile moves an unreadable file aside and changes nothing', () =>
      inTempDir(async (dir) => {
        const file = path.join(dir, 'user-carts.json');
        writeFileSync(file, '[{"id": "12345678", "name": "Custom"'); // truncated
        let error: unknown;
        try {
          await updateJsonFile(file, () => [] as unknown[], (entries) => {
            entries.push({ id: 'ffffffff' });
          });
        } catch (e) {
          error = e;
        }
        assert(error instanceof CorruptFileError, 'CorruptFileError thrown');
        assert(!existsSync(file), 'original moved aside, not overwritten');
        const kept = readdirSync(dir).find((name) => name.startsWith('user-carts.json.corrupt-'));
        assert(!!kept, 'corrupt copy kept');
        assertEqual(read(path.join(dir, kept!)), '[{"id": "12345678", "name": "Custom"');
      })),

    test('updateJsonFile rejects a file that fails validation', () =>
      inTempDir(async (dir) => {
        const file = path.join(dir, 'owned-carts.json');
        writeFileSync(file, '{"version": 1}');
        const isData = (v: unknown): v is { cartridges: string[] } => Array.isArray((v as { cartridges?: unknown }).cartridges);
        let failed = false;
        await updateJsonFile(file, () => ({ cartridges: [] as string[] }), () => {}, isData).catch(() => (failed = true));
        assert(failed, 'invalid structure is not treated as empty');
      })),

    test('whenWritesIdle waits for writes in progress', () =>
      inTempDir(async (dir) => {
        const write = writeFileAtomic(path.join(dir, 'big.bin'), Buffer.alloc(2_000_000));
        const idle = await whenWritesIdle(5000);
        await write;
        assert(idle, 'idle before timeout');
        assert(await whenWritesIdle(0), 'idle immediately with nothing running');
      })),
  ],
};

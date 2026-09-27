/**
 * SD Card Configuration Tests
 *
 * Tests for SD card detection and volume path configuration.
 */

import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { test, assert, assertEqual, TestSuite } from '../utils.js';
import { defaultSearchRoots, detectSDCards, getSearchRoots } from '../../server/lib/sd-card.js';
import { ensureSdGameFolder } from '../../server/lib/cartridge-settings.js';
import { sdCardPathGuard } from '../../server/lib/request-guards.js';

/** A card with just library.db, as the path check needs */
function makeCard(): string {
  const card = mkdtempSync(path.join(os.tmpdir(), 'a3d-card-'));
  mkdirSync(path.join(card, 'Library', 'N64', 'Games'), { recursive: true });
  writeFileSync(path.join(card, 'Library', 'N64', 'library.db'), '');
  return card;
}

/** Run fn with SD_VOLUMES_PATH set to value (unset if undefined), then restore it */
async function withVolumesPath(value: string | undefined, fn: () => void | Promise<void>): Promise<void> {
  const original = process.env.SD_VOLUMES_PATH;
  if (value === undefined) delete process.env.SD_VOLUMES_PATH;
  else process.env.SD_VOLUMES_PATH = value;
  try {
    await fn();
  } finally {
    if (original === undefined) delete process.env.SD_VOLUMES_PATH;
    else process.env.SD_VOLUMES_PATH = original;
  }
}

/** Run the guard with a fake request; returns the status it sent, or 'next' */
async function runGuard(query: Record<string, unknown>, body?: Record<string, unknown>): Promise<number | 'next'> {
  let outcome: number | 'next' = 'next';
  const res = { status: (code: number) => ({ json: () => { outcome = code; } }) };
  await sdCardPathGuard({ query, body } as never, res as never, () => {});
  return outcome;
}

export const sdCardSuite: TestSuite = {
  name: 'SD Card Configuration',
  tests: [
    // =========================================================================
    // Where cards are searched for
    // =========================================================================

    test('getSearchRoots puts the chosen folder first, then the platform defaults', () =>
      withVolumesPath('/mnt/cards', () => {
        const roots = getSearchRoots();
        assertEqual(roots[0].path, '/mnt/cards');
        assert(roots[0].scanChildren, 'chosen folder may be a parent of cards');
        assertEqual(roots.length, 1 + defaultSearchRoots().length);
      })),

    test('getSearchRoots without a chosen folder is the platform defaults, without duplicates', () =>
      withVolumesPath(undefined, () => {
        assertEqual(getSearchRoots().length, defaultSearchRoots().length);
      })),

    test('defaultSearchRoots covers each platform\'s removable-media locations', () => {
      assertEqual(defaultSearchRoots('darwin').map((r) => r.path).join(), '/Volumes');

      const linux = defaultSearchRoots('linux').map((r) => r.path);
      const user = os.userInfo().username;
      for (const dir of [`/run/media/${user}`, `/media/${user}`, '/run/media', '/media']) {
        assert(linux.includes(dir), `linux searches ${dir}`);
      }

      const windows = defaultSearchRoots('win32');
      assert(windows.some((r) => r.path === 'E:\\'), 'windows searches drive roots');
      assert(!windows.some((r) => r.path.startsWith('A:')), 'windows skips floppy letters');
      assert(windows.every((r) => !r.scanChildren), 'windows only checks each drive itself');
    }),

    test('detectSDCards finds a card inside the chosen folder, once', async () => {
      const parent = mkdtempSync(path.join(os.tmpdir(), 'a3d-volumes-'));
      const card = path.join(parent, 'ANALOGUE 3D');
      mkdirSync(path.join(card, 'Library', 'N64'), { recursive: true });
      writeFileSync(path.join(card, 'Library', 'N64', 'library.db'), '');
      try {
        await withVolumesPath(parent, async () => {
          const found = (await detectSDCards()).filter((c) => c.path === card);
          assertEqual(found.length, 1);
          assertEqual(found[0].name, 'ANALOGUE 3D');
        });
        await withVolumesPath(card, async () => {
          assertEqual((await detectSDCards())[0].path, card);
        });
      } finally {
        rmSync(parent, { recursive: true, force: true });
      }
    }),

    // =========================================================================
    // Card game folders
    // =========================================================================

    test('ensureSdGameFolder names a new folder from the cart database', async () => {
      const card = makeCard();
      try {
        const folder = await ensureSdGameFolder(card, 'D827B5D2');
        assertEqual(path.basename(folder), 'Buck Bumble (USA) d827b5d2');
      } finally {
        rmSync(card, { recursive: true, force: true });
      }
    }),

    test('ensureSdGameFolder names carts outside the database like the console', async () => {
      const card = makeCard();
      try {
        const folder = await ensureSdGameFolder(card, 'f85b926b');
        assertEqual(path.basename(folder), 'Unknown Cartridge f85b926b');
      } finally {
        rmSync(card, { recursive: true, force: true });
      }
    }),

    test('ensureSdGameFolder reuses the existing folder whatever its title', async () => {
      const card = makeCard();
      try {
        const games = path.join(card, 'Library', 'N64', 'Games');
        mkdirSync(path.join(games, 'Buck Bumble d827b5d2'));
        const folder = await ensureSdGameFolder(card, 'd827b5d2');
        assertEqual(path.basename(folder), 'Buck Bumble d827b5d2');
        assertEqual(readdirSync(games).length, 1);
      } finally {
        rmSync(card, { recursive: true, force: true });
      }
    }),

    // =========================================================================
    // sdCardPath check
    // =========================================================================

    test('sdCardPathGuard lets a real card and no card through', async () => {
      const card = makeCard();
      try {
        assertEqual(await runGuard({ sdCardPath: card }), 'next');
        assertEqual(await runGuard({}, { sdCardPath: card }), 'next');
        assertEqual(await runGuard({}), 'next');
      } finally {
        rmSync(card, { recursive: true, force: true });
      }
    }),

    test('sdCardPathGuard rejects folders that are not a card, and relative paths', async () => {
      const notACard = mkdtempSync(path.join(os.tmpdir(), 'a3d-not-card-'));
      try {
        assertEqual(await runGuard({ sdCardPath: notACard }), 400);
        assertEqual(await runGuard({}, { sdCardPath: notACard }), 400);
        assertEqual(await runGuard({ sdCardPath: 'Library/..' }), 400);
        assertEqual(await runGuard({ sdCardPath: ['a', 'b'] }), 400);
        assert(true, 'no exception');
      } finally {
        rmSync(notACard, { recursive: true, force: true });
      }
    }),
  ],
};

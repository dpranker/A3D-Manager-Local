/**
 * SD Card Configuration Tests
 *
 * Tests for SD card detection and volume path configuration.
 */

import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { test, assert, assertEqual, TestSuite } from '../utils.js';
import { getVolumesPath } from '../../server/lib/sd-card.js';
import { ensureSdGameFolder } from '../../server/lib/cartridge-settings.js';
import { sdCardPathGuard, webOriginGuard } from '../../server/lib/request-guards.js';

/** Run the web-mode guard with the given headers; returns the status it sent, or 'next' */
function runWebGuard(headers: Record<string, string>): number | 'next' {
  let outcome: number | 'next' = 'next';
  const res = { status: (code: number) => ({ json: () => { outcome = code; } }) };
  webOriginGuard({ headers } as never, res as never, () => {});
  return outcome;
}

/** A card with just library.db, as the path check needs */
function makeCard(): string {
  const card = mkdtempSync(path.join(os.tmpdir(), 'a3d-card-'));
  mkdirSync(path.join(card, 'Library', 'N64', 'Games'), { recursive: true });
  writeFileSync(path.join(card, 'Library', 'N64', 'library.db'), '');
  return card;
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
    // Volumes Path Configuration
    // =========================================================================

    test('getVolumesPath returns default /Volumes/ANALOGUE 3D when env var not set', () => {
      const original = process.env.SD_VOLUMES_PATH;
      delete process.env.SD_VOLUMES_PATH;

      try {
        assertEqual(getVolumesPath(), '/Volumes/ANALOGUE 3D');
      } finally {
        // Restore original value
        if (original !== undefined) {
          process.env.SD_VOLUMES_PATH = original;
        }
      }
    }),

    test('getVolumesPath returns custom path from SD_VOLUMES_PATH env var', () => {
      const original = process.env.SD_VOLUMES_PATH;
      process.env.SD_VOLUMES_PATH = '/media';

      try {
        assertEqual(getVolumesPath(), '/media');
      } finally {
        // Restore original value
        if (original !== undefined) {
          process.env.SD_VOLUMES_PATH = original;
        } else {
          delete process.env.SD_VOLUMES_PATH;
        }
      }
    }),

    test('getVolumesPath supports specific SD card path', () => {
      const original = process.env.SD_VOLUMES_PATH;
      process.env.SD_VOLUMES_PATH = '/Volumes/ANALOGUE3D';

      try {
        assertEqual(getVolumesPath(), '/Volumes/ANALOGUE3D');
      } finally {
        // Restore original value
        if (original !== undefined) {
          process.env.SD_VOLUMES_PATH = original;
        } else {
          delete process.env.SD_VOLUMES_PATH;
        }
      }
    }),

    test('getVolumesPath supports Linux media paths', () => {
      const original = process.env.SD_VOLUMES_PATH;
      process.env.SD_VOLUMES_PATH = '/run/media/user';

      try {
        assertEqual(getVolumesPath(), '/run/media/user');
      } finally {
        // Restore original value
        if (original !== undefined) {
          process.env.SD_VOLUMES_PATH = original;
        } else {
          delete process.env.SD_VOLUMES_PATH;
        }
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

    // =========================================================================
    // Browser/Docker mode guard
    // =========================================================================

    test('webOriginGuard allows the app on loopback and IP addresses', () => {
      assertEqual(runWebGuard({ host: 'localhost:3001' }), 'next');
      assertEqual(runWebGuard({ host: '127.0.0.1:3001', origin: 'http://127.0.0.1:3001' }), 'next');
      assertEqual(runWebGuard({ host: '[::1]:3001' }), 'next');
      assertEqual(runWebGuard({ host: '192.168.1.20:3001', origin: 'http://192.168.1.20:3001' }), 'next');
      // Vite dev server proxying to the API
      assertEqual(runWebGuard({ host: 'localhost:3001', origin: 'http://localhost:5173' }), 'next');
    }),

    test('webOriginGuard refuses other websites and rebinding hosts', () => {
      assertEqual(runWebGuard({ host: 'localhost:3001', origin: 'https://evil.example' }), 403);
      assertEqual(runWebGuard({ host: 'evil.example:3001', origin: 'http://evil.example:3001' }), 403);
      assertEqual(runWebGuard({ host: 'localhost:3001', origin: 'null' }), 403);
      assertEqual(runWebGuard({}), 403);
    }),

    test('webOriginGuard allows host names listed in A3D_ALLOWED_HOSTS', () => {
      const original = process.env.A3D_ALLOWED_HOSTS;
      process.env.A3D_ALLOWED_HOSTS = 'nas.local, a3d.lan';
      try {
        assertEqual(runWebGuard({ host: 'nas.local:3001', origin: 'http://nas.local:3001' }), 'next');
        assertEqual(runWebGuard({ host: 'a3d.lan' }), 'next');
        assertEqual(runWebGuard({ host: 'other.lan' }), 403);
      } finally {
        if (original === undefined) delete process.env.A3D_ALLOWED_HOSTS;
        else process.env.A3D_ALLOWED_HOSTS = original;
      }
    }),
  ],
};

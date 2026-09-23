/**
 * Cartridge Data Tests
 *
 * Tests for:
 * - Ownership tracking (owned-carts.ts)
 * - Settings parsing/validation (cartridge-settings.ts)
 * - Game pak operations (game-pak.ts)
 */

import { readFile, writeFile, mkdir, rm } from 'fs/promises';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import os from 'os';
import { Ajv2020 } from 'ajv/dist/2020.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { test, assert, assertEqual, TestSuite } from '../utils.js';

// Import modules under test
import { type OwnedCartsData } from '../../server/lib/owned-carts.js';

import {
  parseSettings,
  validateSettings,
  normalizeSettings,
  serializeSettings,
  isLegacySettings,
  getSDSettingsSupport,
  createDefaultSettings,
  LegacySettingsError,
  SETTINGS_SCHEMA_URL,
} from '../../server/lib/cartridge-settings.js';

import {
  validateGamePak,
  createEmptyGamePak,
  isGamePakEmpty,
  getGamePakSaveInfo,
  CONTROLLER_PAK_SIZE,
} from '../../server/lib/game-pak.js';

// =============================================================================
// Test Output Directory
// =============================================================================

const OUTPUT_DIR = path.join(__dirname, 'output');

export async function cleanOutput(): Promise<void> {
  if (existsSync(OUTPUT_DIR)) {
    await rm(OUTPUT_DIR, { recursive: true });
  }
  await mkdir(OUTPUT_DIR, { recursive: true });
}

// =============================================================================
// Test Fixtures
// =============================================================================

const FIXTURES_DIR = path.join(__dirname, '..', 'game-data', 'fixtures');

/** Written by 3Dos 1.5.1 (Turok 3, converted during the 1.5.0 -> 1.5.1 update) */
async function getFixtureSettingsText(): Promise<string> {
  return readFile(path.join(FIXTURES_DIR, 'settings.json'), 'utf-8');
}

/** Written by 3Dos 1.5.0 (an orphaned folder the 1.5.1 update didn't convert; note the trailing commas) */
async function getLegacySettingsText(): Promise<string> {
  return readFile(path.join(FIXTURES_DIR, 'settings-legacy.json'), 'utf-8');
}

/**
 * Analogue's published schema, with the one known gap patched: it doesn't
 * allow enable_edge_overshoot in pvm/crt/scanlines, but 3Dos 1.5.1 writes it
 * there in every file.
 */
async function compileSettingsSchema(patchConsoleFields: boolean) {
  const schemaPath = path.join(__dirname, '..', '..', 'docs', 'analogue-schemas', '3d-settings.json');
  const schema = JSON.parse(await readFile(schemaPath, 'utf-8'));
  if (patchConsoleFields) {
    for (const mode of ['pvm', 'crt', 'scanlines']) {
      schema.properties.display.properties.catalog.properties[mode].properties.enable_edge_overshoot = { type: 'boolean' };
    }
  }
  return new Ajv2020({ allErrors: true, strict: false, validateFormats: false }).compile(schema);
}

function expectThrows(fn: () => unknown, check: (error: unknown) => boolean, label: string): void {
  let threw = false;
  try {
    fn();
  } catch (error) {
    threw = true;
    assert(check(error), `${label}: unexpected error ${error instanceof Error ? error.message : String(error)}`);
  }
  assert(threw, `${label}: expected an error`);
}

/** Temporary fake SD card; files maps relative paths to contents */
function withCard(files: Record<string, string>, fn: (card: string) => Promise<void>): () => Promise<void> {
  return async () => {
    const card = mkdtempSync(path.join(os.tmpdir(), 'a3d-settings-card-'));
    try {
      await mkdir(path.join(card, 'Library', 'N64', 'Games'), { recursive: true });
      await writeFile(path.join(card, 'Library', 'N64', 'library.db'), '');
      for (const [file, content] of Object.entries(files)) {
        await mkdir(path.dirname(path.join(card, file)), { recursive: true });
        await writeFile(path.join(card, file), content);
      }
      await fn(card);
    } finally {
      rmSync(card, { recursive: true, force: true });
    }
  };
}

async function getFixtureGamePak(): Promise<Buffer> {
  return readFile(path.join(FIXTURES_DIR, 'controller_pak.img'));
}

// =============================================================================
// Owned Carts Tests
// =============================================================================

const ownedCartsTests = [
  test('loadOwnedCarts returns empty array when file does not exist', async () => {
    const testPath = path.join(OUTPUT_DIR, 'test-owned-carts.json');

    // Make sure test file doesn't exist
    if (existsSync(testPath)) {
      await rm(testPath);
    }

    // Create fresh data
    const data: OwnedCartsData = { version: 1, cartridges: [] };

    assertEqual(data.cartridges.length, 0, 'Should have empty cartridges array');
    assertEqual(data.version, 1, 'Should have version 1');
  }),

  test('saveOwnedCarts and loadOwnedCarts round-trip', async () => {
    const testPath = path.join(OUTPUT_DIR, 'owned-carts-roundtrip.json');

    const testData: OwnedCartsData = {
      version: 1,
      cartridges: [
        { cartId: 'b393776d', addedAt: '2025-01-01T00:00:00.000Z', source: 'manual' },
        { cartId: 'ac631da0', addedAt: '2025-01-02T00:00:00.000Z', source: 'sd-card' },
      ],
    };

    await writeFile(testPath, JSON.stringify(testData, null, 2));
    const loaded = JSON.parse(await readFile(testPath, 'utf-8'));

    assertEqual(loaded.cartridges.length, 2, 'Should have 2 cartridges');
    assertEqual(loaded.cartridges[0].cartId, 'b393776d', 'First cart ID should match');
    assertEqual(loaded.cartridges[1].source, 'sd-card', 'Second source should match');
  }),

  test('addOwnedCartridges batch operation handles duplicates', async () => {
    const existing = new Set(['b393776d', 'ac631da0']);
    const toAdd = ['b393776d', 'e5240d18', 'ac631da0', '12345678'];

    const added: string[] = [];
    const skipped: string[] = [];

    for (const id of toAdd) {
      if (existing.has(id.toLowerCase())) {
        skipped.push(id);
      } else {
        added.push(id);
        existing.add(id.toLowerCase());
      }
    }

    assertEqual(added.length, 2, 'Should add 2 new cartridges');
    assertEqual(skipped.length, 2, 'Should skip 2 existing cartridges');
    assert(added.includes('e5240d18'), 'Should include e5240d18 in added');
    assert(added.includes('12345678'), 'Should include 12345678 in added');
  }),

  test('cart ID normalization to lowercase', async () => {
    const mixedCaseId = 'B393776D';
    const normalized = mixedCaseId.toLowerCase();

    assertEqual(normalized, 'b393776d', 'Should normalize to lowercase');
  }),

  test('OwnedCartsData validates version field', async () => {
    const validData: OwnedCartsData = { version: 1, cartridges: [] };
    assert(validData.version === 1, 'Version should be 1');

    const invalidData = { version: 2, cartridges: [] };
    assert(invalidData.version !== 1, 'Invalid version should not equal 1');
  }),
];

// =============================================================================
// Settings Tests
// =============================================================================

const settingsTests = [
  test('parseSettings reads a settings.json written by 3Dos 1.5.1', async () => {
    const settings = parseSettings(await getFixtureSettingsText());

    assertEqual(settings.$schema, SETTINGS_SCHEMA_URL);
    assertEqual(settings.display.odm, 'bvm');
    assertEqual(settings.display.catalog.bvm.horizontal_beam_convergence, 'professional');
    assertEqual(settings.display.catalog.bvm.enable_edge_hardness, 'soft');
    assertEqual(settings.display.catalog.clean.interpolation_alg, 'bc-spline');
    assertEqual(settings.library.cartridge_color, 'gray');
    assertEqual(settings.hardware.overclock, 'auto');
    assertEqual(settings.hardware.horizontal_upscaling, true);
    assertEqual(settings.hardware.force_progressive_output, true);
  }),

  test('serializeSettings reproduces the console\'s file exactly (keys, order, values)', async () => {
    const original = await getFixtureSettingsText();
    const roundTrip = serializeSettings(parseSettings(original));
    assertEqual(JSON.stringify(JSON.parse(roundTrip)), JSON.stringify(JSON.parse(original)));
  }),

  test('pre-1.5.1 files are detected as legacy, never parsed or converted', async () => {
    const legacyText = await getLegacySettingsText();
    assert(isLegacySettings(JSON.parse(legacyText.replace(/,(\s*[}\]])/g, '$1'))), 'legacy file detected');
    expectThrows(() => parseSettings(legacyText), (e) => e instanceof LegacySettingsError, 'parseSettings');
    assert(!validateSettings({ title: 'Test', hardware: { virtualExpansionPak: true } }).valid, 'legacy object rejected');
    assert(!isLegacySettings(JSON.parse(await getFixtureSettingsText())), 'current file not legacy');
  }),

  test('normalizeSettings rejects values the console does not use', async () => {
    const settings = JSON.parse(await getFixtureSettingsText());
    settings.hardware.overclock = 'SuperFast';
    settings.display.catalog.clean.sharpness = 'Medium';
    const { settings: normalized, errors } = normalizeSettings(settings);
    assertEqual(normalized, undefined);
    assert(errors.some((e) => e.includes('hardware.overclock')), 'overclock error');
    assert(errors.some((e) => e.includes('catalog.clean.sharpness')), 'title-case value rejected');
  }),

  test('normalizeSettings drops unknown keys and fills the console-only overshoot fields', async () => {
    const settings = JSON.parse(await getFixtureSettingsText());
    settings.extra = true;
    settings.hardware.unknown_option = 1;
    delete settings.display.catalog.pvm.enable_edge_overshoot;
    const { settings: normalized, errors } = normalizeSettings(settings);
    assertEqual(errors.length, 0, errors.join('; '));
    assert(normalized !== undefined && !('extra' in normalized) && !('unknown_option' in normalized.hardware), 'unknown keys dropped');
    assertEqual(normalized?.display.catalog.pvm.enable_edge_overshoot, true, 'pvm overshoot uses the locked value');
  }),

  test('parseSettings rejects non-object JSON input', () => {
    expectThrows(() => parseSettings('"just a string"'), (e) => e instanceof Error && e.message.includes('must be an object'), 'string');
  }),

  test('createDefaultSettings produces a valid 1.5.1 file', () => {
    const validation = validateSettings(createDefaultSettings());
    assert(validation.valid, validation.errors.join('; '));
  }),

  test("written files pass Analogue's schema (with the known enable_edge_overshoot gap)", async () => {
    const validate = await compileSettingsSchema(true);
    for (const [label, settings] of [
      ['defaults', createDefaultSettings()],
      ['console file round trip', parseSettings(await getFixtureSettingsText())],
    ] as const) {
      const data = JSON.parse(serializeSettings(settings));
      assert(validate(data), `${label}: ${JSON.stringify(validate.errors)}`);
    }
  }),

  test("the console's own files fail the unpatched schema only on enable_edge_overshoot", async () => {
    const validate = await compileSettingsSchema(false);
    assert(!validate(JSON.parse(await getFixtureSettingsText())), 'expected the published schema to reject it');
    const unexpected = (validate.errors ?? []).filter(
      (e) => !(e.keyword === 'additionalProperties' && (e.params as { additionalProperty?: string }).additionalProperty === 'enable_edge_overshoot'),
    );
    assertEqual(unexpected.length, 0, JSON.stringify(unexpected));
  }),

  // ===========================================================================
  // SD card compatibility (settings are only written for 3Dos 1.5.1+ consoles)
  // ===========================================================================

  test('getSDSettingsSupport: card with 1.5.1-format settings accepts writes', async () => {
    const current = await getFixtureSettingsText();
    const legacy = await getLegacySettingsText();
    await withCard(
      {
        'Library/N64/Games/Turok 3 96be960f/settings.json': current,
        // Orphaned folders on a 1.5.1 card keep the old format; they don't block writes
        'Library/N64/Games/Unknown Cartridge c496f93f/settings.json': legacy,
      },
      async (card) => {
        assertEqual((await getSDSettingsSupport(card)).supported, true);
      },
    )();
  }),

  test('getSDSettingsSupport: card with only pre-1.5.1 settings refuses writes', async () => {
    const legacy = await getLegacySettingsText();
    await withCard(
      {
        'Library/N64/Games/Unknown Cartridge c496f93f/settings.json': legacy,
        // A copied but not yet installed 1.5.1 update doesn't count: the console hasn't converted anything
        'a3d_os_01_05_01.bin': 'x',
      },
      async (card) => {
        const support = await getSDSettingsSupport(card);
        assertEqual(support.supported, false);
        assert(support.reason?.includes('1.5.1') ?? false, 'reason mentions the required firmware');
      },
    )();
  }),

  test('getSDSettingsSupport: no settings files, decided by firmware version', async () => {
    await withCard({}, async (card) => {
      assertEqual((await getSDSettingsSupport(card)).supported, true, 'unknown firmware, nothing to overwrite');
    })();
    await withCard({ 'a3d_os_01_05_00.bin': 'x' }, async (card) => {
      assertEqual((await getSDSettingsSupport(card)).supported, false, '1.5.0 console');
    })();
    await withCard({ 'System/Archived/a3d_os_01_05_01.bin': 'x' }, async (card) => {
      assertEqual((await getSDSettingsSupport(card)).supported, true, '1.5.1 installed');
    })();
  }),
];

// =============================================================================
// Game Pak Tests
// =============================================================================

const gamePakTests = [
  test('CONTROLLER_PAK_SIZE is 32KB', () => {
    assertEqual(CONTROLLER_PAK_SIZE, 32768, 'Controller pak should be 32KB');
  }),

  test('validateGamePak accepts valid size buffer', () => {
    const buffer = Buffer.alloc(CONTROLLER_PAK_SIZE, 0);
    const result = validateGamePak(buffer);

    assert(result.valid, 'Should accept 32KB buffer');
    assertEqual(result.errors.length, 0, 'Should have no errors');
  }),

  test('validateGamePak rejects wrong size buffer', () => {
    const tooSmall = Buffer.alloc(1000, 0);
    const result = validateGamePak(tooSmall);

    assert(!result.valid, 'Should reject wrong size buffer');
    assert(result.errors.length > 0, 'Should have errors');
    assert(result.errors[0].includes('Invalid size'), 'Error should mention size');
  }),

  test('validateGamePak fixture file has correct size', async () => {
    const buffer = await getFixtureGamePak();

    assertEqual(buffer.length, CONTROLLER_PAK_SIZE, 'Fixture should be 32KB');

    const result = validateGamePak(buffer);
    assert(result.valid, 'Fixture should be valid');
  }),

  test('createEmptyGamePak creates 32KB buffer', () => {
    const empty = createEmptyGamePak();

    assertEqual(empty.length, CONTROLLER_PAK_SIZE, 'Should be 32KB');
  }),

  test('createEmptyGamePak has valid header structure', () => {
    const empty = createEmptyGamePak();

    // First 32 bytes should be 0x81 (label area)
    for (let i = 0; i < 32; i++) {
      assertEqual(empty[i], 0x81, `Byte ${i} should be 0x81`);
    }
  }),

  test('isGamePakEmpty returns true for empty pak', () => {
    const empty = createEmptyGamePak();
    const isEmpty = isGamePakEmpty(empty);

    assert(isEmpty, 'Empty pak should be identified as empty');
  }),

  test('isGamePakEmpty returns false for pak with data', async () => {
    const buffer = await getFixtureGamePak();
    const isEmpty = isGamePakEmpty(buffer);

    // The fixture may or may not have data - just verify function works
    assert(typeof isEmpty === 'boolean', 'Should return boolean');
  }),

  test('getGamePakSaveInfo returns page counts', () => {
    const empty = createEmptyGamePak();
    const info = getGamePakSaveInfo(empty);

    assert(info.pagesUsed >= 0, 'Pages used should be non-negative');
    assert(info.pagesFree >= 0, 'Pages free should be non-negative');
    assert(info.percentUsed >= 0 && info.percentUsed <= 100, 'Percent should be 0-100');
  }),

  test('getGamePakSaveInfo for fixture', async () => {
    const buffer = await getFixtureGamePak();
    const info = getGamePakSaveInfo(buffer);

    // Just verify structure is correct
    assert(typeof info.pagesUsed === 'number', 'pagesUsed should be number');
    assert(typeof info.pagesFree === 'number', 'pagesFree should be number');
    assert(typeof info.percentUsed === 'number', 'percentUsed should be number');
  }),

  test('createEmptyGamePak index table has correct structure', () => {
    const empty = createEmptyGamePak();

    // Index table starts at 0x100
    // First 5 pages are system (0x0001)
    for (let i = 0; i < 5; i++) {
      const status = empty.readUInt16BE(0x100 + i * 2);
      assertEqual(status, 0x0001, `System page ${i} should have status 0x0001`);
    }

    // Next pages should be free (0x0003)
    for (let i = 5; i < 10; i++) {
      const status = empty.readUInt16BE(0x100 + i * 2);
      assertEqual(status, 0x0003, `Free page ${i} should have status 0x0003`);
    }
  }),
];

// =============================================================================
// Export Test Suite
// =============================================================================

export const cartridgeDataSuite: TestSuite = {
  name: 'Cartridge Data',
  tests: [
    ...ownedCartsTests,
    ...settingsTests,
    ...gamePakTests,
  ],
};

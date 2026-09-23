/**
 * library.json Tests
 *
 * Parsing, validation and serialization of per-game library.json (3Dos 1.5.1+),
 * checked against a file written by the console and Analogue's JSON schema.
 */

import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { test, assert, assertEqual, TestSuite } from '../utils.js';
import {
  createDefaultLibrary,
  normalizeLibrary,
  parseLibrary,
  serializeLibrary,
  MAX_TITLE_LENGTH,
} from '../../server/lib/library-json.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Written by 3Dos 1.5.1 for an unknown cartridge during the 1.5.0 -> 1.5.1 update */
const CONSOLE_FILE = readFileSync(path.join(__dirname, '..', 'game-data', 'fixtures', 'library.json'), 'utf-8');
const SCHEMA = JSON.parse(readFileSync(path.join(__dirname, '..', '..', 'docs', 'analogue-schemas', '3d-library.json'), 'utf-8'));
const validateSchema = new Ajv2020({ allErrors: true, strict: false, validateFormats: false }).compile(SCHEMA);

function withData(changes: Record<string, unknown>): unknown {
  const file = JSON.parse(CONSOLE_FILE);
  return { ...file, data: { ...file.data, ...changes } };
}

function expectInvalid(input: unknown, fieldHint: string): void {
  const { library, errors } = normalizeLibrary(input);
  assertEqual(library, undefined, `${fieldHint} should be rejected`);
  assert(errors.some((e) => e.includes(fieldHint)), `expected an error about ${fieldHint}, got: ${errors.join('; ')}`);
}

export const libraryJsonSuite: TestSuite = {
  name: 'library.json',
  tests: [
    test("the console's own file passes Analogue's schema", () => {
      assert(validateSchema(JSON.parse(CONSOLE_FILE)), JSON.stringify(validateSchema.errors));
    }),

    test('parseLibrary + serializeLibrary reproduce the console file exactly', () => {
      const roundTrip = serializeLibrary(parseLibrary(CONSOLE_FILE));
      assertEqual(JSON.stringify(JSON.parse(roundTrip)), JSON.stringify(JSON.parse(CONSOLE_FILE)));
    }),

    test("createDefaultLibrary matches the console's placeholder (apart from the year)", () => {
      const console_ = JSON.parse(CONSOLE_FILE);
      const ours = createDefaultLibrary();
      assertEqual(JSON.stringify(ours.defaults), JSON.stringify(console_.defaults));
      assertEqual(JSON.stringify({ ...ours.data, release_year: 0 }), JSON.stringify({ ...console_.data, release_year: 0 }));
      assertEqual(ours.data.release_year, new Date().getFullYear());
    }),

    test('edited files pass the schema and keep the key order', () => {
      const edited = withData({
        title: 'Custom Homebrew',
        revision: 1,
        player_count: 4,
        accessories: ['rumble-pak', 'controller-pak'],
        region: ['usa', 'japan'],
        developers: ['Acme Inc', ' '],
        publishers: [],
        release_year: 1999,
      });
      const { library, errors } = normalizeLibrary(edited);
      assertEqual(errors.length, 0, errors.join('; '));
      const written = JSON.parse(serializeLibrary(library!));
      assert(validateSchema(written), JSON.stringify(validateSchema.errors));
      assertEqual(Object.keys(written.data).join(','), 'title,revision,player_count,accessories,region,developers,publishers,release_year');
      assertEqual(written.data.accessories.join(','), 'controller-pak,rumble-pak', 'schema order');
      assertEqual(written.data.region.join(','), 'japan,usa', 'schema order');
      assertEqual(written.data.developers.join(','), 'Acme Inc', 'blank names dropped');
    }),

    test('title is required and limited to 127 characters', () => {
      expectInvalid(withData({ title: '   ' }), 'data.title');
      expectInvalid(withData({ title: 'x'.repeat(MAX_TITLE_LENGTH + 1) }), 'data.title');
      assertEqual(normalizeLibrary(withData({ title: 'x'.repeat(MAX_TITLE_LENGTH) })).errors.length, 0);
    }),

    test("limits from Analogue's docs: up to 4 players and 5 accessories", () => {
      expectInvalid(withData({ player_count: 5 }), 'data.player_count');
      expectInvalid(withData({ player_count: 0 }), 'data.player_count');
      expectInvalid(
        withData({ accessories: ['controller-pak', 'expansion-pak', 'rumble-pak', 'transfer-pak', 'n64-mouse', 'bio-sensor'] }),
        'data.accessories',
      );
    }),

    test('values outside the schema are rejected (incl. the docs-only "portugal" region)', () => {
      expectInvalid(withData({ region: ['portugal'] }), 'data.region');
      expectInvalid(withData({ accessories: ['power-glove'] }), 'data.accessories');
      expectInvalid(withData({ revision: 1.5 }), 'data.revision');
      const file = JSON.parse(CONSOLE_FILE);
      expectInvalid({ ...file, defaults: { ...file.defaults, overclock: 'Auto' } }, 'defaults.overclock');
      // settings.json spells it disable_antialiasing; library.json needs disable_anti_aliasing
      const { disable_anti_aliasing: _correct, ...otherDefaults } = file.defaults;
      expectInvalid({ ...file, defaults: { ...otherDefaults, disable_antialiasing: _correct } }, 'defaults.disable_anti_aliasing');
    }),

    test('unknown keys are dropped', () => {
      const file = JSON.parse(CONSOLE_FILE);
      const { library } = normalizeLibrary({ ...file, extra: 1, data: { ...file.data, nickname: 'x' } });
      assert(library !== undefined && !('extra' in library) && !('nickname' in library.data), 'unknown keys dropped');
    }),
  ],
};

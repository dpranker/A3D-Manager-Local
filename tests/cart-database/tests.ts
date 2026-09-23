import { readFileSync } from 'node:fs';
import { test, assert, assertEqual, type TestSuite } from '../utils.js';
import { lookupGameName, isKnownCart } from '../../server/lib/game-lookup.js';

interface Cart { id: string; name: string; gameCode: string; flashcartName?: string }
const carts: Cart[] = JSON.parse(readFileSync(new URL('../../data/cart-names.json', import.meta.url), 'utf8'));

export const cartDatabaseSuite: TestSuite = {
  name: 'Cartridge database',
  tests: [
    test('shipped Analogue IDs are unique lowercase eight-digit hex values', () => {
      assertEqual(new Set(carts.map(c => c.id)).size, carts.length);
      assert(carts.every(c => /^[0-9a-f]{8}$/.test(c.id) && c.name.trim().length > 0));
    }),
    test('Japanese Evangelion resolves through the runtime lookup', async () => {
      assertEqual(await lookupGameName('6758D3C4'), 'Neon Genesis Evangelion (Japan)');
      assert(await isKnownCart('6758d3c4'));
      assertEqual(await lookupGameName('NEVJ'), undefined);
    }),
    test('upstream alternate names retain existing regional names', () => {
      const mario = carts.find(c => c.gameCode === 'NKTE');
      assertEqual(mario?.flashcartName, 'Mario Kart 64');
      assert(mario?.name.includes('(USA)'));
    }),
    test('all five observed cartridge IDs have names', async () => {
      for (const id of ['6758d3c4', '5743ee3c', '1a9280c1', '53d8a515', '996b9452']) {
        assert(Boolean(await lookupGameName(id)), `Missing name for ${id}`);
      }
    }),
  ],
};

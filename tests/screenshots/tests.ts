/**
 * Screenshot Tests
 *
 * Listing, lookup and deletion of the console's screenshots, 4K exports and Memories,
 * using a fake SD card with PNGs laid out like the ones 3Dos writes (text chunks
 * before the image data, extra data after IEND).
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { test, assert, assertEqual, TestSuite } from '../utils.js';
import {
  deleteCaptures,
  findCapture,
  isHdrCapture,
  listCaptures,
  parseCaptureTime,
  parseFirmware,
  parsePngHeader,
} from '../../server/lib/screenshots.js';

const CART = 'b372fa05';
const OTHER = '6153de1c';

// assertEqual compares with ===
const assertSame = (actual: unknown, expected: unknown) => assertEqual(JSON.stringify(actual), JSON.stringify(expected));

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  return Buffer.concat([length, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]); // CRC isn't checked
}

function fakePng(
  width: number,
  height: number,
  text: Record<string, string>,
  trailing = 0,
  { bitDepth = 8, extra = [] as string[] } = {},
): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = bitDepth;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('tIME', Buffer.alloc(7)),
    ...extra.map((type) => chunk(type, Buffer.alloc(4))),
    ...Object.entries(text).map(([k, v]) => chunk('tEXt', Buffer.concat([Buffer.from(k, 'latin1'), Buffer.from([0]), Buffer.from(v, 'utf8')]))),
    chunk('IDAT', Buffer.alloc(16)),
    chunk('IEND', Buffer.alloc(0)),
    Buffer.alloc(trailing),
  ]);
}

const tags = (cartId: string, content: string, fw = '01_05_00') => ({
  Software: `A3D FW ${fw}__202607212359590000`,
  Title: 'Ogre Battle 64: Person of Lordly Caliber',
  Source: `0x${cartId}`,
  A3DContent: content,
  'Display Config': '{"hdr":"Off","odm":"PVM","PVM":{"imageSize":"Integer+"}}',
});

function makeCard(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'a3d-screenshots-'));
  const write = (rel: string, data: Buffer) => {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), data);
  };
  const shots = `Gallery/Screenshots/N64/Ogre Battle 64 Person of Lordly Caliber ${CART}`;
  write(`${shots}/Ogre Battle 64_ Person of Lordly Caliber - 20260623211119.png`, fakePng(320, 240, tags(CART, 'A3D Screenshot', '01_04_00'), 64));
  write(`${shots}/Ogre Battle 64_ Person of Lordly Caliber - 20260724214419.png`, fakePng(640, 240, tags(CART, 'A3D Screenshot'), 64));
  write(`${shots}/notes.txt`, Buffer.from('not a capture'));
  write(`Gallery/Screenshots/N64/WinBack Covert Operations ${OTHER}/WinBack_ Covert Operations - 20260624212515.png`, fakePng(320, 240, tags(OTHER, 'A3D Screenshot')));
  write('Gallery/4K Export/N64/Ogre Battle 64_ Person of Lordly Caliber - 20260623211522.png', fakePng(3840, 2160, tags(CART, 'A3D Gallery Export')));
  write('Gallery/4K Export/N64/WinBack_ Covert Operations - 20260624212600.png', fakePng(3840, 2160, tags(OTHER, 'A3D Gallery Export')));
  write(`Memories/N64/Ogre Battle 64 Person of Lordly Caliber ${CART}/Ogre Battle 64_ Person of Lordly Caliber - 20260614230540.png`, fakePng(320, 240, tags(CART, 'A3D Memory'), 1024));
  return root;
}

export const screenshotsSuite: TestSuite = {
  name: 'Screenshots',
  tests: [
    test('parsePngHeader reads size and UTF-8 text chunks', () => {
      const header = parsePngHeader(fakePng(640, 240, { Title: 'Pokémon Stadium', Source: '0x12345678' }, 32));
      assert(header !== null, 'header parsed');
      assertEqual(header!.width, 640);
      assertEqual(header!.height, 240);
      assertEqual(header!.text.Title, 'Pokémon Stadium');
      assertEqual(header!.text.Source, '0x12345678');
    }),

    test('parsePngHeader rejects non-PNG data', () => {
      assertEqual(parsePngHeader(Buffer.from('not a png at all, just some text here')), null);
    }),

    test('isHdrCapture: the HDR setting or HDR-style PNG data', () => {
      const hdr = (config: string, options?: { bitDepth?: number; extra?: string[] }) =>
        isHdrCapture(parsePngHeader(fakePng(320, 240, { 'Display Config': config }, 0, options))!);
      assertEqual(hdr('{"hdr":"Off","odm":"PVM"}'), false);
      assertEqual(hdr('{"hdr":"On","odm":"PVM"}'), true);
      assertEqual(hdr('{"odm":"PVM"}', { bitDepth: 16 }), true);
      assertEqual(hdr('{"hdr":"Off"}', { extra: ['cICP'] }), true);
    }),

    test('parseCaptureTime and parseFirmware read the console formats', () => {
      assertEqual(parseCaptureTime('WinBack_ Covert Operations - 20260624212515.png'), '2026-06-24T21:25:15');
      assertEqual(parseCaptureTime('holiday.png'), null);
      assertEqual(parseFirmware('A3D FW 01_05_01__202609232359590000'), '1.5.1');
      assertEqual(parseFirmware(undefined), null);
    }),

    test('listCaptures finds one cartridge’s screenshots, 4K exports and Memories, newest first', async () => {
      const card = makeCard();
      try {
        const captures = await listCaptures(card, CART.toUpperCase());
        assertSame(
          captures.map((c) => `${c.kind} ${c.takenAt}`),
          ['screenshot 2026-07-24T21:44:19', 'export 2026-06-23T21:15:22', 'screenshot 2026-06-23T21:11:19', 'memory 2026-06-14T23:05:40'],
        );
        const shot = captures[0];
        assertEqual(shot.file, `Ogre Battle 64 Person of Lordly Caliber ${CART}/Ogre Battle 64_ Person of Lordly Caliber - 20260724214419.png`);
        assertSame([shot.width, shot.height, shot.firmware, shot.displayMode], [640, 240, '1.5.0', 'PVM']);
      } finally {
        rmSync(card, { recursive: true, force: true });
      }
    }),

    test('listCaptures returns nothing for a card without screenshot folders', async () => {
      const card = mkdtempSync(path.join(os.tmpdir(), 'a3d-screenshots-'));
      try {
        assertSame(await listCaptures(card, CART), []);
      } finally {
        rmSync(card, { recursive: true, force: true });
      }
    }),

    test('findCapture refuses other carts’ files and paths outside the folders', async () => {
      const card = makeCard();
      try {
        const [shot] = await listCaptures(card, CART);
        assert((await findCapture(card, CART, 'screenshot', shot.file)) !== null, 'own screenshot found');
        assertEqual(await findCapture(card, OTHER, 'screenshot', shot.file), null);
        assertEqual(await findCapture(card, OTHER, 'export', 'Ogre Battle 64_ Person of Lordly Caliber - 20260623211522.png'), null);
        assertEqual(await findCapture(card, CART, 'screenshot', `../../Memories/N64/x ${CART}/a.png`), null);
        assertEqual(await findCapture(card, CART, 'export', `../Screenshots/N64/${shot.file}`), null);
        assertEqual(await findCapture(card, CART, 'screenshot', `Ogre Battle 64 Person of Lordly Caliber ${CART}/notes.txt`), null);
      } finally {
        rmSync(card, { recursive: true, force: true });
      }
    }),

    test('deleteCaptures removes screenshots and exports but never Memories', async () => {
      const card = makeCard();
      try {
        const captures = await listCaptures(card, CART);
        const result = await deleteCaptures(card, CART, captures.map(({ kind, file }) => ({ kind, file })));
        assertSame(result.deleted.map((d) => d.kind), ['screenshot', 'export', 'screenshot']);
        assertSame(result.failed.map((f) => f.kind), ['memory']);
        assertSame((await listCaptures(card, CART)).map((c) => c.kind), ['memory']);
        // Other carts' files and the per-game folder stay
        assertEqual((await listCaptures(card, OTHER)).length, 2);
        assert(existsSync(path.join(card, `Gallery/Screenshots/N64/Ogre Battle 64 Person of Lordly Caliber ${CART}`)), 'folder kept');
      } finally {
        rmSync(card, { recursive: true, force: true });
      }
    }),
  ],
};

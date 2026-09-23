/**
 * Firmware Tests
 *
 * Feed parsing, version helpers, SD card detection and install-to-SD, all
 * offline (the download itself needs analogue.co and isn't covered here).
 */

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { test, assert, assertEqual, TestSuite } from '../utils.js';
import {
  compareVersions,
  firmwareFileName,
  getSDFirmwareStatus,
  installFirmwareToSD,
  parseFirmwareDetails,
  parseFirmwareList,
  parseReleaseNotes,
  versionFromFileName,
} from '../../server/lib/firmware.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Trimmed copies of https://www.analogue.co/support/3d/firmware/latest/details and .../list (2026-09-23)
const DETAILS = JSON.parse(readFileSync(path.join(__dirname, 'fixtures', 'details.json'), 'utf8'));
const LIST = JSON.parse(readFileSync(path.join(__dirname, 'fixtures', 'list.json'), 'utf8'));

function expectRejected(details: Record<string, unknown>, label: string): void {
  let threw = false;
  try {
    parseFirmwareDetails(details);
  } catch {
    threw = true;
  }
  assert(threw, `expected ${label} to be rejected`);
}

/** Temporary fake SD card with the given files (path -> size) */
function makeCard(files: Record<string, number>): string {
  const card = mkdtempSync(path.join(os.tmpdir(), 'a3d-fw-card-'));
  mkdirSync(path.join(card, 'Library', 'N64'), { recursive: true });
  writeFileSync(path.join(card, 'Library', 'N64', 'library.db'), '');
  for (const [file, size] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(card, file)), { recursive: true });
    writeFileSync(path.join(card, file), Buffer.alloc(size, 1));
  }
  return card;
}

function withCard(files: Record<string, number>, fn: (card: string) => Promise<void>): () => Promise<void> {
  return async () => {
    const card = makeCard(files);
    try {
      await fn(card);
    } finally {
      rmSync(card, { recursive: true, force: true });
    }
  };
}

export const firmwareSuite: TestSuite = {
  name: 'Firmware',
  tests: [
    // =========================================================================
    // Versions and file names
    // =========================================================================

    test('firmwareFileName pads each version part', () => {
      assertEqual(firmwareFileName('1.5.1'), 'a3d_os_01_05_01.bin');
      assertEqual(firmwareFileName('1.12.0'), 'a3d_os_01_12_00.bin');
    }),

    test('versionFromFileName round-trips and rejects other files', () => {
      assertEqual(versionFromFileName('a3d_os_01_05_01.bin'), '1.5.1');
      assertEqual(versionFromFileName('A3D_OS_01_10_00.BIN'), '1.10.0');
      assertEqual(versionFromFileName('a3d_os_01_05_01.bin.partial'), null);
      assertEqual(versionFromFileName('labels.db'), null);
    }),

    test('compareVersions compares numerically, not as strings', () => {
      assert(compareVersions('1.10.0', '1.9.9') > 0, '1.10.0 > 1.9.9');
      assert(compareVersions('1.5.0', '1.5.1') < 0, '1.5.0 < 1.5.1');
      assertEqual(compareVersions('1.5.1', '1.5.1'), 0);
    }),

    // =========================================================================
    // Firmware API responses
    // =========================================================================

    test('parseFirmwareDetails maps the API response', () => {
      const release = parseFirmwareDetails(DETAILS);
      assertEqual(release.version, '1.5.1');
      assertEqual(release.publishedAt, '2026-09-23T15:12:32.000Z');
      assertEqual(release.md5, '75f14fd5e3961acff208d154e1ea8c9f');
      assertEqual(release.fileName, 'a3d_os_01_05_01.bin');
      assertEqual(release.downloadUrl, DETAILS.download_url);
      assertEqual(release.releaseNotesUrl, 'https://www.analogue.co/support/3d/firmware/1.5.1');
      assert(release.notes.length > 0, 'release notes parsed');
    }),

    test('parseFirmwareDetails rejects anything it should not download', () => {
      expectRejected({ ...DETAILS, product: 'pocket' }, 'another product');
      expectRejected({ ...DETAILS, md5: 'not-a-hash' }, 'a bad MD5');
      expectRejected({ ...DETAILS, md5: undefined }, 'a missing MD5');
      expectRejected({ ...DETAILS, file_name: 'a3d_os_01_05_00.bin' }, 'a file name for another version');
      expectRejected({ ...DETAILS, download_url: 'https://example.com/a3d_os_01_05_01.bin' }, 'a non-Analogue download host');
      expectRejected({ ...DETAILS, download_url: 'http://assets.analogue.co/firmware/x/a3d_os_01_05_01.bin' }, 'a plain-HTTP download');
    }),

    test('parseFirmwareList keeps 3D versions, newest first', () => {
      assertEqual(parseFirmwareList(LIST).map((r) => r.version).join(','), '1.10.0,1.5.1,1.5.0');
    }),

    test('parseReleaseNotes turns release notes into plain-text blocks', () => {
      const notes = parseReleaseNotes(DETAILS.release_notes_html);
      assertEqual(notes.map((b) => b.type).join(','), 'heading,list,heading,list,paragraph,list');
      const [general, generalList, , osList, note, footnotes] = notes;
      assert(general.type === 'heading' && general.text === 'General', 'first heading');
      assert(generalList.type === 'list' && generalList.items[0].endsWith('in-game ¹'), 'footnote marker becomes ¹');
      assert(osList.type === 'list' && osList.items[1] === 'Fix: Issue with R&D <menu> toggles', 'entities decoded, no tags');
      assert(note.type === 'paragraph' && note.text.startsWith('Note:'), 'note paragraph');
      assert(footnotes.type === 'list' && footnotes.ordered && footnotes.items[0] === 'For more information visit the Platform docs', 'footnotes as ordered list');
    }),

    // =========================================================================
    // SD card detection
    // =========================================================================

    test('older console: root update file is the installed version', withCard(
      { 'a3d_os_01_05_00.bin': 10, '.Trash-1000/files/a3d_os_01_04_00.bin': 5, '.Trash-1000/files/a3d_os_01_05_01.bin.partial': 3 },
      async (card) => {
        const status = await getSDFirmwareStatus(card);
        assertEqual(status.installedVersion, '1.5.0');
        assertEqual(status.pendingVersion, null);
        assertEqual(status.consoleArchives, false);
        assertEqual(status.trashedFiles.map((f) => f.size).sort().join(','), '3,5', 'trashed .bin and .partial both counted');
      },
    )),

    test('3Dos 1.5.1+: newest archived file is installed, newer root file is pending', withCard(
      { 'System/Archived/a3d_os_01_05_00.bin': 10, 'System/Archived/a3d_os_01_05_01.bin': 10, 'a3d_os_01_06_00.bin': 10 },
      async (card) => {
        const status = await getSDFirmwareStatus(card);
        assertEqual(status.installedVersion, '1.5.1');
        assertEqual(status.pendingVersion, '1.6.0');
        assertEqual(status.consoleArchives, true);
      },
    )),

    test('3Dos 1.5.1+: nothing pending once the console has archived the update', withCard(
      { 'System/Archived/a3d_os_01_05_01.bin': 10 },
      async (card) => {
        const status = await getSDFirmwareStatus(card);
        assertEqual(status.installedVersion, '1.5.1');
        assertEqual(status.pendingVersion, null);
        assertEqual(status.files.length, 0);
      },
    )),

    test('interrupted copy: .partial file is reported, not counted as a version', withCard(
      { 'a3d_os_01_05_00.bin': 10, 'a3d_os_01_05_01.bin.partial': 5 },
      async (card) => {
        const status = await getSDFirmwareStatus(card);
        assertEqual(status.installedVersion, '1.5.0');
        assertEqual(status.partialFiles.join(','), 'a3d_os_01_05_01.bin.partial');
      },
    )),

    test('card without any update file has no known version', withCard({}, async (card) => {
      const status = await getSDFirmwareStatus(card);
      assertEqual(status.installedVersion, null);
      assertEqual(status.pendingVersion, null);
    })),

    // =========================================================================
    // Install to SD
    // =========================================================================

    test('installFirmwareToSD adds the new file and leaves existing update files alone', withCard(
      {
        'a3d_os_01_05_00.bin': 10,
        'a3d_os_01_04_00.bin.partial': 3,
        'System/Archived/a3d_os_01_04_00.bin': 10,
        '.Trash-1000/files/a3d_os_01_03_00.bin': 10,
      },
      async (card) => {
        const source = path.join(mkdtempSync(path.join(os.tmpdir(), 'a3d-fw-src-')), 'a3d_os_01_05_01.bin');
        writeFileSync(source, Buffer.alloc(4096, 7));
        try {
          const result = await installFirmwareToSD(source, '1.5.1', card, () => {});
          assertEqual(result.fileName, 'a3d_os_01_05_01.bin');

          const rootFiles = readdirSync(card).filter((f) => f.startsWith('a3d_os')).sort();
          assertEqual(rootFiles.join(','), 'a3d_os_01_05_00.bin,a3d_os_01_05_01.bin', 'old file kept, stale .partial cleared');
          assert(readFileSync(path.join(card, 'a3d_os_01_05_01.bin')).equals(readFileSync(source)), 'contents copied');
          assert(existsSync(path.join(card, 'System/Archived/a3d_os_01_04_00.bin')), "console's archive untouched");
          assert(existsSync(path.join(card, '.Trash-1000/files/a3d_os_01_03_00.bin')), 'trash untouched');
        } finally {
          rmSync(path.dirname(source), { recursive: true, force: true });
        }
      },
    )),
  ],
};

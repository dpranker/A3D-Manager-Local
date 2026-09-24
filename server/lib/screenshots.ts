/**
 * Screenshots and Memories the console saves on the SD card.
 *
 * Layout (seen on a real card, 3Dos 1.3.0 to 1.5.1):
 *   Gallery/Screenshots/N64/<Title> <cartId>/<Title> - YYYYMMDDhhmmss.png   screenshots
 *   Gallery/4K Export/N64/<Title> - YYYYMMDDhhmmss.png                       4K exports (flat, matched by Source)
 *   Memories/N64/<Title> <cartId>/<Title> - YYYYMMDDhhmmss.png              Memories (save states)
 *
 * Each PNG carries tEXt chunks before the image data: Title, Source (0x<cartId>),
 * Software (firmware), A3DContent, Display Config (JSON) and A3DSignature. Screenshots
 * and exports have extra data after IEND, and a Memory's save state follows it (~8.7 MB).
 * The files are signed, so they're only ever copied or deleted, never rewritten.
 * The console keeps no index of them; it reads the folders.
 */

import { open, readdir, stat, unlink } from 'fs/promises';
import path from 'path';

export const CAPTURE_KINDS = ['screenshot', 'export', 'memory'] as const;
export type CaptureKind = (typeof CAPTURE_KINDS)[number];

/** Memories hold save states, so the app doesn't delete them */
export const DELETABLE_KINDS: readonly CaptureKind[] = ['screenshot', 'export'];

const KIND_DIRS: Record<CaptureKind, string[]> = {
  screenshot: ['Gallery', 'Screenshots', 'N64'],
  export: ['Gallery', '4K Export', 'N64'],
  memory: ['Memories', 'N64'],
};

export interface CaptureInfo {
  kind: CaptureKind;
  /** Path below the kind's folder: "<folder>/<file>.png", or "<file>.png" for 4K exports */
  file: string;
  /** Capture time from the file name, in the console's local time (no time zone) */
  takenAt: string | null;
  width: number;
  height: number;
  size: number;
  /** File modification time (ms), so a replaced file isn't served from a stale cache */
  modifiedMs: number;
  /** e.g. "1.5.0", from the Software tag */
  firmware: string | null;
  /** Display mode from Display Config, e.g. "PVM" or "Clean" */
  displayMode: string | null;
  /**
   * Captured with HDR on (Display Config "hdr" other than "Off"), or stored with HDR-style
   * PNG data (16-bit, or a cICP/iCCP color chunk). No HDR capture has been seen yet, so the
   * app doesn't re-encode these: their thumbnails are the original file.
   */
  hdr: boolean;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// The text chunks sit right after IHDR/tIME and are well under 4 KiB together
const HEADER_READ_BYTES = 16 * 1024;

export interface PngHeader {
  width: number;
  height: number;
  bitDepth: number;
  /** Chunk types before the image data, other than tEXt */
  chunks: string[];
  text: Record<string, string>;
}

/** Reads IHDR and the tEXt chunks that come before the image data */
export function parsePngHeader(buffer: Buffer): PngHeader | null {
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  if (buffer.toString('latin1', 12, 16) !== 'IHDR') return null;

  const header: PngHeader = {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    bitDepth: buffer[24],
    chunks: [],
    text: {},
  };
  let offset = 8;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    if (type === 'IDAT' || type === 'IEND') break;
    const dataEnd = offset + 8 + length;
    if (dataEnd > buffer.length) break;
    if (type !== 'tEXt') header.chunks.push(type);
    else {
      const data = buffer.subarray(offset + 8, dataEnd);
      const separator = data.indexOf(0);
      if (separator > 0) {
        // tEXt is Latin-1 by spec, but the console writes UTF-8 (e.g. titles)
        header.text[data.toString('latin1', 0, separator)] = data.toString('utf8', separator + 1);
      }
    }
    offset = dataEnd + 4; // skip CRC
  }
  return header;
}

async function readPngHeader(filePath: string): Promise<PngHeader | null> {
  const handle = await open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(HEADER_READ_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, HEADER_READ_BYTES, 0);
    return parsePngHeader(buffer.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

/** "Title - 20260623211522.png" -> "2026-06-23T21:15:22" */
export function parseCaptureTime(fileName: string): string | null {
  const match = / - (\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\.png$/i.exec(fileName);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}`;
}

/** "A3D FW 01_05_00__202607212359590000" -> "1.5.0" */
export function parseFirmware(software: string | undefined): string | null {
  const match = software && /FW (\d+)_(\d+)_(\d+)/.exec(software);
  return match ? match.slice(1).map(Number).join('.') : null;
}

function parseDisplayConfig(config: string | undefined): { odm?: unknown; hdr?: unknown } {
  if (!config) return {};
  try {
    return JSON.parse(config) ?? {};
  } catch {
    return {};
  }
}

export function isHdrCapture(header: PngHeader): boolean {
  const { hdr } = parseDisplayConfig(header.text['Display Config']);
  const hdrOn = typeof hdr === 'string' && hdr.toLowerCase() !== 'off';
  return hdrOn || header.bitDepth === 16 || header.chunks.includes('cICP') || header.chunks.includes('iCCP');
}

async function listDir(dir: string) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

const isPng = (name: string) => name.toLowerCase().endsWith('.png') && !name.startsWith('.');

async function describe(kind: CaptureKind, root: string, file: string, header: PngHeader | null): Promise<CaptureInfo | null> {
  const fullPath = path.join(root, file);
  header ??= await readPngHeader(fullPath).catch(() => null);
  if (!header) return null;
  const { size, mtimeMs } = await stat(fullPath);
  const { odm } = parseDisplayConfig(header.text['Display Config']);
  return {
    kind,
    file,
    takenAt: parseCaptureTime(path.basename(file)),
    width: header.width,
    height: header.height,
    size,
    modifiedMs: Math.round(mtimeMs),
    firmware: parseFirmware(header.text.Software),
    displayMode: typeof odm === 'string' ? odm : null,
    hdr: isHdrCapture(header),
  };
}

/** Everything the console saved for one cartridge, newest first */
export async function listCaptures(
  sdCardPath: string,
  cartId: string,
  kinds: readonly CaptureKind[] = CAPTURE_KINDS,
): Promise<CaptureInfo[]> {
  const id = cartId.toLowerCase();
  const captures: CaptureInfo[] = [];

  for (const kind of kinds) {
    const root = path.join(sdCardPath, ...KIND_DIRS[kind]);

    if (kind === 'export') {
      // Flat folder: match by the Source tag
      for (const entry of await listDir(root)) {
        if (!entry.isFile() || !isPng(entry.name)) continue;
        const header = await readPngHeader(path.join(root, entry.name)).catch(() => null);
        if (header?.text.Source?.toLowerCase() !== `0x${id}`) continue;
        const info = await describe(kind, root, entry.name, header);
        if (info) captures.push(info);
      }
      continue;
    }

    // One folder per cartridge, named "<Title> <cartId>"
    for (const folder of await listDir(root)) {
      if (!folder.isDirectory() || !folder.name.toLowerCase().endsWith(` ${id}`)) continue;
      for (const entry of await listDir(path.join(root, folder.name))) {
        if (!entry.isFile() || !isPng(entry.name)) continue;
        const info = await describe(kind, root, `${folder.name}/${entry.name}`, null);
        if (info) captures.push(info);
      }
    }
  }

  return captures.sort((a, b) => (b.takenAt ?? '').localeCompare(a.takenAt ?? '') || a.file.localeCompare(b.file));
}

/**
 * Resolves a capture the client asked for to its path on the card. Only a file that
 * listCaptures would return for this cartridge is accepted, so a request can't reach
 * other files on the card.
 */
export async function findCapture(
  sdCardPath: string,
  cartId: string,
  kind: CaptureKind,
  file: string,
): Promise<{ info: CaptureInfo; path: string } | null> {
  const id = cartId.toLowerCase();
  const parts = file.split('/');
  const name = parts[parts.length - 1];
  const expectedParts = kind === 'export' ? 1 : 2;
  if (parts.length !== expectedParts || !isPng(name) || parts.some((p) => !p || p === '..' || p.includes('\\'))) return null;
  if (kind !== 'export' && !parts[0].toLowerCase().endsWith(` ${id}`)) return null;

  const root = path.join(sdCardPath, ...KIND_DIRS[kind]);
  const header = await readPngHeader(path.join(root, file)).catch(() => null);
  if (!header) return null;
  if (kind === 'export' && header.text.Source?.toLowerCase() !== `0x${id}`) return null;

  const info = await describe(kind, root, file, header);
  return info ? { info, path: path.join(root, file) } : null;
}

export interface DeleteCapturesResult {
  deleted: { kind: CaptureKind; file: string }[];
  failed: { kind: CaptureKind; file: string; error: string }[];
}

/** Deletes screenshots and 4K exports. Memories are refused. The per-game folders are left in place. */
export async function deleteCaptures(
  sdCardPath: string,
  cartId: string,
  items: { kind: CaptureKind; file: string }[],
): Promise<DeleteCapturesResult> {
  const result: DeleteCapturesResult = { deleted: [], failed: [] };

  for (const { kind, file } of items) {
    if (!DELETABLE_KINDS.includes(kind)) {
      result.failed.push({ kind, file, error: 'Memories hold save states and are not deleted by the app' });
      continue;
    }
    const capture = await findCapture(sdCardPath, cartId, kind, file);
    if (!capture) {
      result.failed.push({ kind, file, error: 'Not found on the SD card' });
      continue;
    }
    try {
      await unlink(capture.path);
      result.deleted.push({ kind, file });
    } catch (error) {
      result.failed.push({ kind, file, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}

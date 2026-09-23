/**
 * 3Dos firmware: latest-release lookup, SD card detection, and download-to-SD.
 *
 * Releases come from Analogue's documented firmware API
 * (https://www.analogue.co/developer/docs/api): /support/3d/firmware/list and
 * /support/3d/firmware/{version|latest}/details, which include the file name,
 * a direct download URL, the MD5 checksum and release notes.
 *
 * On the SD card the only version markers are the update files themselves
 * (a3d_os_MM_mm_pp.bin). Up to 3Dos 1.5.0 the console left the file in the card
 * root after installing it; from 1.5.1 it moves it to /System/Archived. So a root
 * file is "pending" when the archive has an older (or no newer) version, and the
 * archive's newest file is the installed version.
 */
import { createHash } from 'crypto';
import { createReadStream, createWriteStream } from 'fs';
import { mkdir, open, readdir, rename, stat, unlink } from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import type { ReadableStream as WebReadableStream } from 'stream/web';
import { copyFileWithProgress, type ProgressCallback } from './file-transfer.js';

const SITE_ORIGIN = 'https://www.analogue.co';
export const FIRMWARE_API_BASE = `${SITE_ORIGIN}/support/3d/firmware`;
const INSTALL_GUIDE_URL = `${SITE_ORIGIN}/support/3d/guide/getting-started#updating-3dos`;
const USER_AGENT = 'A3D-Manager';
const LATEST_CACHE_MS = 60 * 60 * 1000;
// Real updates are ~22 MB; anything far outside this is not a firmware image
const MIN_FIRMWARE_BYTES = 5 * 1024 * 1024;
const MAX_FIRMWARE_BYTES = 200 * 1024 * 1024;

const FIRMWARE_FILE_PATTERN = /^a3d_os_(\d{2})_(\d{2})_(\d{2})\.bin$/i;
const PARTIAL_FILE_PATTERN = /^a3d_os_.*\.bin\.partial$/i;
const LOCAL_FIRMWARE_DIR = path.join(process.cwd(), '.local', 'firmware');

/** Release notes as plain-text blocks (the API's HTML is never passed to the client) */
export type ReleaseNotesBlock =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] };

export interface FirmwareRelease {
  version: string;
  /** ISO timestamp */
  publishedAt: string | null;
  downloadUrl: string;
  releaseNotesUrl: string;
  installGuideUrl: string;
  notes: ReleaseNotesBlock[];
  /** Lowercase hex MD5 of the update file, as published by Analogue */
  md5: string;
  fileName: string;
  /** Size label from the API, e.g. "22.3MB" */
  fileSizeLabel: string | null;
}

export interface FirmwareVersionSummary {
  version: string;
  publishedAt: string | null;
}

export interface SDFirmwareFile {
  name: string;
  version: string;
  size: number;
  modified: string;
}

export interface SDFirmwareStatus {
  /** Update files in the card root, highest version first */
  files: SDFirmwareFile[];
  /** Update files the console archived after installing (3Dos 1.5.1+), highest first */
  archivedFiles: SDFirmwareFile[];
  /**
   * Best estimate of the installed version: newest archived file, else (older
   * consoles, which never archive) the newest root file
   */
  installedVersion: string | null;
  /** Root file newer than anything archived: copied but not installed yet */
  pendingVersion: string | null;
  /** True when the card has an archive, so root files are known to be pending */
  consoleArchives: boolean;
  /** Leftovers from an interrupted copy (e.g. card removed before writes were flushed) */
  partialFiles: string[];
  /** Old update files left in a file manager's trash folder on the card (e.g. .Trash-1000) */
  trashedFiles: { path: string; size: number }[];
}

// =============================================================================
// Versions
// =============================================================================

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** "1.5.1" -> "a3d_os_01_05_01.bin" */
export function firmwareFileName(version: string): string {
  const parts = version.split('.');
  if (parts.length !== 3 || parts.some((p) => !/^\d{1,2}$/.test(p))) {
    throw new Error(`Unexpected firmware version format: ${version}`);
  }
  return `a3d_os_${parts.map((p) => p.padStart(2, '0')).join('_')}.bin`;
}

/** "a3d_os_01_05_01.bin" -> "1.5.1"; null for anything else */
export function versionFromFileName(name: string): string | null {
  const match = FIRMWARE_FILE_PATTERN.exec(name);
  return match ? match.slice(1, 4).map(Number).join('.') : null;
}

// =============================================================================
// Releases (Analogue firmware API)
// =============================================================================

const MD5_PATTERN = /^[0-9a-f]{32}$/i;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

const SUPERSCRIPT_DIGITS: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '.': '',
};

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/** Inline HTML to plain text; footnote markers like <superscript>1</superscript> become ¹ */
function inlineText(html: string): string {
  const withMarks = html.replace(/<superscript>\s*([\d.\s]+)\s*<\/superscript>/gi, (_, marks: string) =>
    marks.replace(/\s/g, '').replace(/[\d.]/g, (c) => SUPERSCRIPT_DIGITS[c] ?? c),
  );
  return decodeEntities(withMarks.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

export function parseReleaseNotes(html: string): ReleaseNotesBlock[] {
  const blocks: ReleaseNotesBlock[] = [];
  for (const match of html.matchAll(/<(h[1-6]|p|ul|ol)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const tag = match[1].toLowerCase();
    const inner = match[2];
    if (tag === 'ul' || tag === 'ol') {
      const items = [...inner.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((li) => inlineText(li[1])).filter(Boolean);
      if (items.length) blocks.push({ type: 'list', ordered: tag === 'ol', items });
    } else {
      const text = inlineText(inner);
      if (text) blocks.push(tag === 'p' ? { type: 'paragraph', text } : { type: 'heading', text });
    }
  }
  return blocks;
}

function isAnalogueHost(url: URL): boolean {
  return url.protocol === 'https:' && (url.hostname === 'analogue.co' || url.hostname.endsWith('.analogue.co'));
}

function isoOrNull(value: unknown): string | null {
  const date = typeof value === 'string' ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}

/** Validate a /details response; anything unexpected is rejected rather than downloaded */
export function parseFirmwareDetails(json: unknown): FirmwareRelease {
  const d = (json ?? {}) as Record<string, unknown>;
  const version = typeof d.version === 'string' ? d.version : '';
  const problem =
    d.product !== '3d' || !VERSION_PATTERN.test(version)
      ? 'not a 3D firmware release'
      : typeof d.md5 !== 'string' || !MD5_PATTERN.test(d.md5)
        ? 'missing or invalid MD5 checksum'
        : typeof d.file_name !== 'string' || d.file_name.toLowerCase() !== firmwareFileName(version)
          ? `unexpected file name ${String(d.file_name)}`
          : typeof d.download_url !== 'string' || !URL.canParse(d.download_url) || !isAnalogueHost(new URL(d.download_url))
            ? `unexpected download URL ${String(d.download_url)}`
            : null;
  if (problem) {
    throw new Error(`Unexpected response from Analogue's firmware API: ${problem}`);
  }
  return {
    version,
    publishedAt: isoOrNull(d.published_at),
    downloadUrl: d.download_url as string,
    releaseNotesUrl: typeof d.url === 'string' && URL.canParse(d.url) ? d.url : `${FIRMWARE_API_BASE}/${version}`,
    installGuideUrl: INSTALL_GUIDE_URL,
    notes: parseReleaseNotes(typeof d.release_notes_html === 'string' ? d.release_notes_html : ''),
    md5: (d.md5 as string).toLowerCase(),
    fileName: d.file_name as string,
    fileSizeLabel: typeof d.file_size === 'string' ? d.file_size : null,
  };
}

/** /list response -> 3D versions, newest first */
export function parseFirmwareList(json: unknown): FirmwareVersionSummary[] {
  if (!Array.isArray(json)) throw new Error("Unexpected response from Analogue's firmware API: list is not an array");
  return json
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .filter((item) => item.product === '3d' && typeof item.version === 'string' && VERSION_PATTERN.test(item.version))
    .map((item) => ({ version: item.version as string, publishedAt: isoOrNull(item.publishedAt) }))
    .sort((a, b) => compareVersions(b.version, a.version));
}

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Analogue firmware API returned HTTP ${response.status} for ${url}`);
  }
  return response.json();
}

const apiCache = new Map<string, { value: unknown; fetchedAt: number }>();

async function cachedJson(url: string, force: boolean): Promise<{ value: unknown; fetchedAt: number }> {
  const hit = apiCache.get(url);
  if (!force && hit && Date.now() - hit.fetchedAt < LATEST_CACHE_MS) return hit;
  const entry = { value: await getJson(url), fetchedAt: Date.now() };
  apiCache.set(url, entry);
  return entry;
}

export async function fetchLatestFirmware(options: { force?: boolean } = {}): Promise<{ release: FirmwareRelease; checkedAt: string }> {
  const { value, fetchedAt } = await cachedJson(`${FIRMWARE_API_BASE}/latest/details`, options.force ?? false);
  return { release: parseFirmwareDetails(value), checkedAt: new Date(fetchedAt).toISOString() };
}

/** Details for every release newer than `version`, newest first (for a combined "what's new") */
export async function fetchReleasesNewerThan(version: string, options: { force?: boolean } = {}): Promise<FirmwareRelease[]> {
  const list = parseFirmwareList((await cachedJson(`${FIRMWARE_API_BASE}/list`, options.force ?? false)).value);
  const newer = list.filter((r) => compareVersions(r.version, version) > 0).slice(0, 10);
  const details = await Promise.all(
    newer.map(async (r) => parseFirmwareDetails((await cachedJson(`${FIRMWARE_API_BASE}/${r.version}/details`, options.force ?? false)).value)),
  );
  return details;
}

// =============================================================================
// SD card
// =============================================================================

async function listUpdateFiles(dir: string): Promise<SDFirmwareFile[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: SDFirmwareFile[] = [];
  for (const entry of entries) {
    const version = entry.isFile() ? versionFromFileName(entry.name) : null;
    if (!version) continue;
    const info = await stat(path.join(dir, entry.name));
    files.push({ name: entry.name, version, size: info.size, modified: info.mtime.toISOString() });
  }
  return files.sort((a, b) => compareVersions(b.version, a.version));
}

export async function getSDFirmwareStatus(sdCardPath: string): Promise<SDFirmwareStatus> {
  const files = await listUpdateFiles(sdCardPath);
  const archiveDir = path.join(sdCardPath, 'System', 'Archived');
  const archivedFiles = await listUpdateFiles(archiveDir);
  const consoleArchives = (await stat(archiveDir).catch(() => null))?.isDirectory() ?? false;

  const newestRoot = files[0]?.version ?? null;
  const newestArchived = archivedFiles[0]?.version ?? null;
  const pendingVersion =
    consoleArchives && newestRoot && (!newestArchived || compareVersions(newestRoot, newestArchived) > 0) ? newestRoot : null;
  const installedVersion = consoleArchives ? newestArchived : newestRoot;

  const rootEntries = await readdir(sdCardPath, { withFileTypes: true });
  const partialFiles = rootEntries.filter((e) => e.isFile() && PARTIAL_FILE_PATTERN.test(e.name)).map((e) => e.name);

  const trashedFiles: SDFirmwareStatus['trashedFiles'] = [];
  for (const entry of rootEntries) {
    if (!entry.isDirectory() || !/^\.Trash(-\d+)?$/.test(entry.name)) continue;
    const trashFilesDir = path.join(sdCardPath, entry.name, 'files');
    const names = await readdir(trashFilesDir).catch(() => [] as string[]);
    for (const name of names) {
      if (!FIRMWARE_FILE_PATTERN.test(name) && !PARTIAL_FILE_PATTERN.test(name)) continue;
      const info = await stat(path.join(trashFilesDir, name));
      if (info.isFile()) trashedFiles.push({ path: path.join(entry.name, 'files', name), size: info.size });
    }
  }

  return { files, archivedFiles, installedVersion, pendingVersion, consoleArchives, partialFiles, trashedFiles };
}

// =============================================================================
// Download + install
// =============================================================================

export type FirmwarePhase = 'download' | 'copy';

async function fileHash(filePath: string, algorithm: 'md5'): Promise<string> {
  const hash = createHash(algorithm);
  await pipeline(createReadStream(filePath), hash);
  return hash.digest('hex');
}

/**
 * Download the release into .local/firmware/ and verify it against Analogue's
 * published MD5. A cached copy is reused (without any network request) when its
 * MD5 matches. Returns the local file path.
 */
export async function downloadFirmware(release: FirmwareRelease, onProgress: ProgressCallback): Promise<string> {
  const expectedName = firmwareFileName(release.version);
  await mkdir(LOCAL_FIRMWARE_DIR, { recursive: true });
  const localPath = path.join(LOCAL_FIRMWARE_DIR, expectedName);

  const cached = await stat(localPath).catch(() => null);
  if (cached?.isFile() && (await fileHash(localPath, 'md5')) === release.md5) {
    onProgress({ bytesWritten: cached.size, totalBytes: cached.size, percentage: 100, elapsedMs: 0, bytesPerSecond: 0, estimatedTimeRemainingMs: 0 });
    return localPath;
  }

  const response = await fetch(release.downloadUrl, {
    headers: { 'User-Agent': USER_AGENT },
    redirect: 'follow',
    signal: AbortSignal.timeout(10 * 60_000),
  });
  if (!response.ok || !response.body) {
    throw new Error(`Firmware download failed: HTTP ${response.status}`);
  }

  const finalUrl = new URL(response.url);
  const servedName = path.posix.basename(finalUrl.pathname);
  const contentType = response.headers.get('content-type') ?? '';
  const totalBytes = Number(response.headers.get('content-length'));

  const problem = !isAnalogueHost(finalUrl)
    ? `download was redirected to an unexpected host (${finalUrl.host})`
    : servedName.toLowerCase() !== expectedName
      ? `expected ${expectedName} but the server sent ${servedName}`
      : contentType.includes('text/html')
        ? 'the server sent a web page instead of a firmware file'
        : !Number.isFinite(totalBytes) || totalBytes < MIN_FIRMWARE_BYTES || totalBytes > MAX_FIRMWARE_BYTES
          ? `unexpected file size (${response.headers.get('content-length') ?? 'unknown'} bytes)`
          : null;
  if (problem) {
    await response.body.cancel();
    throw new Error(`Refusing firmware download: ${problem}`);
  }

  const partialPath = `${localPath}.partial`;
  const startTime = Date.now();
  let bytesWritten = 0;
  let lastEmit = 0;
  const md5 = createHash('md5');
  const body = Readable.fromWeb(response.body as WebReadableStream<Uint8Array>);
  body.on('data', (chunk: Buffer) => {
    md5.update(chunk);
    bytesWritten += chunk.length;
    const now = Date.now();
    if (now - lastEmit < 100 && bytesWritten < totalBytes) return;
    lastEmit = now;
    const elapsedMs = now - startTime;
    const bytesPerSecond = elapsedMs > 0 ? (bytesWritten / elapsedMs) * 1000 : 0;
    onProgress({
      bytesWritten,
      totalBytes,
      percentage: Math.min(100, (bytesWritten / totalBytes) * 100),
      elapsedMs,
      bytesPerSecond,
      estimatedTimeRemainingMs: bytesPerSecond > 0 ? ((totalBytes - bytesWritten) / bytesPerSecond) * 1000 : 0,
    });
  });

  try {
    await pipeline(body, createWriteStream(partialPath));
    if (bytesWritten !== totalBytes) {
      throw new Error(`Firmware download incomplete: got ${bytesWritten} of ${totalBytes} bytes`);
    }
    const downloadedMd5 = md5.digest('hex');
    if (downloadedMd5 !== release.md5) {
      throw new Error(`Firmware download is corrupt: MD5 ${downloadedMd5} doesn't match Analogue's published ${release.md5}`);
    }
    await rename(partialPath, localPath);
  } catch (error) {
    await unlink(partialPath).catch(() => {});
    throw error;
  }
  return localPath;
}

export interface InstallResult {
  fileName: string;
  /** MD5 of the file as read back from the card */
  md5: string;
  /** Older update files deleted from the card root */
  removed: string[];
}

/**
 * fsync a file or directory. On FAT a rename only changes the directory, which
 * the kernel otherwise writes back up to ~30s later: a card removed in that
 * window keeps the old name. Windows can't open directories for syncing (it
 * writes removable-media metadata through immediately), so that case is skipped.
 */
async function syncToDisk(target: string): Promise<void> {
  let handle;
  try {
    handle = await open(target, 'r');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (process.platform === 'win32' && (code === 'EISDIR' || code === 'EPERM' || code === 'EACCES')) return;
    throw error;
  }
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * Copy the update file to the card root: written as .partial, verified, renamed,
 * and flushed to the card (file and directory) before reporting success, then
 * read back and compared with the download. Other update files in the root are
 * then deleted, as Analogue's install guide asks: two update files in the root
 * conflict. 3Dos 1.5.1+ moves the installed file to /System/Archived itself, so
 * this only matters for older consoles; the archive is never touched.
 */
export async function installFirmwareToSD(
  localPath: string,
  version: string,
  sdCardPath: string,
  onProgress: ProgressCallback,
): Promise<InstallResult> {
  const fileName = firmwareFileName(version);
  const destPath = path.join(sdCardPath, fileName);
  const partialPath = `${destPath}.partial`;
  const expectedSize = (await stat(localPath)).size;

  try {
    await copyFileWithProgress(localPath, partialPath, onProgress);
    const written = (await stat(partialPath)).size;
    if (written !== expectedSize) {
      throw new Error(`SD card copy incomplete: wrote ${written} of ${expectedSize} bytes`);
    }
    await rename(partialPath, destPath);
  } catch (error) {
    await unlink(partialPath).catch(() => {});
    throw error;
  }

  // Only once the new file is in place: remove other update files (they conflict) and
  // leftovers from interrupted copies. Deleted outright; a file manager's trash stays on the card.
  const removed: string[] = [];
  for (const name of await readdir(sdCardPath)) {
    const isOtherUpdate = versionFromFileName(name) !== null && name.toLowerCase() !== fileName;
    if (isOtherUpdate || PARTIAL_FILE_PATTERN.test(name)) {
      await unlink(path.join(sdCardPath, name));
      if (isOtherUpdate) removed.push(name);
    }
  }

  // Make the new name (and the removals) durable on the card itself
  await syncToDisk(destPath);
  await syncToDisk(sdCardPath);

  // The download was already verified against Analogue's MD5, so a match here verifies the card copy too
  const [cardMd5, downloadMd5] = await Promise.all([fileHash(destPath, 'md5'), fileHash(localPath, 'md5')]);
  if (cardMd5 !== downloadMd5) {
    throw new Error(`The update file on the SD card doesn't match the download (MD5 ${cardMd5} vs ${downloadMd5}). Run the update again.`);
  }
  return { fileName, md5: cardMd5, removed };
}

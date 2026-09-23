/**
 * 3Dos firmware: latest-release lookup, SD card detection, and download-to-SD.
 *
 * Releases come from Analogue's firmware RSS feed (all products; 3D items are
 * titled "3D Firmware X.Y.Z"). Analogue publishes no checksums.
 *
 * On the SD card the only version markers are the update files themselves
 * (a3d_os_MM_mm_pp.bin). Up to 3Dos 1.5.0 the console left the file in the card
 * root after installing it; from 1.5.1 it moves it to /System/Archived. So a root
 * file is "pending" when the archive has an older (or no newer) version, and the
 * archive's newest file is the installed version.
 */
import { createWriteStream } from 'fs';
import { mkdir, readdir, rename, stat, unlink } from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import type { ReadableStream as WebReadableStream } from 'stream/web';
import { XMLParser } from 'fast-xml-parser';
import { copyFileWithProgress, type ProgressCallback } from './file-transfer.js';

export const FIRMWARE_FEED_URL = 'https://www.analogue.co/feed/firmwares';
const SITE_ORIGIN = 'https://www.analogue.co';
const INSTALL_GUIDE_URL = `${SITE_ORIGIN}/support/3d/guide/getting-started#updating-3dos`;
const USER_AGENT = 'A3D-Manager';
const LATEST_CACHE_MS = 60 * 60 * 1000;
// Real updates are ~22 MB; anything far outside this is not a firmware image
const MIN_FIRMWARE_BYTES = 5 * 1024 * 1024;
const MAX_FIRMWARE_BYTES = 200 * 1024 * 1024;

const FIRMWARE_FILE_PATTERN = /^a3d_os_(\d{2})_(\d{2})_(\d{2})\.bin$/i;
const LOCAL_FIRMWARE_DIR = path.join(process.cwd(), '.local', 'firmware');

/** Release notes as plain-text blocks (the feed's HTML is never passed to the client) */
export type ReleaseNotesBlock =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] };

export interface FirmwareRelease {
  version: string;
  /** ISO timestamp from the feed's pubDate */
  publishedAt: string | null;
  downloadUrl: string;
  releaseNotesUrl: string;
  installGuideUrl: string;
  notes: ReleaseNotesBlock[];
}

export interface FirmwareFeed {
  /** 3D releases, newest version first */
  releases: FirmwareRelease[];
  checkedAt: string;
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
// Releases (RSS feed)
// =============================================================================

const FEED_TITLE_PATTERN = /^3D Firmware (\d+\.\d+\.\d+)$/;
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

interface FeedItem {
  title?: string;
  link?: string;
  pubDate?: string;
  'content:encoded'?: string;
}

export function parseFirmwareFeed(xml: string, checkedAt = new Date()): FirmwareFeed {
  const parser = new XMLParser({ isArray: (name) => name === 'item' });
  const items: FeedItem[] = parser.parse(xml)?.rss?.channel?.item ?? [];

  const releases: FirmwareRelease[] = [];
  for (const item of items) {
    const version = FEED_TITLE_PATTERN.exec(String(item.title ?? '').trim())?.[1];
    if (!version) continue; // other Analogue products
    const published = item.pubDate ? new Date(item.pubDate) : null;
    releases.push({
      version,
      publishedAt: published && !Number.isNaN(published.getTime()) ? published.toISOString() : null,
      // Same pattern as the "Download" button on the support page (the feed has no download link)
      downloadUrl: `${SITE_ORIGIN}/support/3d/firmware/${version}/download`,
      releaseNotesUrl: `${SITE_ORIGIN}/support/3d/firmware/${version}`,
      installGuideUrl: INSTALL_GUIDE_URL,
      notes: parseReleaseNotes(String(item['content:encoded'] ?? '')),
    });
  }
  if (releases.length === 0) {
    throw new Error(`No 3D firmware releases found in ${FIRMWARE_FEED_URL} (the feed format may have changed)`);
  }
  releases.sort((a, b) => compareVersions(b.version, a.version));
  return { releases, checkedAt: checkedAt.toISOString() };
}

let feedCache: { feed: FirmwareFeed; fetchedAt: number } | null = null;

export async function fetchFirmwareFeed(options: { force?: boolean } = {}): Promise<FirmwareFeed> {
  if (!options.force && feedCache && Date.now() - feedCache.fetchedAt < LATEST_CACHE_MS) {
    return feedCache.feed;
  }
  const response = await fetch(FIRMWARE_FEED_URL, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/rss+xml, application/xml' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Analogue firmware feed returned HTTP ${response.status}`);
  }
  const feed = parseFirmwareFeed(await response.text());
  feedCache = { feed, fetchedAt: Date.now() };
  return feed;
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

  const trashedFiles: SDFirmwareStatus['trashedFiles'] = [];
  for (const entry of await readdir(sdCardPath, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\.Trash(-\d+)?$/.test(entry.name)) continue;
    for (const file of await listUpdateFiles(path.join(sdCardPath, entry.name, 'files'))) {
      trashedFiles.push({ path: path.join(entry.name, 'files', file.name), size: file.size });
    }
  }

  return { files, archivedFiles, installedVersion, pendingVersion, consoleArchives, trashedFiles };
}

// =============================================================================
// Download + install
// =============================================================================

export type FirmwarePhase = 'download' | 'copy';

function isAnalogueHost(url: URL): boolean {
  return url.protocol === 'https:' && (url.hostname === 'analogue.co' || url.hostname.endsWith('.analogue.co'));
}

/**
 * Download the release into .local/firmware/, reusing an existing copy when its
 * size matches what the server reports. Returns the local file path.
 */
export async function downloadFirmware(release: FirmwareRelease, onProgress: ProgressCallback): Promise<string> {
  const expectedName = firmwareFileName(release.version);
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

  await mkdir(LOCAL_FIRMWARE_DIR, { recursive: true });
  const localPath = path.join(LOCAL_FIRMWARE_DIR, expectedName);

  const existing = await stat(localPath).catch(() => null);
  if (existing?.size === totalBytes) {
    await response.body.cancel();
    onProgress({ bytesWritten: totalBytes, totalBytes, percentage: 100, elapsedMs: 0, bytesPerSecond: 0, estimatedTimeRemainingMs: 0 });
    return localPath;
  }

  const partialPath = `${localPath}.partial`;
  const startTime = Date.now();
  let bytesWritten = 0;
  let lastEmit = 0;
  const body = Readable.fromWeb(response.body as WebReadableStream<Uint8Array>);
  body.on('data', (chunk: Buffer) => {
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
    await rename(partialPath, localPath);
  } catch (error) {
    await unlink(partialPath).catch(() => {});
    throw error;
  }
  return localPath;
}

export interface InstallResult {
  fileName: string;
}

/**
 * Copy the update file to the card root, written as .partial and renamed once
 * verified. Existing update files are left alone: the console archives them
 * itself (3Dos 1.5.1+ moves them to /System/Archived after updating).
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

  // Clear leftovers from earlier interrupted copies (only our own .partial files)
  for (const name of await readdir(sdCardPath)) {
    if (/^a3d_os_.*\.bin\.partial$/i.test(name)) {
      await unlink(path.join(sdCardPath, name)).catch(() => {});
    }
  }
  return { fileName };
}

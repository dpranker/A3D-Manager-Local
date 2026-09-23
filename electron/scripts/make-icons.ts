/**
 * Generates the desktop app icon: the app's N64 cartridge sprite in black on a
 * rounded tile in the accent yellow.
 *
 *   npx tsx electron/scripts/make-icons.ts
 *
 * Writes electron/resources/icon.png (1024px; electron-builder derives the
 * Windows .ico and macOS .icns from it) and electron/resources/icons/NxN.png
 * for Linux.
 */
import { mkdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = path.join(rootDir, 'electron', 'resources');

// Design grid: 160x160 tile, corner radius 28, the 150x98 cartridge sprite at (5, 31)
const GRID = 160;
const SCALE = 8; // master is 1280px so the sprite's pixels scale by a whole number
const ACCENT = '#f4cd01'; // --color-accent
const SHELL = '#000000';
const LINUX_SIZES = [16, 24, 32, 48, 64, 128, 256, 512];

async function renderMaster(): Promise<Buffer> {
  const size = GRID * SCALE;
  const tile = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
      `<rect width="${size}" height="${size}" rx="${28 * SCALE}" fill="${ACCENT}"/></svg>`,
  );

  // The shell sprite is one flat color plus transparency: reuse its alpha, recolored
  const sprite = sharp(path.join(rootDir, 'public', 'n64-cart-dark.png'));
  const { width = 150, height = 98 } = await sprite.metadata();
  const alpha = await sprite.clone().ensureAlpha().extractChannel(3).toBuffer();
  // Two steps: sharp resizes before joinChannel within a single pipeline
  const recolored = await sharp({ create: { width, height, channels: 3, background: SHELL } })
    .joinChannel(alpha)
    .png()
    .toBuffer();
  const shell = await sharp(recolored)
    .resize(width * SCALE, height * SCALE, { kernel: 'nearest' })
    .png()
    .toBuffer();

  return sharp(tile)
    .composite([{ input: shell, left: 5 * SCALE, top: 31 * SCALE }])
    .png()
    .toBuffer();
}

async function main() {
  const master = await renderMaster();
  await mkdir(path.join(outDir, 'icons'), { recursive: true });

  await sharp(master).resize(1024, 1024, { kernel: 'lanczos3' }).png().toFile(path.join(outDir, 'icon.png'));
  for (const size of LINUX_SIZES) {
    await sharp(master)
      .resize(size, size, { kernel: 'lanczos3' })
      .png()
      .toFile(path.join(outDir, 'icons', `${size}x${size}.png`));
  }
  console.log(`Wrote ${path.relative(rootDir, outDir)}/icon.png and icons/{${LINUX_SIZES.join(',')}}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

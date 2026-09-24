import archiver from 'archiver';
import { Router } from 'express';
import path from 'path';
import sharp from 'sharp';
import { CAPTURE_KINDS, deleteCaptures, findCapture, listCaptures, type CaptureKind } from '../lib/screenshots.js';

const router = Router();
const CART_ID = /^[0-9a-fA-F]{8}$/;
const THUMB_WIDTH = 320;
const THUMB_CACHE_LIMIT = 300;

// Thumbnails keyed by path, size and mtime, so a replaced file gets a new one
const thumbCache = new Map<string, Buffer>();

const isKind = (value: unknown): value is CaptureKind => CAPTURE_KINDS.includes(value as CaptureKind);
const queryString = (value: unknown) => (typeof value === 'string' && value ? value : undefined);

// GET /api/screenshots/:cartId?sdCardPath=...&kinds=screenshot,export - one cartridge's screenshots, 4K exports and/or Memories
router.get('/:cartId', async (req, res) => {
  const { cartId } = req.params;
  const sdCardPath = queryString(req.query.sdCardPath);
  const kinds = queryString(req.query.kinds)?.split(',') ?? [...CAPTURE_KINDS];
  if (!CART_ID.test(cartId)) return res.status(400).json({ error: 'Invalid cart ID format' });
  if (!kinds.every(isKind)) return res.status(400).json({ error: `kinds must be from: ${CAPTURE_KINDS.join(', ')}` });
  if (!sdCardPath) return res.json({ captures: [] });

  try {
    res.json({ captures: await listCaptures(sdCardPath, cartId, kinds) });
  } catch (error) {
    console.error('Error listing screenshots:', error);
    res.status(500).json({ error: 'Failed to read screenshots from the SD card' });
  }
});

// GET /api/screenshots/:cartId/image?sdCardPath=&kind=&file=&variant=thumb|full|download
router.get('/:cartId/image', async (req, res) => {
  const { cartId } = req.params;
  const sdCardPath = queryString(req.query.sdCardPath);
  const file = queryString(req.query.file);
  const { kind, variant = 'full' } = req.query;
  if (!CART_ID.test(cartId) || !sdCardPath || !file || !isKind(kind)) {
    return res.status(400).json({ error: 'cartId, sdCardPath, kind and file are required' });
  }

  try {
    const capture = await findCapture(sdCardPath, cartId, kind, file);
    if (!capture) return res.status(404).json({ error: 'Not found on the SD card' });

    if (variant === 'download') {
      // The original file, untouched: it's signed, and a Memory's save state rides along
      return res.download(capture.path, path.basename(capture.path));
    }

    // HDR captures would lose their color data if re-encoded, so they're shown as they are
    if (variant === 'thumb' && !capture.info.hdr) {
      const key = `${capture.path}:${capture.info.size}`;
      let thumb = thumbCache.get(key);
      if (!thumb) {
        // Console captures are 4:3 whatever their pixel size (320x240, 640x240, 1280x240, 640x480)
        const height = kind === 'export' ? Math.round((THUMB_WIDTH * capture.info.height) / capture.info.width) : (THUMB_WIDTH * 3) / 4;
        thumb = await sharp(capture.path).resize(THUMB_WIDTH, height, { fit: 'fill' }).webp({ quality: 85 }).toBuffer();
        if (thumbCache.size >= THUMB_CACHE_LIMIT) thumbCache.delete(thumbCache.keys().next().value!);
        thumbCache.set(key, thumb);
      }
      res.setHeader('Content-Type', 'image/webp');
      res.setHeader('Cache-Control', 'private, max-age=300');
      return res.send(thumb);
    }

    res.setHeader('Cache-Control', 'private, max-age=300');
    res.sendFile(capture.path);
  } catch (error) {
    console.error('Error reading screenshot:', error);
    res.status(500).json({ error: 'Failed to read the screenshot' });
  }
});

// GET /api/screenshots/:cartId/archive?sdCardPath=&kinds=memory - every matching file as one zip, unchanged
router.get('/:cartId/archive', async (req, res) => {
  const { cartId } = req.params;
  const sdCardPath = queryString(req.query.sdCardPath);
  const kinds = queryString(req.query.kinds)?.split(',') ?? [...CAPTURE_KINDS];
  if (!CART_ID.test(cartId) || !sdCardPath) return res.status(400).json({ error: 'cartId and sdCardPath are required' });
  if (!kinds.every(isKind)) return res.status(400).json({ error: `kinds must be from: ${CAPTURE_KINDS.join(', ')}` });

  try {
    const captures = await listCaptures(sdCardPath, cartId, kinds);
    if (!captures.length) return res.status(404).json({ error: 'Nothing to back up' });

    // Named after the console's folder, e.g. "Ogre Battle 64 Person of Lordly Caliber b372fa05 Memories.zip"
    const folder = captures.find((c) => c.file.includes('/'))?.file.split('/')[0] ?? cartId;
    const label = kinds.length === 1 && kinds[0] === 'memory' ? 'Memories' : 'Captures';
    res.attachment(`${folder} ${label}.zip`);

    // PNG data is already compressed; a light level still shrinks the save states
    const archive = archiver('zip', { zlib: { level: 1 } });
    archive.on('error', (error) => {
      console.error('Error writing archive:', error);
      res.destroy(error);
    });
    archive.pipe(res);
    for (const capture of captures) {
      const found = await findCapture(sdCardPath, cartId, capture.kind, capture.file);
      if (found) archive.file(found.path, { name: path.basename(found.path) });
    }
    await archive.finalize();
  } catch (error) {
    console.error('Error archiving captures:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to back up files' });
    else res.destroy();
  }
});

// POST /api/screenshots/:cartId/delete - body { sdCardPath, items: [{ kind, file }] }
router.post('/:cartId/delete', async (req, res) => {
  const { cartId } = req.params;
  const { sdCardPath, items } = req.body ?? {};
  if (!CART_ID.test(cartId)) return res.status(400).json({ error: 'Invalid cart ID format' });
  if (typeof sdCardPath !== 'string' || !sdCardPath) return res.status(400).json({ error: 'SD card path is required' });
  if (
    !Array.isArray(items) ||
    !items.length ||
    !items.every((item) => item && isKind(item.kind) && typeof item.file === 'string')
  ) {
    return res.status(400).json({ error: 'items must list { kind, file } entries' });
  }

  try {
    res.json(await deleteCaptures(sdCardPath, cartId, items));
  } catch (error) {
    console.error('Error deleting screenshots:', error);
    res.status(500).json({ error: 'Failed to delete screenshots' });
  }
});

export default router;

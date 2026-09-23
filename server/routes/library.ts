import { Router } from 'express';
import { getSDSettingsSupport } from '../lib/cartridge-settings.js';
import { isKnownCart } from '../lib/game-lookup.js';
import { downloadLibraryFromSD, getLibraryInfo, saveLocalLibrary, uploadLibraryToSD } from '../lib/library-json.js';

const router = Router();
const CART_ID = /^[0-9a-fA-F]{8}$/;

/**
 * library.json only applies to cartridges outside the console's built-in database.
 * The app's cart database stands in for that; a library.json the console itself
 * created on the card also marks the cart as unknown to the console.
 */
async function isEditable(cartId: string, sdHasLibrary: boolean): Promise<boolean> {
  return sdHasLibrary || !(await isKnownCart(cartId));
}

// GET /api/library/:cartId?sdCardPath=... - local and SD card library.json, plus whether it can be edited/synced
router.get('/:cartId', async (req, res) => {
  const { cartId } = req.params;
  const sdCardPath = typeof req.query.sdCardPath === 'string' ? req.query.sdCardPath : undefined;
  if (!CART_ID.test(cartId)) return res.status(400).json({ error: 'Invalid cart ID format' });

  try {
    const info = await getLibraryInfo(cartId, sdCardPath);
    res.json({
      ...info,
      editable: await isEditable(cartId, info.sd?.exists ?? false),
      sdSupport: sdCardPath ? await getSDSettingsSupport(sdCardPath) : null,
    });
  } catch (error) {
    console.error('Error reading library.json:', error);
    res.status(500).json({ error: 'Failed to read library.json' });
  }
});

// PUT /api/library/:cartId?sdCardPath=... - save locally and, when possible, to the SD card
router.put('/:cartId', async (req, res) => {
  const { cartId } = req.params;
  const sdCardPath = typeof req.query.sdCardPath === 'string' ? req.query.sdCardPath : undefined;
  if (!CART_ID.test(cartId)) return res.status(400).json({ error: 'Invalid cart ID format' });

  try {
    const sdHasLibrary = sdCardPath ? ((await getLibraryInfo(cartId, sdCardPath)).sd?.exists ?? false) : false;
    if (!(await isEditable(cartId, sdHasLibrary))) {
      return res.status(400).json({
        error: "This cartridge is in the built-in database; the console uses its own details and ignores library.json",
      });
    }

    let localPath: string;
    try {
      localPath = await saveLocalLibrary(cartId, req.body);
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid library.json' });
    }

    const sd = sdCardPath ? await uploadLibraryToSD(cartId, sdCardPath) : null;
    res.json({ success: true, path: localPath, sd });
  } catch (error) {
    console.error('Error saving library.json:', error);
    res.status(500).json({ error: 'Failed to save library.json' });
  }
});

// POST /api/library/:cartId/download - replace the local copy with the SD card's
router.post('/:cartId/download', async (req, res) => {
  const { cartId } = req.params;
  const { sdCardPath } = req.body ?? {};
  if (!CART_ID.test(cartId)) return res.status(400).json({ error: 'Invalid cart ID format' });
  if (typeof sdCardPath !== 'string' || !sdCardPath) return res.status(400).json({ error: 'SD card path is required' });

  const result = await downloadLibraryFromSD(cartId, sdCardPath);
  if (result.success) res.json(result);
  else res.status(400).json({ error: result.error });
});

export default router;

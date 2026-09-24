import type { RequestHandler } from 'express';
import path from 'path';
import { isValidAnalogueDir } from './sd-card.js';

export const CART_ID_PATTERN = /^[0-9a-fA-F]{8}$/;

/**
 * Every route that reads or writes the SD card takes its path as sdCardPath (query
 * or JSON body). Checked once here for all of them: if one is given it must be an
 * absolute path to an Analogue 3D card (one with Library/N64/library.db). Routes
 * still decide for themselves whether the card is required.
 */
export const sdCardPathGuard: RequestHandler = async (req, res, next) => {
  const values = [req.query?.sdCardPath, (req.body as { sdCardPath?: unknown } | undefined)?.sdCardPath];
  for (const value of values) {
    if (value === undefined || value === '') continue;
    if (typeof value !== 'string' || !path.isAbsolute(value) || !(await isValidAnalogueDir(value))) {
      res.status(400).json({ error: 'Not an Analogue 3D SD card' });
      return;
    }
  }
  next();
};

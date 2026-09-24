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

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const IP_LITERAL = /^(\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:.]+\])$/i;

/** Host name without the port ("[::1]:3001" -> "[::1]") */
function hostName(hostHeader: string): string {
  return hostHeader.startsWith('[') ? hostHeader.slice(0, hostHeader.indexOf(']') + 1) : hostHeader.split(':')[0];
}

/**
 * Browser/Docker mode: the API changes local data and the SD card, so only the app's
 * own pages may call it.
 * - Host must be loopback, an IP address (e.g. Docker reached by LAN IP), or listed in
 *   A3D_ALLOWED_HOSTS (comma-separated names). A made-up domain pointed at this machine
 *   (DNS rebinding) is refused.
 * - Origin, when the browser sends one, must be the page's own host or loopback (the
 *   Vite dev server). Other websites are refused.
 * The desktop app has its own stricter check (electron/embedded-server.ts).
 */
export const webOriginGuard: RequestHandler = (req, res, next) => {
  const allowedNames = new Set(
    (process.env.A3D_ALLOWED_HOSTS ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean),
  );
  const isAllowedName = (name: string) =>
    LOOPBACK_HOSTS.has(name) || IP_LITERAL.test(name) || allowedNames.has(name);

  const host = req.headers.host?.toLowerCase();
  if (!host || !isAllowedName(hostName(host))) {
    res.status(403).json({ error: `Host ${host ?? '(none)'} isn't allowed. Add it to A3D_ALLOWED_HOSTS to use the app under that name.` });
    return;
  }

  const origin = req.headers.origin;
  if (origin) {
    let originHost: string;
    try {
      originHost = new URL(origin).host.toLowerCase();
    } catch {
      res.status(403).json({ error: 'Forbidden origin' });
      return;
    }
    if (originHost !== host && !LOOPBACK_HOSTS.has(hostName(originHost))) {
      res.status(403).json({ error: 'Forbidden origin' });
      return;
    }
  }
  next();
};

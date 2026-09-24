/**
 * Runs the upstream Express API (server/index.ts) inside the Electron main process.
 *
 * Loaded via dynamic import from main.ts *after* the working directory and
 * environment are prepared, because the server resolves its data paths from
 * process.cwd() at module load time.
 */
import express, { type RequestHandler } from 'express';
import path from 'path';
import type { AddressInfo } from 'net';
import { app as apiApp, ensureLocalDirs } from '../server/index.ts';
import { whenWritesIdle } from '../server/lib/safe-write.ts';

const HOST = '127.0.0.1';

export interface EmbeddedServerOptions {
  /** Fixed port (dev mode, so Vite can proxy to it); 0 or omitted picks a free port */
  port?: number;
  /** Built Vite client to serve; omit when the renderer is served by the Vite dev server */
  distPath?: string;
  /** Extra origins allowed to call the API (the Vite dev server in dev mode) */
  extraOrigins?: string[];
}

export interface EmbeddedServer {
  url: string;
  close(): Promise<void>;
  /** Resolves once no file write is in progress, or after timeoutMs (false then) */
  whenWritesIdle(timeoutMs: number): Promise<boolean>;
}

/**
 * The API is only for our own window. Reject requests from other origins (the
 * upstream app enables permissive CORS for web mode) and requests whose Host
 * header isn't loopback, which blocks DNS-rebinding attempts from web pages.
 */
function localOnly(getPort: () => number, extraOrigins: string[]): RequestHandler {
  return (req, res, next) => {
    const port = getPort();
    const allowedHosts = [`${HOST}:${port}`, `localhost:${port}`];
    const allowedOrigins = [...allowedHosts.map((h) => `http://${h}`), ...extraOrigins];

    if (!req.headers.host || !allowedHosts.includes(req.headers.host)) {
      res.status(403).json({ error: 'Forbidden host' });
      return;
    }
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.includes(origin)) {
      res.status(403).json({ error: 'Forbidden origin' });
      return;
    }
    next();
  };
}

export async function startEmbeddedServer(options: EmbeddedServerOptions = {}): Promise<EmbeddedServer> {
  await ensureLocalDirs();

  let port = options.port ?? 0;
  const app = express();
  app.use(localOnly(() => port, options.extraOrigins ?? []));
  app.use(apiApp);

  if (options.distPath) {
    const distPath = options.distPath;
    app.use(express.static(distPath));
    // SPA fallback for client-side routes
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve, reject) => {
    const s = app.listen(port, HOST, () => resolve(s));
    s.once('error', reject);
  });
  port = (server.address() as AddressInfo).port;

  return {
    url: `http://${HOST}:${port}`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
    whenWritesIdle,
  };
}

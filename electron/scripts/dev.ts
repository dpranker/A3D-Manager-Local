/**
 * npm run electron:dev
 *
 * 1. Reserves a free loopback port for the embedded API server.
 * 2. Starts the Vite dev server (HMR) with its /api proxy pointed at that port.
 * 3. Bundles the main/preload code with esbuild in watch mode.
 * 4. Launches Electron, restarting it whenever main/preload/server code changes.
 *    Extra args are passed to Electron: npm run electron:dev -- --remote-debugging-port=9222
 */
import { spawn, type ChildProcess } from 'child_process';
import electronBinary from 'electron';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'vite';
import { createBuildContexts } from './build.ts';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

async function main() {
  const apiPort = await getFreePort();

  const vite = await createServer({
    root: rootDir,
    server: {
      proxy: {
        '/api': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: true },
      },
    },
  });
  await vite.listen();
  const devServerUrl = vite.resolvedUrls?.local[0];
  if (!devServerUrl) throw new Error('Vite dev server did not report a URL');
  vite.printUrls();

  let electron: ChildProcess | null = null;
  let restarting = false;
  let shuttingDown = false;

  const shutdown = async (code = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    electron?.kill();
    await Promise.all(contexts.map((c) => c.dispose()));
    await vite.close();
    process.exit(code);
  };

  const launchElectron = () => {
    electron = spawn(electronBinary as unknown as string, ['.', ...process.argv.slice(2)], {
      cwd: rootDir,
      stdio: 'inherit',
      env: {
        ...process.env,
        A3D_DEV_SERVER_URL: devServerUrl,
        A3D_API_PORT: String(apiPort),
      },
    });
    electron.once('exit', (code) => {
      if (restarting) {
        restarting = false;
        launchElectron();
      } else {
        // Window closed by the user: stop everything
        void shutdown(code ?? 0);
      }
    });
  };

  // watch() does an initial build per bundle; launch once all have finished it, restart after later builds
  let bundlesAwaitingFirstBuild = 0;
  let firstBuildFailed = false;
  let restartTimer: NodeJS.Timeout | undefined;
  const contexts = await createBuildContexts([
    {
      name: 'restart-electron',
      setup(b) {
        let built = false;
        bundlesAwaitingFirstBuild++;
        b.onEnd((result) => {
          if (!built) {
            built = true;
            firstBuildFailed ||= result.errors.length > 0;
            if (--bundlesAwaitingFirstBuild === 0) {
              if (firstBuildFailed) void shutdown(1);
              else launchElectron();
            }
            return;
          }
          if (result.errors.length > 0 || shuttingDown) return;
          // Debounce: one edit can rebuild several bundles
          clearTimeout(restartTimer);
          restartTimer = setTimeout(() => {
            console.log('[electron:dev] main process changed, restarting Electron…');
            if (electron && electron.exitCode === null) {
              restarting = true;
              const stopping = electron;
              stopping.kill();
              setTimeout(() => {
                if (stopping.exitCode === null && stopping.signalCode === null) stopping.kill('SIGKILL');
              }, 3000);
            } else {
              launchElectron();
            }
          }, 200);
        });
      },
    },
  ]);

  await Promise.all(contexts.map((c) => c.watch()));

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

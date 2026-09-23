/**
 * Electron main process: runs the Express API in-process on 127.0.0.1 and
 * shows the React client in a BrowserWindow.
 *
 * Dev (npm run electron:dev): electron/scripts/dev.ts starts Vite and passes
 *   A3D_DEV_SERVER_URL + A3D_API_PORT; data lives in the repo like web mode.
 * Packaged: the client is served from dist/ by Express; data lives in userData/workspace.
 */
import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { cpSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { IPC_CHANNELS, type ChooseSDCardResult } from '../src/desktop/bridge.ts';
import type { EmbeddedServer } from './embedded-server.ts';
import { SDCardLocation } from './sd-card-location.ts';

const APP_NAME = 'A3D Manager';
const outDir = path.dirname(fileURLToPath(import.meta.url));
const devServerUrl = process.env.A3D_DEV_SERVER_URL;

// Same userData location in dev and packaged builds
app.setName(APP_NAME);
app.setPath('userData', path.join(app.getPath('appData'), APP_NAME));

let mainWindow: BrowserWindow | null = null;
let server: EmbeddedServer | null = null;
let appOrigin = '';
const sdCardLocation = new SDCardLocation(app.getPath('userData'));

/**
 * The server keeps .local/ (and reads data/) relative to process.cwd(). In a
 * packaged app the install dir is read-only (AppImage mounts are), so run from
 * userData/workspace (kept apart from Chromium's profile files) and refresh the
 * bundled data/ there on every launch.
 */
function prepareWorkingDirectory(): void {
  if (!app.isPackaged) return; // dev: keep the repo cwd, sharing .local/ with `npm run dev`

  const workDir = path.join(app.getPath('userData'), 'workspace');
  mkdirSync(workDir, { recursive: true });
  const bundledData = path.join(process.resourcesPath, 'data');
  if (existsSync(bundledData)) {
    cpSync(bundledData, path.join(workDir, 'data'), { recursive: true, force: true });
  }
  process.chdir(workDir);
}

async function startServer(): Promise<EmbeddedServer> {
  process.env.A3D_EMBEDDED = '1';
  // Not bundled into main.js: must evaluate only after the cwd/env setup above
  const { startEmbeddedServer } = await import('./embedded-server.js');
  await sdCardLocation.init();

  if (devServerUrl) {
    return startEmbeddedServer({
      port: Number(process.env.A3D_API_PORT) || 0,
      extraOrigins: [new URL(devServerUrl).origin],
    });
  }
  return startEmbeddedServer({ distPath: path.join(app.getAppPath(), 'dist') });
}

function isOwnOrigin(url: string): boolean {
  try {
    return new URL(url).origin === appOrigin;
  } catch {
    return false;
  }
}

function openExternally(url: string): void {
  if (/^https?:\/\//.test(url)) {
    void shell.openExternal(url);
  }
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 900,
    minHeight: 600,
    title: APP_NAME,
    // Used for the window/taskbar icon on Linux and Windows (macOS uses the bundle icon)
    icon: path.join(app.getAppPath(), 'electron', 'resources', 'icons', '256x256.png'),
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(outDir, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once('ready-to-show', () => win.show());

  // Keep the window on the app; anything else (e.g. help links) opens in the system browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!isOwnOrigin(url)) openExternally(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!isOwnOrigin(url)) {
      event.preventDefault();
      openExternally(url);
    }
  });

  void win.loadURL(devServerUrl ?? server!.url);
  return win;
}

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  if (!event.senderFrame || !isOwnOrigin(event.senderFrame.url)) {
    throw new Error('Untrusted IPC sender');
  }
}

function registerIpc(): void {
  ipcMain.handle(IPC_CHANNELS.getSDCardPath, (event) => {
    assertTrustedSender(event);
    return sdCardLocation.current();
  });

  ipcMain.handle(IPC_CHANNELS.chooseSDCard, async (event): Promise<ChooseSDCardResult> => {
    assertTrustedSender(event);
    const parent = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.OpenDialogOptions = {
      title: 'Choose your Analogue 3D SD card',
      buttonLabel: 'Use this SD card',
      defaultPath: sdCardLocation.current() ?? undefined,
      properties: ['openDirectory'],
    };
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) {
      return { status: 'canceled' };
    }

    const dir = result.filePaths[0];
    const error = await sdCardLocation.select(dir);
    return error ? { status: 'invalid', path: dir, message: error } : { status: 'selected', path: dir };
  });
}

async function bootstrap(): Promise<void> {
  prepareWorkingDirectory();
  server = await startServer();
  appOrigin = new URL(devServerUrl ?? server.url).origin;
  registerIpc();
  mainWindow = createWindow();
}

if (!app.requestSingleInstanceLock()) {
  // Another instance owns the local data; hand over to it
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.on('window-all-closed', () => app.quit());

  // Nothing to flush: stop accepting requests and let process exit drop the sockets
  // (deferring quit here would hang signal-initiated shutdowns)
  app.on('will-quit', () => {
    void server?.close();
    server = null;
  });

  app
    .whenReady()
    .then(bootstrap)
    .catch((error: unknown) => {
      console.error('Failed to start A3D Manager:', error);
      dialog.showErrorBox('A3D Manager failed to start', error instanceof Error ? error.stack ?? error.message : String(error));
      app.exit(1);
    });
}

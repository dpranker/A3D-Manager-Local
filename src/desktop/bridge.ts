/**
 * Contract between the renderer and the Electron preload script (electron/preload.ts).
 * Only exists when running inside the desktop app; in the plain web build
 * `getDesktopBridge()` returns null and desktop-only UI stays hidden.
 */

export type ChooseSDCardResult =
  | { status: 'selected'; path: string }
  | { status: 'canceled' }
  | { status: 'invalid'; path: string; message: string };

export interface DesktopBridge {
  /** Folder currently used to look for SD cards (card root or its parent), if any */
  getSDCardPath(): Promise<string | null>;
  /** Open a native folder picker and, if the choice is valid, start using it */
  chooseSDCard(): Promise<ChooseSDCardResult>;
  /**
   * Register what to run when the app is about to quit (sending queued saves).
   * The main process waits for the returned promise, up to a timeout.
   */
  onFlushSaves(handler: () => Promise<void>): void;
}

export const DESKTOP_BRIDGE_KEY = 'a3dDesktop';

export const IPC_CHANNELS = {
  getSDCardPath: 'a3d:get-sd-card-path',
  chooseSDCard: 'a3d:choose-sd-card',
  /** main -> renderer: send queued saves now (payload: request id) */
  flushSaves: 'a3d:flush-saves',
  /** renderer -> main: done (payload: the same request id) */
  flushSavesDone: 'a3d:flush-saves-done',
} as const;

export function getDesktopBridge(): DesktopBridge | null {
  const bridge = (globalThis as Record<string, unknown>)[DESKTOP_BRIDGE_KEY];
  return (bridge as DesktopBridge | undefined) ?? null;
}

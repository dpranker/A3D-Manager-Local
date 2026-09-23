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
}

export const DESKTOP_BRIDGE_KEY = 'a3dDesktop';

export const IPC_CHANNELS = {
  getSDCardPath: 'a3d:get-sd-card-path',
  chooseSDCard: 'a3d:choose-sd-card',
} as const;

export function getDesktopBridge(): DesktopBridge | null {
  const bridge = (globalThis as Record<string, unknown>)[DESKTOP_BRIDGE_KEY];
  return (bridge as DesktopBridge | undefined) ?? null;
}

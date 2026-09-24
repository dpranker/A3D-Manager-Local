/**
 * Where the server looks for SD cards. Upstream reads SD_VOLUMES_PATH on every
 * detection call, so the desktop app just keeps that env var in sync with the
 * folder the user picked (persisted in userData/desktop-settings.json).
 *
 * Priority: picked folder > SD_VOLUMES_PATH from the environment >
 * the platform's removable-media mount directory.
 */
import { existsSync } from 'fs';
import { readFile, readdir, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

interface DesktopSettings {
  sdCardPath?: string;
}

export class SDCardLocation {
  private readonly settingsFile: string;

  constructor(userDataDir: string) {
    this.settingsFile = path.join(userDataDir, 'desktop-settings.json');
  }

  /** Apply the saved location (else SD_VOLUMES_PATH from the environment, else the OS default) to SD_VOLUMES_PATH */
  async init(): Promise<void> {
    const saved = (await this.readSettings()).sdCardPath;
    const location = saved ?? process.env.SD_VOLUMES_PATH ?? defaultMountDir();
    if (location) {
      process.env.SD_VOLUMES_PATH = location;
    }
  }

  current(): string | null {
    return process.env.SD_VOLUMES_PATH ?? null;
  }

  /** Remember `dir` if it is an SD card root or a folder containing one; returns an error message otherwise */
  async select(dir: string): Promise<string | null> {
    if (!(await containsAnalogueCard(dir))) {
      return 'No Analogue 3D SD card found here. Choose the card itself (the folder that contains "Library/N64/library.db").';
    }
    process.env.SD_VOLUMES_PATH = dir;
    await this.writeSettings({ ...(await this.readSettings()), sdCardPath: dir });
    return null;
  }

  private async readSettings(): Promise<DesktopSettings> {
    try {
      return JSON.parse(await readFile(this.settingsFile, 'utf8')) as DesktopSettings;
    } catch {
      return {};
    }
  }

  private async writeSettings(settings: DesktopSettings): Promise<void> {
    await writeFile(this.settingsFile, JSON.stringify(settings, null, 2));
  }
}

function isCardRoot(dir: string): boolean {
  return existsSync(path.join(dir, 'Library', 'N64', 'library.db'));
}

/** Mirrors the two layouts server/lib/sd-card.ts detectSDCards() accepts */
async function containsAnalogueCard(dir: string): Promise<boolean> {
  if (isCardRoot(dir)) return true;
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.some((e) => e.isDirectory() && isCardRoot(path.join(dir, e.name)));
  } catch {
    return false;
  }
}

function defaultMountDir(): string | undefined {
  const user = os.userInfo().username;
  const candidates =
    process.platform === 'darwin'
      ? ['/Volumes']
      : process.platform === 'linux'
        ? [`/run/media/${user}`, `/media/${user}`]
        : [];
  return candidates.find((dir) => existsSync(dir));
}

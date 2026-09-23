import { contextBridge, ipcRenderer } from 'electron';
import {
  DESKTOP_BRIDGE_KEY,
  IPC_CHANNELS,
  type ChooseSDCardResult,
  type DesktopBridge,
} from '../src/desktop/bridge.ts';

const bridge: DesktopBridge = {
  getSDCardPath: () => ipcRenderer.invoke(IPC_CHANNELS.getSDCardPath) as Promise<string | null>,
  chooseSDCard: () => ipcRenderer.invoke(IPC_CHANNELS.chooseSDCard) as Promise<ChooseSDCardResult>,
};

contextBridge.exposeInMainWorld(DESKTOP_BRIDGE_KEY, bridge);

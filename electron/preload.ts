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
  onFlushSaves: (handler) => {
    ipcRenderer.on(IPC_CHANNELS.flushSaves, (_event, requestId: number) => {
      handler()
        .catch((error: unknown) => console.error('Flushing saves before quit failed:', error))
        .finally(() => ipcRenderer.send(IPC_CHANNELS.flushSavesDone, requestId));
    });
  },
};

contextBridge.exposeInMainWorld(DESKTOP_BRIDGE_KEY, bridge);

import { contextBridge, ipcRenderer } from 'electron';
import type { MachineCompleteArgs, MachineCompleteResult, AppConfig } from './preload-types';

ipcRenderer.on('machine:token', (_event, _payload: { requestId: string; delta: string }) => {
  // The active complete() call attaches its own listener for the duration of the request.
});

contextBridge.exposeInMainWorld('machine', {
  complete: (args: MachineCompleteArgs, onToken?: (delta: string) => void) => {
    const pending = ipcRenderer.invoke('machine:complete', args) as Promise<MachineCompleteResult>;
    if (onToken) {
      const handler = (_e: unknown, payload: { requestId: string; delta: string }) => {
        onToken(payload.delta);
      };
      ipcRenderer.on('machine:token', handler);
      void pending.finally(() => ipcRenderer.removeListener('machine:token', handler));
    }
    return pending;
  },
  abort: (requestId: string) => ipcRenderer.invoke('machine:abort', { requestId }),
});

contextBridge.exposeInMainWorld('config', {
  get: () => ipcRenderer.invoke('config:get') as Promise<AppConfig>,
  pickModelFile: () =>
    ipcRenderer.invoke('config:pickModelFile') as Promise<{ filePath: string | null }>,
  setModelFilePath: (filePath: string | null) =>
    ipcRenderer.invoke('config:setModelFilePath', { filePath }) as Promise<AppConfig>,
});

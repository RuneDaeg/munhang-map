/* oxlint-disable typescript/no-require-imports */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('munhangDesktop', {
  isDesktop: true,
  platform: process.platform,
  getVisionStatus: () => ipcRenderer.invoke('vision:status'),
  recognize: (body) => ipcRenderer.invoke('vision:recognize', body),
  setApiKey: (apiKey) => ipcRenderer.invoke('setup:set-api-key', apiKey),
  skipApiKey: () => ipcRenderer.invoke('setup:skip-api-key'),
  openApiKeySettings: () => ipcRenderer.invoke('setup:open'),
});

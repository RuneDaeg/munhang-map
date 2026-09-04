/* oxlint-disable typescript/no-require-imports */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('munhangDesktop', {
  isDesktop: true,
  platform: process.platform,
  getVisionStatus: () => ipcRenderer.invoke('vision:status'),
  recognize: (body) => ipcRenderer.invoke('vision:recognize', body),
  setConnection: (connection) => ipcRenderer.invoke('setup:set-connection', connection),
  skipApiKey: () => ipcRenderer.invoke('setup:skip-api-key'),
  openApiKeySettings: () => ipcRenderer.invoke('setup:open'),
});

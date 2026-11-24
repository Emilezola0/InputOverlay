const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, cb) {
  const handler = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('inputMemory', {
  onInput: (cb) => subscribe('input', cb),
  onSettings: (cb) => subscribe('settings', cb),
  onClearHistory: (cb) => subscribe('history:clear', cb),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  getDefaults: () => ipcRenderer.invoke('settings:defaults'),
  setSettings: (patch) => ipcRenderer.send('settings:set', patch),
  clearHistory: () => ipcRenderer.send('history:clear'),
  hookStatus: () => ipcRenderer.invoke('hook:status'),
  overlayFit: (width, height) => ipcRenderer.send('overlay:fit', { width, height }),
});

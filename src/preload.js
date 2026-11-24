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
  // Enregistrements
  onRecordToggle: (cb) => subscribe('record:toggle', cb),
  onRecordState: (cb) => subscribe('record:state', cb),
  getRecordState: () => ipcRenderer.invoke('record:getState'),
  setRecordState: (state) => ipcRenderer.send('record:state', state),
  listRecordings: () => ipcRenderer.invoke('recordings:list'),
  loadRecording: (id) => ipcRenderer.invoke('recordings:load', id),
  saveRecording: (session) => ipcRenderer.invoke('recordings:save', session),
  renameRecording: (id, name) => ipcRenderer.invoke('recordings:rename', id, name),
  deleteRecording: (id) => ipcRenderer.invoke('recordings:delete', id),
  exportRecording: (id) => ipcRenderer.invoke('recordings:export', id),
  importRecording: () => ipcRenderer.invoke('recordings:import'),
  overlayFit:(width, height) => ipcRenderer.send('overlay:fit', { width, height }),
});

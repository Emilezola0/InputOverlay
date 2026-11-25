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
  // Entraînement
  listSequences: () => ipcRenderer.invoke('sequences:list'),
  saveSequence: (seq) => ipcRenderer.invoke('sequences:save', seq),
  deleteSequence: (id) => ipcRenderer.invoke('sequences:delete', id),
  onTrainingToggle: (cb) => subscribe('training:toggle', cb),
  onTrainingState: (cb) => subscribe('training:state', cb),
  getTrainingState: () => ipcRenderer.invoke('training:getState'),
  setTrainingState: (state) => ipcRenderer.send('training:state', state),
  // Raccourcis
  getShortcutStatus: () => ipcRenderer.invoke('shortcuts:status'),
  onShortcutStatus: (cb) => subscribe('shortcuts:status', cb),
  suspendShortcuts: (on) => ipcRenderer.send('shortcuts:suspend', on),
  // Essais d'entraînement
  loadAttempts: (id) => ipcRenderer.invoke('attempts:load', id),
  saveAttempts: (id, list) => ipcRenderer.invoke('attempts:save', id, list),
  deleteAttempts: (id) => ipcRenderer.invoke('attempts:delete', id),
  // Mises à jour
  getUpdateState: () => ipcRenderer.invoke('update:get'),
  onUpdateState: (cb) => subscribe('update:state', cb),
  checkUpdates: () => ipcRenderer.send('update:check'),
  installUpdate: () => ipcRenderer.send('update:install'),
  openReleases: () => ipcRenderer.send('update:open'),
  appVersion: () => ipcRenderer.invoke('app:version'),
  overlayFit: (width, height) => ipcRenderer.send('overlay:fit', { width, height }),
  overlayMove: (x, y, done = false) => ipcRenderer.send('overlay:move', { x, y, done }),
  showMainWindow: () => ipcRenderer.send('main:show'),
});

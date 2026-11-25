// Process principal : capture globale clavier/souris (uiohook), fenêtres, réglages.
const { app, BrowserWindow, ipcMain, globalShortcut, screen, shell, dialog, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { uIOhook } = require('uiohook-napi');

// ---------- Réglages ----------
const DEFAULT_SETTINGS = {
  keyboardLayout: 'azerty', // 'azerty' | 'qwerty'
  padStyle: 'xbox', // 'xbox' | 'ps'
  timeUnit: 'ms', // 'ms' | 'frames'
  mergeWindowMs: 25, // appuis simultanés regroupés sur une même ligne
  overlay: {
    visible: true,
    locked: false,
    keyboard: 'gaming', // 'off' | 'gaming' | 'full'
    mouse: false,
    gamepad: false,
    history: true,
    training: true, // widget d'entraînement (visible seulement quand un test est actif)
    direction: 'horizontal', // 'vertical' | 'horizontal'
    scale: 1,
    opacity: 0.92,
    historyRows: 6,
    position: null, // {x, y}
  },
  shortcuts: {
    overlayToggle: 'CommandOrControl+Shift+O',
    overlayLock: 'CommandOrControl+Shift+L',
    record: 'CommandOrControl+Shift+R',
    training: 'CommandOrControl+Shift+T',
    clearHistory: 'CommandOrControl+Shift+Backspace',
  },
};

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
let settings = structuredClone(DEFAULT_SETTINGS);

function deepMerge(target, patch) {
  for (const [k, v] of Object.entries(patch || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object') {
      deepMerge(target[k], v);
    } else {
      target[k] = v;
    }
  }
  return target;
}

function loadSettings() {
  try {
    const saved = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    settings = deepMerge(structuredClone(DEFAULT_SETTINGS), saved);
  } catch {
    settings = structuredClone(DEFAULT_SETTINGS);
  }
}

let saveTimer = null;
function saveSettingsSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
      fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
    } catch (e) {
      console.error('Impossible de sauvegarder les réglages', e);
    }
  }, 300);
}

function updateSettings(patch) {
  deepMerge(settings, patch);
  saveSettingsSoon();
  applyOverlaySettings();
  if (patch && patch.shortcuts) registerShortcuts();
  broadcast('settings', settings);
}

// ---------- Fenêtres ----------
let mainWin = null;
let overlayWin = null;

function broadcast(channel, payload) {
  for (const w of [mainWin, overlayWin]) {
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
  }
}

const commonPrefs = {
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true,
  nodeIntegration: false,
  backgroundThrottling: false, // on continue à lire la manette même en arrière-plan
};

function createMainWindow() {
  mainWin = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'InputMemory',
    backgroundColor: '#0f1117',
    autoHideMenuBar: true,
    webPreferences: commonPrefs,
  });
  mainWin.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWin.on('closed', () => {
    mainWin = null;
    app.quit();
  });
}

function createOverlayWindow() {
  const pos = settings.overlay.position;
  const wa = screen.getPrimaryDisplay().workArea;
  overlayWin = new BrowserWindow({
    width: 420,
    height: 300,
    x: pos ? pos.x : wa.x + 20,
    y: pos ? pos.y : wa.y + wa.height - 320,
    frame: false,
    transparent: true,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: !settings.overlay.locked,
    show: false,
    title: 'InputMemory Overlay',
    webPreferences: commonPrefs,
  });
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  overlayWin.setVisibleOnAllWorkspaces(true);
  overlayWin.loadFile(path.join(__dirname, 'renderer', 'overlay.html'));
  overlayWin.once('ready-to-show', applyOverlaySettings);

  overlayWin.on('moved', () => {
    const [x, y] = overlayWin.getPosition();
    settings.overlay.position = { x, y };
    saveSettingsSoon();
  });
  overlayWin.on('closed', () => (overlayWin = null));
}

function applyOverlaySettings() {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  const o = settings.overlay;
  overlayWin.setIgnoreMouseEvents(o.locked);
  overlayWin.setFocusable(!o.locked);
  if (o.visible && !overlayWin.isVisible()) overlayWin.showInactive();
  if (!o.visible && overlayWin.isVisible()) overlayWin.hide();
}

// ---------- Capture globale (clavier + souris) ----------
let hookStatus = { ok: false, error: null };
const pressedKeys = new Set();
const pressedButtons = new Set();

function startHook() {
  uIOhook.on('keydown', (e) => {
    if (pressedKeys.has(e.keycode)) return; // ignore l'auto-répétition
    pressedKeys.add(e.keycode);
    broadcast('input', { type: 'down', device: 'kb', code: e.keycode });
  });
  uIOhook.on('keyup', (e) => {
    pressedKeys.delete(e.keycode);
    broadcast('input', { type: 'up', device: 'kb', code: e.keycode });
  });
  uIOhook.on('mousedown', (e) => {
    if (pressedButtons.has(e.button)) return;
    pressedButtons.add(e.button);
    broadcast('input', { type: 'down', device: 'mouse', code: e.button });
  });
  uIOhook.on('mouseup', (e) => {
    pressedButtons.delete(e.button);
    broadcast('input', { type: 'up', device: 'mouse', code: e.button });
  });
  uIOhook.on('wheel', (e) => {
    // direction 3 = verticale, 4 = horizontale ; rotation < 0 = vers le haut
    const dir = e.direction === 4 ? (e.rotation < 0 ? 'left' : 'right') : e.rotation < 0 ? 'up' : 'down';
    broadcast('input', { type: 'tap', device: 'mouse', code: 'wheel-' + dir });
  });
  try {
    uIOhook.start();
    hookStatus = { ok: true, error: null };
  } catch (e) {
    hookStatus = { ok: false, error: String(e && e.message ? e.message : e) };
    console.error('uIOhook: échec du démarrage', e);
  }
}

// ---------- IPC ----------
ipcMain.handle('settings:get', () => settings);
ipcMain.handle('settings:defaults', () => DEFAULT_SETTINGS);
ipcMain.on('settings:set', (_e, patch) => updateSettings(patch));
ipcMain.handle('hook:status', () => hookStatus);
ipcMain.on('history:clear', () => broadcast('history:clear'));
ipcMain.on('overlay:fit', (_e, { width, height }) => {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  const w = Math.max(60, Math.ceil(width));
  const h = Math.max(40, Math.ceil(height));
  const b = overlayWin.getBounds();
  if (b.width === w && b.height === h) return;
  // garde l'overlay entièrement visible sur son écran
  const wa = screen.getDisplayMatching(b).workArea;
  const x = Math.max(wa.x, Math.min(b.x, wa.x + wa.width - w));
  const y = Math.max(wa.y, Math.min(b.y, wa.y + wa.height - h));
  overlayWin.setBounds({ x, y, width: w, height: h });
});

// ---------- Enregistrements (V2) ----------
const recDir = () => path.join(app.getPath('userData'), 'recordings');
const recFile = (id) => path.join(recDir(), `${String(id).replace(/[^\w-]/g, '')}.json`);
const metaOf = (s) => ({ id: s.id, name: s.name, createdAt: s.createdAt, durationMs: s.durationMs, count: s.events.length });
let recordState = { active: false, startedAt: null };

function readSession(file) {
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    return s && Array.isArray(s.events) ? s : null;
  } catch {
    return null;
  }
}

function writeSession(s) {
  fs.mkdirSync(recDir(), { recursive: true });
  fs.writeFileSync(recFile(s.id), JSON.stringify(s));
  return metaOf(s);
}

const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

ipcMain.handle('recordings:list', () => {
  if (!fs.existsSync(recDir())) return [];
  return fs.readdirSync(recDir())
    .filter((f) => f.endsWith('.json'))
    .map((f) => readSession(path.join(recDir(), f)))
    .filter(Boolean)
    .map(metaOf)
    .sort((a, b) => b.createdAt - a.createdAt);
});
ipcMain.handle('recordings:load', (_e, id) => readSession(recFile(id)));
ipcMain.handle('recordings:save', (_e, s) => writeSession({ ...s, id: s.id || newId() }));
ipcMain.handle('recordings:rename', (_e, id, name) => {
  const s = readSession(recFile(id));
  if (!s) return null;
  s.name = String(name).slice(0, 80);
  return writeSession(s);
});
ipcMain.handle('recordings:delete', async (_e, id) => {
  // corbeille plutôt que suppression définitive
  await shell.trashItem(recFile(id));
  return true;
});
ipcMain.handle('recordings:export', async (_e, id) => {
  const s = readSession(recFile(id));
  if (!s) return false;
  const { canceled, filePath } = await dialog.showSaveDialog(mainWin, {
    title: 'Exporter la session',
    defaultPath: `${s.name.replace(/[\\/:*?"<>|]/g, '-')}.json`,
    filters: [{ name: 'Session InputMemory', extensions: ['json'] }],
  });
  if (canceled || !filePath) return false;
  fs.writeFileSync(filePath, JSON.stringify(s, null, 1));
  return true;
});
ipcMain.handle('recordings:import', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWin, {
    title: 'Importer une session',
    filters: [{ name: 'Session InputMemory', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (canceled || !filePaths[0]) return null;
  const s = readSession(filePaths[0]);
  if (!s) return null;
  return writeSession({ ...s, id: newId(), name: s.name || path.basename(filePaths[0], '.json') });
});
ipcMain.on('record:state', (_e, state) => {
  recordState = state;
  broadcast('record:state', state);
});
ipcMain.handle('record:getState', () => recordState);

// ---------- Séquences d'entraînement (V3) ----------
const seqFile = () => path.join(app.getPath('userData'), 'sequences.json');
function readSequences() {
  try {
    const list = JSON.parse(fs.readFileSync(seqFile(), 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
function writeSequences(list) {
  fs.mkdirSync(path.dirname(seqFile()), { recursive: true });
  fs.writeFileSync(seqFile(), JSON.stringify(list, null, 1));
}
ipcMain.handle('sequences:list', () => readSequences());
ipcMain.handle('sequences:save', (_e, seq) => {
  const list = readSequences();
  const item = { ...seq, id: seq.id || newId(), updatedAt: Date.now() };
  const i = list.findIndex((x) => x.id === item.id);
  if (i >= 0) list[i] = item;
  else list.unshift(item);
  writeSequences(list);
  return item;
});
ipcMain.handle('sequences:delete', (_e, id) => {
  writeSequences(readSequences().filter((x) => x.id !== id));
  return true;
});
let trainingState = { active: false };
ipcMain.on('training:state', (_e, state) => {
  trainingState = state;
  broadcast('training:state', state);
});
ipcMain.handle('training:getState', () => trainingState);

// ---------- Raccourcis globaux (configurables) ----------
const SHORTCUT_ACTIONS = {
  overlayToggle: () => updateSettings({ overlay: { visible: !settings.overlay.visible } }),
  overlayLock: () => updateSettings({ overlay: { locked: !settings.overlay.locked } }),
  record: () => mainWin?.webContents.send('record:toggle'),
  training: () => mainWin?.webContents.send('training:toggle'),
  clearHistory: () => broadcast('history:clear'),
};
let shortcutStatus = {}; // nom -> 'ok' | 'conflict' | 'invalid' | 'none'
let shortcutsSuspended = false;

function registerShortcuts() {
  globalShortcut.unregisterAll();
  shortcutStatus = {};
  for (const [name, action] of Object.entries(SHORTCUT_ACTIONS)) {
    const acc = settings.shortcuts?.[name];
    if (!acc) {
      shortcutStatus[name] = 'none';
      continue;
    }
    if (shortcutsSuspended) continue;
    try {
      shortcutStatus[name] = globalShortcut.register(acc, action) ? 'ok' : 'conflict';
    } catch {
      shortcutStatus[name] = 'invalid';
    }
  }
  broadcast('shortcuts:status', shortcutStatus);
}
ipcMain.handle('shortcuts:status', () => shortcutStatus);
// pendant la saisie d'un nouveau raccourci, on désactive les raccourcis globaux
ipcMain.on('shortcuts:suspend', (_e, on) => {
  shortcutsSuspended = !!on;
  if (on) globalShortcut.unregisterAll();
  else registerShortcuts();
});

// ---------- Essais d'entraînement sauvegardés ----------
const attemptsFile = (id) => path.join(app.getPath('userData'), 'attempts', `${String(id).replace(/[^\w-]/g, '')}.json`);
ipcMain.handle('attempts:load', (_e, id) => {
  try {
    const list = JSON.parse(fs.readFileSync(attemptsFile(id), 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
});
ipcMain.handle('attempts:save', (_e, id, list) => {
  fs.mkdirSync(path.dirname(attemptsFile(id)), { recursive: true });
  fs.writeFileSync(attemptsFile(id), JSON.stringify(list.slice(-300)));
  return true;
});
ipcMain.handle('attempts:delete', (_e, id) => {
  fs.rmSync(attemptsFile(id), { force: true });
  return true;
});

// ---------- Mises à jour automatiques ----------
const REPO = { owner: 'Emilezola0', repo: 'InputOverlay' };
const RELEASES_URL = `https://github.com/${REPO.owner}/${REPO.repo}/releases/latest`;
const isPortable = () => !!process.env.PORTABLE_EXECUTABLE_DIR;
let updateState = { state: 'idle', version: app.getVersion() };

function setUpdateState(patch) {
  updateState = { ...updateState, ...patch };
  broadcast('update:state', updateState);
}

const newer = (a, b) => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
};

let autoUpdater = null;
async function checkForUpdates() {
  if (!app.isPackaged) {
    setUpdateState({ state: 'dev' });
    return;
  }
  setUpdateState({ state: 'checking' });
  if (isPortable()) {
    // la version portable ne peut pas se remplacer elle-même : on signale juste la nouvelle version
    try {
      const res = await net.fetch(`https://api.github.com/repos/${REPO.owner}/${REPO.repo}/releases/latest`, {
        headers: { 'User-Agent': 'InputMemory-updater', Accept: 'application/vnd.github+json' },
      });
      const rel = await res.json();
      const latest = String(rel.tag_name || '').replace(/^v/, '');
      if (latest && newer(latest, app.getVersion())) setUpdateState({ state: 'available-portable', latest });
      else setUpdateState({ state: 'uptodate' });
    } catch (e) {
      setUpdateState({ state: 'error', error: String(e.message || e) });
    }
    return;
  }
  try {
    await autoUpdater.checkForUpdates();
  } catch (e) {
    setUpdateState({ state: 'error', error: String(e.message || e) });
  }
}

function setupUpdates() {
  if (app.isPackaged && !isPortable()) {
    autoUpdater = require('electron-updater').autoUpdater;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('update-available', (info) => setUpdateState({ state: 'downloading', latest: info.version, percent: 0 }));
    autoUpdater.on('update-not-available', () => setUpdateState({ state: 'uptodate' }));
    autoUpdater.on('download-progress', (p) => setUpdateState({ state: 'downloading', percent: Math.round(p.percent) }));
    autoUpdater.on('update-downloaded', (info) => setUpdateState({ state: 'ready', latest: info.version }));
    autoUpdater.on('error', (e) => setUpdateState({ state: 'error', error: String(e.message || e) }));
  }
  if (!app.isPackaged) return setUpdateState({ state: 'dev' });
  setTimeout(checkForUpdates, 5000);
  setInterval(checkForUpdates, 4 * 60 * 60 * 1000);
}
ipcMain.handle('update:get', () => updateState);
ipcMain.handle('app:version', () => app.getVersion());
ipcMain.on('update:check', () => checkForUpdates());
ipcMain.on('update:install', () => autoUpdater?.quitAndInstall());
ipcMain.on('update:open', () => shell.openExternal(RELEASES_URL));

// ---------- Debug : capture des fenêtres puis fermeture (IM_SNAPSHOT=dossier) ----------
function debugSnapshot(dir) {
  for (const [name, w] of [['main', mainWin], ['overlay', overlayWin]]) {
    w.webContents.on('console-message', (e) => console.log(`[${name}] ${e.level}: ${e.message}`));
  }
  let delay = 3500;
  // Événements FACTICES injectés directement dans les fenêtres : aucune vraie touche n'est
  // envoyée au système (ne jamais utiliser uIOhook.keyToggle / keyTap ici).
  const fake = (ms, type, device, code) => setTimeout(() => broadcast('input', { type, device, code }), ms);
  const js = (ms, code) => setTimeout(() => mainWin.webContents.executeJavaScript(code), ms);
  const press = (ms, device, code, hold = 40) => {
    fake(ms, 'down', device, code);
    fake(ms + hold, 'up', device, code);
  };
  if (process.env.IM_FAKE === 'templates') {
    // Modèle Rocket League « Speedflip », test activé, conduite + speedflip factices
    js(800, `document.querySelector('.tab[data-view="training"]').click(); document.getElementById('btn-seq-templates').click();`);
    js(1100, `document.querySelector('.tpl-item[data-tpl="0"]').click();`);
    js(1500, `document.getElementById('btn-train-toggle').click();`);
    for (const [ms, code] of [[1700, 7], [1720, 1], [1760, 'ls:→']]) fake(ms, 'down', 'pad', code);
    fake(1900, 'up', 'pad', 'ls:→');
    const t = 2100;
    for (const [ms, type, code] of [[t, 'down', 0], [t + 60, 'up', 0], [t + 100, 'down', 'ls:↖'], [t + 115, 'down', 0], [t + 150, 'up', 'ls:↖'],
      [t + 150, 'down', 'ls:←'], [t + 160, 'up', 'ls:←'], [t + 160, 'down', 'ls:↙'], [t + 170, 'up', 'ls:↙'], [t + 170, 'down', 'ls:↓']]) fake(ms, type, 'pad', code);
    js(3300, `document.getElementById('btn-seq-templates').click();`);
    delay = 3700;
  } else if (process.env.IM_FAKE === 'reopen') {
    // Rouvre l'onglet Entraînement pour vérifier que les essais sauvegardés sont rechargés
    js(800, `document.querySelector('.tab[data-view="training"]').click();`);
    delay = 2000;
  } else if (process.env.IM_FAKE === 'settings') {
    // Onglet réglages : préréglage "Manette", puis saisie d'un raccourci via un keydown DOM factice
    setTimeout(() => console.log('[settings-initial]', JSON.stringify(shortcutStatus)), 600);
    js(800, `document.querySelector('.tab[data-view="settings"]').click(); document.querySelector('[data-preset="pad"]').click();`);
    js(1200, `document.querySelector('.sc-btn[data-sc="record"]').click();`);
    js(1500, `window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyK', key: 'K', ctrlKey: true, altKey: true, bubbles: true }));`);
    setTimeout(() => console.log('[settings-test]', JSON.stringify({ shortcuts: settings.shortcuts, status: shortcutStatus, overlay: settings.overlay })), 2000);
    delay = 2600;
  } else if (process.env.IM_FAKE === 'minimize') {
    // Vérifie que la fenêtre principale reste « visible » (lecture manette) une fois réduite
    setTimeout(() => mainWin.minimize(), 800);
    setTimeout(async () => {
      const r = await mainWin.webContents.executeJavaScript(
        `({ minimized: true, visibility: document.visibilityState, hidden: document.hidden, gamepadApi: typeof navigator.getGamepads })`
      );
      console.log('[minimize-test]', JSON.stringify(r));
      mainWin.restore();
    }, 2000);
    delay = 3000;
  } else if (process.env.IM_FAKE === 'training') {
    // Modèle : ↓ ↘ → + A, puis deux essais (un bon, un raté) et un essai "presque"
    js(800, `document.querySelector('.tab[data-view="training"]').click(); document.getElementById('btn-seq-new').click();`);
    js(1000, `document.getElementById('btn-seq-capture').click();`);
    const model = (t0, dt = 1, skip = null, aLate = 0) => {
      if (skip !== '↓') press(t0, 'pad', 'ls:↓', 45);
      if (skip !== '↘') press(t0 + 50 * dt, 'pad', 'ls:↘', 45);
      press(t0 + 100 * dt, 'pad', 'ls:→', 80);
      press(t0 + 130 * dt + aLate, 'pad', 0, 60);
    };
    model(1200);
    js(2000, `document.getElementById('btn-seq-capture').click();`);
    js(2300, `document.getElementById('btn-train-toggle').click();`);
    model(2600); // parfait
    model(4200, 1, '↘', 0); // étape manquante
    model(5800, 1, null, 90); // A en retard
    delay = 7600;
  } else if (process.env.IM_FAKE) {
    setTimeout(() => mainWin.webContents.send('record:toggle'), 1000);
    const seq = [
      [1100, 'down', 'kb', 42], [1110, 'down', 'kb', 17], [1300, 'up', 'kb', 17],
      [1400, 'down', 'pad', 'ls:↓'], [1450, 'up', 'pad', 'ls:↓'], [1450, 'down', 'pad', 'ls:↘'],
      [1500, 'up', 'pad', 'ls:↘'], [1500, 'down', 'pad', 'ls:→'], [1530, 'down', 'pad', 0],
      [1600, 'up', 'pad', 'ls:→'], [1620, 'up', 'pad', 0], [1700, 'up', 'kb', 42],
      [1800, 'down', 'mouse', 1], [1900, 'up', 'mouse', 1], [2000, 'tap', 'mouse', 'wheel-down'],
      [2050, 'tap', 'mouse', 'wheel-down'], [2200, 'down', 'kb', 32], [2900, 'up', 'kb', 32],
      [2950, 'down', 'kb', 57], [3000, 'up', 'kb', 57],
    ];
    for (const [ms, type, device, code] of seq) fake(ms, type, device, code);
    setTimeout(() => mainWin.webContents.send('record:toggle'), 3200);
    js(3600, `document.querySelector('.tab[data-view="recordings"]').click(); setTimeout(() => { for (let i = 0; i < 30; i++) document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowRight', bubbles: true })); }, 500);`);
    delay = 4800;
  }
  setTimeout(async () => {
    for (const [name, w] of [['main', mainWin], ['overlay', overlayWin]]) {
      const img = await w.webContents.capturePage();
      fs.writeFileSync(path.join(dir, `${name}.png`), img.toPNG());
      console.log(`[snapshot] ${name} ${JSON.stringify(w.getBounds())}`);
    }
    app.quit();
  }, delay);
}

// ---------- Cycle de vie ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWin) {
      if (mainWin.isMinimized()) mainWin.restore();
      mainWin.focus();
    }
  });

  app.whenReady().then(() => {
    loadSettings();
    createMainWindow();
    createOverlayWindow();
    startHook();
    registerShortcuts();
    setupUpdates();
    // outils de test réservés au développement (jamais actifs dans l'exe distribué)
    if (!app.isPackaged && process.env.IM_SNAPSHOT) debugSnapshot(process.env.IM_SNAPSHOT);
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    try {
      uIOhook.stop();
    } catch {}
  });
}

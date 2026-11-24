// Process principal : capture globale clavier/souris (uiohook), fenêtres, réglages.
const { app, BrowserWindow, ipcMain, globalShortcut, screen } = require('electron');
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
    mouse: true,
    gamepad: true,
    history: true,
    direction: 'vertical', // 'vertical' | 'horizontal'
    scale: 1,
    opacity: 0.92,
    historyRows: 8,
    position: null, // {x, y}
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

// ---------- Raccourcis globaux ----------
function registerShortcuts() {
  globalShortcut.register('CommandOrControl+Shift+O', () =>
    updateSettings({ overlay: { visible: !settings.overlay.visible } })
  );
  globalShortcut.register('CommandOrControl+Shift+L', () =>
    updateSettings({ overlay: { locked: !settings.overlay.locked } })
  );
  globalShortcut.register('CommandOrControl+Shift+Backspace', () => broadcast('history:clear'));
}

// ---------- Debug : capture des fenêtres puis fermeture (IM_SNAPSHOT=dossier) ----------
function debugSnapshot(dir) {
  for (const [name, w] of [['main', mainWin], ['overlay', overlayWin]]) {
    w.webContents.on('console-message', (e) => console.log(`[${name}] ${e.level}: ${e.message}`));
  }
  if (process.env.IM_SIMULATE) {
    const { UiohookKey } = require('uiohook-napi');
    setTimeout(() => uIOhook.keyToggle(UiohookKey.Shift, 'down'), 1500);
    setTimeout(() => uIOhook.keyToggle(UiohookKey.W, 'down'), 1510);
    setTimeout(() => uIOhook.keyToggle(UiohookKey.W, 'up'), 1700);
    setTimeout(() => uIOhook.keyToggle(UiohookKey.D, 'down'), 2000);
    setTimeout(() => uIOhook.keyToggle(UiohookKey.Shift, 'up'), 3700);
    setTimeout(() => uIOhook.keyToggle(UiohookKey.D, 'up'), 3700);
  }
  setTimeout(async () => {
    for (const [name, w] of [['main', mainWin], ['overlay', overlayWin]]) {
      const img = await w.webContents.capturePage();
      fs.writeFileSync(path.join(dir, `${name}.png`), img.toPNG());
      console.log(`[snapshot] ${name} ${JSON.stringify(w.getBounds())}`);
    }
    app.quit();
  }, 3500);
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
    if (process.env.IM_SNAPSHOT) debugSnapshot(process.env.IM_SNAPSHOT);
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    try {
      uIOhook.stop();
    } catch {}
  });
}

// Fenêtre principale : vue Live, enregistrements, réglages.
import { InputHub } from './lib/hub.js';
import { KeyboardWidget, MouseWidget, GamepadWidget, HistoryWidget } from './lib/widgets.js';
import { Recorder } from './lib/recorder.js';
import { formatClock } from './lib/timeline.js';
import { initRecordings } from './recordings.js';
import { initTraining } from './trainingView.js';
import { formatAccel, accelFromEvent } from './lib/labels.js';

const api = window.inputMemory;
let settings = await api.getSettings();

const hub = new InputHub();
const keyboard = new KeyboardWidget('full', settings);
const mouse = new MouseWidget();
const gamepad = new GamepadWidget(settings);
const history = new HistoryWidget(settings, { maxRows: 200 });
const widgets = [keyboard, mouse, gamepad, history];

document.getElementById('kb-slot').appendChild(keyboard.el);
document.getElementById('mouse-slot').appendChild(mouse.el);
document.getElementById('pad-slot').appendChild(gamepad.el);
document.getElementById('history-slot').appendChild(history.el);

const recorder = new Recorder(api);
let training = null;
hub.on((ev) => {
  history.onEvent(ev);
  recorder.onEvent(ev);
  training?.onEvent(ev);
});
hub.start();
api.onClearHistory(() => history.clear());

// ---- Enregistrement
const recordings = initRecordings(api, () => settings, {
  onMakeSequence: (id) => {
    document.querySelector('.tab[data-view="training"]').click();
    training.open(id);
  },
});
training = initTraining(api, () => settings, hub, (s) => gamepad.setGuides(s.angleGuides));
const recBtn = document.getElementById('btn-rec');
const recLabel = document.getElementById('rec-label');
async function toggleRecording(source) {
  if (!recorder.active) {
    recorder.start();
    recBtn.classList.add('recording');
    return;
  }
  recBtn.classList.remove('recording');
  recLabel.textContent = 'Enregistrer';
  const meta = await recorder.stop(settings, source);
  if (meta) recordings.refreshList(meta.id);
}
recBtn.addEventListener('click', () => toggleRecording('button'));
api.onRecordToggle(() => toggleRecording('shortcut'));

// ---- Onglets
for (const tab of document.querySelectorAll('.tab')) {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.dataset.view === tab.dataset.view));
  });
}

// ---- Outils historique
const btnPause = document.getElementById('btn-pause');
btnPause.addEventListener('click', () => {
  history.paused = !history.paused;
  btnPause.classList.toggle('active', history.paused);
  btnPause.textContent = history.paused ? 'Reprendre' : 'Pause';
});
document.getElementById('btn-clear').addEventListener('click', () => api.clearHistory());
for (const cb of document.querySelectorAll('[data-filter]')) {
  cb.addEventListener('change', () => (history.filter[cb.dataset.filter] = cb.checked));
}

// ---- Réglages : liaison générique des contrôles via data-path
const getPath = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);
const patchFor = (path, value) => path.split('.').reduceRight((acc, k) => ({ [k]: acc }), value);

const controls = [...document.querySelectorAll('[data-path]')];
function fillControls() {
  for (const c of controls) {
    const v = getPath(settings, c.dataset.path);
    if (c.type === 'checkbox') c.checked = !!v;
    else c.value = v;
    const out = c.parentElement.querySelector('output');
    if (out) out.textContent = c.dataset.path.endsWith('opacity') ? `${Math.round(v * 100)}%` : c.dataset.path.endsWith('scale') ? `×${Number(v).toFixed(2)}` : v;
  }
}
for (const c of controls) {
  c.addEventListener('input', () => {
    let v = c.type === 'checkbox' ? c.checked : c.value;
    if (c.dataset.type === 'number') v = Number(v);
    api.setSettings(patchFor(c.dataset.path, v));
  });
}
fillControls();

// ---- Préréglages de l'overlay
const PRESETS = {
  pad: { keyboard: 'off', mouse: false, gamepad: true, history: true, direction: 'horizontal' },
  kbm: { keyboard: 'gaming', mouse: true, gamepad: false, history: true, direction: 'horizontal' },
  history: { keyboard: 'off', mouse: false, gamepad: false, history: true, direction: 'vertical' },
  all: { keyboard: 'gaming', mouse: true, gamepad: true, history: true, direction: 'horizontal' },
};
for (const b of document.querySelectorAll('[data-preset]')) {
  b.addEventListener('click', () => api.setSettings({ overlay: PRESETS[b.dataset.preset] }));
}

// ---- Raccourcis configurables
let scStatus = await api.getShortcutStatus();
let listening = null; // bouton en attente d'une combinaison
const defaults = await api.getDefaults();
function renderShortcuts() {
  for (const b of document.querySelectorAll('.sc-btn')) {
    const name = b.dataset.sc;
    const acc = settings.shortcuts?.[name];
    b.classList.toggle('listening', b === listening);
    b.classList.toggle('conflict', scStatus[name] === 'conflict' || scStatus[name] === 'invalid');
    b.classList.toggle('none', !acc);
    b.textContent = b === listening ? 'Appuie sur une combinaison…' : formatAccel(acc);
    b.title = scStatus[name] === 'conflict' ? 'Déjà utilisé par un autre logiciel : choisis une autre combinaison' : '';
  }
  // textes et infobulles qui mentionnent un raccourci
  for (const el of document.querySelectorAll('[data-sc-title]')) el.title = formatAccel(settings.shortcuts?.[el.dataset.scTitle]);
  for (const el of document.querySelectorAll('[data-sc-text]')) el.textContent = formatAccel(settings.shortcuts?.[el.dataset.scText]);
}
function stopListening() {
  listening = null;
  api.suspendShortcuts(false);
  renderShortcuts();
}
for (const b of document.querySelectorAll('.sc-btn')) {
  b.addEventListener('click', () => {
    if (listening === b) return stopListening();
    listening = b;
    api.suspendShortcuts(true);
    renderShortcuts();
  });
}
window.addEventListener(
  'keydown',
  (ev) => {
    if (!listening) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    if (ev.code === 'Escape') return stopListening();
    const name = listening.dataset.sc;
    if (ev.code === 'Delete' && !ev.ctrlKey && !ev.altKey && !ev.shiftKey) {
      api.setSettings({ shortcuts: { [name]: '' } });
      return stopListening();
    }
    const acc = accelFromEvent(ev);
    if (!acc) return; // on attend une combinaison complète
    // si la combinaison est déjà prise par une autre action, on la lui retire
    const patch = { [name]: acc };
    for (const [other, a] of Object.entries(settings.shortcuts || {})) if (other !== name && a === acc) patch[other] = '';
    api.setSettings({ shortcuts: patch });
    stopListening();
  },
  true
);
document.getElementById('btn-sc-reset').addEventListener('click', () => api.setSettings({ shortcuts: defaults.shortcuts }));
api.onShortcutStatus((st) => {
  scStatus = st;
  renderShortcuts();
});
renderShortcuts();

// ---- Version et mises à jour
document.getElementById('app-version').textContent = await api.appVersion();
const banner = document.getElementById('update-banner');
const updStatus = document.getElementById('update-status');
function renderUpdate(u) {
  const texts = {
    idle: '',
    dev: 'désactivées en mode développement',
    checking: 'vérification…',
    uptodate: 'à jour',
    downloading: `téléchargement de la ${u.latest ?? ''}… ${u.percent ? u.percent + '%' : ''}`,
    ready: `version ${u.latest} prête`,
    'available-portable': `version ${u.latest} disponible`,
    error: 'impossible de vérifier (hors ligne ?)',
  };
  updStatus.textContent = texts[u.state] ?? '';
  if (u.state === 'ready') {
    banner.innerHTML = `Mise à jour ${u.latest} prête <button class="btn primary" id="btn-upd-install">Redémarrer</button>`;
    banner.hidden = false;
    document.getElementById('btn-upd-install').onclick = () => api.installUpdate();
  } else if (u.state === 'available-portable') {
    banner.innerHTML = `Nouvelle version ${u.latest} <button class="btn primary" id="btn-upd-open">Télécharger</button>`;
    banner.hidden = false;
    document.getElementById('btn-upd-open').onclick = () => api.openReleases();
  } else banner.hidden = true;
}
renderUpdate(await api.getUpdateState());
api.onUpdateState(renderUpdate);
document.getElementById('btn-update-check').addEventListener('click', () => api.checkUpdates());

// ---- Bouton « Overlay » de l'en-tête : afficher / masquer (utile si on l'a fermé)
const ovBtn = document.getElementById('btn-overlay');
function renderOverlayBtn() {
  const on = settings.overlay.visible;
  ovBtn.textContent = on ? 'Overlay ✓' : 'Overlay masqué';
  ovBtn.title = on ? 'Overlay affiché : clic pour le masquer' : "Overlay masqué : clic pour l'afficher";
  ovBtn.classList.toggle('ok', on);
}
ovBtn.addEventListener('click', () => api.setSettings({ overlay: { visible: !settings.overlay.visible } }));
renderOverlayBtn();

api.onSettings((s) => {
  settings = s;
  renderOverlayBtn();
  renderShortcuts();
  widgets.forEach((w) => w.setSettings(s));
  recordings.setSettings(s);
  training.setSettings(s);
  fillControls();
});

// ---- Statuts
const hookPill = document.getElementById('hook-status');
const st = await api.hookStatus();
hookPill.textContent = st.ok ? 'Capture clavier/souris : active' : `Capture indisponible : ${st.error}`;
hookPill.classList.add(st.ok ? 'ok' : 'err');
const padPill = document.getElementById('pad-status');

// ---- Boucle d'affichage
function frame(now) {
  for (const w of widgets) w.update(hub, now);
  recordings.frame(now);
  if (recorder.active) recLabel.textContent = `${formatClock(recorder.elapsed, false).replace(/\.\d+s$/, 's')} · ${recorder.events.length}`;
  const label = hub.pad.connected ? `Manette : ${hub.pad.id.replace(/\s*\(.*\)$/, '')}` : 'Manette : aucune';
  if (padPill.textContent !== label) {
    padPill.textContent = label;
    padPill.classList.toggle('ok', hub.pad.connected);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Fenêtre principale : vue Live, enregistrements, réglages.
import { InputHub } from './lib/hub.js';
import { KeyboardWidget, MouseWidget, GamepadWidget, HistoryWidget } from './lib/widgets.js';
import { Recorder } from './lib/recorder.js';
import { formatClock } from './lib/timeline.js';
import { initRecordings } from './recordings.js';

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
hub.on((ev) => {
  history.onEvent(ev);
  recorder.onEvent(ev);
});
hub.start();
api.onClearHistory(() => history.clear());

// ---- Enregistrement
const recordings = initRecordings(api, () => settings);
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

api.onSettings((s) => {
  settings = s;
  widgets.forEach((w) => w.setSettings(s));
  recordings.setSettings(s);
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

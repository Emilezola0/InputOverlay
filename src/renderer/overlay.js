// Overlay : fenêtre transparente qui affiche les widgets choisis par-dessus le jeu.
import { InputHub } from './lib/hub.js';
import { KeyboardWidget, MouseWidget, GamepadWidget, HistoryWidget } from './lib/widgets.js';

const api = window.inputMemory;
const root = document.getElementById('root');
const wrap = document.getElementById('wrap');
let settings = await api.getSettings();
let widgets = [];
let history = null;
let signature = '';
let trainCard = null;
let training = await api.getTrainingState();

const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
function renderTraining() {
  if (!trainCard) return;
  const t = training;
  trainCard.hidden = !t.active;
  if (!t.active) return;
  const problems = t.phase === 'result' ? t.steps.filter((s) => s.status !== 'ok' && s.detail) : [];
  trainCard.firstElementChild.innerHTML = `
    <div class="ov-train-head"><b>${escHtml(t.name)}</b>${t.attempts ? `<span>${t.attempts} essai(s) · ${t.successRate}% réussis</span>` : ''}</div>
    <div class="ov-verdict ${t.verdict ? 'v-' + t.verdict : ''}">${escHtml(t.verdictLabel)}${t.phase === 'result' && t.score !== null ? ` · ${t.score}%` : ''}</div>
    <div class="ov-steps">${t.steps.map((s) => `<span class="ov-step s-${t.phase === 'ready' ? 'pending' : s.status}">${escHtml(s.label)}</span>`).join('')}</div>
    ${problems.slice(0, 3).map((s) => `<div class="ov-detail">${escHtml(s.label)} : ${s.detail}</div>`).join('')}`;
}

function build() {
  const o = settings.overlay;
  root.innerHTML = '';
  widgets = [];
  history = null;
  const add = (w) => {
    const card = document.createElement('div');
    card.className = 'ov-card';
    card.appendChild(w.el);
    root.appendChild(card);
    widgets.push(w);
  };
  if (o.keyboard !== 'off') add(new KeyboardWidget(o.keyboard, settings));
  if (o.mouse) add(new MouseWidget());
  if (o.gamepad) add(new GamepadWidget(settings));
  if (o.history) {
    history = new HistoryWidget(settings, { maxRows: o.historyRows, compact: true });
    add(history);
  }
  if (o.training) {
    const card = document.createElement('div');
    card.className = 'ov-card ov-train-card';
    card.hidden = true;
    card.innerHTML = '<div class="ov-train"></div>';
    root.appendChild(card);
    trainCard = card;
  } else trainCard = null;
  if (!widgets.length && !o.training) root.innerHTML = '<div class="ov-card ov-empty">Aucun widget activé</div>';
}

function apply() {
  const o = settings.overlay;
  const sig = [o.keyboard, o.mouse, o.gamepad, o.history, o.training].join('|');
  if (sig !== signature) {
    signature = sig;
    build();
    renderTraining();
  } else {
    widgets.forEach((w) => w.setSettings(settings));
    history?.setMaxRows(o.historyRows);
  }
  root.className = o.direction;
  wrap.style.zoom = o.scale;
  root.style.opacity = o.opacity;
  document.body.classList.toggle('editing', !o.locked);
}

// La fenêtre s'adapte à la taille du contenu
new ResizeObserver(() => {
  const r = document.body.getBoundingClientRect();
  api.overlayFit(r.width, r.height);
}).observe(document.body);

apply();
renderTraining();
api.onSettings((s) => {
  settings = s;
  apply();
});
api.onClearHistory(() => history?.clear());
api.onTrainingState((s) => {
  training = s;
  renderTraining();
});

// Indicateur REC pendant un enregistrement
let rec = await api.getRecordState();
const recWrap = document.getElementById('rec-wrap');
const recBadge = document.getElementById('rec-badge');
api.onRecordState((s) => (rec = s));
function updateRec() {
  recWrap.hidden = !rec.active;
  if (!rec.active) return;
  const s = Math.floor((Date.now() - rec.startedAt) / 1000);
  const txt = `REC ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  if (recBadge.textContent !== txt) recBadge.textContent = txt;
}

const hub = new InputHub();
hub.on((ev) => history?.onEvent(ev));
hub.start();

function frame(now) {
  for (const w of widgets) w.update(hub, now);
  updateRec();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

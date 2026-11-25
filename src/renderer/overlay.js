// Overlay : fenêtre transparente qui affiche les widgets choisis par-dessus le jeu.
// Déverrouillé, il se règle sur place : barre d'outils, taille par widget (−/+, molette, poignée), masquer, déplacer.
import { InputHub } from './lib/hub.js';
import { KeyboardWidget, MouseWidget, GamepadWidget, HistoryWidget } from './lib/widgets.js';
import { formatAccel } from './lib/labels.js';

const api = window.inputMemory;
const root = document.getElementById('root');
const content = document.getElementById('content');
let settings = await api.getSettings();
let widgets = [];
let history = null;
let signature = '';
let trainCard = null;
let training = await api.getTrainingState();

const WIDGETS = [
  ['keyboard', 'Clavier'],
  ['mouse', 'Souris'],
  ['gamepad', 'Manette'],
  ['history', 'Historique'],
  ['training', 'Entraînement'],
];
const LABEL = Object.fromEntries(WIDGETS);
const MIN = 0.4;
const MAX = 3;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const round = (v) => Math.round(v * 100) / 100;
const pct = (v) => `${Math.round(v * 100)}%`;
const isOn = (o, name) => (name === 'keyboard' ? o.keyboard !== 'off' : !!o[name]);
const sizeOf = (name) => settings.overlay.sizes?.[name] ?? 1;
const editing = () => !settings.overlay.locked;

// ---------------------------------------------------------------- Réglages modifiés depuis l'overlay
// Appliqués tout de suite ici, envoyés à l'appli un peu après (pas à chaque cran de molette).
let pending = {};
let sendTimer = null;
function patchOverlay(patch) {
  const o = settings.overlay;
  if (patch.sizes) patch = { ...patch, sizes: { ...(o.sizes ?? {}), ...patch.sizes } };
  settings = { ...settings, overlay: { ...o, ...patch } };
  pending = { ...pending, ...patch };
  apply();
  clearTimeout(sendTimer);
  sendTimer = setTimeout(flush, 150);
}
function flush() {
  clearTimeout(sendTimer);
  if (!Object.keys(pending).length) return;
  api.setSettings({ overlay: pending });
  pending = {};
}

// ---------------------------------------------------------------- Entraînement
const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
function renderTraining() {
  if (!trainCard) return;
  const t = training;
  const slot = trainCard.parentElement;
  if (!t.active) {
    // en édition, on le montre quand même pour pouvoir le placer et le dimensionner
    slot.hidden = !editing();
    trainCard.firstElementChild.innerHTML = '<div class="ov-placeholder">Entraînement : visible pendant un test</div>';
    return;
  }
  slot.hidden = false;
  const problems = t.phase === 'result' ? t.steps.filter((s) => s.status !== 'ok' && s.detail) : [];
  trainCard.firstElementChild.innerHTML = `
    <div class="ov-train-head"><b>${escHtml(t.name)}</b>${t.attempts ? `<span>${t.attempts} essai(s) · ${t.successRate}% réussis</span>` : ''}</div>
    <div class="ov-verdict ${t.armed ? 'v-parfait' : t.verdict ? 'v-' + t.verdict : ''}">${escHtml(t.verdictLabel)}${t.phase === 'result' && t.score !== null ? ` · ${t.score}%` : ''}</div>
    <div class="ov-steps">${t.steps.map((s) => `<span class="ov-step s-${t.phase === 'ready' ? 'pending' : s.status}">${escHtml(s.label)}</span>`).join('')}</div>
    ${problems.slice(0, 3).map((s) => `<div class="ov-detail">${escHtml(s.label)} : ${s.detail}</div>`).join('')}`;
}

// ---------------------------------------------------------------- Construction
function slotFor(name, cardEl) {
  const slot = document.createElement('div');
  slot.className = 'ov-slot';
  slot.dataset.w = name;
  const extra =
    name === 'keyboard' ? '<button data-act="kbmode" title="Clavier complet / gaming">⇄</button>'
    : name === 'history' ? '<button data-act="rows-" title="Moins de lignes">≡−</button><button data-act="rows+" title="Plus de lignes">≡+</button>'
    : '';
  slot.innerHTML = `<div class="card-tools" title="${LABEL[name]}">${extra}<button data-act="w-" title="Plus petit">−</button><span class="size"></span><button data-act="w+" title="Plus grand">+</button><button data-act="hide" title="Masquer">×</button></div><div class="card-grip" title="Glisse pour redimensionner"></div>`;
  slot.insertBefore(cardEl, slot.firstChild);
  root.appendChild(slot);
  return slot;
}

function build() {
  const o = settings.overlay;
  root.innerHTML = '';
  widgets = [];
  history = null;
  const add = (name, w) => {
    const card = document.createElement('div');
    card.className = 'ov-card';
    card.appendChild(w.el);
    slotFor(name, card);
    widgets.push(w);
  };
  if (o.keyboard !== 'off') add('keyboard', new KeyboardWidget(o.keyboard, settings));
  if (o.mouse) add('mouse', new MouseWidget());
  if (o.gamepad) add('gamepad', new GamepadWidget(settings));
  if (o.history) {
    history = new HistoryWidget(settings, { maxRows: o.historyRows, compact: true });
    add('history', history);
  }
  if (o.training) {
    const card = document.createElement('div');
    card.className = 'ov-card ov-train-card';
    card.innerHTML = '<div class="ov-train"></div>';
    slotFor('training', card);
    trainCard = card;
  } else trainCard = null;
  if (!widgets.length && !o.training) root.innerHTML = '<div class="ov-card ov-empty">Aucun widget activé</div>';
}

function renderToolbar() {
  const o = settings.overlay;
  document.getElementById('tb-widgets').innerHTML = WIDGETS.map(
    ([name, label]) => `<button data-act="toggle" data-w="${name}" class="${isOn(o, name) ? '' : 'off'}">${label}</button>`
  ).join(' ');
  document.getElementById('tb-scale').textContent = pct(o.scale);
  document.getElementById('tb-op').textContent = pct(o.opacity);
  document.getElementById('tb-dir').textContent = o.direction === 'vertical' ? '↕ Vertical' : '↔ Horizontal';
  const lock = formatAccel(settings.shortcuts?.overlayLock);
  document.getElementById('tb-lock').textContent = `🔒 Verrouiller${lock ? ` (${lock})` : ''}`;
}

function apply() {
  const o = settings.overlay;
  const sig = [o.keyboard, o.mouse, o.gamepad, o.history, o.training].join('|');
  if (sig !== signature) {
    signature = sig;
    build();
  } else {
    widgets.forEach((w) => w.setSettings(settings));
    history?.setMaxRows(o.historyRows);
  }
  for (const slot of root.querySelectorAll('.ov-slot')) {
    const s = sizeOf(slot.dataset.w);
    slot.querySelector('.ov-card').style.zoom = s;
    slot.querySelector('.size').textContent = pct(s);
  }
  root.className = o.direction;
  content.style.zoom = o.scale;
  root.style.opacity = o.opacity;
  document.body.classList.toggle('editing', editing());
  renderToolbar();
  renderTraining();
}

// La fenêtre s'adapte à la taille du contenu, sans jamais dépasser l'écran
function fit() {
  const z = Number(content.style.zoom) || 1;
  const c = content.getBoundingClientRect();
  const k = Math.min(settings.overlay.scale, (screen.availWidth - 40) / (c.width / z), (screen.availHeight - 80) / (c.height / z));
  if (Math.abs(k - z) > 0.01) {
    content.style.zoom = k; // le ResizeObserver rappellera fit()
    return;
  }
  const r = document.body.getBoundingClientRect();
  api.overlayFit(r.width, r.height);
}
new ResizeObserver(fit).observe(document.body);

// ---------------------------------------------------------------- Actions de la barre et des widgets
function setSize(name, v) {
  patchOverlay({ sizes: { [name]: round(clamp(v, MIN, MAX)) } });
}
function toggleWidget(name, on) {
  const o = settings.overlay;
  if (name !== 'keyboard') patchOverlay({ [name]: on });
  else if (on) patchOverlay({ keyboard: o.lastKeyboard || 'gaming' });
  else if (o.keyboard !== 'off') patchOverlay({ keyboard: 'off', lastKeyboard: o.keyboard }); // pour le réafficher pareil
}

document.addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-act]');
  if (!b || !editing()) return;
  const o = settings.overlay;
  const name = b.dataset.w ?? b.closest('.ov-slot')?.dataset.w;
  switch (b.dataset.act) {
    case 'toggle': return toggleWidget(name, !isOn(o, name));
    case 'hide': return toggleWidget(name, false);
    case 'w-': return setSize(name, sizeOf(name) - 0.1);
    case 'w+': return setSize(name, sizeOf(name) + 0.1);
    case 'kbmode': return patchOverlay({ keyboard: o.keyboard === 'full' ? 'gaming' : 'full' });
    case 'rows-': return patchOverlay({ historyRows: clamp(o.historyRows - 1, 1, 20) });
    case 'rows+': return patchOverlay({ historyRows: clamp(o.historyRows + 1, 1, 20) });
    case 'scale-': return patchOverlay({ scale: round(clamp(o.scale - 0.1, 0.5, 2.5)) });
    case 'scale+': return patchOverlay({ scale: round(clamp(o.scale + 0.1, 0.5, 2.5)) });
    case 'op-': return patchOverlay({ opacity: round(clamp(o.opacity - 0.1, 0.2, 1)) });
    case 'op+': return patchOverlay({ opacity: round(clamp(o.opacity + 0.1, 0.2, 1)) });
    case 'dir': return patchOverlay({ direction: o.direction === 'vertical' ? 'horizontal' : 'vertical' });
    case 'reset': return patchOverlay({ sizes: Object.fromEntries(WIDGETS.map(([n]) => [n, 1])), scale: 1 });
    case 'app': return api.showMainWindow();
    case 'lock':
      flush();
      return api.setSettings({ overlay: { locked: true } });
  }
});

// Molette : sur un widget → sa taille ; ailleurs → taille globale
document.addEventListener(
  'wheel',
  (ev) => {
    if (!editing()) return;
    ev.preventDefault();
    const step = ev.deltaY < 0 ? 0.05 : -0.05;
    const slot = ev.target.closest('.ov-slot');
    if (slot) setSize(slot.dataset.w, sizeOf(slot.dataset.w) + step);
    else patchOverlay({ scale: round(clamp(settings.overlay.scale + step, 0.5, 2.5)) });
  },
  { passive: false }
);

// Glisser : poignée d'angle → taille du widget ; ailleurs → déplacer l'overlay
let drag = null;
document.addEventListener('pointerdown', (ev) => {
  if (!editing() || ev.button !== 0 || ev.target.closest('button')) return;
  const grip = ev.target.closest('.card-grip');
  if (grip) {
    const slot = grip.closest('.ov-slot');
    drag = { mode: 'size', name: slot.dataset.w, x0: ev.screenX, y0: ev.screenY, s0: sizeOf(slot.dataset.w), w0: slot.getBoundingClientRect().width };
  } else {
    drag = { mode: 'move', x0: ev.screenX, y0: ev.screenY, wx: window.screenX, wy: window.screenY };
  }
  try {
    document.documentElement.setPointerCapture(ev.pointerId);
  } catch {}
  ev.preventDefault();
});
document.addEventListener('pointermove', (ev) => {
  if (!drag) return;
  const dx = ev.screenX - drag.x0;
  const dy = ev.screenY - drag.y0;
  if (drag.mode === 'move') api.overlayMove(drag.wx + dx, drag.wy + dy);
  else setSize(drag.name, drag.s0 * (1 + Math.max(dx, dy) / Math.max(60, drag.w0)));
});
const endDrag = () => {
  if (drag?.mode === 'move') api.overlayMove(null, null, true);
  drag = null;
};
document.addEventListener('pointerup', endDrag);
document.addEventListener('pointercancel', endDrag);

// ---------------------------------------------------------------- Démarrage
apply();
api.onSettings((s) => {
  // pendant un réglage en cours ici, on garde nos valeurs non encore envoyées
  settings = Object.keys(pending).length ? { ...s, overlay: { ...s.overlay, ...pending } } : s;
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

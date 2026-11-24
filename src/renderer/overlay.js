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
  if (!widgets.length) root.innerHTML = '<div class="ov-card ov-empty">Aucun widget activé</div>';
}

function apply() {
  const o = settings.overlay;
  const sig = [o.keyboard, o.mouse, o.gamepad, o.history].join('|');
  if (sig !== signature) {
    signature = sig;
    build();
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
api.onSettings((s) => {
  settings = s;
  apply();
});
api.onClearHistory(() => history?.clear());

const hub = new InputHub();
hub.on((ev) => history?.onEvent(ev));
hub.start();

function frame(now) {
  for (const w of widgets) w.update(hub, now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

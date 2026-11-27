// Widgets visuels : clavier, souris, manette, historique.
// Chaque widget expose `el`, `update(hub, now)` (appelé à chaque frame) et `setSettings(settings)`.
import { K, keyLabel, inputLabel, formatDuration, formatAngle, PAD_LABELS } from './labels.js';
import { stickAngle } from './hub.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// ---------------------------------------------------------------- Clavier
const k = (c, w = 1) => ({ c, w });
const gap = (w = 1) => ({ gap: w });
const letters = (...names) => names.map((n) => k(K[n]));

const LAYOUTS = {
  full: {
    main: [
      [k(K.Escape), gap(1), ...letters('F1', 'F2', 'F3', 'F4'), gap(0.5), ...letters('F5', 'F6', 'F7', 'F8'), gap(0.5), ...letters('F9', 'F10', 'F11', 'F12')],
      [k(K.Backquote), ...letters('1', '2', '3', '4', '5', '6', '7', '8', '9', '0'), k(K.Minus), k(K.Equal), k(K.Backspace, 2)],
      [k(K.Tab, 1.5), ...letters('Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'), k(K.BracketLeft), k(K.BracketRight), k(K.Backslash, 1.5)],
      [k(K.CapsLock, 1.75), ...letters('A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'), k(K.Semicolon), k(K.Quote), k(K.Enter, 2.25)],
      [k(K.Shift, 1.25), k(K.IntlBackslash), ...letters('Z', 'X', 'C', 'V', 'B', 'N', 'M'), k(K.Comma), k(K.Period), k(K.Slash), k(K.ShiftRight, 2.75)],
      [k(K.Ctrl, 1.25), k(K.Meta, 1.25), k(K.Alt, 1.25), k(K.Space, 6.25), k(K.AltRight, 1.25), k(K.MetaRight, 1.25), k(K.ContextMenu, 1.25), k(K.CtrlRight, 1.25)],
    ],
    nav: [
      [k(K.PrintScreen), k(K.ScrollLock), gap(1)],
      [k(K.Insert), k(K.Home), k(K.PageUp)],
      [k(K.Delete), k(K.End), k(K.PageDown)],
      [gap(3)],
      [gap(1), k(K.ArrowUp), gap(1)],
      [k(K.ArrowLeft), k(K.ArrowDown), k(K.ArrowRight)],
    ],
  },
  gaming: {
    main: [
      [k(K.Escape), ...letters('1', '2', '3', '4', '5', '6')],
      [k(K.Tab, 1.5), ...letters('Q', 'W', 'E', 'R', 'T', 'Y')],
      [k(K.CapsLock, 1.75), ...letters('A', 'S', 'D', 'F', 'G', 'H')],
      [k(K.Shift, 1.25), k(K.IntlBackslash), ...letters('Z', 'X', 'C', 'V', 'B')],
      [k(K.Ctrl, 1.25), k(K.Meta, 1.25), k(K.Alt, 1.25), k(K.Space, 4)],
    ],
    nav: null,
  },
};

export class KeyboardWidget {
  constructor(layoutName, settings) {
    this.el = document.createElement('div');
    this.el.className = `widget keyboard kb-${layoutName}`;
    this.keys = new Map(); // code -> element
    const layout = LAYOUTS[layoutName];
    const buildBlock = (rows) => {
      const block = document.createElement('div');
      block.className = 'kb-block';
      for (const row of rows) {
        const r = document.createElement('div');
        r.className = 'kb-row';
        for (const item of row) {
          const d = document.createElement('div');
          d.style.setProperty('--w', item.gap ?? item.w);
          if (item.gap) d.className = 'kb-gap';
          else {
            d.className = 'key';
            d.dataset.code = item.c;
            this.keys.set(item.c, d);
          }
          r.appendChild(d);
        }
        block.appendChild(r);
      }
      return block;
    };
    this.el.appendChild(buildBlock(layout.main));
    if (layout.nav) this.el.appendChild(buildBlock(layout.nav));
    this.setSettings(settings);
  }

  setSettings(settings) {
    for (const [code, d] of this.keys) {
      const label = keyLabel(code, settings.keyboardLayout);
      d.textContent = label;
      d.classList.toggle('small', label.length > 3);
    }
  }

  update(hub) {
    for (const [code, d] of this.keys) d.classList.toggle('on', hub.kb.has(code));
  }
}

// ---------------------------------------------------------------- Souris
export class MouseWidget {
  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'widget mouse';
    this.el.innerHTML = `
      <svg viewBox="0 0 120 180" class="mouse-svg">
        <rect class="m-body" x="12" y="12" width="96" height="156" rx="48"/>
        <path class="m-btn" data-b="1" d="M58 13 A47 47 0 0 0 13 60 L13 74 L58 74 Z"/>
        <path class="m-btn" data-b="2" d="M62 13 A47 47 0 0 1 107 60 L107 74 L62 74 Z"/>
        <rect class="m-btn m-wheel" data-b="3" x="53" y="28" width="14" height="30" rx="7"/>
        <path class="m-arrow" data-w="wheel-up" d="M60 16 L66 24 L54 24 Z"/>
        <path class="m-arrow" data-w="wheel-down" d="M60 70 L66 62 L54 62 Z"/>
        <rect class="m-btn" data-b="5" x="4" y="86" width="10" height="20" rx="4"/>
        <rect class="m-btn" data-b="4" x="4" y="110" width="10" height="20" rx="4"/>
      </svg>`;
    this.btns = [...this.el.querySelectorAll('[data-b]')].map((n) => [Number(n.dataset.b), n]);
    this.arrows = [...this.el.querySelectorAll('[data-w]')].map((n) => [n.dataset.w, n]);
  }
  setSettings() {}
  update(hub, now) {
    for (const [b, n] of this.btns) n.classList.toggle('on', hub.mouse.has(b));
    for (const [w, n] of this.arrows) n.classList.toggle('on', now - (hub.wheel[w] ?? -1e9) < 150);
  }
}

// ---------------------------------------------------------------- Manette
const FACE = {
  xbox: { 0: '#3fb950', 1: '#f85149', 2: '#4f8cff', 3: '#e3b341' },
  ps: { 0: '#6ea8ff', 1: '#ff6b6b', 2: '#e58fd6', 3: '#4fd1a5' },
};

// Graduations autour des sticks : traits tous les 45°, petits traits tous les 15°
const TICKS = Array.from({ length: 24 }, (_, i) => {
  const a = (i * 15 * Math.PI) / 180;
  const big = i % 3 === 0;
  const r1 = big ? 30 : 32;
  const r2 = 36;
  const p = (r) => `${(Math.sin(a) * r).toFixed(1)} ${(-Math.cos(a) * r).toFixed(1)}`;
  return `<path class="${big ? 'tick big' : 'tick'}" d="M${p(r1)} L${p(r2)}"/>`;
}).join('');

// Point à l'angle a (0 = haut, + = droite) et au rayon r autour du centre du stick
const polar = (a, r) => {
  const rad = (a * Math.PI) / 180;
  return `${(Math.sin(rad) * r).toFixed(1)} ${(-Math.cos(rad) * r).toFixed(1)}`;
};
// Secteur d'anneau entre a1 et a2 (sens horaire), rayons r1 → r2
function wedge(a1, a2, r1, r2) {
  const large = a2 - a1 > 180 ? 1 : 0;
  return `M${polar(a1, r2)} A${r2} ${r2} 0 ${large} 1 ${polar(a2, r2)} L${polar(a2, r1)} A${r1} ${r1} 0 ${large} 0 ${polar(a1, r1)} Z`;
}

export class GamepadWidget {
  constructor(settings) {
    this.el = document.createElement('div');
    this.el.className = 'widget gamepad';
    this.el.innerHTML = `
      <svg viewBox="0 0 400 260" class="pad-svg">
        <g class="trigger" data-t="6"><rect class="t-bg" x="62" y="6" width="86" height="16" rx="5"/><rect class="t-fill" x="62" y="6" width="0" height="16" rx="5"/><text x="105" y="18" data-l="6"></text></g>
        <g class="trigger" data-t="7"><rect class="t-bg" x="252" y="6" width="86" height="16" rx="5"/><rect class="t-fill" x="252" y="6" width="0" height="16" rx="5"/><text x="295" y="18" data-l="7"></text></g>
        <rect class="p-btn" data-b="4" x="62" y="28" width="86" height="18" rx="9"/><text x="105" y="41" data-l="4"></text>
        <rect class="p-btn" data-b="5" x="252" y="28" width="86" height="18" rx="9"/><text x="295" y="41" data-l="5"></text>
        <path class="p-body" d="M70 52 Q200 40 330 52 Q360 56 368 90 L392 200 Q398 248 356 250 Q326 252 306 218 L290 196 L110 196 L94 218 Q74 252 44 250 Q2 248 8 200 L32 90 Q40 56 70 52 Z"/>
        <circle class="stick-base" cx="110" cy="105" r="30"/>
        <g class="stick-ticks" transform="translate(110 105)">${TICKS}</g>
        <line class="stick-ray" data-ray="0" x1="110" y1="105" x2="110" y2="105"/>
        <circle class="stick" data-s="0" data-b="10" cx="110" cy="105" r="18"/>
        <circle class="stick-base" cx="250" cy="165" r="30"/>
        <g class="stick-ticks" transform="translate(250 165)">${TICKS}</g>
        <line class="stick-ray" data-ray="2" x1="250" y1="165" x2="250" y2="165"/>
        <circle class="stick" data-s="2" data-b="11" cx="250" cy="165" r="18"/>
        <g class="stick-guides" data-guides="0" transform="translate(110 105)"></g>
        <g class="stick-guides" data-guides="2" transform="translate(250 165)"></g>
        <text class="stick-angle" data-angle="0" x="110" y="152"></text>
        <text class="stick-angle" data-angle="2" x="250" y="212"></text>
        <rect class="p-btn" data-b="12" x="138" y="136" width="20" height="24" rx="3"/>
        <rect class="p-btn" data-b="13" x="138" y="180" width="20" height="24" rx="3"/>
        <rect class="p-btn" data-b="14" x="114" y="160" width="24" height="20" rx="3"/>
        <rect class="p-btn" data-b="15" x="158" y="160" width="24" height="20" rx="3"/>
        <rect class="p-btn" data-b="8" x="160" y="98" width="24" height="14" rx="7"/>
        <rect class="p-btn" data-b="9" x="216" y="98" width="24" height="14" rx="7"/>
        <circle class="p-btn" data-b="16" cx="200" cy="72" r="11"/>
        <g class="face" data-b="3"><circle class="p-btn" data-b="3" cx="295" cy="78" r="15"/><text x="295" y="84" data-l="3"></text></g>
        <g class="face" data-b="0"><circle class="p-btn" data-b="0" cx="295" cy="132" r="15"/><text x="295" y="138" data-l="0"></text></g>
        <g class="face" data-b="2"><circle class="p-btn" data-b="2" cx="268" cy="105" r="15"/><text x="268" y="111" data-l="2"></text></g>
        <g class="face" data-b="1"><circle class="p-btn" data-b="1" cx="322" cy="105" r="15"/><text x="322" y="111" data-l="1"></text></g>
      </svg>
      <div class="pad-status"></div>`;
    this.btns = [...this.el.querySelectorAll('.p-btn, .stick')].map((n) => [Number(n.dataset.b), n]);
    this.sticks = [...this.el.querySelectorAll('.stick')].map((n) => [
      Number(n.dataset.s),
      n,
      this.el.querySelector(`.stick-ray[data-ray="${n.dataset.s}"]`),
      this.el.querySelector(`.stick-angle[data-angle="${n.dataset.s}"]`),
    ]);
    this.triggers = [...this.el.querySelectorAll('.trigger')].map((g) => [Number(g.dataset.t), g.querySelector('.t-fill'), g]);
    this.status = this.el.querySelector('.pad-status');
    this.guideGroups = { ls: this.el.querySelector('[data-guides="0"]'), rs: this.el.querySelector('[data-guides="2"]') };
    this.guides = [];
    this.setSettings(settings);
  }

  /**
   * Angles à prendre (entraînement) : [{ stick: 'ls'|'rs', angle, tol, step, next, measured, ok }].
   * Secteur vert = zone attendue ; trait = dernier angle joué (vert si bon, rouge sinon).
   */
  setGuides(guides = []) {
    const sig = JSON.stringify(guides);
    if (sig === this._guideSig) return;
    this._guideSig = sig;
    this.guides = guides;
    for (const [stick, g] of Object.entries(this.guideGroups)) {
      const list = guides.filter((x) => x.stick === stick);
      g.innerHTML = list
        .map((x) => {
          const cls = `guide${x.next ? ' next' : ''}`;
          let out = `<path class="${cls}" data-a="${x.angle}" data-tol="${x.tol}" d="${wedge(x.angle - x.tol, x.angle + x.tol, 33, 52)}"/>`;
          out += `<path class="guide-mid${x.next ? ' next' : ''}" d="M${polar(x.angle, 10)} L${polar(x.angle, 56)}"/>`;
          if (list.length > 1) out += `<text class="guide-n" x="${polar(x.angle, 62).split(' ')[0]}" y="${(Number(polar(x.angle, 62).split(' ')[1]) + 4).toFixed(1)}">${x.step}</text>`;
          if (x.measured != null) out += `<path class="guide-hit ${x.ok ? 'ok' : 'bad'}" d="M${polar(x.measured, 30)} L${polar(x.measured, 56)}"/>`;
          return out;
        })
        .join('');
    }
  }

  setSettings(settings) {
    const style = settings.padStyle;
    for (const t of this.el.querySelectorAll('text[data-l]')) t.textContent = PAD_LABELS[style][Number(t.dataset.l)];
    for (const [i, color] of Object.entries(FACE[style])) {
      this.el.querySelector(`.face[data-b="${i}"]`).style.setProperty('--face', color);
    }
  }

  update(hub) {
    const p = hub.pad;
    this.el.classList.toggle('disconnected', !p.connected);
    this.status.textContent = p.connected ? '' : 'Manette non détectée · branche-la puis appuie sur un bouton';
    if (!p.connected) return;
    for (const [b, n] of this.btns) n.classList.toggle('on', !!p.buttons[b]);
    for (const [axis, n, ray, label] of this.sticks) {
      const ax = p.axes[axis] ?? 0;
      const ay = p.axes[axis + 1] ?? 0;
      n.setAttribute('transform', `translate(${(ax * 14).toFixed(1)} ${(ay * 14).toFixed(1)})`);
      // rayon et angle : visibles dès que le stick sort du centre
      const m = Math.min(1, Math.hypot(ax, ay));
      const show = m > 0.2;
      const cx = Number(ray.getAttribute('x1'));
      const cy = Number(ray.getAttribute('y1'));
      ray.setAttribute('x2', (cx + (show ? (ax / m) * 36 * m : 0)).toFixed(1));
      ray.setAttribute('y2', (cy + (show ? (ay / m) * 36 * m : 0)).toFixed(1));
      ray.classList.toggle('strong', m > 0.5);
      const cur = stickAngle(ax, ay);
      const txt = show ? formatAngle(cur) : '';
      if (label.textContent !== txt) label.textContent = txt;
      // stick dans la zone attendue : le secteur s'allume
      const group = this.guideGroups[axis === 0 ? 'ls' : 'rs'];
      for (const w of group.querySelectorAll('.guide')) {
        const d = ((((cur - Number(w.dataset.a)) % 360) + 540) % 360) - 180;
        w.classList.toggle('hit', m > 0.5 && Math.abs(d) <= Number(w.dataset.tol));
      }
    }
    for (const [i, fill, g] of this.triggers) {
      const v = p.values[i] ?? 0;
      fill.setAttribute('width', (86 * v).toFixed(1));
      g.classList.toggle('on', !!p.buttons[i]);
    }
  }
}

// ---------------------------------------------------------------- Historique
export class HistoryWidget {
  constructor(settings, { maxRows = 300, compact = false } = {}) {
    this.el = document.createElement('div');
    this.el.className = `widget history${compact ? ' compact' : ''}`;
    this.list = document.createElement('div');
    this.list.className = 'hist-list';
    this.el.appendChild(this.list);
    this.rows = [];
    this.maxRows = maxRows;
    this.paused = false;
    this.filter = { kb: true, mouse: true, pad: true };
    this.dirty = true;
    this.setSettings(settings);
  }

  setSettings(settings) {
    this.settings = settings;
    this.dirty = true;
  }

  setMaxRows(n) {
    this.maxRows = n;
    this.rows = this.rows.slice(-n);
    this.dirty = true;
  }

  clear() {
    this.rows = [];
    this.dirty = true;
  }

  onEvent(ev) {
    if (this.paused || !this.filter[ev.device]) {
      // on enregistre quand même les relâchements pour fermer les lignes ouvertes
      if (ev.type !== 'up') return;
    }
    const last = this.rows[this.rows.length - 1];
    const item = { device: ev.device, code: ev.code, key: ev.key, tDown: ev.t, tUp: null, angle: ev.angle ?? null };

    if (ev.type === 'tap') {
      if (last && last.tap && last.items[0].key === ev.key && ev.t - last.tLast < 300) {
        last.count++;
        last.tLast = ev.t;
      } else {
        item.tUp = ev.t;
        this._push({ items: [item], t0: ev.t, tLast: ev.t, tap: true, count: 1, gap: last ? ev.t - last.t0 : null });
      }
    } else if (ev.type === 'down') {
      const merge = this.settings.mergeWindowMs ?? 25;
      if (last && !last.tap && ev.t - last.t0 <= merge) last.items.push(item);
      else this._push({ items: [item], t0: ev.t, gap: last ? ev.t - last.t0 : null });
    } else if (ev.type === 'up') {
      for (let r = this.rows.length - 1, n = 0; r >= 0 && n < 60; r--, n++) {
        const it = this.rows[r].items.find((i) => i.key === ev.key && i.tUp === null);
        if (it) {
          it.tUp = ev.t;
          if (ev.peakAngle != null) it.angle = ev.peakAngle; // angle au plus loin du centre
          break;
        }
      }
    }
    this.dirty = true;
  }

  _push(row) {
    this.rows.push(row);
    if (this.rows.length > this.maxRows) this.rows.splice(0, this.rows.length - this.maxRows);
  }

  update(_hub, now) {
    const live = this.rows.some((r) => r.items.some((i) => i.tUp === null));
    if (!this.dirty && !live) return;
    this.dirty = false;
    const unit = this.settings.timeUnit;
    let html = '';
    for (let r = this.rows.length - 1; r >= 0; r--) {
      const row = this.rows[r];
      const held = row.items.some((i) => i.tUp === null);
      const chips = row.items
        .map((i) => {
          const ang = i.angle != null ? ` <small class="ang">${formatAngle(i.angle)}</small>` : '';
          return `<span class="chip dev-${i.device}${i.tUp === null ? ' held' : ''}">${esc(inputLabel(i, this.settings))}${ang}</span>`;
        })
        .join('<span class="plus">+</span>');
      const dur = row.tap
        ? row.count > 1 ? `×${row.count}` : ''
        : formatDuration(Math.max(...row.items.map((i) => (i.tUp ?? now) - i.tDown)), unit);
      const gapTxt = row.gap == null ? '' : `+${formatDuration(row.gap, unit)}`;
      html += `<div class="hist-row${held ? ' held' : ''}"><span class="gap">${gapTxt}</span><span class="chips">${chips}</span><span class="dur">${dur}</span></div>`;
    }
    this.list.innerHTML = html || '<div class="hist-empty">Rien pour l\'instant : appuie sur une touche, clique ou utilise ta manette.</div>';
  }
}

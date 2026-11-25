// Éditeur de séquence en frise, façon montage vidéo :
//  - une piste par input (les inputs à maintenir en haut, sur toute la durée) ;
//  - un bloc par input d'une étape, relié aux autres inputs de la même étape ;
//  - glisser un bloc = déplacer l'étape (Maj : décale aussi les suivantes) ;
//  - double-clic sur une piste = ajouter l'input à cet endroit ; clic droit sur un bloc = le retirer ;
//  - fenêtres de délai en jaune, étirables par leurs bords ;
//  - aperçu animé, dernier essai en fantôme, zoom Ctrl+molette.
import { keyOf, isStickInput, hasWindow } from './training.js';
import { inputLabel, formatDuration, formatAngle, PAD_LABELS } from './labels.js';
import { actionLabel } from './templates.js';

const LANE_H = 30;
const RULER_H = 26;
const LABEL_W = 132;
const PAD = 16; // marge à gauche du temps 0
const SNAP = 5; // ms
const ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const snap = (t, free) => (free ? Math.round(t) : Math.round(t / SNAP) * SNAP);

export class SeqEditor {
  /**
   * @param {HTMLElement} el
   * @param {{ getSettings, onBeforeChange, onChange, onSelect, onCaptureLane, getActions }} opts
   */
  constructor(el, opts) {
    this.el = el;
    this.o = opts;
    this.seq = null;
    this.k = 0.6; // px par ms
    this.sel = null; // étape sélectionnée (objet)
    this.extraLanes = []; // pistes ajoutées mais encore vides
    this.ghost = null; // dernier essai : [{ i, at, status }]
    this.drag = null;
    this.play = null;
    el.classList.add('se');
    el.tabIndex = 0;
    el.innerHTML = `
      <div class="se-bar">
        <button class="btn se-b" data-a="play" title="Rejoue le modèle avec une tête de lecture">▶ Aperçu</button>
        <select class="select se-speed" title="Vitesse de l'aperçu"><option value="1">×1</option><option value="0.5">×0.5</option><option value="0.25" selected>×0.25</option></select>
        <span class="se-sep"></span>
        <button class="btn se-b" data-a="zoom-out" title="Dézoomer (Ctrl+molette)">−</button>
        <button class="btn se-b" data-a="fit">Ajuster</button>
        <button class="btn se-b" data-a="zoom-in" title="Zoomer (Ctrl+molette)">+</button>
        <span class="se-sep"></span>
        <button class="btn se-b" data-a="undo" title="Annuler (Ctrl+Z)">↶</button>
        <button class="btn se-b" data-a="redo" title="Rétablir (Ctrl+Y)">↷</button>
        <span class="se-sep"></span>
        <button class="btn se-b" data-a="lane" title="Ajouter une piste (un input)">+ Piste</button>
        <span class="se-hint">Glisse un bloc pour le déplacer (Maj : décale la suite) · double-clic sur une piste : ajouter · clic droit : retirer</span>
      </div>
      <div class="se-scroll"><div class="se-content"></div></div>
      <div class="se-palette" hidden></div>`;
    this.scroll = el.querySelector('.se-scroll');
    this.content = el.querySelector('.se-content');
    this.palette = el.querySelector('.se-palette');
    this.speed = el.querySelector('.se-speed');
    this._bind();
    new ResizeObserver(() => {
      if (this.fitPending && this.scroll.clientWidth) this.fit();
    }).observe(this.scroll);
  }

  get settings() {
    return this.o.getSettings();
  }

  // ---------------------------------------------------------------- données
  setSequence(seq, { keepView = false } = {}) {
    const same = this.seq && seq && this.seq.id === seq.id;
    this.seq = seq;
    if (!same) {
      this.extraLanes = [];
      this.sel = null;
      this.ghost = null;
      this.stopPreview();
    } else if (this.sel && seq && !seq.steps.includes(this.sel)) {
      this.sel = null;
    }
    if (!keepView || !same) this.fit();
    else this.render();
  }

  setGhost(ghost) {
    this.ghost = ghost;
    this.render();
  }

  select(step) {
    this.sel = step;
    this.o.onSelect?.(step ? this.seq.steps.indexOf(step) : -1);
    this.render();
  }

  lanes() {
    const out = [];
    const seen = new Set();
    for (const h of this.seq?.hold ?? []) {
      seen.add(keyOf(h));
      out.push({ key: keyOf(h), input: h, hold: true });
    }
    for (const st of this.seq?.steps ?? []) {
      for (const i of st.inputs) {
        const k = keyOf(i);
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ key: k, input: i });
      }
    }
    for (const i of this.extraLanes) {
      const k = keyOf(i);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ key: k, input: i, empty: true });
    }
    return out;
  }

  endT() {
    const steps = this.seq?.steps ?? [];
    let end = steps.at(-1)?.t ?? 0;
    steps.forEach((st, i) => {
      if (i > 0 && hasWindow(st)) end = Math.max(end, steps[i - 1].t + (st.maxGap ?? (st.minGap ?? 0) + 100));
    });
    for (const g of this.ghost ?? []) end = Math.max(end, g.at);
    return end;
  }

  x(t) {
    return LABEL_W + PAD + t * this.k;
  }

  tAt(clientX) {
    const r = this.content.getBoundingClientRect();
    return (clientX - r.left - LABEL_W - PAD) / this.k;
  }

  fit() {
    const w = this.scroll.clientWidth;
    if (!w) {
      this.fitPending = true;
      return this.render();
    }
    this.fitPending = false;
    this.k = Math.max(0.05, Math.min(6, (w - LABEL_W - PAD - 60) / Math.max(250, this.endT() + 80)));
    this.render();
    this.scroll.scrollLeft = 0;
  }

  zoom(f, clientX = null) {
    const r = this.scroll.getBoundingClientRect();
    const cx = clientX ?? r.left + r.width / 2;
    const t = this.tAt(cx);
    this.k = Math.max(0.05, Math.min(8, this.k * f));
    this.render();
    // garde le même instant sous la souris
    this.scroll.scrollLeft = Math.max(0, this.x(t) - (cx - r.left));
  }

  // ---------------------------------------------------------------- modifications
  change(fn, { live = false } = {}) {
    if (!live) this.o.onBeforeChange?.();
    fn();
    this.normalize();
    this.render();
    if (!live) this.o.onChange?.();
  }

  normalize() {
    const steps = this.seq.steps;
    steps.sort((a, b) => a.t - b.t);
    const t0 = steps[0]?.t ?? 0;
    if (t0 !== 0) for (const s of steps) s.t -= t0;
  }

  laneInput(lane) {
    const { device, code, action } = lane.input;
    const i = { device, code };
    if (action) i.action = action;
    return i;
  }

  addAt(lane, t) {
    if (lane.hold) return;
    const cw = (this.seq.chordWindow ?? 40) / 2;
    t = Math.max(0, snap(t));
    this.change(() => {
      const near = this.seq.steps.find((s) => Math.abs(s.t - t) <= cw);
      if (near) {
        if (!near.inputs.some((i) => keyOf(i) === lane.key)) near.inputs.push(this.laneInput(lane));
        this.sel = near;
      } else {
        const st = { t, inputs: [this.laneInput(lane)] };
        this.seq.steps.push(st);
        this.sel = st;
      }
      this.extraLanes = this.extraLanes.filter((i) => keyOf(i) !== lane.key);
    });
  }

  removeInput(step, key) {
    this.change(() => {
      step.inputs = step.inputs.filter((i) => keyOf(i) !== key);
      if (!step.inputs.length) {
        this.seq.steps.splice(this.seq.steps.indexOf(step), 1);
        if (this.sel === step) this.sel = null;
      }
    });
  }

  removeLane(lane) {
    this.change(() => {
      if (lane.hold) this.seq.hold = this.seq.hold.filter((h) => keyOf(h) !== lane.key);
      for (const st of this.seq.steps) st.inputs = st.inputs.filter((i) => keyOf(i) !== lane.key);
      this.seq.steps = this.seq.steps.filter((st) => st.inputs.length);
      this.extraLanes = this.extraLanes.filter((i) => keyOf(i) !== lane.key);
      if (this.sel && !this.seq.steps.includes(this.sel)) this.sel = null;
    });
  }

  addLane(input) {
    const k = keyOf(input);
    if (!this.lanes().some((l) => l.key === k)) this.extraLanes.push(input);
    this.render();
  }

  deleteSelected() {
    if (!this.sel) return;
    const st = this.sel;
    this.change(() => {
      this.seq.steps.splice(this.seq.steps.indexOf(st), 1);
      this.sel = null;
    });
  }

  duplicateSelected() {
    if (!this.sel) return;
    const st = this.sel;
    this.change(() => {
      const copy = structuredClone(st);
      copy.t = st.t + 100;
      delete copy.minGap;
      delete copy.maxGap;
      this.seq.steps.push(copy);
      this.sel = copy;
    });
  }

  nudge(ms, ripple) {
    if (!this.sel) return;
    const st = this.sel;
    this.change(() => {
      const idx = this.seq.steps.indexOf(st);
      const moved = ripple ? this.seq.steps.slice(idx) : [st];
      for (const s of moved) s.t = Math.max(0, s.t + ms);
    });
  }

  // ---------------------------------------------------------------- aperçu
  togglePreview() {
    if (this.play) return this.stopPreview();
    const speed = Number(this.speed.value) || 1;
    const end = this.endT() + 250;
    const start = performance.now();
    const btn = this.el.querySelector('[data-a="play"]');
    btn.textContent = '■ Stop';
    const tick = (now) => {
      if (!this.play) return;
      const t = (now - start) * speed;
      this.play.t = t;
      this.render();
      if (t > end) return this.stopPreview();
      this.play.raf = requestAnimationFrame(tick);
    };
    this.play = { t: 0, raf: requestAnimationFrame(tick) };
  }

  stopPreview() {
    if (!this.play) return;
    cancelAnimationFrame(this.play.raf);
    this.play = null;
    const btn = this.el.querySelector('[data-a="play"]');
    if (btn) btn.textContent = '▶ Aperçu';
    this.render();
  }

  // ---------------------------------------------------------------- palette « + Piste »
  openPalette() {
    const s = this.settings;
    const style = s.padStyle ?? 'xbox';
    const pad = (code) => ({ device: 'pad', code });
    const btn = (input, label = inputLabel(input, s), title = '') =>
      `<button class="se-pal-i" data-in='${esc(JSON.stringify(input))}' title="${esc(title)}">${esc(label)}</button>`;
    const actions = this.o.getActions?.() ?? [];
    const order = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    this.palette.innerHTML = `
      ${actions.length ? `<h4>Actions (${esc(this.seq.game)})</h4><div class="se-pal-row">${actions.map((a) => btn(a.input, a.label, inputLabel(a.input, s))).join('')}</div>` : ''}
      <h4>Boutons manette</h4><div class="se-pal-row">${order.map((c) => btn(pad(c), PAD_LABELS[style][c] ?? String(c))).join('')}</div>
      <h4>Stick gauche</h4><div class="se-pal-row">${ARROWS.map((a) => btn(pad(`ls:${a}`), `LS ${a}`)).join('')}</div>
      <h4>Stick droit</h4><div class="se-pal-row">${ARROWS.map((a) => btn(pad(`rs:${a}`), `RS ${a}`)).join('')}</div>
      <div class="se-pal-row"><button class="btn se-pal-cap">Autre : appuie sur une touche / un bouton…</button></div>`;
    this.palette.hidden = false;
  }

  // ---------------------------------------------------------------- rendu
  render() {
    if (!this.seq) {
      this.content.innerHTML = '';
      return;
    }
    const s = this.settings;
    const lanes = this.lanes();
    const steps = this.seq.steps;
    const laneIdx = new Map(lanes.map((l, i) => [l.key, i]));
    const top = (i) => RULER_H + i * LANE_H;
    const end = this.endT();
    const width = Math.max(this.scroll.clientWidth, this.x(end + 200) + 40);
    const height = RULER_H + Math.max(1, lanes.length) * LANE_H + 6;
    const unit = s.timeUnit;
    let h = '';

    // règle
    const step = [5, 10, 20, 50, 100, 200, 500, 1000, 2000].find((v) => v * this.k >= 46) ?? 5000;
    h += `<div class="se-ruler" style="height:${RULER_H}px"><div class="se-lbl se-lbl-ruler">ms</div></div>`;
    for (let t = 0; this.x(t) < width; t += step) {
      h += `<div class="se-tick" style="left:${this.x(t)}px;height:${height}px"></div><div class="se-tick-t" style="left:${this.x(t) + 3}px">${formatDuration(t, unit)}</div>`;
    }
    // écarts entre étapes sur la règle
    steps.forEach((st, i) => {
      if (i === 0) return;
      const a = this.x(steps[i - 1].t);
      const b = this.x(st.t);
      if (b - a > 34) h += `<div class="se-gap" style="left:${a}px;width:${b - a}px">+${formatDuration(Math.round(st.t - steps[i - 1].t), unit)}</div>`;
    });

    // pistes
    lanes.forEach((l, i) => {
      const al = l.input.action && this.seq.game ? actionLabel(this.seq.game, l.input.action) : '';
      h += `<div class="se-row${i % 2 ? ' odd' : ''}${l.hold ? ' hold' : ''}" data-lane="${i}" style="top:${top(i)}px;height:${LANE_H}px">
        <div class="se-lbl"><span class="se-dot dev-${l.input.device}"></span><b>${esc(inputLabel(l.input, s))}</b>${al ? `<small>${esc(al)}</small>` : ''}${l.hold ? '<small>maintenu</small>' : ''}<button class="se-lane-x" data-lane="${i}" title="Retirer cette piste">×</button></div>
      </div>`;
      if (l.hold) {
        h += `<div class="se-holdbar" style="left:${this.x(0) - 6}px;width:${Math.max(30, this.x(steps.at(-1)?.t ?? 0) - this.x(0) + 40)}px;top:${top(i) + 7}px">maintenu pendant tout l'essai</div>`;
      }
    });

    // fenêtres de délai (sous les blocs)
    steps.forEach((st, i) => {
      if (i === 0 || !hasWindow(st)) return;
      const li = laneIdx.get(keyOf(st.inputs[0]));
      const base = steps[i - 1].t;
      const a = base + (st.minGap ?? 0);
      const open = st.maxGap == null;
      const b = open ? a + Math.max(80, 60 / this.k) : base + st.maxGap;
      const lo = st.minGap != null ? formatDuration(st.minGap, unit) : '0';
      const hi = open ? '∞' : formatDuration(st.maxGap, unit);
      h += `<div class="se-win${open ? ' open' : ''}${st === this.sel ? ' sel' : ''}" style="left:${this.x(a)}px;width:${Math.max(4, this.x(b) - this.x(a))}px;top:${top(li) + 3}px;height:${LANE_H - 6}px" title="Étape ${i + 1} : entre ${lo} et ${hi} après l'étape ${i}">
        <div class="se-win-h" data-step="${i}" data-edge="min"></div>${open ? '' : `<div class="se-win-h r" data-step="${i}" data-edge="max"></div>`}</div>`;
    });

    // liens d'accord + blocs
    steps.forEach((st, i) => {
      const idx = st.inputs.map((x) => laneIdx.get(keyOf(x))).filter((v) => v != null);
      const x = this.x(st.t);
      if (idx.length > 1) {
        const y1 = top(Math.min(...idx)) + LANE_H / 2;
        const y2 = top(Math.max(...idx)) + LANE_H / 2;
        h += `<div class="se-chord${st === this.sel ? ' sel' : ''}" style="left:${x - 1}px;top:${y1}px;height:${y2 - y1}px"></div>`;
      }
      const hit = this.play && this.play.t >= st.t && this.play.t - st.t < 160;
      for (const inp of st.inputs) {
        const li = laneIdx.get(keyOf(inp));
        if (li == null) continue;
        const ang = isStickInput(inp) && inp.angle != null ? ` ${formatAngle(inp.angle)}` : '';
        h += `<div class="se-block dev-${inp.device}${st === this.sel ? ' sel' : ''}${hit ? ' hit' : ''}" data-step="${i}" data-key="${esc(keyOf(inp))}" style="left:${x - 13}px;top:${top(li) + 4}px;height:${LANE_H - 8}px" title="Étape ${i + 1} · ${esc(inputLabel(inp, s))}${esc(ang)} · à ${formatDuration(st.t, unit)}">${i + 1}${ang ? `<small>${esc(ang.trim())}</small>` : ''}</div>`;
      }
    });

    // dernier essai en fantôme
    for (const g of this.ghost ?? []) {
      const st = steps[g.i];
      if (!st) continue;
      for (const inp of st.inputs) {
        const li = laneIdx.get(keyOf(inp));
        if (li == null) continue;
        h += `<div class="se-ghost g-${g.status}" style="left:${this.x(g.at) - 7}px;top:${top(li) + LANE_H / 2 - 7}px" title="Ton dernier essai : étape ${g.i + 1} à ${formatDuration(Math.round(g.at), unit)}"></div>`;
      }
    }

    if (!lanes.length) h += `<div class="se-empty" style="top:${RULER_H + 6}px">Séquence vide : clique sur <b>● Enregistrer le modèle</b> et joue-la, ou sur <b>+ Piste</b> puis double-clique sur la piste.</div>`;
    if (this.play) h += `<div class="se-play" style="left:${this.x(this.play.t)}px;height:${height}px"></div>`;
    if (this.drag?.tip) h += `<div class="se-tip" style="left:${this.drag.tipX}px;top:${this.drag.tipY}px">${esc(this.drag.tip)}</div>`;

    this.content.style.width = `${width}px`;
    this.content.style.height = `${height}px`;
    this.content.innerHTML = h;
  }

  // ---------------------------------------------------------------- interactions
  _bind() {
    const el = this.el;
    el.querySelector('.se-bar').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-a]');
      if (!b) return;
      const a = b.dataset.a;
      if (a === 'play') this.togglePreview();
      else if (a === 'fit') this.fit();
      else if (a === 'zoom-in') this.zoom(1.5);
      else if (a === 'zoom-out') this.zoom(1 / 1.5);
      else if (a === 'undo') this.o.onUndo?.();
      else if (a === 'redo') this.o.onRedo?.();
      else if (a === 'lane') {
        ev.stopPropagation();
        if (this.palette.hidden) this.openPalette();
        else this.palette.hidden = true;
      }
    });
    this.palette.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const i = ev.target.closest('.se-pal-i');
      if (i) {
        this.addLane(JSON.parse(i.dataset.in));
        this.palette.hidden = true;
      } else if (ev.target.closest('.se-pal-cap')) {
        this.palette.hidden = true;
        this.o.onCaptureLane?.();
      }
    });
    document.addEventListener('click', (ev) => {
      if (!ev.target.closest('.se-palette')) this.palette.hidden = true;
    });

    // molette : défiler ; Ctrl+molette : zoomer
    this.scroll.addEventListener(
      'wheel',
      (ev) => {
        if (ev.ctrlKey) {
          ev.preventDefault();
          this.zoom(ev.deltaY < 0 ? 1.25 : 0.8, ev.clientX);
        } else if (Math.abs(ev.deltaY) > Math.abs(ev.deltaX) && this.scroll.scrollWidth > this.scroll.clientWidth) {
          ev.preventDefault();
          this.scroll.scrollLeft += ev.deltaY;
        }
      },
      { passive: false }
    );

    this.content.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      el.focus({ preventScroll: true });
      const x = ev.target.closest('.se-lane-x');
      if (x) return this.removeLane(this.lanes()[Number(x.dataset.lane)]);
      const handle = ev.target.closest('.se-win-h');
      const block = ev.target.closest('.se-block');
      if (handle) {
        const st = this.seq.steps[Number(handle.dataset.step)];
        this.select(st);
        this.drag = { kind: 'win', st, edge: handle.dataset.edge, started: false };
      } else if (block) {
        const st = this.seq.steps[Number(block.dataset.step)];
        this.sel = st;
        this.o.onSelect?.(this.seq.steps.indexOf(st));
        const idx = this.seq.steps.indexOf(st);
        this.drag = { kind: 'step', st, x0: ev.clientX, t0: st.t, after: this.seq.steps.slice(idx + 1).map((s) => [s, s.t]), started: false };
        this.render();
      } else {
        if (!ev.target.closest('.se-lbl') && this.sel) this.select(null);
        return;
      }
      try {
        this.content.setPointerCapture(ev.pointerId);
      } catch {}
      ev.preventDefault();
    });

    this.content.addEventListener('pointermove', (ev) => {
      const d = this.drag;
      if (!d) return;
      if (!d.started) {
        if (d.kind === 'step' && Math.abs(ev.clientX - d.x0) < 3) return;
        d.started = true;
        this.o.onBeforeChange?.();
      }
      const r = this.content.getBoundingClientRect();
      const unit = this.settings.timeUnit;
      const steps = this.seq.steps;
      if (d.kind === 'step') {
        const dt = snap((ev.clientX - d.x0) / this.k, ev.altKey);
        d.st.t = Math.max(0, d.t0 + dt);
        // Maj : les étapes suivantes suivent (montage « ripple »)
        for (const [s, t] of d.after) s.t = ev.shiftKey ? Math.max(0, t + dt) : t;
        const sorted = [...steps].sort((a, b) => a.t - b.t);
        const i = sorted.indexOf(d.st);
        const prev = sorted[i - 1];
        d.tip = `${formatDuration(d.st.t, unit)}${prev ? ` · +${formatDuration(Math.round(d.st.t - prev.t), unit)} après l'étape d'avant` : ''}${ev.shiftKey ? ' · suite décalée' : ''}`;
      } else {
        const i = steps.indexOf(d.st);
        const base = steps[i - 1]?.t ?? 0;
        const v = Math.max(0, snap(this.tAt(ev.clientX) - base, ev.altKey));
        if (d.edge === 'min') d.st.minGap = d.st.maxGap != null ? Math.min(v, d.st.maxGap) : v;
        else d.st.maxGap = Math.max(v, d.st.minGap ?? 0);
        d.tip = `fenêtre ${formatDuration(d.st.minGap ?? 0, unit)} – ${d.st.maxGap != null ? formatDuration(d.st.maxGap, unit) : '∞'}`;
      }
      d.tipX = ev.clientX - r.left + 12;
      d.tipY = ev.clientY - r.top - 28;
      this.render();
    });

    const endDrag = () => {
      const d = this.drag;
      if (!d) return;
      this.drag = null;
      if (d.started) {
        this.normalize();
        this.render();
        this.o.onChange?.();
      }
    };
    this.content.addEventListener('pointerup', endDrag);
    this.content.addEventListener('pointercancel', endDrag);

    // double-clic sur une piste : ajouter l'input à cet instant
    this.content.addEventListener('dblclick', (ev) => {
      if (ev.target.closest('.se-block, .se-lbl, .se-win-h')) return;
      const r = this.content.getBoundingClientRect();
      const li = Math.floor((ev.clientY - r.top - RULER_H) / LANE_H);
      const lane = this.lanes()[li];
      if (lane) this.addAt(lane, this.tAt(ev.clientX));
    });

    // clic droit sur un bloc : retirer cet input de l'étape
    this.content.addEventListener('contextmenu', (ev) => {
      const block = ev.target.closest('.se-block');
      if (!block) return;
      ev.preventDefault();
      this.removeInput(this.seq.steps[Number(block.dataset.step)], block.dataset.key);
    });

    el.addEventListener('keydown', (ev) => {
      if (ev.target.closest('input, select, textarea')) return;
      const ctrl = ev.ctrlKey || ev.metaKey;
      if (ctrl && ev.key.toLowerCase() === 'z') this.o.onUndo?.();
      else if (ctrl && (ev.key.toLowerCase() === 'y' || (ev.shiftKey && ev.key.toLowerCase() === 'z'))) this.o.onRedo?.();
      else if (ctrl && ev.key.toLowerCase() === 'd') this.duplicateSelected();
      else if (ev.key === 'Delete' || ev.key === 'Backspace') this.deleteSelected();
      else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') this.nudge((ev.key === 'ArrowLeft' ? -1 : 1) * (ev.shiftKey ? 50 : SNAP), ev.altKey);
      else if (ev.key === ' ') this.togglePreview();
      else return;
      ev.preventDefault();
    });
  }
}

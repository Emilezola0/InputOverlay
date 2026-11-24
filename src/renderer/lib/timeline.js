// Timeline sur canvas : une piste par input, barres = durée d'appui, losanges = crans de molette.
import { inputLabel, formatDuration } from './labels.js';

const LABEL_W = 96;
const AXIS_H = 26;
const LANE_H = 24;
const MIN_MS_PER_PX = 0.05;

function niceStep(msPerPx) {
  const target = msPerPx * 90; // ~90 px entre deux graduations
  const pow = 10 ** Math.floor(Math.log10(target));
  for (const m of [1, 2, 5, 10]) if (m * pow >= target) return m * pow;
  return 10 * pow;
}

export function formatClock(ms, precise = true) {
  const s = ms / 1000;
  if (s < 60) return precise ? `${s.toFixed(2)}s` : `${+s.toFixed(2)}s`;
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(precise ? 2 : 0).padStart(precise ? 5 : 2, '0')}`;
}

export class Timeline {
  constructor(container, { onSeek } = {}) {
    this.container = container;
    this.onSeek = onSeek;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'tl-canvas';
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.data = null;
    this.settings = null;
    this.msPerPx = 10;
    this.offset = 0; // ms au bord gauche de la zone des barres
    this.playhead = 0;
    this.follow = true;
    this.fitted = true; // tant que l'utilisateur n'a pas zoomé, on garde la session entière visible
    this._queued = false;

    new ResizeObserver(() => this._resize()).observe(container);

    let dragging = false;
    const seekAt = (ev) => {
      const r = this.canvas.getBoundingClientRect();
      const x = ev.clientX - r.left - LABEL_W;
      this.onSeek?.(Math.max(0, Math.min(this.duration, this.offset + Math.max(0, x) * this.msPerPx)));
    };
    this.canvas.addEventListener('mousedown', (ev) => {
      if (ev.button !== 0 || !this.data) return;
      dragging = true;
      seekAt(ev);
    });
    window.addEventListener('mousemove', (ev) => dragging && seekAt(ev));
    window.addEventListener('mouseup', () => (dragging = false));
    this.canvas.addEventListener('mousemove', (ev) => this._hover(ev));

    this.canvas.addEventListener(
      'wheel',
      (ev) => {
        if (!this.data) return;
        if (ev.ctrlKey) {
          ev.preventDefault();
          const r = this.canvas.getBoundingClientRect();
          const x = Math.max(0, ev.clientX - r.left - LABEL_W);
          this.zoomAround(ev.deltaY < 0 ? 1 / 1.25 : 1.25, x);
        } else if (ev.shiftKey || Math.abs(ev.deltaX) > Math.abs(ev.deltaY)) {
          ev.preventDefault();
          this.follow = false;
          this.pan((ev.deltaX || ev.deltaY) * this.msPerPx);
        }
      },
      { passive: false }
    );
  }

  get duration() {
    return this.data?.duration ?? 0;
  }
  get barWidth() {
    return Math.max(10, this.width - LABEL_W - 8);
  }

  setData(data, settings) {
    this.data = data;
    this.settings = settings;
    this.playhead = 0;
    this._resize();
    this.fit();
  }

  setSettings(settings) {
    this.settings = settings;
    this.draw();
  }

  fit() {
    if (!this.data) return;
    this.msPerPx = Math.max(MIN_MS_PER_PX, this.duration / this.barWidth);
    this.offset = 0;
    this.follow = true;
    this.fitted = true;
    this.draw();
  }

  zoomAround(factor, x = this.barWidth / 2) {
    this.fitted = false;
    const at = this.offset + x * this.msPerPx;
    const maxMsPerPx = Math.max(MIN_MS_PER_PX, this.duration / this.barWidth) * 1.5;
    this.msPerPx = Math.min(maxMsPerPx, Math.max(MIN_MS_PER_PX, this.msPerPx * factor));
    this.offset = at - x * this.msPerPx;
    this._clampOffset();
    this.draw();
  }

  pan(ms) {
    this.fitted = false;
    this.offset += ms;
    this._clampOffset();
    this.draw();
  }

  _clampOffset() {
    const visible = this.barWidth * this.msPerPx;
    this.offset = Math.max(0, Math.min(this.offset, Math.max(0, this.duration - visible * 0.9)));
  }

  setPlayhead(t, playing = false) {
    this.playhead = t;
    if (playing && this.follow) {
      const visible = this.barWidth * this.msPerPx;
      if (t > this.offset + visible * 0.92 || t < this.offset) {
        this.offset = Math.max(0, t - visible * 0.1);
      }
    }
    this.draw();
  }

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    this.width = this.container.clientWidth;
    const lanes = this.data?.lanes.length ?? 0;
    this.height = Math.max(AXIS_H + LANE_H * 3, AXIS_H + lanes * LANE_H + 6);
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.fitted && this.data && this.width > 0) this.msPerPx = Math.max(MIN_MS_PER_PX, this.duration / this.barWidth);
    this.draw();
  }

  draw() {
    if (this._queued) return;
    this._queued = true;
    requestAnimationFrame(() => {
      this._queued = false;
      this._draw();
    });
  }

  _x(t) {
    return LABEL_W + (t - this.offset) / this.msPerPx;
  }

  _draw() {
    const { ctx, width: W, height: H } = this;
    const css = getComputedStyle(document.documentElement);
    const v = (n) => css.getPropertyValue(n).trim();
    const colors = { kb: v('--kb'), mouse: v('--mouse'), pad: v('--pad') };
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = v('--panel');
    ctx.fillRect(0, 0, W, H);
    if (!this.data) return;

    const { lanes } = this.data;
    const step = niceStep(this.msPerPx);
    const tStart = Math.floor(this.offset / step) * step;
    const tEnd = this.offset + this.barWidth * this.msPerPx;

    // pistes
    lanes.forEach((l, i) => {
      const y = AXIS_H + i * LANE_H;
      ctx.fillStyle = i % 2 ? v('--panel') : v('--panel-2');
      ctx.fillRect(LABEL_W, y, W - LABEL_W, LANE_H);
    });

    // grille + axe
    ctx.font = '11px Segoe UI, sans-serif';
    ctx.textBaseline = 'middle';
    for (let t = tStart; t <= tEnd; t += step) {
      const x = this._x(t);
      if (x < LABEL_W) continue;
      ctx.fillStyle = v('--line');
      ctx.fillRect(Math.round(x), AXIS_H - 6, 1, H);
      ctx.fillStyle = v('--muted');
      ctx.fillText(formatClock(t, false), x + 4, AXIS_H / 2);
    }
    // fin de la session
    const xEnd = this._x(this.duration);
    if (xEnd < W) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(xEnd, AXIS_H, W - xEnd, H - AXIS_H);
    }

    // barres
    lanes.forEach((l, i) => {
      const y = AXIS_H + i * LANE_H;
      const c = colors[l.device];
      for (const s of l.segments) {
        if (s.e < this.offset || s.s > tEnd) continue;
        const x0 = Math.max(LABEL_W, this._x(s.s));
        const x1 = Math.max(x0 + 2, this._x(s.e));
        const active = this.playhead >= s.s && this.playhead <= s.e;
        ctx.globalAlpha = active ? 1 : 0.7;
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.roundRect(x0, y + 4, x1 - x0, LANE_H - 8, 3);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      for (const t of l.taps) {
        if (t < this.offset || t > tEnd) continue;
        const x = this._x(t);
        const cy = y + LANE_H / 2;
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.moveTo(x, cy - 6);
        ctx.lineTo(x + 5, cy);
        ctx.lineTo(x, cy + 6);
        ctx.lineTo(x - 5, cy);
        ctx.closePath();
        ctx.fill();
      }
    });

    // colonne des libellés
    ctx.fillStyle = v('--panel');
    ctx.fillRect(0, 0, LABEL_W, H);
    ctx.fillStyle = v('--line');
    ctx.fillRect(LABEL_W - 1, 0, 1, H);
    ctx.font = '600 12px Segoe UI, sans-serif';
    lanes.forEach((l, i) => {
      const y = AXIS_H + i * LANE_H + LANE_H / 2;
      ctx.fillStyle = colors[l.device];
      ctx.fillRect(8, y - 5, 4, 10);
      ctx.fillStyle = v('--text');
      ctx.fillText(inputLabel(l, this.settings), 18, y, LABEL_W - 24);
    });

    // tête de lecture
    const px = this._x(this.playhead);
    if (px >= LABEL_W && px <= W) {
      ctx.fillStyle = '#ff4d6d';
      ctx.fillRect(Math.round(px) - 1, 0, 2, H);
      ctx.beginPath();
      ctx.moveTo(px - 6, 0);
      ctx.lineTo(px + 6, 0);
      ctx.lineTo(px, 8);
      ctx.fill();
    }
  }

  _hover(ev) {
    if (!this.data) return;
    const r = this.canvas.getBoundingClientRect();
    const x = ev.clientX - r.left;
    const y = ev.clientY - r.top;
    const lane = this.data.lanes[Math.floor((y - AXIS_H) / LANE_H)];
    let tip = '';
    if (lane && x > LABEL_W) {
      const t = this.offset + (x - LABEL_W) * this.msPerPx;
      const tol = 4 * this.msPerPx;
      const seg = lane.segments.find((s) => t >= s.s - tol && t <= s.e + tol);
      const unit = this.settings.timeUnit;
      const name = inputLabel(lane, this.settings);
      if (seg) tip = `${name} — appuyé ${formatDuration(seg.e - seg.s, unit)} (à ${formatClock(seg.s)})`;
      else if (lane.taps.some((tp) => Math.abs(tp - t) <= tol * 1.5)) tip = `${name} (à ${formatClock(t)})`;
    } else if (lane) {
      tip = `${inputLabel(lane, this.settings)} : ${lane.count} appui(s), maintien moyen ${formatDuration(lane.avgHold, this.settings.timeUnit)}`;
    }
    this.canvas.title = tip;
  }
}

// Analyse d'une session enregistrée + état rejouable compatible avec les widgets (même forme que le hub).

const DEVICE_ORDER = { kb: 0, mouse: 1, pad: 2 };
const ARROW_VEC = {
  '→': [1, 0], '↘': [0.71, 0.71], '↓': [0, 1], '↙': [-0.71, 0.71],
  '←': [-1, 0], '↖': [-0.71, -0.71], '↑': [0, -1], '↗': [0.71, -0.71],
};

export const keyOf = (e) => `${e.device}:${e.code}`;

/** Transforme une liste d'événements en pistes (une par input) avec segments d'appui. */
export function analyze(session) {
  const lanes = new Map();
  const open = new Map();
  const lane = (e) => {
    const key = keyOf(e);
    if (!lanes.has(key)) {
      lanes.set(key, { key, device: e.device, code: e.code, first: e.t, segments: [], taps: [], count: 0 });
    }
    return lanes.get(key);
  };
  for (const e of session.events) {
    const l = lane(e);
    if (e.type === 'down') {
      open.set(l.key, e.t);
      l.count++;
    } else if (e.type === 'up' && open.has(l.key)) {
      l.segments.push({ s: open.get(l.key), e: e.t });
      open.delete(l.key);
    } else if (e.type === 'tap') {
      l.taps.push(e.t);
      l.count++;
    }
  }
  for (const [key, s] of open) lanes.get(key).segments.push({ s, e: session.durationMs });

  const list = [...lanes.values()].sort(
    (a, b) => DEVICE_ORDER[a.device] - DEVICE_ORDER[b.device] || a.first - b.first
  );
  for (const l of list) {
    const held = l.segments.map((s) => s.e - s.s);
    l.avgHold = held.length ? held.reduce((a, b) => a + b, 0) / held.length : 0;
  }

  const presses = session.events.filter((e) => e.type !== 'up').map((e) => e.t);
  const gaps = presses.slice(1).map((t, i) => t - presses[i]).filter((g) => g > 0);
  const minutes = Math.max(session.durationMs, 1) / 60000;
  return {
    lanes: list,
    duration: session.durationMs,
    stats: {
      total: presses.length,
      perMinute: presses.length / minutes,
      avgGap: gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0,
      byDevice: list.reduce((acc, l) => ((acc[l.device] = (acc[l.device] || 0) + l.count), acc), {}),
      top: [...list].sort((a, b) => b.count - a.count).slice(0, 8),
    },
  };
}

/** État reconstruit au temps t, lisible par KeyboardWidget / MouseWidget / GamepadWidget. */
export class ReplayState {
  constructor(events) {
    this.events = events;
    this.reset();
  }

  reset() {
    this.idx = 0;
    this.t = -1;
    this.kb = new Set();
    this.mouse = new Set();
    this.wheel = {};
    this.pad = { connected: true, id: 'Rejeu', buttons: [], values: [], axes: [0, 0, 0, 0] };
  }

  /** Avance (ou recule) jusqu'à t. `onEvent` reçoit chaque événement appliqué ; retourne true si on a dû repartir de zéro. */
  seek(t, onEvent) {
    let rewound = false;
    if (t < this.t) {
      this.reset();
      rewound = true;
    }
    while (this.idx < this.events.length && this.events[this.idx].t <= t) {
      const e = this.events[this.idx++];
      this._apply(e);
      onEvent?.(e);
    }
    this.t = t;
    return rewound;
  }

  _apply(e) {
    const down = e.type === 'down';
    if (e.device === 'kb') down ? this.kb.add(e.code) : this.kb.delete(e.code);
    else if (e.device === 'mouse') {
      if (e.type === 'tap') this.wheel[e.code] = e.t;
      else down ? this.mouse.add(e.code) : this.mouse.delete(e.code);
    } else if (e.device === 'pad') {
      if (typeof e.code === 'number') {
        this.pad.buttons[e.code] = down;
        this.pad.values[e.code] = down ? 1 : 0;
      } else {
        const [stick, arrow] = e.code.split(':');
        const base = stick === 'ls' ? 0 : 2;
        const [x, y] = down ? ARROW_VEC[arrow] || [0, 0] : [0, 0];
        this.pad.axes[base] = x;
        this.pad.axes[base + 1] = y;
      }
    }
  }
}

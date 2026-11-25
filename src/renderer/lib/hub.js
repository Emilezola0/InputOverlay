// Hub d'inputs : reçoit clavier/souris du process principal, lit la manette (API Gamepad)
// et diffuse des événements normalisés : { type: 'down'|'up'|'tap', device, code, key, t, sticks }.
// Angles des sticks en degrés : 0 = haut, positif = vers la droite, négatif = vers la gauche (−180…180).
//  - sticks : position des deux sticks au moment de l'événement ({ ls: { a, m }, rs: { a, m } }, m = force 0…1) ;
//  - direction de stick (ls:↖…) : angle à l'entrée dans la direction (down), angle au plus loin du centre (peakAngle, up).

const ARROWS = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗']; // secteurs de 45° (y vers le bas)
const STICK_DEADZONE = 0.5;
const TRIGGER_THRESHOLD = 0.35;

export const stickAngle = (x, y) => Math.round((Math.atan2(x, -y) * 180) / Math.PI);
const isStickCode = (code) => typeof code === 'string' && /^[lr]s:/.test(code);

function stickDirection(x, y) {
  if (Math.hypot(x, y) < STICK_DEADZONE) return null;
  const angle = Math.atan2(y, x); // -PI..PI, 0 = droite, PI/2 = bas
  const sector = Math.round(angle / (Math.PI / 4));
  return ARROWS[(sector + 8) % 8];
}

export class InputHub {
  constructor() {
    this.listeners = new Set();
    this.kb = new Set();
    this.mouse = new Set();
    this.wheel = {}; // code -> timestamp du dernier cran
    this.pad = { connected: false, id: '', index: -1, buttons: [], values: [], axes: [0, 0, 0, 0] };
    this._padPressed = [];
    this._dirs = { ls: null, rs: null };
    this.stick = { ls: { a: 0, m: 0 }, rs: { a: 0, m: 0 } }; // position actuelle
    this._peak = { ls: null, rs: null }; // point le plus loin du centre dans la direction en cours
  }

  start() {
    window.inputMemory.onInput((raw) => this._onRaw(raw));
    // setInterval plutôt que rAF : continue de tourner quand la fenêtre est minimisée
    setInterval(() => this._pollPad(), 4);
    window.addEventListener('gamepadconnected', () => this._pollPad());
    window.addEventListener('gamepaddisconnected', () => this._pollPad());
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _emit(type, device, code, extra = {}) {
    const sticks = { ls: { ...this.stick.ls }, rs: { ...this.stick.rs } };
    const ev = { type, device, code, key: `${device}:${code}`, t: performance.now(), sticks, ...extra };
    for (const fn of this.listeners) fn(ev);
  }

  _onRaw(raw) {
    const { type, device, code } = raw;
    if (device === 'pad') {
      // événements factices (tests) : la position du stick suit l'angle fourni
      const extra = {};
      for (const k of ['angle', 'peakAngle']) if (raw[k] !== undefined) extra[k] = raw[k];
      if (isStickCode(code)) {
        const s = code.slice(0, 2);
        if (type === 'down') this.stick[s] = { a: raw.angle ?? this.stick[s].a, m: 1 };
        else if (type === 'up') this.stick[s] = { a: this.stick[s].a, m: 0 };
      }
      return this._emit(type, device, code, extra);
    }
    const set = device === 'kb' ? this.kb : this.mouse;
    if (type === 'down') set.add(code);
    else if (type === 'up') set.delete(code);
    else if (type === 'tap') this.wheel[code] = performance.now();
    this._emit(type, device, code);
  }

  _pickGamepad() {
    const pads = [...(navigator.getGamepads?.() || [])].filter(Boolean);
    return pads.find((p) => p.mapping === 'standard') || pads[0] || null;
  }

  _pollPad() {
    const gp = this._pickGamepad();
    if (!gp) {
      if (this.pad.connected) {
        // libère tout ce qui était appuyé
        this._padPressed.forEach((p, i) => p && this._emit('up', 'pad', i));
        for (const s of ['ls', 'rs']) if (this._dirs[s]) this._emit('up', 'pad', `${s}:${this._dirs[s]}`);
        this._padPressed = [];
        this._dirs = { ls: null, rs: null };
      }
      this.pad.connected = false;
      return;
    }
    const pad = this.pad;
    pad.connected = true;
    pad.id = gp.id;
    pad.index = gp.index;
    pad.axes = [...gp.axes];
    pad.values = gp.buttons.map((b) => b.value);
    pad.buttons = gp.buttons.map((b, i) =>
      i === 6 || i === 7 ? b.value > TRIGGER_THRESHOLD : b.pressed
    );

    pad.buttons.forEach((pressed, i) => {
      if (pressed !== !!this._padPressed[i]) {
        this._padPressed[i] = pressed;
        this._emit(pressed ? 'down' : 'up', 'pad', i);
      }
    });

    const sticks = { ls: [gp.axes[0] ?? 0, gp.axes[1] ?? 0], rs: [gp.axes[2] ?? 0, gp.axes[3] ?? 0] };
    for (const [s, [x, y]] of Object.entries(sticks)) {
      const cur = { a: stickAngle(x, y), m: Math.min(1, Math.hypot(x, y)) };
      this.stick[s] = cur;
      const dir = stickDirection(x, y);
      if (dir !== this._dirs[s]) {
        if (this._dirs[s]) this._emit('up', 'pad', `${s}:${this._dirs[s]}`, { peakAngle: this._peak[s]?.a });
        if (dir) this._emit('down', 'pad', `${s}:${dir}`, { angle: cur.a });
        this._dirs[s] = dir;
        this._peak[s] = dir ? { ...cur } : null;
      } else if (dir && cur.m >= this._peak[s].m) {
        this._peak[s] = { ...cur };
      }
    }
  }
}

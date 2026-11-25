// Enregistreur de sessions : capture les événements du hub avec un temps relatif au début.


const two = (n) => String(n).padStart(2, '0');
export const defaultSessionName = (d = new Date()) =>
  `Session du ${two(d.getDate())}/${two(d.getMonth() + 1)} à ${two(d.getHours())}:${two(d.getMinutes())}`;

export class Recorder {
  constructor(api) {
    this.api = api;
    this.active = false;
    this.events = [];
    this.t0 = 0;
    this.startedAt = null;
  }

  get elapsed() {
    return this.active ? performance.now() - this.t0 : 0;
  }

  start() {
    this.active = true;
    this.events = [];
    this.t0 = performance.now();
    this.startedAt = Date.now();
    this.api.setRecordState({ active: true, startedAt: this.startedAt });
  }

  onEvent(ev) {
    if (!this.active) return;
    const e = { t: Math.round((ev.t - this.t0) * 10) / 10, type: ev.type, device: ev.device, code: ev.code };
    if (ev.angle != null) e.angle = ev.angle;
    if (ev.peakAngle != null) e.peakAngle = ev.peakAngle;
    this.events.push(e);
  }

  /** @param {'button'|'shortcut'} source ce qui a déclenché l'arrêt (pour retirer ses propres inputs) */
  async stop(settings, source = 'button') {
    if (!this.active) return null;
    this.active = false;
    const durationMs = Math.round(performance.now() - this.t0);
    this.api.setRecordState({ active: false, startedAt: null });
    const events = clean(this.events, source, durationMs);
    if (!events.length) return null;
    return this.api.saveRecording({
      name: defaultSessionName(new Date(this.startedAt)),
      createdAt: this.startedAt,
      durationMs,
      layout: { keyboardLayout: settings.keyboardLayout, padStyle: settings.padStyle },
      events,
    });
  }
}

function clean(raw, source, durationMs) {
  let events = [...raw];
  // retire les inputs qui ont servi à arrêter l'enregistrement
  if (source === 'shortcut') {
    // les touches du raccourci sont encore enfoncées : appuis clavier finaux sans relâchement
    const released = new Set();
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.device !== 'kb') break;
      if (e.type === 'up') {
        released.add(e.code);
        continue;
      }
      if (e.type === 'down' && !released.has(e.code)) events.splice(i, 1);
      else break;
    }
  } else {
    const end = events.length ? events[events.length - 1].t : 0;
    while (events.length) {
      const e = events[events.length - 1];
      if (e.device === 'mouse' && e.code === 1 && end - e.t < 1500) events.pop();
      else break;
    }
  }
  // supprime les relâchements orphelins (touches appuyées avant le début)
  const held = new Set();
  events = events.filter((e) => {
    const key = `${e.device}:${e.code}`;
    if (e.type === 'down') held.add(key);
    else if (e.type === 'up') {
      if (!held.has(key)) return false;
      held.delete(key);
    }
    return true;
  });
  // ferme ce qui est encore appuyé à la fin
  for (const key of held) {
    const i = key.indexOf(':');
    const device = key.slice(0, i);
    const rawCode = key.slice(i + 1);
    const code = device === 'pad' && rawCode.includes(':') ? rawCode : /^\d+$/.test(rawCode) ? Number(rawCode) : rawCode;
    events.push({ t: durationMs, type: 'up', device, code });
  }
  return events;
}

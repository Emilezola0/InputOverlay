// Moteur d'entraînement : compare un essai à une séquence modèle.
// Une séquence = liste d'étapes ; une étape = un ou plusieurs inputs appuyés ensemble, à un temps t (ms).
// Options d'une étape : minGap / maxGap (fenêtre de délai depuis l'étape précédente, en ms, vérifiée même
// sans « Vérifier le timing »). Option d'un input de stick : angle / angleTol (degrés, 0 = haut, + = droite),
// vérifiés si la séquence a checkAngles.

export const keyOf = (i) => `${i.device}:${i.code}`;
const isStickDir = (i) => i.device === 'pad' && typeof i.code === 'string' && i.code.includes(':');
export const isStickInput = isStickDir;
/** Écart signé entre deux angles (−180…180). */
export const angleDiff = (a, b) => ((((a - b) % 360) + 540) % 360) - 180;
export const hasWindow = (st) => st.minGap != null || st.maxGap != null;
export const sequenceKeys = (seq) => new Set(seq.steps.flatMap((st) => st.inputs.map(keyOf)));
export const holdKeys = (seq) => new Set((seq?.hold ?? []).map(keyOf));

/** Quels inputs comptent : 'sequence' (seulement ceux de la séquence), 'devices' (appareils utilisés), 'all'. */
export function inputFilterOf(seq) {
  if (seq.inputFilter) return seq.inputFilter;
  return seq.ignoreOtherDevices === false ? 'all' : 'devices'; // anciennes séquences
}

/**
 * Regroupe des appuis {device, code, t, angle?, peakAngle?, sticks?} en étapes (accords) selon une fenêtre en ms.
 * Angle d'une direction de stick : position du stick au moment du bouton joué avec elle dans l'étape
 * (ex. ↖ + saut : l'angle au moment du saut), sinon l'angle au plus loin du centre.
 */
export function buildSteps(presses, chordWindow = 40) {
  const steps = [];
  const t0 = presses[0]?.t ?? 0;
  for (const p of presses) {
    const last = steps[steps.length - 1];
    const t = p.t - t0;
    const input = { device: p.device, code: p.code };
    const src = { input, p };
    if (last && t - last.t <= chordWindow) {
      if (!last.inputs.some((i) => keyOf(i) === keyOf(input))) {
        last.inputs.push(input);
        last.src.push(src);
      }
    } else {
      steps.push({ t: Math.round(t), inputs: [input], src: [src] });
    }
  }
  for (const st of steps) {
    for (const { input, p } of st.src) {
      if (!isStickDir(input)) continue;
      const stick = input.code.slice(0, 2);
      const btn = st.src.find((x) => !isStickDir(x.input) && x.p.sticks?.[stick]?.m >= 0.5);
      const a = btn ? btn.p.sticks[stick].a : p.peakAngle ?? p.angle;
      if (a != null) input.angle = Math.round(a);
    }
    delete st.src;
  }
  return steps;
}

function jaccard(a, b) {
  const A = new Set(a.inputs.map(keyOf));
  const B = new Set(b.inputs.map(keyOf));
  let inter = 0;
  for (const k of A) if (B.has(k)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Alignement (type Needleman-Wunsch) entre étapes modèle et étapes jouées. */
/** Fusionne deux étapes jouées consécutives (accord joué en décalé). */
function mergeSteps(a, b) {
  const inputs = [...a.inputs];
  for (const i of b.inputs) if (!inputs.some((x) => keyOf(x) === keyOf(i))) inputs.push(i);
  return { t: a.t, inputs, split: b.t - a.t, lateInputs: b.inputs };
}

function align(ref, att) {
  const GAP_REF = -1; // étape modèle ratée
  const GAP_ATT = -0.6; // étape jouée en trop
  const n = ref.length;
  const m = att.length;
  const score = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  const move = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1)); // 1 diag, 2 haut, 3 gauche, 4 accord en 2 temps
  for (let i = 1; i <= n; i++) (score[i][0] = i * GAP_REF), (move[i][0] = 2);
  for (let j = 1; j <= m; j++) (score[0][j] = j * GAP_ATT), (move[0][j] = 3);
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const sim = jaccard(ref[i - 1], att[j - 1]);
      const diag = sim > 0 ? score[i - 1][j - 1] + 2 * sim : -Infinity;
      const up = score[i - 1][j] + GAP_REF;
      const left = score[i][j - 1] + GAP_ATT;
      let split = -Infinity;
      if (j >= 2 && ref[i - 1].inputs.length > 1) {
        const simU = jaccard(ref[i - 1], mergeSteps(att[j - 2], att[j - 1]));
        if (simU > sim && simU > jaccard(ref[i - 1], att[j - 2])) split = score[i - 1][j - 2] + 2 * simU - 0.1;
      }
      const best = Math.max(diag, up, left, split);
      score[i][j] = best;
      move[i][j] = best === diag ? 1 : best === split ? 4 : best === up ? 2 : 3;
    }
  }
  const pairs = []; // [refIdx | -1, attIdx | -1]
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const mv = move[i][j];
    if (mv === 1) pairs.push([--i, --j]);
    else if (mv === 4) {
      pairs.push([--i, j - 2, j - 1]);
      j -= 2;
    }
    else if (mv === 2) pairs.push([--i, -1]);
    else pairs.push([-1, --j]);
  }
  return pairs.reverse();
}

/**
 * Évalue un essai.
 * @returns {{steps, extras, score, verdict, perfect, okCount, almostCount, missCount}}
 *  steps[i] = { status: 'ok'|'almost'|'miss'|'pending', err, missing[], extra[], reason }
 */
export function evaluate(sequence, presses, { partial = false, holds = [] } = {}) {
  const ref = sequence.steps;
  // les inputs à maintenir sont jugés à part (holds), pas comme des appuis
  const hk = holdKeys(sequence);
  if (hk.size) presses = presses.filter((p) => !hk.has(keyOf(p)));
  // directions de stick traversées en balayant (ex. ↖ → ← → ↙ → ↓) : on ignore celles absentes du modèle
  if (sequence.stickSweep !== false) {
    const keys = sequenceKeys(sequence);
    presses = presses.filter((p) => !isStickDir(p) || keys.has(keyOf(p)));
  }
  const att = buildSteps(presses, sequence.chordWindow ?? 40);
  const tol = sequence.tolerance ?? 50;
  const angleRank = { ok: 0, almost: 1, miss: 2 };
  const checkTiming = sequence.timing !== false;
  const pairs = align(ref, att);

  const steps = ref.map(() => ({ status: 'miss', err: null, missing: [], extra: [], reason: 'non joué' }));
  const extras = [];
  let prev = null; // { rt, at } temps modèle / joué de la dernière étape reconnue
  let lastMatchedRef = -1;
  const rank = { ok: 0, almost: 1, miss: 2 };
  for (const [r, a, a2] of pairs) {
    if (r === -1) {
      extras.push(att[a]);
      continue;
    }
    if (a === -1) continue;
    const R = ref[r];
    const A = a2 !== undefined ? mergeSteps(att[a], att[a2]) : att[a];
    const rk = new Set(R.inputs.map(keyOf));
    const ak = new Set(A.inputs.map(keyOf));
    const st = steps[r];
    st.missing = R.inputs.filter((i) => !ak.has(keyOf(i)));
    st.extra = A.inputs.filter((i) => !rk.has(keyOf(i)));
    st.err = prev ? A.t - prev.at - (R.t - prev.rt) : 0;
    st.gap = prev ? A.t - prev.at : null; // délai réel depuis l'étape précédente
    st.at = A.t; // moment joué (depuis le début de l'essai), pour la frise
    const exact = st.missing.length === 0 && st.extra.length === 0;
    const absErr = Math.abs(st.err);
    const windowed = prev && hasWindow(R); // une fenêtre de délai remplace le timing « modèle ± tolérance »
    if (!exact) {
      st.status = 'almost';
      st.reason = st.missing.length ? 'accord incomplet' : 'inputs en trop';
    } else if (!checkTiming || windowed || absErr <= tol) {
      st.status = 'ok';
      st.reason = '';
    } else if (absErr <= tol * 2.5) {
      st.status = 'almost';
      st.reason = st.err > 0 ? 'un peu tard' : 'un peu tôt';
    } else {
      st.status = 'miss';
      st.reason = st.err > 0 ? 'trop tard' : 'trop tôt';
    }
    // accord joué en deux temps : on juge aussi le décalage entre ses inputs
    if (A.split !== undefined) {
      st.split = A.split;
      st.lateInputs = A.lateInputs;
      const late = Math.max(0, A.split - (sequence.chordWindow ?? 40)); // au-delà de la fenêtre d'accord
      const sStatus = !checkTiming || late <= tol ? 'ok' : late <= tol * 2.5 ? 'almost' : 'miss';
      if (rank[sStatus] > rank[st.status] || (st.status === 'ok' && sStatus === 'ok')) {
        st.status = sStatus;
        st.reason = sStatus === 'ok' ? '' : 'accord pas simultané';
      }
    }
    // fenêtre de délai : pas avant minGap, pas après maxGap
    if (windowed) {
      const lo = R.minGap ?? -Infinity;
      const hi = R.maxGap ?? Infinity;
      const out = st.gap < lo ? lo - st.gap : st.gap > hi ? st.gap - hi : 0;
      st.windowOut = out ? (st.gap < lo ? -out : out) : 0;
      if (out) {
        const wStatus = out <= tol ? 'almost' : 'miss';
        if (angleRank[wStatus] >= angleRank[st.status === 'pending' ? 'ok' : st.status]) {
          st.status = wStatus;
          st.reason = st.gap < lo ? 'trop tôt' : 'trop tard';
        }
      }
    }
    // angles des sticks
    st.angles = [];
    for (const ri of R.inputs) {
      if (!isStickDir(ri)) continue;
      const ai = A.inputs.find((x) => keyOf(x) === keyOf(ri));
      if (ai?.angle == null) continue;
      const check = sequence.checkAngles && ri.angle != null;
      const tolA = ri.angleTol ?? 15;
      const diff = check ? angleDiff(ai.angle, ri.angle) : 0;
      const ok = !check || Math.abs(diff) <= tolA;
      st.angles.push({ code: ri.code, angle: ai.angle, target: check ? ri.angle : null, tol: tolA, diff, ok });
      if (!ok) {
        const aStatus = Math.abs(diff) <= tolA * 2 ? 'almost' : 'miss';
        if (angleRank[aStatus] > angleRank[st.status]) st.status = aStatus;
        if (st.status !== 'ok' && (st.reason === '' || aStatus === st.status)) st.reason = 'mauvais angle';
      }
    }
    prev = { rt: R.t, at: A.t };
    lastMatchedRef = r;
  }

  if (partial) {
    // pendant l'essai : les étapes après la dernière reconnue ne sont pas encore jouées
    for (let i = lastMatchedRef + 1; i < steps.length; i++) steps[i] = { status: 'pending', err: null, missing: [], extra: [], reason: '' };
  }

  const okCount = steps.filter((s) => s.status === 'ok').length;
  const almostCount = steps.filter((s) => s.status === 'almost').length;
  const missCount = steps.filter((s) => s.status === 'miss').length;
  const score = ref.length ? (okCount + 0.5 * almostCount) / ref.length : 0;
  const holdsOk = holds.every((h) => h.ok);
  const perfect = okCount === ref.length && extras.length === 0 && holdsOk;
  let verdict;
  if (perfect) verdict = 'parfait';
  else if (okCount === ref.length && holdsOk) verdict = 'reussi';
  else if (okCount === ref.length) verdict = 'presque';
  else if (score >= 0.6) verdict = 'presque';
  else verdict = 'rate';
  return { steps, extras, holds, score, verdict, perfect, okCount, almostCount, missCount, lastMatchedRef };
}

export const VERDICT_LABEL = {
  parfait: 'Parfait !',
  reussi: 'Réussi (avec inputs en trop)',
  presque: 'Presque',
  rate: 'Raté',
};

/** Récap sur plusieurs essais. */
export function summarize(sequence, attempts) {
  const n = attempts.length;
  const perStep = sequence.steps.map((_, i) => {
    const res = attempts.map((a) => a.steps[i]).filter(Boolean);
    const errs = res.filter((s) => s.err !== null && s.status !== 'miss').map((s) => s.err);
    const reasons = {};
    for (const s of res) if (s.status !== 'ok' && s.reason) reasons[s.reason] = (reasons[s.reason] || 0) + 1;
    const topReason = Object.entries(reasons).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
    return {
      ok: res.filter((s) => s.status === 'ok').length,
      almost: res.filter((s) => s.status === 'almost').length,
      miss: res.filter((s) => s.status === 'miss').length,
      avgErr: errs.length ? errs.reduce((a, b) => a + b, 0) / errs.length : null,
      avgAngle: (() => {
        const v = res.map((s) => s.angles?.[0]?.angle).filter((a) => a != null);
        return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
      })(),
      topReason,
    };
  });
  const weakest = perStep
    .map((s, i) => ({ i, rate: n ? s.ok / n : 1 }))
    .sort((a, b) => a.rate - b.rate)[0];
  return {
    attempts: n,
    perfect: attempts.filter((a) => a.perfect).length,
    success: attempts.filter((a) => a.verdict === 'parfait' || a.verdict === 'reussi').length,
    avgScore: n ? attempts.reduce((s, a) => s + a.score, 0) / n : 0,
    streak: (() => {
      let k = 0;
      for (let i = n - 1; i >= 0 && (attempts[i].verdict === 'parfait' || attempts[i].verdict === 'reussi'); i--) k++;
      return k;
    })(),
    perStep,
    holdFails: attempts.filter((a) => a.holds?.some((h) => !h.ok)).length,
    weakest: weakest && n && weakest.rate < 1 ? weakest.i : null,
  };
}

/**
 * Détecte le début et la fin d'un essai à partir du flux d'inputs.
 * Déclenchement (sequence.trigger) :
 *  - 'first' : l'essai commence au premier input de l'étape 1 (les autres inputs avant sont ignorés) ;
 *  - 'key'   : il faut d'abord appuyer sur la touche de départ (sequence.armKey), puis jouer l'étape 1 ;
 *  - 'auto'  : n'importe quel input pris en compte démarre un essai.
 * Fin : dernière étape jouée, ou plus d'input pendant un moment, ou durée maximale dépassée.
 */
export class AttemptTracker {
  constructor({ onProgress, onResult, onArm, liveSticks }) {
    this.liveSticks = liveSticks; // position actuelle des sticks (pour un stick encore tenu à la fin)
    this.onProgress = onProgress;
    this.onResult = onResult;
    this.onArm = onArm;
    this.sequence = null;
    this.presses = [];
    this.timer = null;
    this.armed = false;
    this.armTimer = null;
    this.down = new Set(); // inputs actuellement appuyés (pour les inputs à maintenir)
    this.holds = [];
  }

  setSequence(seq) {
    this.cancel();
    this.sequence = seq;
    this.keys = seq ? sequenceKeys(seq) : new Set();
    this.firstKeys = seq?.steps[0] ? new Set(seq.steps[0].inputs.map(keyOf)) : new Set();
    this.holdKeys = holdKeys(seq);
  }

  cancel() {
    clearTimeout(this.timer);
    this.presses = [];
    this.setArmed(false);
  }

  get running() {
    return this.presses.length > 0;
  }

  get trigger() {
    return this.sequence?.trigger || 'auto';
  }

  setArmed(on) {
    clearTimeout(this.armTimer);
    if (this.armed !== on) {
      this.armed = on;
      this.onArm?.(on);
    }
    // sans input dans les 5 s, la touche de départ est oubliée
    if (on) this.armTimer = setTimeout(() => this.setArmed(false), 5000);
  }

  idleTimeout() {
    const s = this.sequence;
    const gaps = s.steps.slice(1).map((st, i) => st.t - s.steps[i].t);
    return Math.max(600, Math.max(0, ...gaps) * 1.6 + (s.tolerance ?? 50) * 3);
  }

  maxDuration() {
    const s = this.sequence;
    return (s.steps.at(-1)?.t ?? 0) * 1.5 + Math.max(700, (s.tolerance ?? 50) * 6);
  }

  relevant(ev) {
    if (ev.type === 'up') return false;
    const filter = inputFilterOf(this.sequence);
    if (filter === 'all') return true;
    if (filter === 'sequence') return this.keys.has(`${ev.device}:${ev.code}`);
    return this.sequence.steps.some((st) => st.inputs.some((i) => i.device === ev.device));
  }

  /** Suit ce qui est appuyé (à appeler pour tous les inputs, même quand le test est arrêté). */
  noteState(ev) {
    const key = `${ev.device}:${ev.code}`;
    if (ev.type === 'down') this.down.add(key);
    else if (ev.type === 'up') {
      this.down.delete(key);
      // input à maintenir relâché pendant l'essai
      if (this.running) for (const h of this.holds) if (h.key === key && h.ok) Object.assign(h, { ok: false, reason: 'relâché' });
      if (this.running && ev.peakAngle != null) {
        for (let i = this.presses.length - 1; i >= 0; i--) {
          const p = this.presses[i];
          if (`${p.device}:${p.code}` === key) {
            if (p.peakAngle == null) p.peakAngle = ev.peakAngle;
            break;
          }
        }
      }
    }
  }

  onEvent(ev) {
    this.noteState(ev);
    const key = `${ev.device}:${ev.code}`;
    if (!this.sequence?.steps.length || ev.type === 'up') return;
    if (this.holdKeys.has(key)) return; // un input à maintenir ne démarre rien et ne compte pas comme appui
    const arm = this.sequence.armKey;
    // touche de départ : arme le prochain essai, n'est jamais comptée comme input
    if (this.trigger === 'key' && arm && key === keyOf(arm)) {
      if (!this.running) this.setArmed(true);
      return;
    }
    if (!this.relevant(ev)) return;
    if (!this.running) {
      if (this.trigger === 'key' && !this.armed) return;
      if (this.trigger !== 'auto' && !this.firstKeys.has(key)) return;
      this.setArmed(false);
      this.startT = ev.t;
      this.holds = (this.sequence.hold ?? []).map((i) => {
        const ok = this.down.has(keyOf(i));
        return { input: { device: i.device, code: i.code }, key: keyOf(i), ok, reason: ok ? '' : 'pas maintenu' };
      });
    }
    this.presses.push({ device: ev.device, code: ev.code, t: ev.t, angle: ev.angle, sticks: ev.sticks });
    clearTimeout(this.timer);
    const partial = evaluate(this.sequence, this.presses, { partial: true, holds: this.publicHolds() });
    this.onProgress?.(partial);
    // fin anticipée : dernière étape reconnue → on attend juste la fenêtre d'accord
    // (si la dernière étape est incomplète, on laisse le temps à un input en retard d'arriver)
    const lastIdx = this.sequence.steps.length - 1;
    const lastStep = partial.steps[lastIdx];
    const cw = this.sequence.chordWindow ?? 40;
    let wait = this.idleTimeout();
    if (partial.lastMatchedRef === lastIdx) {
      wait = lastStep.missing.length ? cw + (this.sequence.tolerance ?? 50) * 3 : cw + 30;
    }
    if (this.trigger !== 'auto') wait = Math.min(wait, Math.max(0, this.startT + this.maxDuration() - ev.t));
    this.timer = setTimeout(() => this.finish(), wait);
  }

  publicHolds() {
    return this.holds.map(({ input, ok, reason }) => ({ input, ok, reason }));
  }

  finish() {
    clearTimeout(this.timer);
    if (!this.presses.length) return;
    // direction de stick encore tenue : on prend sa position actuelle plutôt que l'angle d'entrée
    const live = this.liveSticks?.();
    if (live) {
      for (const p of this.presses) {
        const s = typeof p.code === 'string' ? p.code.slice(0, 2) : '';
        if (p.peakAngle == null && (s === 'ls' || s === 'rs') && this.down.has(`${p.device}:${p.code}`) && live[s]?.m >= 0.5) p.peakAngle = live[s].a;
      }
    }
    const result = evaluate(this.sequence, this.presses, { holds: this.publicHolds() });
    result.presses = this.presses;
    result.at = Date.now();
    this.presses = [];
    this.onResult?.(result);
  }
}

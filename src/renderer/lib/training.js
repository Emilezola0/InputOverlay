// Moteur d'entraînement : compare un essai à une séquence modèle.
// Une séquence = liste d'étapes ; une étape = un ou plusieurs inputs appuyés ensemble, à un temps t (ms).

export const keyOf = (i) => `${i.device}:${i.code}`;

/** Regroupe des appuis {device, code, t} en étapes (accords) selon une fenêtre en ms. */
export function buildSteps(presses, chordWindow = 40) {
  const steps = [];
  const t0 = presses[0]?.t ?? 0;
  for (const p of presses) {
    const last = steps[steps.length - 1];
    const t = p.t - t0;
    const input = { device: p.device, code: p.code };
    if (last && t - last.t <= chordWindow) {
      if (!last.inputs.some((i) => keyOf(i) === keyOf(input))) last.inputs.push(input);
    } else {
      steps.push({ t: Math.round(t), inputs: [input] });
    }
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
export function evaluate(sequence, presses, { partial = false } = {}) {
  const ref = sequence.steps;
  const att = buildSteps(presses, sequence.chordWindow ?? 40);
  const tol = sequence.tolerance ?? 50;
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
    const exact = st.missing.length === 0 && st.extra.length === 0;
    const absErr = Math.abs(st.err);
    if (!exact) {
      st.status = 'almost';
      st.reason = st.missing.length ? 'accord incomplet' : 'inputs en trop';
    } else if (!checkTiming || absErr <= tol) {
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
  const perfect = okCount === ref.length && extras.length === 0;
  let verdict;
  if (perfect) verdict = 'parfait';
  else if (okCount === ref.length) verdict = 'reussi';
  else if (score >= 0.6) verdict = 'presque';
  else verdict = 'rate';
  return { steps, extras, score, verdict, perfect, okCount, almostCount, missCount, lastMatchedRef };
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
    weakest: weakest && n && weakest.rate < 1 ? weakest.i : null,
  };
}

/**
 * Détecte automatiquement début et fin d'un essai à partir du flux d'inputs.
 * onProgress(evaluation partielle) pendant l'essai, onResult(évaluation finale) à la fin.
 */
export class AttemptTracker {
  constructor({ onProgress, onResult }) {
    this.onProgress = onProgress;
    this.onResult = onResult;
    this.sequence = null;
    this.presses = [];
    this.timer = null;
  }

  setSequence(seq) {
    this.cancel();
    this.sequence = seq;
  }

  cancel() {
    clearTimeout(this.timer);
    this.presses = [];
  }

  get running() {
    return this.presses.length > 0;
  }

  idleTimeout() {
    const s = this.sequence;
    const gaps = s.steps.slice(1).map((st, i) => st.t - s.steps[i].t);
    return Math.max(600, Math.max(0, ...gaps) * 1.6 + (s.tolerance ?? 50) * 3);
  }

  relevant(ev) {
    if (ev.type === 'up') return false;
    const s = this.sequence;
    if (s.ignoreOtherDevices === false) return true;
    return s.steps.some((st) => st.inputs.some((i) => i.device === ev.device));
  }

  onEvent(ev) {
    if (!this.sequence?.steps.length || !this.relevant(ev)) return;
    this.presses.push({ device: ev.device, code: ev.code, t: ev.t });
    clearTimeout(this.timer);
    const partial = evaluate(this.sequence, this.presses, { partial: true });
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
    this.timer = setTimeout(() => this.finish(), wait);
  }

  finish() {
    clearTimeout(this.timer);
    if (!this.presses.length) return;
    const result = evaluate(this.sequence, this.presses);
    result.presses = this.presses;
    result.at = Date.now();
    this.presses = [];
    this.onResult?.(result);
  }
}

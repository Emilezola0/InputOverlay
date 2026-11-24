// Onglet « Entraînement » : éditeur de séquence modèle, test en direct, résultat et récap.
import { buildSteps, evaluate, summarize, AttemptTracker, VERDICT_LABEL, keyOf } from './lib/training.js';
import { inputLabel, formatDuration } from './lib/labels.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const DEFAULTS = { tolerance: 50, timing: true, ignoreOtherDevices: true, chordWindow: 40 };

export function initTraining(api, getSettings) {
  let settings = getSettings();
  let sequences = [];
  let seq = null;
  const attemptsBySeq = new Map();
  let active = false;
  let phase = 'ready'; // ready | running | result
  let live = null; // évaluation partielle pendant l'essai
  let last = null; // dernier résultat
  let capture = null; // { mode: 'model'|'step', presses: [], timer }

  const attempts = () => attemptsBySeq.get(seq?.id) ?? [];
  const chips = (inputs) =>
    inputs.map((i) => `<span class="chip dev-${i.device}">${esc(inputLabel(i, settings))}</span>`).join('<span class="plus">+</span>');
  const unit = () => settings.timeUnit;

  const tracker = new AttemptTracker({
    onProgress: (p) => {
      phase = 'running';
      live = p;
      renderTest();
    },
    onResult: (r) => {
      phase = 'result';
      live = null;
      last = r;
      if (!attemptsBySeq.has(seq.id)) attemptsBySeq.set(seq.id, []);
      attemptsBySeq.get(seq.id).push(r);
      renderTest();
      renderRecap();
    },
  });

  // ---------------------------------------------------------------- Séquences
  async function refreshList(selectId) {
    sequences = await api.listSequences();
    const id = selectId ?? seq?.id ?? sequences[0]?.id;
    const found = sequences.find((s) => s.id === id);
    if (found) select(found);
    else if (!sequences.length) select(null);
    renderList();
  }

  function renderList() {
    $('seq-list').innerHTML = sequences.length
      ? sequences
          .map(
            (s) => `<button class="rec-item${s.id === seq?.id ? ' active' : ''}" data-id="${esc(s.id)}">
              <span class="rec-item-name">${esc(s.name)}</span>
              <span class="rec-item-meta seq-preview">${s.steps.length ? s.steps.map((st) => st.inputs.map((i) => esc(inputLabel(i, settings))).join('+')).join(' ') : 'vide'}</span>
            </button>`
          )
          .join('')
      : '<div class="rec-none">Aucune séquence.<br>Clique sur <b>+ Nouvelle</b>.</div>';
  }

  $('seq-list').addEventListener('click', (ev) => {
    const b = ev.target.closest('.rec-item');
    if (b) select(sequences.find((s) => s.id === b.dataset.id));
    renderList();
  });

  function select(s) {
    stopCapture(false);
    seq = s ? { ...DEFAULTS, ...s } : null;
    tracker.setSequence(seq);
    phase = 'ready';
    live = null;
    last = attempts().at(-1) ?? null;
    if (last) phase = 'result';
    $('train-main').classList.toggle('empty', !seq);
    if (!seq) {
      setActive(false);
      return;
    }
    $('seq-name').value = seq.name;
    $('seq-tol').value = seq.tolerance;
    $('seq-timing').checked = seq.timing;
    $('seq-ignore').checked = seq.ignoreOtherDevices;
    renderAll();
  }

  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    const toSave = seq;
    saveTimer = setTimeout(async () => {
      const saved = await api.saveSequence(toSave);
      const i = sequences.findIndex((s) => s.id === saved.id);
      if (i >= 0) sequences[i] = saved;
      renderList();
    }, 250);
  }

  function changed({ resetAttempts = false } = {}) {
    tracker.setSequence(seq);
    if (resetAttempts) {
      attemptsBySeq.delete(seq.id);
      last = null;
      phase = 'ready';
    }
    save();
    renderAll();
  }

  $('btn-seq-new').addEventListener('click', async () => {
    const n = sequences.length + 1;
    const created = await api.saveSequence({ ...DEFAULTS, name: `Séquence ${n}`, steps: [] });
    await refreshList(created.id);
  });
  $('btn-seq-delete').addEventListener('click', async () => {
    if (!seq || !confirm(`Supprimer la séquence « ${seq.name} » ?`)) return;
    await api.deleteSequence(seq.id);
    attemptsBySeq.delete(seq.id);
    seq = null;
    refreshList();
  });
  $('seq-name').addEventListener('change', () => {
    seq.name = $('seq-name').value.trim() || seq.name;
    changed();
  });
  $('seq-tol').addEventListener('input', () => {
    seq.tolerance = Number($('seq-tol').value);
    changed();
  });
  $('seq-timing').addEventListener('change', () => {
    seq.timing = $('seq-timing').checked;
    changed();
  });
  $('seq-ignore').addEventListener('change', () => {
    seq.ignoreOtherDevices = $('seq-ignore').checked;
    changed();
  });

  // Édition des étapes : supprimer, modifier l'écart
  $('seq-steps').addEventListener('click', (ev) => {
    const del = ev.target.closest('.step-del');
    if (!del) return;
    const i = Number(del.dataset.i);
    seq.steps.splice(i, 1);
    if (seq.steps.length) {
      const t0 = seq.steps[0].t;
      seq.steps.forEach((s) => (s.t -= t0));
    }
    changed({ resetAttempts: true });
  });
  $('seq-steps').addEventListener('change', (ev) => {
    const input = ev.target.closest('.gap-input');
    if (!input) return;
    const i = Number(input.dataset.i); // écart entre l'étape i-1 et i
    const newGap = Math.max(0, Number(input.value) || 0);
    const delta = newGap - (seq.steps[i].t - seq.steps[i - 1].t);
    for (let k = i; k < seq.steps.length; k++) seq.steps[k].t += delta;
    changed({ resetAttempts: true });
  });

  // ---------------------------------------------------------------- Capture du modèle
  function startCapture(mode) {
    stopCapture(false);
    tracker.cancel();
    capture = { mode, presses: [], timer: null };
    renderCapture();
  }

  function stopCapture(apply = true, source = 'auto') {
    if (!capture) return;
    clearTimeout(capture.timer);
    const c = capture;
    capture = null;
    renderCapture();
    if (!apply) return;
    let presses = c.presses;
    // retire le clic qui a servi à arrêter la capture
    if (source === 'button') while (presses.length && keyOf(presses.at(-1)) === 'mouse:1') presses = presses.slice(0, -1);
    if (!presses.length) return;
    const steps = buildSteps(presses, seq.chordWindow);
    if (c.mode === 'model') seq.steps = steps;
    else {
      const lastT = seq.steps.at(-1)?.t ?? -150;
      seq.steps.push({ t: lastT + 150, inputs: steps[0].inputs });
    }
    changed({ resetAttempts: true });
  }

  $('btn-seq-capture').addEventListener('click', () => {
    if (capture?.mode === 'model') stopCapture(true, 'button');
    else startCapture('model');
  });
  $('btn-seq-add').addEventListener('click', () => {
    if (capture?.mode === 'step') stopCapture(false);
    else startCapture('step');
  });

  function renderCapture() {
    const hint = $('seq-capture-hint');
    $('btn-seq-capture').textContent = capture?.mode === 'model' ? '■ Terminer' : '● Enregistrer le modèle';
    $('btn-seq-capture').classList.toggle('recording', capture?.mode === 'model');
    $('btn-seq-add').textContent = capture?.mode === 'step' ? 'Annuler' : '+ Étape';
    hint.hidden = !capture;
    if (!capture) return;
    hint.innerHTML =
      capture.mode === 'model'
        ? `Joue ta séquence modèle… (${capture.presses.length} input${capture.presses.length > 1 ? 's' : ''}) — arrêt auto après 1,5 s sans input, ou clique sur Terminer.`
        : 'Appuie sur le ou les inputs de la nouvelle étape…';
  }

  // ---------------------------------------------------------------- Test
  function setActive(on) {
    active = on && !!seq?.steps.length;
    tracker.cancel();
    if (active) {
      phase = last ? 'result' : 'ready';
    }
    $('btn-train-toggle').textContent = active ? '■ Arrêter le test' : '▶ Activer le test';
    $('btn-train-toggle').classList.toggle('recording', active);
    renderTest();
  }
  $('btn-train-toggle').addEventListener('click', () => setActive(!active));
  $('btn-train-reset').addEventListener('click', () => {
    if (!seq) return;
    attemptsBySeq.delete(seq.id);
    last = null;
    phase = 'ready';
    renderTest();
    renderRecap();
  });

  function onEvent(ev) {
    if (capture) {
      if (ev.type === 'up') return;
      capture.presses.push({ device: ev.device, code: ev.code, t: ev.t });
      clearTimeout(capture.timer);
      if (capture.mode === 'step') capture.timer = setTimeout(() => stopCapture(true), seq.chordWindow + 20);
      else capture.timer = setTimeout(() => stopCapture(true), 1500);
      renderCapture();
      return;
    }
    if (active) tracker.onEvent(ev);
  }

  // ---------------------------------------------------------------- Rendu
  function renderAll() {
    renderSteps();
    renderTest();
    renderRecap();
  }

  function renderSteps() {
    $('seq-tol').parentElement.querySelector('output').textContent = formatDuration(seq.tolerance, unit());
    if (!seq.steps.length) {
      $('seq-steps').innerHTML = '<div class="rec-none">Séquence vide : clique sur <b>● Enregistrer le modèle</b> et joue la séquence attendue.</div>';
      return;
    }
    $('seq-steps').innerHTML = seq.steps
      .map((st, i) => {
        const gap = i > 0
          ? `<div class="step-gap" title="Écart avec l'étape précédente (ms)"><input class="gap-input" type="number" min="0" step="5" data-i="${i}" value="${Math.round(st.t - seq.steps[i - 1].t)}">ms</div>`
          : '';
        return `${gap}<div class="step-card"><span class="step-num">${i + 1}</span><div class="chips">${chips(st.inputs)}</div><button class="step-del" data-i="${i}" title="Supprimer l'étape">×</button></div>`;
      })
      .join('');
  }

  function timingGauge(err) {
    if (err === null || !seq.timing) return '';
    const tol = seq.tolerance;
    const range = tol * 3;
    const pos = 50 + (Math.max(-range, Math.min(range, err)) / range) * 50;
    const zone = (tol / range) * 50;
    return `<div class="gauge" title="Zone verte = ±${tol}ms"><div class="gauge-zone" style="left:${50 - zone}%;width:${zone * 2}%"></div><div class="gauge-mid"></div><div class="gauge-mark" style="left:${pos}%"></div></div>`;
  }

  function stepDetail(s, i) {
    if (s.status === 'pending') return '…';
    if (s.status === 'miss' && s.err === null) return 'Raté : non joué';
    const parts = [];
    if (s.missing.length) parts.push(`manque ${s.missing.map((x) => esc(inputLabel(x, settings))).join('+')}`);
    if (s.extra.length) parts.push(`en trop ${s.extra.map((x) => esc(inputLabel(x, settings))).join('+')}`);
    if (s.split !== undefined && s.split > 2) {
      parts.push(`${s.lateInputs.map((x) => esc(inputLabel(x, settings))).join('+')} ${formatDuration(s.split, unit())} après`);
    }
    if (seq.timing && i > 0 && s.err !== null) {
      const e = Math.round(s.err);
      parts.push(Math.abs(e) <= 2 ? 'pile dans le timing' : `${e > 0 ? '+' : '−'}${formatDuration(Math.abs(e), unit())} ${e > 0 ? 'tard' : 'tôt'}`);
    }
    return parts.join(' · ') || 'OK';
  }

  function renderTest() {
    if (!seq) return;
    const status = $('train-status');
    const view = phase === 'running' ? live : last;
    if (!seq.steps.length) status.innerHTML = '<span class="muted">Enregistre d\'abord une séquence modèle.</span>';
    else if (!active) status.innerHTML = '<span class="muted">Clique sur <b>▶ Activer le test</b> (ou Ctrl+Maj+T, même en jeu), puis joue la séquence.</span>';
    else if (phase === 'running') status.innerHTML = '<span class="verdict running">En cours…</span>';
    else if (phase === 'result' && last)
      status.innerHTML = `<span class="verdict v-${last.verdict}">${VERDICT_LABEL[last.verdict]}</span>
        <span class="score">${Math.round(last.score * 100)}%</span>
        <span class="muted">Essai n°${attempts().length} · rejoue quand tu veux</span>`;
    else status.innerHTML = '<span class="verdict ready">Prêt : joue la séquence !</span>';

    $('train-result').innerHTML = seq.steps
      .map((st, i) => {
        const s = view?.steps[i] ?? { status: active ? 'pending' : 'idle', err: null, missing: [], extra: [] };
        return `<div class="res-step s-${s.status}">
          <div class="res-head"><span class="step-num">${i + 1}</span><div class="chips">${chips(st.inputs)}</div></div>
          <div class="res-detail">${s.status === 'idle' ? '&nbsp;' : stepDetail(s, i)}</div>
          ${s.status !== 'idle' && s.status !== 'pending' && i > 0 ? timingGauge(s.err) : ''}
        </div>`;
      })
      .join('');

    const extras = view?.extras ?? [];
    $('train-extras').innerHTML = extras.length
      ? `<span class="muted">En trop :</span> ${extras.map((e) => `<span class="extra">${chips(e.inputs)}</span>`).join(' ')}`
      : '';
    publish();
  }

  function renderRecap() {
    if (!seq) return;
    const list = attempts();
    if (!list.length) {
      $('train-recap').innerHTML = '<div class="rec-none">Pas encore d\'essai.</div>';
      return;
    }
    const r = summarize(seq, list);
    const pct = (x) => `${Math.round(x * 100)}%`;
    const avgErr = (e) => (e === null || !seq.timing ? '—' : Math.abs(e) < 3 ? 'pile' : `${e > 0 ? '+' : '−'}${formatDuration(Math.abs(e), unit())} ${e > 0 ? 'tard' : 'tôt'}`);
    const weak = r.weakest !== null
      ? `<div class="weak">Point faible : <b>étape ${r.weakest + 1}</b> ${chips(seq.steps[r.weakest].inputs)}${r.perStep[r.weakest].topReason ? ` (souvent ${esc(r.perStep[r.weakest].topReason)})` : ''}</div>`
      : '<div class="weak good">Toutes les étapes sont maîtrisées 👌</div>';
    $('train-recap').innerHTML = `
      <div class="stat-grid four">
        <div class="stat"><b>${r.attempts}</b><span>essais</span></div>
        <div class="stat"><b>${pct(r.success / r.attempts)}</b><span>réussis</span></div>
        <div class="stat"><b>${r.perfect}</b><span>parfaits</span></div>
        <div class="stat"><b>${r.streak}</b><span>série actuelle</span></div>
      </div>
      ${weak}
      <table class="stat-top recap-table">
        <tr><th>Étape</th><th>Réussi</th><th>Presque</th><th>Raté</th><th>Timing moyen</th></tr>
        ${seq.steps
          .map((st, i) => {
            const p = r.perStep[i];
            return `<tr${i === r.weakest ? ' class="weak-row"' : ''}><td><span class="step-num">${i + 1}</span> ${chips(st.inputs)}</td>
              <td class="c-ok">${pct(p.ok / r.attempts)}</td><td class="c-almost">${p.almost}</td><td class="c-miss">${p.miss}</td><td>${avgErr(p.avgErr)}</td></tr>`;
          })
          .join('')}
      </table>
      <div class="attempt-pills">${list
        .slice(-30)
        .map((a, k) => `<span class="pill-att v-${a.verdict}" title="Essai ${list.length - Math.min(30, list.length) + k + 1} : ${VERDICT_LABEL[a.verdict]} (${pct(a.score)})">${pct(a.score)}</span>`)
        .join('')}</div>`;
  }

  // État envoyé à l'overlay
  function publish() {
    const view = phase === 'running' ? live : last;
    const list = attempts();
    api.setTrainingState({
      active: active && !!seq,
      name: seq?.name ?? '',
      phase,
      steps: (seq?.steps ?? []).map((st, i) => ({
        label: st.inputs.map((x) => inputLabel(x, settings)).join('+'),
        status: view?.steps[i]?.status ?? 'pending',
        detail: view?.steps[i] && view.steps[i].status !== 'pending' ? stepDetail(view.steps[i], i) : '',
      })),
      verdict: phase === 'result' ? last?.verdict : null,
      verdictLabel: phase === 'result' && last ? VERDICT_LABEL[last.verdict] : phase === 'running' ? 'En cours…' : 'Prêt',
      score: last ? Math.round(last.score * 100) : null,
      attempts: list.length,
      successRate: list.length ? Math.round((list.filter((a) => a.verdict === 'parfait' || a.verdict === 'reussi').length / list.length) * 100) : null,
    });
  }

  api.onTrainingToggle(() => setActive(!active));
  refreshList();

  return {
    onEvent,
    setSettings(s) {
      settings = s;
      renderList();
      if (seq) renderAll();
    },
  };
}

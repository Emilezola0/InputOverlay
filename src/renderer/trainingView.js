// Onglet « Entraînement » : éditeur de séquence modèle, test en direct, résultat et récap.
import { buildSteps, evaluate, summarize, AttemptTracker, VERDICT_LABEL, keyOf, inputFilterOf, holdKeys, isStickInput, hasWindow } from './lib/training.js';
import { TEMPLATES, GAMES, fromTemplate, controlsFor, applyControls, actionLabel } from './lib/templates.js';
import { inputLabel, formatDuration, formatAccel, formatAngle, K } from './lib/labels.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const DEFAULTS = { tolerance: 50, timing: true, chordWindow: 40, trigger: 'first', inputFilter: 'sequence', stickSweep: true, checkAngles: false, category: '', note: '' };
const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));

export function initTraining(api, getSettings, hub = null) {
  let settings = getSettings();
  let sequences = [];
  let seq = null;
  const attemptsBySeq = new Map();
  let active = false;
  let phase = 'ready'; // ready | running | result
  let live = null; // évaluation partielle pendant l'essai
  let last = null; // dernier résultat
  let capture = null; // { mode: 'model'|'step'|'arm'|'hold'|'bind', presses: [], timer, target }
  let lastUiDown = 0; // dernier clic sur un bouton de l'appli (pour ne pas l'assigner comme contrôle)
  document.addEventListener('pointerdown', (e) => {
    if (e.target.closest?.('button, select, input, label')) lastUiDown = performance.now();
  }, true);
  let armed = false; // touche de départ appuyée, en attente de l'essai

  const attempts = () => attemptsBySeq.get(seq?.id) ?? [];
  const chips = (inputs, game = seq?.game) =>
    inputs
      .map((i) => {
        const al = i.action ? actionLabel(game, i.action) : '';
        const ang = i.angle != null && isStickInput(i) ? `<small class="ang">${esc(formatAngle(i.angle))}</small>` : '';
        return `<span class="chip dev-${i.device}"${al ? ` title="${esc(al)}"` : ''}>${esc(inputLabel(i, settings))}${al ? `<small class="act">${esc(al)}</small>` : ''}${ang}</span>`;
      })
      .join('<span class="plus">+</span>');
  const unit = () => settings.timeUnit;

  const tracker = new AttemptTracker({
    liveSticks: () => hub?.stick,
    onArm: (on) => {
      armed = on;
      renderTest();
    },
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
      persistAttempts(seq.id);
      renderTest();
      renderRecap();
    },
  });

  // Essais sauvegardés sur disque (sans les appuis bruts, inutiles pour le récap)
  function persistAttempts(id) {
    const list = (attemptsBySeq.get(id) ?? []).map(({ presses, ...rest }) => rest);
    api.saveAttempts(id, list);
  }
  function clearAttempts(id) {
    attemptsBySeq.set(id, []);
    api.deleteAttempts(id);
  }
  function ensureAttemptsLoaded(id) {
    if (attemptsBySeq.has(id)) return;
    attemptsBySeq.set(id, []);
    api.loadAttempts(id).then((list) => {
      attemptsBySeq.set(id, [...list, ...(attemptsBySeq.get(id) ?? [])]);
      if (seq?.id === id && phase !== 'running') {
        last = attempts().at(-1) ?? null;
        phase = last ? 'result' : 'ready';
        renderAll();
      }
    });
  }

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
    const groups = new Map();
    for (const s of sequences) {
      const cat = s.category?.trim() || 'Sans catégorie';
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat).push(s);
    }
    const cats = [...groups.keys()].sort((a, b) => (a === 'Sans catégorie') - (b === 'Sans catégorie') || a.localeCompare(b));
    $('seq-list').innerHTML = sequences.length
      ? cats
          .map(
            (cat) => `<div class="seq-group">${esc(cat)}</div>` +
              groups.get(cat)
                .map(
                  (s) => `<button class="rec-item${s.id === seq?.id ? ' active' : ''}" data-id="${esc(s.id)}">
                    <span class="rec-item-name">${esc(s.name)}</span>
                    <span class="rec-item-meta seq-preview">${s.steps.length ? s.steps.map((st) => st.inputs.map((i) => esc(inputLabel(i, settings))).join('+')).join(' ') : 'vide'}</span>
                  </button>`
                )
                .join('')
          )
          .join('')
      : '<div class="rec-none">Aucune séquence.<br>Clique sur <b>Modèles</b> pour partir d\'un exemple, ou sur <b>+ Nouvelle</b>.</div>';
    $('seq-categories').innerHTML = cats.filter((c) => c !== 'Sans catégorie').map((c) => `<option value="${esc(c)}">`).join('');
  }

  // Modèles intégrés
  function renderTemplates() {
    const cats = [...new Set(TEMPLATES.map((t) => t.game))];
    const preview = (t) => {
      const s = fromTemplate(t, settings);
      const steps = s.steps.map((st) => st.inputs.map((x) => esc(inputLabel(x, settings))).join('+')).join('  ');
      return s.hold.length ? `${steps}  (en maintenant ${s.hold.map((x) => esc(inputLabel(x, settings))).join('+')})` : steps;
    };
    $('seq-templates').innerHTML =
      '<p class="tpl-hint">Les modèles utilisent tes contrôles (bouton <b>Contrôles</b>).</p>' +
      cats
        .map(
          (cat) => `<h3>${esc(cat)}</h3>` +
            TEMPLATES.map((t, i) => (t.game !== cat ? '' : `<button class="tpl-item" data-tpl="${i}">${esc(t.name)}<small>${preview(t)}</small></button>`)).join('')
        )
        .join('');
  }
  $('btn-seq-templates').addEventListener('click', (ev) => {
    ev.stopPropagation();
    renderTemplates();
    $('seq-templates').hidden = !$('seq-templates').hidden;
  });
  document.addEventListener('click', (ev) => {
    if (!ev.target.closest('#seq-templates')) $('seq-templates').hidden = true;
    if (!ev.target.closest('#game-controls') && !$('game-controls').hidden) {
      $('game-controls').hidden = true;
      if (capture?.mode === 'bind') stopCapture(false);
    }
  });
  $('seq-templates').addEventListener('click', async (ev) => {
    const b = ev.target.closest('.tpl-item');
    if (!b) return;
    $('seq-templates').hidden = true;
    const created = await api.saveSequence(fromTemplate(TEMPLATES[Number(b.dataset.tpl)], settings));
    await refreshList(created.id);
  });

  // Mes contrôles : quel bouton correspond à quelle action, par jeu
  function renderControls() {
    $('game-controls').innerHTML = Object.entries(GAMES)
      .map(([game, def]) => {
        const ctrl = controlsFor(settings, game);
        const rows = Object.entries(def.actions)
          .map(([action, a]) => {
            const b = ctrl[action];
            const same = Object.entries(ctrl).filter(([k, x]) => k !== action && keyOf(x) === keyOf(b)).map(([k]) => def.actions[k].label);
            const waiting = capture?.mode === 'bind' && capture.target.game === game && capture.target.action === action;
            return `<div class="ctrl-row${waiting ? ' waiting' : ''}">
              <span class="ctrl-name">${esc(a.label)}</span>
              <span class="chips">${waiting ? '<span class="muted">appuie sur le bouton… (Échap : annuler)</span>' : chips([b], '')}</span>
              <span class="ctrl-warn" title="${same.length && !waiting ? `Même bouton que ${esc(same.join(', '))}` : ''}">${same.length && !waiting ? '⚠' : ''}</span>
              <button class="btn ctrl-bind" data-game="${esc(game)}" data-action="${esc(action)}">${waiting ? 'Annuler' : 'Changer'}</button>
            </div>`;
          })
          .join('');
        return `<h3>${esc(game)}<button class="btn ctrl-reset" data-game="${esc(game)}">Par défaut</button></h3><p class="tpl-hint">${esc(def.note)}</p>${rows}`;
      })
      .join('');
  }
  $('btn-game-controls').addEventListener('click', (ev) => {
    ev.stopPropagation();
    $('seq-templates').hidden = true;
    const open = $('game-controls').hidden;
    if (!open && capture?.mode === 'bind') stopCapture(false);
    $('game-controls').hidden = !open;
    if (open) renderControls();
  });
  $('game-controls').addEventListener('click', (ev) => {
    ev.stopPropagation(); // le panneau est redessiné : le clic ne doit pas le fermer
    const bind = ev.target.closest('.ctrl-bind');
    const reset = ev.target.closest('.ctrl-reset');
    if (bind) {
      const t = bind.dataset;
      if (capture?.mode === 'bind' && capture.target.game === t.game && capture.target.action === t.action) stopCapture(false);
      else startCapture('bind', { game: t.game, action: t.action });
    } else if (reset) {
      setGameControls(reset.dataset.game, null);
    }
  });

  /** Enregistre les contrôles d'un jeu et met à jour les séquences créées depuis ses modèles. */
  async function setGameControls(game, patch) {
    const cur = { ...(settings.gameControls?.[game] ?? {}) };
    const next = patch === null ? {} : { ...cur, ...patch };
    settings = { ...settings, gameControls: { ...(settings.gameControls ?? {}), [game]: next } };
    // remplace tout le jeu (sinon les anciens choix seraient fusionnés)
    api.setSettings({ gameControls: { [game]: null } });
    api.setSettings({ gameControls: { [game]: next } });
    let n = 0;
    for (const s of sequences) {
      if (s.game !== game) continue;
      if (applyControls(s, settings)) {
        await api.saveSequence(s);
        n++;
      }
    }
    if (n) await refreshList(seq?.id);
    renderControls();
    renderTemplates();
  }

  $('seq-list').addEventListener('click', (ev) => {
    const b = ev.target.closest('.rec-item');
    if (b) select(sequences.find((s) => s.id === b.dataset.id));
    renderList();
  });

  function select(s) {
    stopCapture(false);
    seq = s ? { ...DEFAULTS, ...s } : null;
    if (seq) ensureAttemptsLoaded(seq.id);
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
    $('seq-sweep').checked = seq.stickSweep !== false;
    $('seq-angles').checked = !!seq.checkAngles;
    $('seq-trigger').value = seq.trigger;
    $('seq-filter').value = inputFilterOf(seq);
    $('seq-category').value = seq.category ?? '';
    $('seq-note').value = seq.note ?? '';
    seq.hold = seq.hold ?? [];
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
      clearAttempts(seq.id);
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
    clearAttempts(seq.id);
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
  $('seq-sweep').addEventListener('change', () => {
    seq.stickSweep = $('seq-sweep').checked;
    changed();
  });
  $('seq-angles').addEventListener('change', () => {
    seq.checkAngles = $('seq-angles').checked;
    changed();
  });
  $('seq-trigger').addEventListener('change', () => {
    seq.trigger = $('seq-trigger').value;
    changed();
    if (seq.trigger === 'key' && !seq.armKey) startCapture('arm');
  });
  $('seq-filter').addEventListener('change', () => {
    seq.inputFilter = $('seq-filter').value;
    changed();
  });
  $('seq-category').addEventListener('change', () => {
    seq.category = $('seq-category').value.trim();
    changed();
  });
  $('seq-note').addEventListener('change', () => {
    seq.note = $('seq-note').value.trim();
    changed();
  });
  $('btn-seq-arm').addEventListener('click', () => {
    if (capture?.mode === 'arm') stopCapture(false);
    else startCapture('arm');
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
    const win = ev.target.closest('.win-input');
    if (win) {
      const st = seq.steps[Number(win.dataset.i)];
      const v = num(win.value);
      if (win.dataset.k === 'min') st.minGap = v == null ? undefined : Math.max(0, v);
      else st.maxGap = v == null ? undefined : Math.max(0, v);
      if (st.minGap != null && st.maxGap != null && st.minGap > st.maxGap) [st.minGap, st.maxGap] = [st.maxGap, st.minGap];
      return changed({ resetAttempts: true });
    }
    const ang = ev.target.closest('.ang-input');
    if (ang) {
      const inp = seq.steps[Number(ang.dataset.i)].inputs[Number(ang.dataset.j)];
      const v = num(ang.value);
      if (ang.dataset.k === 'angle') inp.angle = v == null ? undefined : Math.max(-180, Math.min(180, Math.round(v)));
      else inp.angleTol = v == null ? undefined : Math.max(1, Math.min(90, Math.round(v)));
      return changed({ resetAttempts: true });
    }
    const input = ev.target.closest('.gap-input');
    if (!input) return;
    const i = Number(input.dataset.i); // écart entre l'étape i-1 et i
    const newGap = Math.max(0, Number(input.value) || 0);
    const delta = newGap - (seq.steps[i].t - seq.steps[i - 1].t);
    for (let k = i; k < seq.steps.length; k++) seq.steps[k].t += delta;
    changed({ resetAttempts: true });
  });

  // Inputs à maintenir pendant tout l'essai
  $('seq-holds').addEventListener('click', (ev) => {
    const del = ev.target.closest('.hold-del');
    if (del) {
      seq.hold.splice(Number(del.dataset.i), 1);
      changed({ resetAttempts: true });
    } else if (ev.target.closest('#btn-hold-add')) {
      if (capture?.mode === 'hold') stopCapture(false);
      else startCapture('hold');
    }
  });

  // ---------------------------------------------------------------- Capture du modèle
  function startCapture(mode, target = null) {
    stopCapture(false);
    tracker.cancel();
    capture = { mode, presses: [], timer: null, target };
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
    if (c.mode === 'bind') {
      renderControls();
      const p = presses[0];
      if (p) setGameControls(c.target.game, { [c.target.action]: { device: p.device, code: p.code } });
      return;
    }
    if (!presses.length) return;
    if (c.mode === 'hold') {
      const p = { device: presses[0].device, code: presses[0].code };
      if (!seq.hold.some((h) => keyOf(h) === keyOf(p))) seq.hold.push(p);
      changed({ resetAttempts: true });
      return;
    }
    if (c.mode === 'arm') {
      seq.armKey = { device: presses[0].device, code: presses[0].code };
      changed();
      return;
    }
    // les inputs à maintenir (accélérer, boost…) ne deviennent pas des étapes
    const hk = holdKeys(seq);
    presses = presses.filter((p) => !hk.has(keyOf(p)));
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
    $('btn-seq-arm').textContent = capture?.mode === 'arm' ? 'Annuler' : 'Choisir';
    if ($('btn-hold-add')) $('btn-hold-add').textContent = capture?.mode === 'hold' ? 'Annuler' : '+ Ajouter';
    hint.hidden = !capture || capture.mode === 'bind';
    if (!$('game-controls').hidden) renderControls();
    if (!capture) return;
    hint.innerHTML =
      capture.mode === 'model'
        ? `Joue ta séquence modèle… (${capture.presses.length} input${capture.presses.length > 1 ? 's' : ''}) — arrêt auto après 1,5 s sans input, ou clique sur Terminer.`
        : capture.mode === 'arm'
          ? 'Appuie sur la touche de départ (un bouton que tu n\'utilises pas dans la séquence, ex. View / Share ou une touche du clavier)…'
          : capture.mode === 'hold'
            ? 'Appuie sur l\'input à maintenir pendant tout l\'essai (ex. accélérer, boost)…'
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
    clearAttempts(seq.id);
    last = null;
    phase = 'ready';
    renderTest();
    renderRecap();
  });

  function onEvent(ev) {
    if (capture) tracker.noteState(ev);
    if (capture) {
      if (ev.type === 'up') return;
      if (capture.mode === 'bind') {
        if (ev.device === 'kb' && ev.code === K.Escape) return stopCapture(false);
        if (ev.device === 'mouse') {
          // un clic sur un bouton de l'appli (ex. « Annuler ») n'est pas un contrôle
          const c = capture;
          setTimeout(() => {
            if (capture === c && performance.now() - lastUiDown > 250) {
              c.presses.push({ device: ev.device, code: ev.code, t: ev.t });
              stopCapture(true);
            }
          }, 120);
          return;
        }
        capture.presses.push({ device: ev.device, code: ev.code, t: ev.t });
        return stopCapture(true);
      }
      capture.presses.push({ device: ev.device, code: ev.code, t: ev.t });
      clearTimeout(capture.timer);
      if (capture.mode === 'arm' || capture.mode === 'hold') return stopCapture(true);
      if (capture.mode === 'step') capture.timer = setTimeout(() => stopCapture(true), seq.chordWindow + 20);
      else capture.timer = setTimeout(() => stopCapture(true), 1500);
      renderCapture();
      return;
    }
    if (active) tracker.onEvent(ev);
    else tracker.noteState(ev);
  }

  // ---------------------------------------------------------------- Rendu
  function renderAll() {
    renderSteps();
    renderTest();
    renderRecap();
  }

  function renderSteps() {
    $('seq-tol').parentElement.querySelector('output').textContent = formatDuration(seq.tolerance, unit());
    $('seq-arm-row').hidden = seq.trigger !== 'key';
    $('seq-arm-key').innerHTML = seq.armKey ? chips([seq.armKey]) : '<span class="muted">aucune</span>';
    $('seq-holds').innerHTML = `<span class="muted">À maintenir pendant tout l'essai :</span>
      ${seq.hold.length ? seq.hold.map((h, i) => `<span class="hold-item">${chips([h])}<button class="step-del hold-del" data-i="${i}" title="Retirer">×</button></span>`).join('') : '<span class="muted">rien</span>'}
      <button id="btn-hold-add" class="btn">${capture?.mode === 'hold' ? 'Annuler' : '+ Ajouter'}</button>`;
    if (!seq.steps.length) {
      $('seq-steps').innerHTML = '<div class="rec-none">Séquence vide : clique sur <b>● Enregistrer le modèle</b> et joue la séquence attendue.</div>';
      return;
    }
    $('seq-steps').innerHTML = seq.steps
      .map((st, i) => {
        const v = (x) => (x == null ? '' : x);
        const gap = i > 0
          ? `<div class="step-gap${hasWindow(st) ? ' has-win' : ''}">
              <span title="Écart du modèle avec l'étape précédente"><input class="gap-input" type="number" min="0" step="5" data-i="${i}" value="${Math.round(st.t - seq.steps[i - 1].t)}">ms</span>
              <span class="win" title="Fenêtre de délai : pas avant min, pas après max (ms après l'étape précédente). Vérifiée même sans « Vérifier le timing ». Laisse vide pour ne pas limiter.">⏱<input class="win-input" type="number" min="0" step="5" data-i="${i}" data-k="min" placeholder="min" value="${v(st.minGap)}">–<input class="win-input" type="number" min="0" step="5" data-i="${i}" data-k="max" placeholder="max" value="${v(st.maxGap)}"></span>
            </div>`
          : '';
        const angles = seq.checkAngles
          ? st.inputs
              .map((inp, j) => (!isStickInput(inp) ? '' : `<span class="ang-edit" title="Angle attendu : 0 = haut, positif = droite, négatif = gauche">${esc(inputLabel(inp, settings))} <input class="ang-input" type="number" step="1" min="-180" max="180" data-i="${i}" data-j="${j}" data-k="angle" placeholder="—" value="${v(inp.angle)}">° ± <input class="ang-input tol" type="number" step="1" min="1" max="90" data-i="${i}" data-j="${j}" data-k="tol" placeholder="15" value="${v(inp.angleTol)}">°</span>`))
              .join('')
          : '';
        return `${gap}<div class="step-card"><span class="step-num">${i + 1}</span><div class="step-body"><div class="chips">${chips(st.inputs)}</div>${angles ? `<div class="ang-row">${angles}</div>` : ''}</div><button class="step-del" data-i="${i}" title="Supprimer l'étape">×</button></div>`;
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
    const R = seq.steps[i];
    if (i > 0 && s.gap != null && hasWindow(R)) {
      const lo = R.minGap != null ? formatDuration(R.minGap, unit()) : '0';
      const hi = R.maxGap != null ? formatDuration(R.maxGap, unit()) : '∞';
      parts.push(`délai ${formatDuration(Math.round(s.gap), unit())} (fenêtre ${lo}–${hi})`);
    } else if (seq.timing && i > 0 && s.err !== null) {
      const e = Math.round(s.err);
      parts.push(Math.abs(e) <= 2 ? 'pile dans le timing' : `${e > 0 ? '+' : '−'}${formatDuration(Math.abs(e), unit())} ${e > 0 ? 'tard' : 'tôt'}`);
    }
    for (const a of s.angles ?? []) {
      const lbl = esc(inputLabel({ device: 'pad', code: a.code }, settings));
      parts.push(a.target == null ? `${lbl} ${formatAngle(a.angle)}` : `${lbl} ${formatAngle(a.angle)} ${a.ok ? '✓' : `(attendu ${formatAngle(a.target)} ±${a.tol}°)`}`);
    }
    return parts.join(' · ') || 'OK';
  }

  function renderTest() {
    if (!seq) return;
    const status = $('train-status');
    const view = phase === 'running' ? live : last;
    if (!seq.steps.length) status.innerHTML = '<span class="muted">Enregistre d\'abord une séquence modèle.</span>';
    else if (!active) status.innerHTML = `<span class="muted">Clique sur <b>▶ Activer le test</b> (ou ${esc(formatAccel(settings.shortcuts?.training))}, même en jeu), puis joue la séquence.</span>`;
    else if (phase === 'running') status.innerHTML = '<span class="verdict running">En cours…</span>';
    else if (phase === 'result' && last)
      status.innerHTML = `<span class="verdict v-${last.verdict}">${VERDICT_LABEL[last.verdict]}</span>
        <span class="score">${Math.round(last.score * 100)}%</span>
        <span class="muted">Essai n°${attempts().length} · ${seq.trigger === 'key' && seq.armKey ? `rejoue : ${chips([seq.armKey])} puis la séquence` : 'rejoue quand tu veux'}</span>`;
    else status.innerHTML = `<span class="verdict ready">${readyText()}</span>`;
    if (active && armed && phase !== 'running') status.innerHTML = '<span class="verdict armed">Armé : vas-y !</span>';

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

    renderTimeline(view);
    const extras = view?.extras ?? [];
    const holds = view?.holds ?? [];
    $('train-extras').innerHTML =
      (holds.length
        ? `<div class="holds-line"><span class="muted">Maintenu :</span> ${holds
            .map((h) => `<span class="hold-res ${h.ok ? 'c-ok' : 'c-miss'}">${chips([h.input])} ${h.ok ? '✓' : `✗ ${esc(h.reason)}`}</span>`)
            .join(' ')}</div>`
        : '') +
      (extras.length ? `<span class="muted">En trop :</span> ${extras.map((e) => `<span class="extra">${chips(e.inputs)}</span>`).join(' ')}` : '');
    publish();
  }

  // Frise : le modèle en haut, ton essai en bas, sur la même échelle de temps (fenêtres de délai en bandes)
  function renderTimeline(view) {
    const el = $('train-timeline');
    if (!seq.steps.length) {
      el.innerHTML = '';
      return;
    }
    const W = 600;
    const L = 64;
    const R = 14;
    const played = (view?.steps ?? []).filter((s) => s.at != null);
    const extras = view?.extras ?? [];
    // fin des fenêtres de délai (placées après l'étape précédente jouée, ou celle du modèle)
    const winEnds = seq.steps.map((st, i) => (i > 0 && hasWindow(st) ? (view?.steps[i - 1]?.at ?? seq.steps[i - 1].t) + (st.maxGap ?? st.minGap ?? 0) : 0));
    const tMax = Math.max(seq.steps.at(-1).t, ...played.map((s) => s.at), ...extras.map((e) => e.t), ...winEnds, 100) * 1.08;
    const x = (t) => L + (t / tMax) * (W - L - R);
    const yM = 22;
    const yA = 58;
    const col = { ok: '#3fdc8a', almost: '#f0b940', miss: '#ff6b81', pending: '#59607a', idle: '#59607a' };
    let svg = `<text x="0" y="${yM + 4}" class="tl-lbl">Modèle</text><text x="0" y="${yA + 4}" class="tl-lbl">Ton essai</text>
      <line x1="${L}" y1="${yM}" x2="${W - R}" y2="${yM}" class="tl-axis"/><line x1="${L}" y1="${yA}" x2="${W - R}" y2="${yA}" class="tl-axis"/>`;
    // graduations
    const step = tMax > 1500 ? 500 : tMax > 600 ? 200 : tMax > 250 ? 100 : 50;
    for (let t = 0; t <= tMax; t += step) svg += `<line x1="${x(t)}" y1="${yA + 6}" x2="${x(t)}" y2="${yA + 10}" class="tl-tick"/><text x="${x(t)}" y="${yA + 22}" class="tl-t">${formatDuration(t, unit())}</text>`;
    seq.steps.forEach((st, i) => {
      svg += `<circle cx="${x(st.t)}" cy="${yM}" r="9" class="tl-model"/><text x="${x(st.t)}" y="${yM + 4}" class="tl-n">${i + 1}</text>`;
      // fenêtre de délai, placée après l'étape précédente jouée (ou du modèle)
      if (i > 0 && hasWindow(st)) {
        const base = view?.steps[i - 1]?.at ?? seq.steps[i - 1].t;
        const a = base + (st.minGap ?? 0);
        const b = st.maxGap != null ? base + st.maxGap : tMax;
        svg += `<rect x="${x(a)}" y="${yA - 11}" width="${Math.max(2, x(Math.min(b, tMax)) - x(a))}" height="22" rx="4" class="tl-win"><title>Fenêtre de l'étape ${i + 1}</title></rect>`;
      }
    });
    for (const e of extras) svg += `<line x1="${x(e.t)}" y1="${yA - 8}" x2="${x(e.t)}" y2="${yA + 8}" class="tl-extra"><title>En trop</title></line>`;
    (view?.steps ?? []).forEach((s, i) => {
      if (s.at == null) return;
      svg += `<line x1="${x(seq.steps[i].t)}" y1="${yM + 9}" x2="${x(s.at)}" y2="${yA - 9}" class="tl-link"/>`;
      svg += `<circle cx="${x(s.at)}" cy="${yA}" r="9" fill="${col[s.status]}" class="tl-att"><title>Étape ${i + 1} : ${s.status === 'ok' ? 'OK' : esc(s.reason || s.status)}</title></circle><text x="${x(s.at)}" y="${yA + 4}" class="tl-n dark">${i + 1}</text>`;
    });
    el.innerHTML = `<svg viewBox="0 0 ${W} 86" class="timeline-svg">${svg}</svg>`;
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
      : r.holdFails ? '' : '<div class="weak good">Toutes les étapes sont maîtrisées 👌</div>';
    $('train-recap').innerHTML = `
      <div class="stat-grid four">
        <div class="stat"><b>${r.attempts}</b><span>essais</span></div>
        <div class="stat"><b>${pct(r.success / r.attempts)}</b><span>réussis</span></div>
        <div class="stat"><b>${r.perfect}</b><span>parfaits</span></div>
        <div class="stat"><b>${r.streak}</b><span>série actuelle</span></div>
      </div>
      ${weak}
      ${seq.hold.length && r.holdFails ? `<div class="weak">Maintien raté sur <b>${r.holdFails}</b> essai${r.holdFails > 1 ? 's' : ''} : ${chips(seq.hold)} pas gardé appuyé</div>` : ''}
      <table class="stat-top recap-table">
        <tr><th>Étape</th><th>Réussi</th><th>Presque</th><th>Raté</th><th>Timing moyen</th>${r.perStep.some((p) => p.avgAngle != null) ? '<th>Angle moyen</th>' : ''}</tr>
        ${seq.steps
          .map((st, i) => {
            const p = r.perStep[i];
            return `<tr${i === r.weakest ? ' class="weak-row"' : ''}><td><span class="step-num">${i + 1}</span> ${chips(st.inputs)}</td>
              <td class="c-ok">${pct(p.ok / r.attempts)}</td><td class="c-almost">${p.almost}</td><td class="c-miss">${p.miss}</td><td>${avgErr(p.avgErr)}</td>${r.perStep.some((q) => q.avgAngle != null) ? `<td>${p.avgAngle != null ? formatAngle(p.avgAngle) : '—'}</td>` : ''}</tr>`;
          })
          .join('')}
      </table>
      <div class="attempt-pills">${list
        .slice(-30)
        .map((a, k) => `<span class="pill-att v-${a.verdict}" title="Essai ${list.length - Math.min(30, list.length) + k + 1} : ${VERDICT_LABEL[a.verdict]} (${pct(a.score)})">${pct(a.score)}</span>`)
        .join('')}</div>`;
  }

  function readyText() {
    if (seq.trigger === 'key') {
      return seq.armKey
        ? `Prêt : appuie sur ${chips([seq.armKey])} puis fais la séquence`
        : 'Choisis une touche de départ dans les options';
    }
    if (seq.trigger === 'first') return `Prêt : l'essai démarre dès ${chips(seq.steps[0].inputs)}`;
    return 'Prêt : joue la séquence !';
  }

  // État envoyé à l'overlay
  function publish() {
    const view = phase === 'running' ? live : last;
    const list = attempts();
    api.setTrainingState({
      active: active && !!seq,
      name: seq?.name ?? '',
      phase,
      steps: [
        ...(seq?.hold?.length
          ? [{
              label: `Maintenir ${seq.hold.map((x) => inputLabel(x, settings)).join('+')}`,
              status: view?.holds?.length ? (view.holds.every((h) => h.ok) ? 'ok' : 'miss') : 'pending',
              detail: view?.holds?.filter((h) => !h.ok).map((h) => `${inputLabel(h.input, settings)} ${h.reason}`).join(' · ') ?? '',
            }]
          : []),
        ...(seq?.steps ?? []).map((st, i) => ({
          label: st.inputs.map((x) => inputLabel(x, settings)).join('+'),
          status: view?.steps[i]?.status ?? 'pending',
          detail: view?.steps[i] && view.steps[i].status !== 'pending' ? stepDetail(view.steps[i], i) : '',
        })),
      ],
      verdict: phase === 'result' ? last?.verdict : null,
      verdictLabel: armed && phase !== 'running' ? 'Armé : vas-y !' : phase === 'result' && last ? VERDICT_LABEL[last.verdict] : phase === 'running' ? 'En cours…' : 'Prêt',
      armed,
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
      if (!$('game-controls').hidden) renderControls();
      renderList();
      if (seq) renderAll();
    },
  };
}

// Onglet « Enregistrements » : liste des sessions, timeline, rejeu, historique et statistiques.
import { analyze, ReplayState, keyOf } from './lib/replay.js';
import { Timeline, formatClock } from './lib/timeline.js';
import { KeyboardWidget, MouseWidget, GamepadWidget, HistoryWidget } from './lib/widgets.js';
import { inputLabel, formatDuration } from './lib/labels.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fmtDate = (ms) =>
  new Date(ms).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export function initRecordings(api, getSettings) {
  let settings = getSettings();
  let list = [];
  let session = null;
  let data = null;
  let replay = null;
  let playhead = 0;
  let playing = false;
  let lastFrame = 0;

  const keyboard = new KeyboardWidget('full', settings);
  const mouse = new MouseWidget();
  const gamepad = new GamepadWidget(settings);
  const history = new HistoryWidget(settings, { maxRows: 200 });
  $('replay-kb').appendChild(keyboard.el);
  $('replay-mouse').appendChild(mouse.el);
  $('replay-pad').appendChild(gamepad.el);
  $('replay-history').appendChild(history.el);
  const widgets = [keyboard, mouse, gamepad];

  const timeline = new Timeline($('timeline'), { onSeek: (t) => seek(t) });

  // ---- Liste
  async function refreshList(selectId) {
    list = await api.listRecordings();
    renderList();
    const id = selectId ?? session?.id ?? list[0]?.id;
    if (id && id !== session?.id) await open(id);
    if (!list.length) close();
  }

  function renderList() {
    const el = $('rec-list');
    if (!list.length) {
      el.innerHTML = '<div class="rec-none">Aucune session.<br>Clique sur <b>● Enregistrer</b> ou fais <kbd>Ctrl</kbd>+<kbd>Maj</kbd>+<kbd>R</kbd>.</div>';
      return;
    }
    el.innerHTML = list
      .map(
        (s) => `<button class="rec-item${s.id === session?.id ? ' active' : ''}" data-id="${esc(s.id)}">
          <span class="rec-item-name">${esc(s.name)}</span>
          <span class="rec-item-meta">${fmtDate(s.createdAt)} · ${formatClock(s.durationMs, false)} · ${s.count} évts</span>
        </button>`
      )
      .join('');
  }
  $('rec-list').addEventListener('click', (ev) => {
    const btn = ev.target.closest('.rec-item');
    if (btn) open(btn.dataset.id);
  });

  async function open(id) {
    const s = await api.loadRecording(id);
    if (!s) return;
    session = s;
    data = analyze(s);
    replay = new ReplayState(s.events);
    playing = false;
    playhead = 0;
    history.clear();
    $('rec-main').classList.remove('empty');
    $('rec-name').value = s.name;
    timeline.setData(data, settings);
    renderStats();
    renderList();
    seek(0);
  }

  function close() {
    session = data = replay = null;
    playing = false;
    $('rec-main').classList.add('empty');
  }

  // ---- Lecture
  function seek(t) {
    if (!replay) return;
    playhead = Math.max(0, Math.min(t, data.duration));
    const rewound = replay.seek(playhead, (e) => history.onEvent({ ...e, key: keyOf(e) }));
    if (rewound) {
      history.clear();
      replay.reset();
      replay.seek(playhead, (e) => history.onEvent({ ...e, key: keyOf(e) }));
    }
    timeline.setPlayhead(playhead, playing);
    updateTime();
    renderReplay();
  }

  function setPlaying(p) {
    if (!session) return;
    if (p && playhead >= data.duration) seek(0);
    playing = p;
    lastFrame = performance.now();
    $('btn-play').textContent = playing ? '❚❚ Pause' : '▶ Lire';
    timeline.follow = true;
  }

  function updateTime() {
    $('rec-time').textContent = `${formatClock(playhead)} / ${formatClock(data?.duration ?? 0)}`;
  }

  function renderReplay() {
    if (!replay) return;
    for (const w of widgets) w.update(replay, playhead);
    history.update(replay, playhead);
  }

  function renderStats() {
    const st = data.stats;
    const unit = settings.timeUnit;
    const dev = { kb: 'Clavier', mouse: 'Souris', pad: 'Manette' };
    $('rec-stats').innerHTML = `
      <div class="stat-grid">
        <div class="stat"><b>${st.total}</b><span>inputs</span></div>
        <div class="stat"><b>${Math.round(st.perMinute)}</b><span>par minute</span></div>
        <div class="stat"><b>${formatClock(data.duration, false)}</b><span>durée</span></div>
        <div class="stat"><b>${formatDuration(st.avgGap, unit)}</b><span>écart moyen</span></div>
      </div>
      <div class="stat-dev">${Object.entries(st.byDevice)
        .map(([d, n]) => `<span class="chip dev-${d}">${dev[d]} ${n}</span>`)
        .join(' ')}</div>
      <table class="stat-top">
        <tr><th>Input</th><th>Appuis</th><th>Maintien moy.</th></tr>
        ${st.top
          .map(
            (l) => `<tr><td><span class="chip dev-${l.device}">${esc(inputLabel(l, settings))}</span></td>
              <td>${l.count}</td><td>${l.segments.length ? formatDuration(l.avgHold, unit) : '—'}</td></tr>`
          )
          .join('')}
      </table>`;
  }

  // ---- Contrôles
  $('btn-play').addEventListener('click', () => setPlaying(!playing));
  $('rec-speed').addEventListener('change', () => (lastFrame = performance.now()));
  $('zoom-in').addEventListener('click', () => timeline.zoomAround(1 / 1.5));
  $('zoom-out').addEventListener('click', () => timeline.zoomAround(1.5));
  $('zoom-fit').addEventListener('click', () => timeline.fit());
  $('rec-name').addEventListener('change', async () => {
    if (!session) return;
    const name = $('rec-name').value.trim() || session.name;
    await api.renameRecording(session.id, name);
    session.name = name;
    refreshList();
  });
  $('btn-export').addEventListener('click', () => session && api.exportRecording(session.id));
  $('btn-import').addEventListener('click', async () => {
    const meta = await api.importRecording();
    if (meta) refreshList(meta.id);
  });
  $('btn-delete').addEventListener('click', async () => {
    if (!session || !confirm(`Mettre « ${session.name} » à la corbeille ?`)) return;
    const id = session.id;
    close();
    await api.deleteRecording(id);
    refreshList();
  });

  const isActive = () => document.querySelector('.view.recordings').classList.contains('active');
  window.addEventListener('keydown', (ev) => {
    if (!isActive() || !session || ev.target?.closest?.('input, select, textarea')) return;
    if (ev.code === 'Space') {
      ev.preventDefault();
      setPlaying(!playing);
    } else if (ev.code === 'ArrowLeft' || ev.code === 'ArrowRight') {
      ev.preventDefault();
      const stepMs = ev.shiftKey ? 1000 : 1000 / 60; // une frame, ou 1 s avec Maj
      seek(playhead + (ev.code === 'ArrowLeft' ? -stepMs : stepMs));
    } else if (ev.code === 'Home') seek(0);
  });

  refreshList();

  return {
    /** Appelé à chaque frame par la boucle principale. */
    frame(now) {
      if (!playing || !session) return;
      const dt = now - lastFrame;
      lastFrame = now;
      const speed = Number($('rec-speed').value);
      const t = playhead + dt * speed;
      if (t >= data.duration) {
        seek(data.duration);
        setPlaying(false);
      } else seek(t);
    },
    setSettings(s) {
      settings = s;
      widgets.forEach((w) => w.setSettings(s));
      history.setSettings(s);
      timeline.setSettings(s);
      if (data) renderStats();
      renderReplay();
    },
    refreshList,
  };
}

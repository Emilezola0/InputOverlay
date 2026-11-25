// Modèles de séquences prêts à l'emploi, construits à partir des contrôles du joueur.
// Chaque jeu déclare ses actions (Sauter, Boost…) avec un bouton par défaut ; le joueur peut les changer
// (onglet Entraînement → Mes contrôles). Les inputs d'un modèle gardent leur action : si le joueur change
// ses contrôles, les séquences créées depuis un modèle sont mises à jour.
// Codes manette = mapping standard : 0 A/✕, 1 B/○, 2 X/□, 3 Y/△, 4 LB, 5 RB, 6 LT, 7 RT, 8 View, 9 Menu.
// Les directions restent celles du stick gauche : 'ls:↑', 'ls:↗', …
// Le timing n'est pas vérifié par défaut (ordre seulement) : pour l'activer, le mieux est de réenregistrer
// le modèle en le jouant soi-même (bouton « Enregistrer le modèle »).

const pad = (code) => ({ device: 'pad', code });

export const GAMES = {
  'Rocket League': {
    note: 'Contrôles par défaut de Rocket League. L\'air roll gauche / droite n\'est pas assigné par défaut dans le jeu : beaucoup de joueurs le mettent sur LB / RB.',
    actions: {
      throttle: { label: 'Accélérer', default: pad(7) },
      reverse: { label: 'Freiner / reculer', default: pad(6) },
      jump: { label: 'Sauter', default: pad(0) },
      boost: { label: 'Boost', default: pad(1) },
      powerslide: { label: 'Dérapage / air roll', default: pad(2) },
      airRollLeft: { label: 'Air roll gauche', default: pad(4) },
      airRollRight: { label: 'Air roll droite', default: pad(5) },
    },
  },
  'Jeux de combat': {
    note: 'Les directions se font au stick gauche.',
    actions: {
      attack: { label: 'Coup', default: pad(2) },
    },
  },
};

/** Contrôles effectifs d'un jeu : défauts du jeu + choix du joueur (settings.gameControls). */
export function controlsFor(settings, game) {
  const def = GAMES[game];
  if (!def) return {};
  const user = settings?.gameControls?.[game] ?? {};
  const out = {};
  for (const [k, a] of Object.entries(def.actions)) out[k] = user[k]?.device ? { device: user[k].device, code: user[k].code } : a.default;
  return out;
}

export const actionLabel = (game, action) => GAMES[game]?.actions[action]?.label ?? '';

// Briques des modèles
const act = (action) => ({ action });
const dir = (arrow, angle, angleTol) => (angle == null ? pad(`ls:${arrow}`) : { ...pad(`ls:${arrow}`), angle, angleTol });
const st = (t, ...inputs) => ({ t, inputs });

const BASE = { tolerance: 60, timing: false, chordWindow: 40, trigger: 'first', inputFilter: 'devices', stickSweep: true };

export const TEMPLATES = [
  {
    game: 'Rocket League',
    name: 'Speedflip (flip vers la gauche)',
    note: "Garde Accélérer + Boost appuyés pendant toute la figure. Le flip se fait en diagonale à environ 35° à gauche de l'avant (vérifié à ±12°). Tourne un peu à droite, saute, flip en diagonale avant-gauche (↖ + saut), annule tout de suite le flip en tirant le stick en arrière (↓), puis air roll gauche pour retomber à plat. Le léger braquage du début n'est pas vérifié. Certains joueurs tiennent l'air roll dès le saut : dans ce cas, réenregistre le modèle à ta façon.",
    checkAngles: true,
    hold: [act('throttle'), act('boost')],
    steps: [st(0, act('jump')), st(100, dir('↖', -35, 12), act('jump')), st(160, dir('↓')), st(230, act('airRollLeft'))],
  },
  {
    game: 'Rocket League',
    name: 'Speedflip (flip vers la droite)',
    note: 'Version miroir : Accélérer + Boost maintenus, tourne un peu à gauche, saute, flip avant-droite à environ 35° (↗ + saut), annule avec ↓, puis air roll droite.',
    checkAngles: true,
    hold: [act('throttle'), act('boost')],
    steps: [st(0, act('jump')), st(100, dir('↗', 35, 12), act('jump')), st(160, dir('↓')), st(230, act('airRollRight'))],
  },
  {
    game: 'Rocket League',
    name: 'Half-flip',
    note: "Saute, backflip (↓ + saut), annule le flip en poussant le stick vers l'avant (↑), puis air roll (gauche ou droite, non vérifié) pour te remettre droit.",
    steps: [st(0, act('jump')), st(150, dir('↓'), act('jump')), st(300, dir('↑'))],
  },
  {
    game: 'Rocket League',
    name: 'Fast aerial',
    note: 'Saut + boost ensemble, stick vers l’arrière (↓), puis deuxième saut juste après.',
    steps: [st(0, act('jump'), act('boost')), st(60, dir('↓')), st(180, act('jump'))],
  },
  {
    game: 'Rocket League',
    name: 'Wavedash (vers l’avant)',
    note: 'Petit saut puis, juste avant de toucher le sol, flip vers l’avant (↑ + saut). Le moment exact dépend de la hauteur du saut.',
    steps: [st(0, act('jump')), st(350, dir('↑'), act('jump'))],
  },
  {
    game: 'Jeux de combat',
    name: 'Quart de cercle avant (236 + coup)',
    note: 'Bas, bas-avant, avant + coup. Vu pour un personnage tourné vers la droite.',
    steps: [st(0, dir('↓')), st(50, dir('↘')), st(100, dir('→'), act('attack'))],
  },
  {
    game: 'Jeux de combat',
    name: 'Dragon punch (623 + coup)',
    note: 'Avant, bas, bas-avant + coup.',
    steps: [st(0, dir('→')), st(60, dir('↓')), st(120, dir('↘'), act('attack'))],
  },
  {
    game: 'Jeux de combat',
    name: 'Demi-cercle avant (41236 + coup)',
    note: 'Arrière, bas-arrière, bas, bas-avant, avant + coup.',
    steps: [st(0, dir('←')), st(50, dir('↙')), st(100, dir('↓')), st(150, dir('↘')), st(200, dir('→'), act('attack'))],
  },
  {
    game: 'Jeux de combat',
    name: 'Dash avant (→ →)',
    note: 'Deux fois avant rapidement : relâche le stick entre les deux.',
    steps: [st(0, dir('→')), st(120, dir('→'))],
  },
];

/** Remplace chaque input lié à une action par le bouton choisi. Renvoie true si quelque chose a changé. */
function resolveInputs(inputs, controls) {
  let changed = false;
  for (const i of inputs) {
    const b = i.action && controls[i.action];
    if (!b) continue;
    if (i.device !== b.device || i.code !== b.code) changed = true;
    i.device = b.device;
    i.code = b.code;
  }
  // deux actions sur le même bouton : on ne garde qu'un exemplaire
  for (let k = inputs.length - 1; k >= 0; k--) {
    if (inputs.findIndex((x) => x.device === inputs[k].device && x.code === inputs[k].code) < k) inputs.splice(k, 1), (changed = true);
  }
  return changed;
}

/** Applique les contrôles du joueur à une séquence issue d'un modèle (modifie seq). */
export function applyControls(seq, settings) {
  if (!seq?.game || !GAMES[seq.game]) return false;
  const controls = controlsFor(settings, seq.game);
  let changed = false;
  for (const s of seq.steps) if (resolveInputs(s.inputs, controls)) changed = true;
  if (seq.hold && resolveInputs(seq.hold, controls)) changed = true;
  return changed;
}

/** Copie d'un modèle, avec les contrôles du joueur, prête à être enregistrée comme séquence. */
export function fromTemplate(tpl, settings) {
  const seq = {
    ...BASE,
    name: tpl.name,
    category: tpl.game,
    game: tpl.game,
    note: tpl.note,
    checkAngles: !!tpl.checkAngles,
    hold: structuredClone(tpl.hold ?? []),
    steps: structuredClone(tpl.steps),
  };
  applyControls(seq, settings);
  return seq;
}

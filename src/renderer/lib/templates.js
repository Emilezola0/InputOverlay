// Modèles de séquences prêts à l'emploi.
// Codes manette = mapping standard : 0 A/✕, 1 B/○, 2 X/□, 3 Y/△, 4 LB, 5 RB, 6 LT, 7 RT, 8 View, 9 Menu,
// directions du stick gauche : 'ls:↑', 'ls:↗', … (affichées selon le style Xbox / PlayStation choisi).
// Les timings sont indicatifs : le timing n'est pas vérifié par défaut (ordre seulement). Pour l'activer,
// le mieux est de réenregistrer le modèle en le jouant soi-même (bouton « Enregistrer le modèle »).

const pad = (code) => ({ device: 'pad', code });
const A = pad(0), B = pad(1), X = pad(2);
const st = (t, ...inputs) => ({ t, inputs });
const dir = (arrow) => pad(`ls:${arrow}`);

const BASE = { tolerance: 60, timing: false, chordWindow: 40, trigger: 'first', inputFilter: 'devices', stickSweep: true };

export const TEMPLATES = [
  {
    category: 'Rocket League',
    name: 'Speedflip (flip vers la gauche)',
    note: "Contrôles par défaut. Garde RT (accélérer) et B (boost), tourne un peu à droite, saute (A), flip en diagonale avant-gauche (↖ + A) puis annule le flip en tirant le stick en arrière (↓). L'air roll n'est pas vérifié.",
    steps: [st(0, A), st(110, dir('↖'), A), st(170, dir('↓'))],
  },
  {
    category: 'Rocket League',
    name: 'Speedflip (flip vers la droite)',
    note: 'Version miroir : tourne un peu à gauche, saute (A), flip avant-droite (↗ + A), annule avec ↓.',
    steps: [st(0, A), st(110, dir('↗'), A), st(170, dir('↓'))],
  },
  {
    category: 'Rocket League',
    name: 'Half-flip',
    note: "Saute (A), backflip (↓ + A), annule le flip en poussant le stick vers l'avant (↑), puis air roll pour te remettre droit (non vérifié).",
    steps: [st(0, A), st(150, dir('↓'), A), st(300, dir('↑'))],
  },
  {
    category: 'Rocket League',
    name: 'Fast aerial',
    note: 'Saut + boost (A + B), stick vers l’arrière (↓), puis deuxième saut (A) juste après.',
    steps: [st(0, A, B), st(60, dir('↓')), st(180, A)],
  },
  {
    category: 'Rocket League',
    name: 'Wavedash (vers l’avant)',
    note: 'Petit saut (A) puis, juste avant de toucher le sol, flip vers l’avant (↑ + A). Le moment exact dépend de la hauteur du saut.',
    steps: [st(0, A), st(350, dir('↑'), A)],
  },
  {
    category: 'Jeux de combat',
    name: 'Quart de cercle avant (236 + X)',
    note: 'Bas, bas-avant, avant + coup (X / □). Vu pour un personnage tourné vers la droite.',
    steps: [st(0, dir('↓')), st(50, dir('↘')), st(100, dir('→'), X)],
  },
  {
    category: 'Jeux de combat',
    name: 'Dragon punch (623 + X)',
    note: 'Avant, bas, bas-avant + coup (X / □).',
    steps: [st(0, dir('→')), st(60, dir('↓')), st(120, dir('↘'), X)],
  },
  {
    category: 'Jeux de combat',
    name: 'Demi-cercle avant (41236 + X)',
    note: 'Arrière, bas-arrière, bas, bas-avant, avant + coup (X / □).',
    steps: [st(0, dir('←')), st(50, dir('↙')), st(100, dir('↓')), st(150, dir('↘')), st(200, dir('→'), X)],
  },
  {
    category: 'Jeux de combat',
    name: 'Dash avant (→ →)',
    note: 'Deux fois avant rapidement : relâche le stick entre les deux.',
    steps: [st(0, dir('→')), st(120, dir('→'))],
  },
];

/** Copie d'un modèle, prête à être enregistrée comme séquence. */
export function fromTemplate(tpl) {
  return {
    ...BASE,
    name: tpl.name,
    category: tpl.category,
    note: tpl.note,
    steps: structuredClone(tpl.steps),
  };
}

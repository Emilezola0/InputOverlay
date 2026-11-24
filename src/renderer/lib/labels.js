// Noms et libellés des inputs. Les codes clavier sont des scancodes (position physique),
// donc les libellés dépendent de la disposition (AZERTY / QWERTY).

export const K = {
  Escape: 1, '1': 2, '2': 3, '3': 4, '4': 5, '5': 6, '6': 7, '7': 8, '8': 9, '9': 10, '0': 11,
  Minus: 12, Equal: 13, Backspace: 14, Tab: 15,
  Q: 16, W: 17, E: 18, R: 19, T: 20, Y: 21, U: 22, I: 23, O: 24, P: 25,
  BracketLeft: 26, BracketRight: 27, Enter: 28, Ctrl: 29,
  A: 30, S: 31, D: 32, F: 33, G: 34, H: 35, J: 36, K: 37, L: 38, Semicolon: 39, Quote: 40,
  Backquote: 41, Shift: 42, Backslash: 43,
  Z: 44, X: 45, C: 46, V: 47, B: 48, N: 49, M: 50, Comma: 51, Period: 52, Slash: 53,
  ShiftRight: 54, NumpadMultiply: 55, Alt: 56, Space: 57, CapsLock: 58,
  F1: 59, F2: 60, F3: 61, F4: 62, F5: 63, F6: 64, F7: 65, F8: 66, F9: 67, F10: 68,
  NumLock: 69, ScrollLock: 70, F11: 87, F12: 88, IntlBackslash: 86,
  Numpad7: 71, Numpad8: 72, Numpad9: 73, NumpadSubtract: 74, Numpad4: 75, Numpad5: 76,
  Numpad6: 77, NumpadAdd: 78, Numpad1: 79, Numpad2: 80, Numpad3: 81, Numpad0: 82, NumpadDecimal: 83,
  NumpadEnter: 3612, CtrlRight: 3613, NumpadDivide: 3637, PrintScreen: 3639, AltRight: 3640,
  Home: 3655, PageUp: 3657, End: 3663, PageDown: 3665, Insert: 3666, Delete: 3667,
  Meta: 3675, MetaRight: 3676, ContextMenu: 3677,
  ArrowUp: 57416, ArrowLeft: 57419, ArrowRight: 57421, ArrowDown: 57424,
};

const BASE = {};
for (const [name, code] of Object.entries(K)) BASE[code] = name;

const COMMON = {
  [K.Escape]: 'Échap', [K.Backspace]: '⌫', [K.Tab]: 'Tab', [K.Enter]: 'Entrée',
  [K.Ctrl]: 'Ctrl', [K.CtrlRight]: 'Ctrl D', [K.Shift]: 'Maj', [K.ShiftRight]: 'Maj D',
  [K.Alt]: 'Alt', [K.AltRight]: 'AltGr', [K.Space]: 'Espace', [K.CapsLock]: 'Verr',
  [K.Meta]: 'Win', [K.MetaRight]: 'Win D', [K.ContextMenu]: 'Menu',
  [K.ArrowUp]: '↑', [K.ArrowDown]: '↓', [K.ArrowLeft]: '←', [K.ArrowRight]: '→',
  [K.Insert]: 'Inser', [K.Delete]: 'Suppr', [K.Home]: 'Début', [K.End]: 'Fin',
  [K.PageUp]: 'PgPréc', [K.PageDown]: 'PgSuiv', [K.PrintScreen]: 'Impr',
  [K.NumLock]: 'VerrNum', [K.ScrollLock]: 'Arrêt',
  [K.Numpad0]: 'Num0', [K.Numpad1]: 'Num1', [K.Numpad2]: 'Num2', [K.Numpad3]: 'Num3',
  [K.Numpad4]: 'Num4', [K.Numpad5]: 'Num5', [K.Numpad6]: 'Num6', [K.Numpad7]: 'Num7',
  [K.Numpad8]: 'Num8', [K.Numpad9]: 'Num9', [K.NumpadAdd]: 'Num+', [K.NumpadSubtract]: 'Num-',
  [K.NumpadMultiply]: 'Num*', [K.NumpadDivide]: 'Num/', [K.NumpadDecimal]: 'Num.',
  [K.NumpadEnter]: 'NumEntrée',
};

const QWERTY = {
  [K.Backquote]: '`', [K.Minus]: '-', [K.Equal]: '=', [K.BracketLeft]: '[', [K.BracketRight]: ']',
  [K.Backslash]: '\\', [K.Semicolon]: ';', [K.Quote]: "'", [K.Comma]: ',', [K.Period]: '.',
  [K.Slash]: '/', [K.IntlBackslash]: '\\',
};

const AZERTY = {
  [K.Q]: 'A', [K.W]: 'Z', [K.A]: 'Q', [K.Z]: 'W', [K.Semicolon]: 'M', [K.M]: ',',
  [K.Backquote]: '²', [K.Minus]: ')', [K.Equal]: '=', [K.BracketLeft]: '^', [K.BracketRight]: '$',
  [K.Backslash]: '*', [K.Quote]: 'ù', [K.Comma]: ';', [K.Period]: ':', [K.Slash]: '!',
  [K.IntlBackslash]: '<',
};

export function keyLabel(code, layout = 'azerty') {
  const map = layout === 'azerty' ? AZERTY : QWERTY;
  return map[code] ?? COMMON[code] ?? BASE[code] ?? `#${code}`;
}

export const MOUSE_LABELS = {
  1: 'Clic G', 2: 'Clic D', 3: 'Clic M', 4: 'Souris 4', 5: 'Souris 5',
  'wheel-up': 'Molette ↑', 'wheel-down': 'Molette ↓', 'wheel-left': 'Molette ←', 'wheel-right': 'Molette →',
};

// Mapping "standard" de l'API Gamepad
export const PAD_LABELS = {
  xbox: ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'LS', 'RS', '↑', '↓', '←', '→', 'Guide'],
  ps: ['✕', '○', '□', '△', 'L1', 'R1', 'L2', 'R2', 'Share', 'Options', 'L3', 'R3', '↑', '↓', '←', '→', 'PS'],
};

export function padLabel(code, style = 'xbox') {
  if (typeof code === 'string') {
    // directions des sticks : 'ls:↗' / 'rs:↗'
    const [stick, arrow] = code.split(':');
    return stick === 'ls' ? arrow : `R${arrow}`;
  }
  return PAD_LABELS[style]?.[code] ?? `B${code}`;
}

export function inputLabel(ev, settings) {
  if (ev.device === 'kb') return keyLabel(ev.code, settings.keyboardLayout);
  if (ev.device === 'mouse') return MOUSE_LABELS[ev.code] ?? `Souris ${ev.code}`;
  return padLabel(ev.code, settings.padStyle);
}

export function formatDuration(ms, unit) {
  if (unit === 'frames') return `${Math.round(ms / (1000 / 60))}f`;
  return ms >= 10000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

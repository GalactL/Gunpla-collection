import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// WCAG 2.x relative luminance and contrast ratio.
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrast = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const css = readFileSync(new URL('../../public/app.css', import.meta.url), 'utf8');
const tokens = (block) => Object.fromEntries([...block.matchAll(/--([\w-]+):(#[0-9A-Fa-f]{6})/g)].map((m) => [m[1], m[2]]));
const light = tokens(css.match(/:root\{([^}]*)\}/)[1]);
const dark = { ...light, ...tokens(css.match(/prefers-color-scheme:dark\)\{\s*:root\{([^}]*)\}/)[1]) };

// [foreground, background, minimum]: 4.5 for text, 3 for non-text (focus ring, active underline, borders).
const PAIRS = [
  ['ink', 'paper', 4.5], ['ink', 'tray', 4.5], ['ink', 'card', 4.5],
  ['ink-2', 'paper', 4.5], ['ink-2', 'tray', 4.5],
  ['ink-2', 'card', 4.5], // also placeholder text: ::placeholder uses ink-2 on the card-coloured fields

  ['red', 'paper', 4.5], ['red', 'card', 4.5], ['on-red', 'red', 4.5],
  ['blue', 'paper', 4.5], ['on-blue', 'blue', 4.5],
  ['on-yellow', 'yellow', 4.5], ['on-field', 'field', 4.5], ['paper', 'ink', 4.5],
  ['blue', 'paper', 3], ['blue', 'tray', 3], ['red', 'paper', 3], ['red', 'tray', 3], ['ink-2', 'paper', 3],
];

test('contraste AA de chaque paire de tokens, thèmes clair et sombre', (t) => {
  assert.ok(Object.keys(light).length >= 13 && dark.paper !== light.paper, 'both token blocks parsed');
  for (const [name, theme] of [['clair', light], ['sombre', dark]]) {
    for (const [fg, bg, min] of PAIRS) {
      const r = contrast(theme[fg], theme[bg]);
      t.diagnostic(`${name} ${fg} (${theme[fg]}) / ${bg} (${theme[bg]}) = ${r.toFixed(2)}:1 (min ${min})`);
      assert.ok(r >= min, `${name}: ${fg} on ${bg} = ${r.toFixed(2)} < ${min}`);
    }
  }
});

test('placeholder : ink-2 opaque (le gris par défaut du navigateur, #757575, tombe sous 4,5 sur card)', () => {
  assert.match(css, /::placeholder\{color:var\(--ink-2\);opacity:1\}/);
  assert.ok(contrast('#757575', light.card) < 4.5 && contrast('#757575', dark.card) < 4.5);
});

test('contrast() : valeurs de référence', () => {
  assert.equal(contrast('#000000', '#FFFFFF').toFixed(2), '21.00');
  assert.equal(contrast('#FFFFFF', '#FFFFFF'), 1);
  assert.equal(contrast('#767676', '#FFFFFF').toFixed(2), '4.54');
});

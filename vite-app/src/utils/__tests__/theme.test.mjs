// node --test src/utils/__tests__/theme.test.mjs   (from vite-app/)
// The themes the app's top bar and the backer page's both step through (utils/theme.js), and that
// the places which repeat them (the head script in index.html, the Icon set) have not drifted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  THEME_KEY, THEME_ORDER, THEME_ICON, THEME_LABEL, THEME_META, isDarkTheme,
  nextTheme, nextThemeLabel, storedTheme, deviceTheme, themeOrder,
} from '../theme.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(here, rel), 'utf8');

test('the order is dark, dusk, light, cloudy, then the experimental Swiss pair, and the key is the app\'s "theme"', () => {
  assert.deepEqual(THEME_ORDER, ['dark', 'dusk', 'light', 'cloudy', 'swiss-light', 'swiss-dark']);
  assert.equal(THEME_KEY, 'theme');
});

test('every theme has an icon, a label and a theme-color, and nothing else does', () => {
  for (const map of [THEME_ICON, THEME_LABEL, THEME_META]) assert.deepEqual(Object.keys(map).sort(), [...THEME_ORDER].sort());
  assert.deepEqual(THEME_ORDER.filter(isDarkTheme), ['dark', 'dusk', 'swiss-dark']);
});

test('the button of an admin steps through all six and wraps', () => {
  assert.equal(nextTheme('dark', true), 'dusk');
  assert.equal(nextTheme('cloudy', true), 'swiss-light');
  assert.equal(nextTheme('swiss-light', true), 'swiss-dark');
  assert.equal(nextTheme('swiss-dark', true), 'dark');
  let t = 'light';
  const seen = [];
  for (let i = 0; i < THEME_ORDER.length; i++) { t = nextTheme(t, true); seen.push(t); }
  assert.deepEqual(seen, ['cloudy', 'swiss-light', 'swiss-dark', 'dark', 'dusk', 'light']);     // six presses, back where it started
  assert.equal(nextTheme('nonsense', true), 'dark');                    // an unknown value steps to the first
});

test('everyone else steps through the four, never into Swiss', () => {
  assert.deepEqual(themeOrder(), ['dark', 'dusk', 'light', 'cloudy']);
  assert.equal(nextTheme('light'), 'cloudy');
  assert.equal(nextTheme('cloudy'), 'dark');
  assert.equal(nextTheme('swiss-light'), 'dark');      // a Swiss theme left stored steps out of it
  assert.equal(nextTheme('nonsense'), 'dark');
});

test('the label names the theme the button switches to', () => {
  assert.equal(nextThemeLabel('dark'), 'Dusk');
  assert.equal(nextThemeLabel('dusk'), 'Light');
  assert.equal(nextThemeLabel('light'), 'Cloudy');
  assert.equal(nextThemeLabel('cloudy'), 'Dark');
  assert.equal(nextThemeLabel('cloudy', true), 'Swiss light');
  assert.equal(nextThemeLabel('swiss-light', true), 'Swiss dark');
  assert.equal(nextThemeLabel('swiss-dark', true), 'Dark');
});

test('a stored value counts only if it names a theme', () => {
  for (const t of THEME_ORDER) assert.equal(storedTheme(t), t);
  for (const bad of [null, undefined, '', 'Dark', 'blue', 'constructor', '__proto__', 'toString', 0, {}, ['dark']]) {
    assert.equal(storedTheme(bad), null, String(bad));
  }
});

test('a device with no choice gets its scheme', () => {
  assert.equal(deviceTheme(true), 'light');
  assert.equal(deviceTheme(false), 'dark');
});

test('index.html\'s head script knows the same six theme-colors, and gives /b/ the stored theme first', () => {
  const html = read('../../../index.html');
  const m = /var mc = \{([^}]*)\}/.exec(html);
  assert.ok(m, 'the head script has a theme-color map');
  const map = Object.fromEntries([...m[1].matchAll(/'?([\w-]+)'?:'(#[0-9a-fA-F]{6})'/g)].map((x) => [x[1], x[2]]));
  assert.deepEqual(map, THEME_META);
  // The backer branch uses a stored theme (one of mc's keys) before the device's scheme.
  assert.match(html, /t = stored && Object\.prototype\.hasOwnProperty\.call\(mc, stored\) \? stored : \(mm\('\(prefers-color-scheme: light\)'\)/);
});

test('every theme\'s icon exists in the Icon set', () => {
  const icons = read('../../components/Icon.jsx');
  for (const name of Object.values(THEME_ICON)) assert.match(icons, new RegExp(String.raw`\b${name}:\s*\{`), name);
});

test('utils.js still re-exports the names the app imports from it', () => {
  const u = read('../utils.js');
  assert.match(u, /export \{ THEME_ORDER, isDarkTheme, THEME_ICON, THEME_LABEL, THEME_META \} from '\.\/theme\.js'/);
});

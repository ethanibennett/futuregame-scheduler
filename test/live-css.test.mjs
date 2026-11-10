// futurega.me/live's generated stylesheet (vite-app/scripts/make-live-css.mjs; Laws of UX pick 13):
// what it keeps from styles.css, and that it stays a small part of it.
//   node --test test/live-css.test.mjs        (in npm run test:live-page)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { liveCss, selectorFits } from '../vite-app/scripts/make-live-css.mjs';

test('selectors: the page\'s classes, the tokens and the base elements stay; the app\'s go', () => {
  for (const s of [':root', '[data-theme="light"]', ':root:not([data-theme="light"])', 'html, body'.split(',')[1].trim(),
    '.top-bar-title h1', '.bp-top .btn-icon', '.btn-ghost:hover', '.btn:not(.btn-sm)', '#root', '.grid-dev-col',
    ':where(a, button, input):focus-visible', '[data-contrast="high"] .ctl']) {
    assert.ok(selectorFits(s), s);
  }
  for (const s of ['.cal-event-row', '.top-bar-actions .btn-icon', 'table td', 'input[type="email"]', '.btn.btn-sm',
    ':is([data-theme="light"],[data-theme="cloudy"]) .cal-action-btn', '#splash']) {
    assert.ok(!selectorFits(s), s);
  }
});

test('the generated sheet: tokens, fonts and the shell, under a tenth of styles.css', () => {
  const src = fs.readFileSync(new URL('../vite-app/src/styles.css', import.meta.url), 'utf8');
  const out = liveCss(src);
  assert.match(out, /--gu:/);
  assert.match(out, /--subrow:/);
  assert.match(out, /@font-face/);
  assert.match(out, /\.top-bar\s*\{/);
  assert.match(out, /\.btn-icon/);
  assert.doesNotMatch(out, /\.cal-event-row/);
  assert.ok(out.length < src.length / 10, `${out.length} of ${src.length}`);
});

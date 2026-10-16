// The Swiss theme's typographic corrections (catalogue item 15, "Real punctuation"; owner,
// 2026-10-16): while data-theme is swiss-light or swiss-dark, text on screen gets a true minus in
// losses and axes (−$125), an en dash in month ranges (Oct–Dec), hair spaces around the slashes in
// blinds (2k / 3k / 3k) and real apostrophes. Every other theme is untouched: a node's original
// text is kept and put back when the theme changes away.
//
// It edits text nodes in place, which React tolerates: React compares the strings it rendered, not
// the DOM, so an unchanged string is left as we set it, and a changed one is set fresh and fixed
// again by the observer.

const MONTHS = 'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec';
const RANGE = new RegExp(`\\b(${MONTHS})-(${MONTHS})\\b`, 'gi');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'CODE', 'PRE', 'SVG']);

/** The corrected form of one string (pure: test/swiss-typography.test.mjs). */
export function swissText(s) {
  if (!s || s.length < 2) return s;
  return s
    .replace(/(^|[\s(·])-(?=[$€£¥]|\d)/g, '$1−')
    .replace(RANGE, (m, a, b) => `${cap(a)}–${cap(b)}`)
    .replace(/(\d(?:\.\d+)?[kKmM]?)\/(?=\d)/g, '$1 / ')
    .replace(/([A-Za-z])'([A-Za-z])/g, '$1’$2');
}

const isSwiss = () => (document.documentElement.getAttribute('data-theme') || '').startsWith('swiss');

export function installSwissTypography() {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
  const original = new WeakMap();   // text node -> the text React wrote
  const touched = new Set();
  let on = false;

  const fix = (node) => {
    const p = node.parentNode;
    if (!p || SKIP.has(p.nodeName) || p.isContentEditable) return;
    const now = node.nodeValue;
    const want = swissText(now);
    if (want === now) return;
    original.set(node, now);
    touched.add(node);
    node.nodeValue = want;
  };
  const walk = (root) => {
    if (root.nodeType === 3) { fix(root); return; }
    if (root.nodeType !== 1 || SKIP.has(root.nodeName)) return;
    const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = it.nextNode(); n; n = it.nextNode()) fix(n);
  };
  const restore = () => {
    for (const n of touched) {
      const o = original.get(n);
      if (o != null && n.isConnected && n.nodeValue === swissText(o)) n.nodeValue = o;
    }
    touched.clear();
  };

  const mo = new MutationObserver((records) => {
    if (!on) return;
    for (const r of records) {
      if (r.type === 'characterData') fix(r.target);
      else r.addedNodes.forEach(walk);
    }
  });
  const sync = () => {
    const want = isSwiss();
    if (want === on) return;
    on = want;
    if (on) {
      walk(document.body);
      mo.observe(document.body, { subtree: true, childList: true, characterData: true });
    } else {
      mo.disconnect();
      restore();
    }
  };
  new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  if (document.body) sync(); else document.addEventListener('DOMContentLoaded', sync, { once: true });
}

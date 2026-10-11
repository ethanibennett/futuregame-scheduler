/* Content-sized pills on the grid (owner rule, 2026-10-10: every pill and button's box is whole g
 * wide, its label centred in it).
 *
 * Most controls get a fixed width in g where they are styled, because their label is fixed. A few
 * hold text that varies — a username, a count — and CSS cannot round an intrinsic width up to a
 * whole g (no round() over max-content in WebKit). Those carry the class `snap-g`, and this sizes
 * them (snap-g-centred: with the parity of its parent, for a box centred in it): the width the
 * content asks for, rounded UP to a whole g, written as calc(var(--gu) * n) so
 * it keeps scaling with g between measurements. A max-width still caps it; give the max a whole-g
 * value too.
 *
 * App-wide by observation, so an element opts in with the class alone: a new `snap-g` element is
 * sized when it mounts, again when its own text or children change, and all of them on resize and
 * once the webfonts have loaded (Univers Condensed is narrower than its fallback).
 */
const watched = new WeakMap(); // element -> its MutationObserver

function unitG() {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;visibility:hidden;width:calc(var(--gu) * 100);height:0';
  document.body.appendChild(probe);
  const g = probe.getBoundingClientRect().width / 100;
  probe.remove();
  return g;
}

function snap(el, g = unitG()) {
  if (!el.isConnected || !g) return;
  // The content's own width, measured at max-content: as a flex item with overflow hidden it
  // could be squeezed below that (its automatic minimum is 0), truncating the label it holds.
  el.style.width = 'max-content';
  const w = el.getBoundingClientRect().width;
  el.style.width = '';
  if (!w) return; // not rendered (display:none) — sized when it next changes
  // 0.02g of slack, so a width that is already whole does not round up a column on float noise.
  let n = Math.max(1, Math.ceil(w / g - 0.02));
  // snap-g-centred: a box centred in its parent. Both its edges land on g lines only when its
  // width and the parent's content width (35g on a phone) are both odd or both even, so the
  // count takes the parent's parity.
  if (el.classList.contains('snap-g-centred') && el.parentElement) {
    const ps = getComputedStyle(el.parentElement);
    const inner = el.parentElement.clientWidth - parseFloat(ps.paddingLeft) - parseFloat(ps.paddingRight);
    const pn = Math.round(inner / g);
    if (Math.abs(inner / g - pn) < 0.05 && (pn - n) % 2) n += 1;
  }
  el.style.width = `calc(var(--gu) * ${n})`;
}

function watch(el) {
  if (watched.has(el)) return;
  const mo = new MutationObserver(() => snap(el));
  mo.observe(el, { childList: true, characterData: true, subtree: true });
  watched.set(el, mo);
  snap(el);
}

const SEL = '.snap-g, .snap-g-centred';

function scan(root) {
  if (root.nodeType !== 1) return;
  if (root.matches(SEL)) watch(root);
  root.querySelectorAll(SEL).forEach(watch);
}

function snapAll() {
  const g = unitG();
  document.querySelectorAll(SEL).forEach(el => snap(el, g));
}

export function installGridSnap() {
  if (typeof document === 'undefined' || !document.body) return;
  new MutationObserver((records) => {
    for (const r of records) r.addedNodes.forEach(scan);
  }).observe(document.body, { childList: true, subtree: true });
  scan(document.body);
  window.addEventListener('resize', snapAll);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(snapAll);
}

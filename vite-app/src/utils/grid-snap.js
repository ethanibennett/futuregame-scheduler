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
  // …but never narrower than the content as laid out (WebKit floors a box to 1/64px): the slack
  // let a 58.31px name into a 58.11px box, and its ellipsis cut "ham5" to "ha…".
  if (Math.floor(n * g * 64) / 64 < w) n += 1;
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

// A computed colour's alpha: rgba(…, a), color(… / a), oklch(… / a); anything else is opaque.
function alphaOf(c) {
  if (!c || c === 'transparent') return 0;
  const m = c.match(/\/\s*([\d.]+%?)\s*\)$/) || c.match(/^rgba\([^)]*,\s*([\d.]+)\s*\)$/);
  if (!m) return 1;
  return m[1].endsWith('%') ? parseFloat(m[1]) / 100 : parseFloat(m[1]);
}

function unitR() {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;visibility:hidden;width:0;height:calc(var(--subrow) * 100)';
  document.body.appendChild(probe);
  const r = probe.getBoundingClientRect().height / 100;
  probe.remove();
  return r;
}

/* snap-place: a box CENTRED by its parent — a dialog on a flex backdrop — lands wherever centring
 * puts it, which is half an r off a line whenever its height and the window's differ in parity
 * (and half a g off on a desktop shell of the other parity). CSS cannot round a position that
 * depends on the box's own content height, so this measures it and moves it (by position:relative
 * offsets in flow, by its margins when it is fixed or absolute; under half a g and half an r)
 * until its left edge is on a g line counted from the .app-shell's left (inside an opaque fixed
 * sheet, that sheet's left) and its top on an r line counted from the .top-bar's top — the
 * guard's and the grid overlay's origin. Its insides, sized in whole g and r, then fall on the
 * lines too.
 * Re-placed when its content changes (a wizard's next step), on resize and once fonts load. */
function place(el, g = unitG(), r = unitR()) {
  if (!el.isConnected || !g || !r) return;
  // Not while it (or anything around it) is animating in: a box measured mid-slide would keep the
  // wrong offset. Placed again once those animations end.
  if (typeof document.getAnimations === 'function') {
    const moving = document.getAnimations().filter(a => a.playState === 'running' && a.effect && a.effect.target
      && a.effect.target.nodeType === 1 && a.effect.target.contains(el)
      && a.effect.getComputedTiming().endTime !== Infinity);
    if (moving.length) { Promise.all(moving.map(a => a.finished.catch(() => {}))).then(() => place(el)); return; }
  }
  // A fixed or absolute box (centred by top/left 50% and a transform) moves by its margins; one in
  // flow (centred by its flex parent) by position:relative offsets, which leave the centring alone.
  const pos = getComputedStyle(el).position;
  const byMargin = pos === 'fixed' || pos === 'absolute';
  const [px, py] = byMargin ? ['marginLeft', 'marginTop'] : ['left', 'top'];
  el.style[px] = '';
  el.style[py] = '';
  if (pos === 'static') el.style.position = 'relative';
  const q = el.getBoundingClientRect();
  if (!q.width) return;
  const shell = document.querySelector('.app-shell');
  const bar = document.querySelector('.top-bar');
  // Inside a LAYER (an opaque fixed sheet or panel drawn over the app) the g lines run from the
  // layer's own left edge, as the grid guard counts them; elsewhere from the shell's.
  let layer = null;
  for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
    const s = getComputedStyle(a);
    if (s.position !== 'fixed' || (shell && a.contains(shell))) continue;
    if (alphaOf(s.backgroundColor) >= 0.95 || s.backgroundImage !== 'none') { layer = a; break; }
  }
  const ox = layer ? layer.getBoundingClientRect().left : shell ? shell.getBoundingClientRect().left : 0;
  const oy = bar ? bar.getBoundingClientRect().top : 0;
  const dx = Math.round((q.left - ox) / g) - (q.left - ox) / g;
  const dy = Math.round((q.top - oy) / r) - (q.top - oy) / r;
  if (Math.abs(dx) > 1e-3) el.style[px] = `calc(var(--gu) * ${dx.toFixed(4)})`;
  if (Math.abs(dy) > 1e-3) el.style[py] = `calc(var(--subrow) * ${dy.toFixed(4)})`;
}

const fit = (el) => (el.classList.contains('snap-place') ? place(el) : snap(el));

// A placed box also moves when its own size changes without a DOM change (a webfont arriving
// after first paint re-flows its text): a ResizeObserver catches that. Placing it changes only its
// offset, never its size, so this cannot loop.
const ro = typeof ResizeObserver === 'function' ? new ResizeObserver((entries) => entries.forEach(e => place(e.target))) : null;

function watch(el) {
  if (watched.has(el)) return;
  const mo = new MutationObserver(() => fit(el));
  mo.observe(el, { childList: true, characterData: true, subtree: true });
  watched.set(el, mo);
  if (ro && el.classList.contains('snap-place')) ro.observe(el);
  fit(el);
}

const SEL = '.snap-g, .snap-g-centred, .snap-place';

function scan(root) {
  if (root.nodeType !== 1) return;
  if (root.matches(SEL)) watch(root);
  root.querySelectorAll(SEL).forEach(watch);
}

function snapAll() {
  const g = unitG();
  document.querySelectorAll('.snap-g, .snap-g-centred').forEach(el => snap(el, g));
  // After the sizes: a placed box centres on what is inside it.
  const r = unitR();
  document.querySelectorAll('.snap-place').forEach(el => place(el, g, r));
}

export function installGridSnap() {
  if (typeof document === 'undefined' || !document.body) return;
  new MutationObserver((records) => {
    for (const r of records) r.addedNodes.forEach(scan);
  }).observe(document.body, { childList: true, subtree: true });
  scan(document.body);
  window.addEventListener('resize', snapAll);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(snapAll);
  // A face first used after start-up (a screen that opens later) loads then, after `ready`.
  if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', snapAll);
}

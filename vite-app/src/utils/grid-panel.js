// ── Grid placement for portalled panels (the home's dropdowns and menus) ──
// Moved out of DashboardView.jsx (2026-10-12) so the home's sections share it.
// g is read from a 100g probe (what --gu really resolves to), r = 0.71g, and the origin is the top
// bar (the grid overlay's origin). A panel's top is snapped to a whole r from the bar (1r below /
// above its trigger) and emitted as calc() in r, its left edge as calc() in g on a column line;
// nothing is written in px.
export function gridGeom() {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;visibility:hidden;height:0;width:calc(var(--gu) * 100)';
  document.body.appendChild(probe);
  const G = probe.getBoundingClientRect().width / 100;
  probe.remove();
  const barTop = document.querySelector('.top-bar')?.getBoundingClientRect().top || 0;
  return { G, R: G * 0.71, barTop };
}

// anchorRect: the trigger's client rect. heightR: the panel's height in r. leftG: its left edge in
// g from the viewport's left, which lands on a grid line when it is measured from an element that
// is on one (the trigger's left, or its right less the panel's whole-g width).
export function gridPanelStyle(anchorRect, heightR, leftG) {
  const { R, barTop } = gridGeom();
  const openAbove = anchorRect.top > window.innerHeight / 2;
  const topR = openAbove
    ? Math.round((anchorRect.top - barTop) / R) - 1 - heightR
    : Math.round((anchorRect.bottom - barTop) / R) + 1;
  const barR = barTop / R; // 0 when the bar sits at the viewport top
  return {
    position: 'fixed',
    left: `calc(var(--gu) * ${+leftG.toFixed(4)})`,
    top: `calc(var(--subrow) * ${+(topR + barR).toFixed(4)})`,
    transform: 'none',
  };
}

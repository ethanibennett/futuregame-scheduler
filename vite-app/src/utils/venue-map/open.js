import React from 'react';
import { createRoot } from 'react-dom/client';
import { hasVenueMap } from '../venue-place.js';

/* Opens the venue map for an event (docs/venue-map.md): what a venue strip on an event card does.
 *
 * The popup is its own small React root in a node appended to <body> — portalled out of every
 * card, pane and stacking context — so any strip can open it without a host component or a hook
 * (the Schedule list's lite rows have none). Its code, stylesheet and map providers are loaded
 * on the first open (a dynamic import), so none of it is in the main bundle. One popup at a time;
 * closing it returns focus to the strip that opened it.
 */
let current = null;

export function openVenueMap(event, trigger) {
  if (!hasVenueMap(event) || typeof document === 'undefined') return;
  if (current) current.close(false);
  const host = document.createElement('div');
  host.className = 'vm-host';
  document.body.appendChild(host);
  let root = null;
  let closed = false;
  const close = (restoreFocus = true) => {
    if (closed) return;
    closed = true;
    if (current && current.close === close) current = null;
    if (root) root.unmount();
    host.remove();
    if (restoreFocus && trigger && trigger.isConnected && typeof trigger.focus === 'function') trigger.focus({ preventScroll: true });
  };
  current = { close };
  import('../../components/VenueMapSheet.jsx').then((m) => {
    if (closed) return;
    root = createRoot(host);
    root.render(React.createElement(m.default, { event, onClose: () => close(true) }));
  }).catch(() => close(true));
}

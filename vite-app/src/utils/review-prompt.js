// The App Store ratings prompt (launch plan §12, 2026-10-15): ask after the third saved event or after
// a logged bag, never after a bust. Apple shows the system sheet at most three times a year whatever
// we ask; we also wait 120 days between asks and an hour after a bust. The native call goes through
// an InAppReview Capacitor plugin (SKStoreReviewController / AppStore.requestReview), which the Mac
// adds (handoff #279); until it exists this does nothing, and on the web it never asks.
import { Capacitor, registerPlugin } from '@capacitor/core';

const KEY = 'reviewPrompt';
const GAP_MS = 120 * 864e5;
const AFTER_BUST_MS = 3600e3;

/** Pure: the next state after a moment ('saved' | 'bagged' | 'busted'), and whether to ask now. */
export function nextReviewState(state, kind, now = Date.now()) {
  const s = { saves: 0, lastAskedAt: 0, lastBustAt: 0, ...(state || {}) };
  if (kind === 'busted') return { state: { ...s, lastBustAt: now }, ask: false };
  const next = kind === 'saved' ? { ...s, saves: s.saves + 1 } : s;
  const moment = (kind === 'saved' && next.saves === 3) || kind === 'bagged';
  const quiet = (!next.lastAskedAt || now - next.lastAskedAt >= GAP_MS) && (!next.lastBustAt || now - next.lastBustAt >= AFTER_BUST_MS);
  if (moment && quiet) return { state: { ...next, lastAskedAt: now }, ask: true };
  return { state: next, ask: false };
}

let plugin = null;
function nativeReview() {
  try {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'ios') return null;
    if (!Capacitor.isPluginAvailable('InAppReview')) return null;
    plugin = plugin || registerPlugin('InAppReview');
    return plugin;
  } catch { return null; }
}

/** Record a moment; asks for a rating when it is the right one. Never throws. */
export function noteReviewMoment(kind) {
  try {
    let state = null;
    try { state = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { state = null; }
    const r = nextReviewState(state, kind);
    try { localStorage.setItem(KEY, JSON.stringify(r.state)); } catch { /* private mode */ }
    if (r.ask) { const p = nativeReview(); if (p) p.requestReview().catch(() => {}); }
  } catch { /* a ratings prompt must never break a save */ }
}

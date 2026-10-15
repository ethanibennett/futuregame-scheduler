// The live landing page's arithmetic (components/LivePage.jsx), pure so Node can test it.

/** The ad's campaign from ?ct=, or '' (letters, digits, dot, dash, underscore; at most 40). */
export function campaignFrom(search) {
  try {
    const ct = new URLSearchParams(search || '').get('ct') || '';
    return /^[A-Za-z0-9._-]{1,40}$/.test(ct) ? ct : '';
  } catch { return ''; }
}

/** The App Store link for a campaign: Apple's campaign link (pt = provider token, ct = campaign),
 *  or null until the server knows the app's id. */
export function storeLink(appStore, ct) {
  if (!appStore || !appStore.id || !appStore.pt) return null;
  return `https://apps.apple.com/app/apple-store/id${appStore.id}?pt=${encodeURIComponent(appStore.pt)}&ct=${encodeURIComponent(ct || 'live')}&mt=8`;
}

/** The web app, carrying the campaign so the sign-up can be credited to it. */
export function webLink(ct) {
  return ct ? `/?src=${encodeURIComponent(ct)}` : '/';
}

/** The figures card's two lines from GET /api/public/live-summary, or blanks while it loads. */
export function liveFigures(sum) {
  if (!sum || !(sum.events > 0)) return { headline: '', note: '' };
  const n = (x) => Number(x).toLocaleString('en-US');
  const s = (x, one, many) => `${n(x)} ${x === 1 ? one : many}`;
  return {
    headline: s(sum.events, 'live event', 'live events'),
    note: `in ${s(sum.series, 'series', 'series')}${sum.rooms > 0 ? ` at ${s(sum.rooms, 'room', 'rooms')}` : ''}`,
  };
}

/** Where this browser first came from, kept once (the first touch) for the sign-up to report:
 *  { ct, landing, ref (the referring host), at }. A blocked store just keeps nothing. */
export function rememberSource(ct, referrer, store = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  try {
    if (!store || store.getItem('acqSource')) return false;
    let ref = null;
    try { ref = referrer ? new URL(referrer).hostname : null; } catch { ref = null; }
    store.setItem('acqSource', JSON.stringify({ ct: ct || null, landing: 'live', ref, at: Date.now() }));
    return true;
  } catch { return false; }
}

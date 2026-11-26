// The play-money tables, the app's side (docs/play-money-platform.md §6). The scheduler (fetchApi) says whether
// tables are on, holds the chip balance and the invites, and issues a 2-minute seat ticket; the tables service
// (its own origin) trades the ticket for a table token, streams this player's view, and takes their actions.

import { fetchApi } from './api.js';

async function json(res) {
  let body = null;
  try { body = await res.json(); } catch { /* empty */ }
  if (!res.ok) {
    const err = new Error((body && body.error) || `The server answered ${res.status}`);
    err.status = res.status; err.body = body;
    throw err;
  }
  return body;
}

export const tablesApi = {
  availability: () => fetchApi('/tables/availability').then(json),
  chips: () => fetchApi('/tables/chips').then(json),
  list: () => fetchApi('/tables').then(json),
  create: (body) => fetchApi('/tables', { method: 'POST', body }).then(json),
  invite: (token) => fetchApi(`/tables/invite/${encodeURIComponent(token)}`).then(json),
  accept: (token) => fetchApi(`/tables/invite/${encodeURIComponent(token)}/accept`, { method: 'POST' }).then(json),
  ticket: (id) => fetchApi(`/tables/${encodeURIComponent(id)}/ticket`, { method: 'POST' }).then(json),
  close: (id) => fetchApi(`/tables/${encodeURIComponent(id)}/close`, { method: 'POST' }).then(json),
  report: (id, msgId, text) => fetchApi(`/tables/${encodeURIComponent(id)}/report`, { method: 'POST', body: { msgId, text } }).then(json),
  // Everyone blocked either way (lib/safety.js): their table messages are not shown.
  hidden: () => fetchApi('/blocks').then(json).then((d) => new Set((d && d.hidden) || [])),
};

/* The invite a play.futurega.me/join/<token> link carried, kept until the lobby takes it (across a sign-in). */
const PENDING = 'pendingTableInvite';
export function rememberTableInvite(pathname) {
  const m = /^\/join\/([A-Za-z0-9_-]{16,64})$/.exec(pathname || '');
  if (m) { try { sessionStorage.setItem(PENDING, m[1]); } catch { /* storage off */ } }
  return m ? m[1] : null;
}
export function takeTableInvite() {
  try { const v = sessionStorage.getItem(PENDING); sessionStorage.removeItem(PENDING); return v; } catch { return null; }
}

/**
 * A seat at one table: join with a fresh ticket, follow the stream, act. onView gets every view the service
 * sends (the whole view each time, so a missed one costs nothing). The stream reconnects with a new ticket
 * when it drops (a phone locked, a network change), and the next view brings the table back as it is.
 */
export function openTable(tableId, { onView, onStatus }) {
  let closed = false;
  let es = null;
  let base = null;
  let token = null;
  let retry = null;

  const call = async (path, body) => {
    const res = await fetch(`${base}/tables/${encodeURIComponent(tableId)}/${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body || {}),
    });
    return json(res);
  };

  async function connect() {
    if (closed) return;
    onStatus && onStatus('connecting');
    try {
      const t = await tablesApi.ticket(tableId);
      base = t.url;
      const res = await fetch(`${base}/tables/${encodeURIComponent(tableId)}/join`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ticket: t.ticket }),
      });
      const j = await json(res);
      if (closed) return;
      token = j.token;
      onView(j.view);
      es = new EventSource(`${base}/tables/${encodeURIComponent(tableId)}/events?token=${encodeURIComponent(token)}`);
      es.addEventListener('view', (e) => { try { onView(JSON.parse(e.data)); } catch { /* a bad frame: the next one carries all of it */ } });
      es.onopen = () => onStatus && onStatus('live');
      es.onerror = () => {
        if (closed) return;
        es.close(); es = null;
        onStatus && onStatus('reconnecting');
        retry = setTimeout(connect, 2000);
      };
    } catch (e) {
      if (closed) return;
      onStatus && onStatus(e.status === 404 ? 'gone' : 'reconnecting', e.message);
      if (e.status !== 404) retry = setTimeout(connect, 4000);
    }
  }
  connect();

  return {
    act: (move) => call('act', move),
    sit: (seat, buyIn) => call('sit', { seat, buyIn }),
    rebuy: (amount) => call('rebuy', { amount }),
    sitOut: () => call('sit-out'),
    sitIn: () => call('sit-in'),
    // Waiting for the big blind: post one to come in at once (true), or wait again (false).
    post: (on) => call('post', { on }),
    leave: () => call('leave'),
    // A table made with the start gate: deal the first hand (the host, or anyone seated while the host is not).
    start: () => call('start'),
    say: (text) => call('chat', { text }),
    mute: (userId, muted) => call('mute', { userId, muted }),
    close() { closed = true; clearTimeout(retry); if (es) es.close(); },
  };
}

/* The service's view of the hand, cut to the streets dealt so far, as the replayer reads a hand being played
   (the drill does the same: a street that has not come is not in the hand). */
export function liveReplayHand(view) {
  if (!view || !view.hand) return null;
  const { hand, live } = view.hand;
  const upTo = live.si;
  return { ...hand, streets: hand.streets.slice(0, upTo + 1) };
}

export const chips = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });

// ── A sit and go in words (lib/tables/sng.mjs does the arithmetic; the view carries its results) ──
/* "1st", "2nd", "3rd", "4th" … */
export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
/* The prizes: "1st 4,000 · 2nd 2,400 · 3rd 1,600". */
export const prizesText = (prizes) => (prizes || []).map((p, i) => `${ordinal(i + 1)} ${chips(p)}`).join(' · ');
/* One place: "3rd Casey +1,600"; a share of a called-off game's pool: "Casey +2,250". */
export const placeText = (p) => `${p.place ? `${ordinal(p.place)} ` : ''}${p.name}${p.prize ? ` +${chips(p.prize)}` : ''}`;
/* Minutes and seconds: "4:07". */
export function clockText(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
/* The level line under a sit and go's felt: "Level 3 · 25/50 · 50/100 in 4:07" (the stakes in the table's words). */
export function levelText(sng, stakes, nextStakes, leftMs) {
  if (!sng) return '';
  const lv = `Level ${sng.level}${sng.clockLevel > sng.level ? ` · level ${sng.clockLevel} next hand` : ''}`;
  const next = nextStakes && leftMs != null && sng.clockLevel === sng.level ? ` · ${nextStakes} in ${clockText(leftMs)}` : '';
  return `${lv} · ${stakes}${next}`;
}

/* The words of the result for this player, once the hand is over. */
export function resultLine(view) {
  const h = view && view.hand;
  if (!h || !h.live.over || !h.live.result) return '';
  const names = h.hand.players.map((p) => p.name);
  const won = h.live.result.won.map((w, p) => [p, w]).filter(([, w]) => w > 0);
  if (h.you >= 0) {
    const net = h.live.result.net[h.you];
    if (net > 0) return `You win ${chips(net)}`;
    if (won.length) return `${won.map(([p]) => names[p]).join(' and ')} ${won.length > 1 ? 'split the pot' : 'wins'}`;
  }
  return won.length ? `${won.map(([p]) => names[p]).join(' and ')} ${won.length > 1 ? 'split' : 'wins'} ${chips(won.reduce((s, [, w]) => s + w, 0))}` : '';
}

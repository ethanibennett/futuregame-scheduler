/**
 * The event being played on the lock screen (Features 10, 2026-11-11): the native LiveActivity plugin
 * (ios/App/App/AppDelegate.swift), started when a run starts, updated when the level, blinds or stack move,
 * ended at a bust, a bag or Finish. The level's end goes as a time, so the lock screen counts it down itself.
 * Nothing happens off the iPhone app, or where the player has turned Live Activities off (the request then fails).
 *
 * The activity is drawn in the app's design scheme (owner, 2026-11-15; ios/App/FuturegameWidgets): the start
 * sends the venue band's colour and name, as Home's playing card shows them, and the chosen theme's colours,
 * each resolved to #rrggbb here, since the widget cannot read CSS.
 *
 * A running cash session is on it too (owner, 2026-11-18: "Live activity should reflect cash games too"), as Home's
 * cash card draws it, and before a tournament run, since that card leads Home's carousel: the room on the band, the
 * game and stakes as the name with when it started under it, then the session's clock (counting up on the lock
 * screen by itself, from the start), what is in play, and the last stack against what went in. Figures go as the
 * card's own text (the session's currency), since the widget has no money formatting of its own.
 */
import { cashCard } from './home-upnext.js';
import { fmtMoney } from './home.js';

let lastKey = null;
let running = false;

function plugin() {
  try {
    const C = window.Capacitor;
    if (!C || !C.isNativePlatform || !C.isNativePlatform() || !C.registerPlugin) return null;
    if (C.isPluginAvailable && !C.isPluginAvailable('LiveActivity')) return null;
    return C.registerPlugin('LiveActivity');
  } catch { return null; }
}

/** Any CSS colour (a hex, rgb(), or var(--token, fallback)) as #rrggbb, by the browser's own resolution. */
export function cssColorHex(css) {
  if (!css || typeof document === 'undefined' || !document.body) return undefined;
  try {
    const el = document.createElement('span');
    el.style.display = 'none';
    el.style.color = css;
    if (!el.style.color) return undefined;   // not a colour: the browser kept nothing, and it would inherit the text's
    document.body.appendChild(el);
    const c = getComputedStyle(el).color;
    el.remove();
    const m = String(c).match(/[\d.]+/g);
    if (!m || m.length < 3) return undefined;
    return '#' + m.slice(0, 3).map(v => Math.max(0, Math.min(255, Math.round(+v))).toString(16).padStart(2, '0')).join('');
  } catch { return undefined; }
}

/** The chosen theme's colours the widget draws with: the card, its stat boxes, the text and the muted text. */
function themePalette() {
  const out = {};
  for (const [key, token] of [['surface', '--surface'], ['panel', '--surface2'], ['text', '--text'], ['muted', '--text-muted']]) {
    const hex = cssColorHex(`var(${token})`);
    if (hex) out[key] = hex;
  }
  return out;
}

/**
 * The running cash session as a `play` for syncLiveActivity, or null. session/stacks: the live session store's
 * (hooks/useLiveCashSession). opts.skew: the server's clock less this device's (ms), so the lock screen's clock
 * counts from the start on this device's clock. opts.cur: the session currency's CURRENCY_CONFIG entry.
 * opts.strip: the room's band colour.
 */
export function cashPlay(session, stacks, opts = {}) {
  const c = cashCard(session, stacks);
  const start = c ? Date.parse(session.started_at) : NaN;
  if (!c || !Number.isFinite(start)) return null;
  const cur = opts.cur || null;
  const money = (v) => fmtMoney(v, cur);
  const since = new Date(start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const skew = Number(opts.skew) || 0;
  return {
    id: `cash-${c.id}`, kind: 'cash',
    event: c.name, room: c.room,
    strip: opts.strip, stripLabel: c.room || 'Cash game',
    startedAt: Math.round((start - skew) / 1000) * 1000,
    inPlay: money(c.inPlay),
    stackText: c.stack == null ? '' : money(c.stack),
    stackLabel: c.stack == null ? 'No update yet' : `Stack ${fmtMoney(c.result, cur, { signed: true })}`,
    result: c.stack == null ? '' : fmtMoney(c.result, cur, { signed: true }),
    note: `Since ${since}${c.rebuys ? ` · ${c.rebuys} rebuy${c.rebuys === 1 ? '' : 's'}` : ''}`,
  };
}

/**
 * play: { id, event, room, strip (a CSS colour), stripLabel, level, blinds, levelEndsAt (ms), stack, bigBlinds,
 * lateRegClosesAt (ms) }, or a cash session's (cashPlay: kind 'cash', startedAt (ms), inPlay, stackText, stackLabel,
 * result, note), or null.
 */
export async function syncLiveActivity(play) {
  const p = plugin();
  if (!p) return;
  try {
    if (!play) {
      if (running) { running = false; lastKey = null; await p.end(); }
      return;
    }
    const key = [play.id, play.level, play.blinds, play.stack, play.levelEndsAt ? Math.round(play.levelEndsAt / 60000) : 0,
      play.startedAt || 0, play.inPlay, play.stackText, play.stackLabel, play.note].join('|');
    if (key === lastKey) return;
    const state = {
      level: play.level || 0, blinds: play.blinds || '', levelEndsAt: play.levelEndsAt || 0, stack: play.stack || 0,
      bigBlinds: play.bigBlinds || undefined, lateRegClosesAt: play.lateRegClosesAt || 0,
      startedAt: play.startedAt || 0, inPlay: play.inPlay || undefined, stackText: play.stackText || undefined,
      stackLabel: play.stackLabel || undefined, result: play.result || undefined, note: play.note || undefined,
    };
    if (!running || (lastKey && lastKey.split('|')[0] !== String(play.id))) {
      await p.start({
        kind: play.kind || undefined, event: play.event, room: play.room || '',
        strip: cssColorHex(play.strip), stripLabel: play.stripLabel || undefined, palette: themePalette(),
        ...state,
      });
      running = true;
    } else {
      await p.update(state);
    }
    lastKey = key;
  } catch { /* the player turned Live Activities off, or iOS is older than 16.2 */ }
}

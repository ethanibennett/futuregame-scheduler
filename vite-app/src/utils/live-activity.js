/**
 * The event being played on the lock screen (Features 10, 2026-11-11): the native LiveActivity plugin
 * (ios/App/App/AppDelegate.swift), started when a run starts, updated when the level, blinds or stack move,
 * ended at a bust, a bag or Finish. The level's end goes as a time, so the lock screen counts it down itself.
 * Nothing happens off the iPhone app, or where the player has turned Live Activities off (the request then fails).
 *
 * The activity is drawn in the app's design scheme (owner, 2026-11-15; ios/App/FuturegameWidgets): the start
 * sends the venue band's colour and name, as Home's playing card shows them, and the chosen theme's colours,
 * each resolved to #rrggbb here, since the widget cannot read CSS.
 */
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

/** play: { id, event, room, strip (a CSS colour), stripLabel, level, blinds, levelEndsAt (ms), stack, bigBlinds, lateRegClosesAt (ms) } or null. */
export async function syncLiveActivity(play) {
  const p = plugin();
  if (!p) return;
  try {
    if (!play) {
      if (running) { running = false; lastKey = null; await p.end(); }
      return;
    }
    const key = [play.id, play.level, play.blinds, play.stack, play.levelEndsAt ? Math.round(play.levelEndsAt / 60000) : 0].join('|');
    if (key === lastKey) return;
    const state = { level: play.level || 0, blinds: play.blinds || '', levelEndsAt: play.levelEndsAt || 0, stack: play.stack || 0, bigBlinds: play.bigBlinds || undefined, lateRegClosesAt: play.lateRegClosesAt || 0 };
    if (!running || (lastKey && lastKey.split('|')[0] !== String(play.id))) {
      await p.start({
        event: play.event, room: play.room || '',
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

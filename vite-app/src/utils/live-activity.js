/**
 * The event being played on the lock screen (Features 10, 2026-11-11): the native LiveActivity plugin
 * (ios/App/App/AppDelegate.swift), started when a run starts, updated when the level, blinds or stack move,
 * ended at a bust, a bag or Finish. The level's end goes as a time, so the lock screen counts it down itself.
 * Nothing happens off the iPhone app, or until the Mac adds the widget extension (the request then fails).
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

/** play: { id, event, room, level, blinds, levelEndsAt (ms), stack, bigBlinds, lateRegClosesAt (ms) } or null. */
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
      await p.start({ event: play.event, room: play.room || '', ...state });
      running = true;
    } else {
      await p.update(state);
    }
    lastKey = key;
  } catch { /* no widget extension yet, or the player turned Live Activities off */ }
}

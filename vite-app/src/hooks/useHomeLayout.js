// Edit home: the signed-in user's home layout (utils/home-layout.js), loaded, cached and saved.
//
//   const { layout, set, flush, status } = useHomeLayout({ token, isGuest, userId });
//
// The first paint reads the localStorage cache ({ layout, dirty } under homeLayout:u<id>), so a
// returning user never sees the home reorder. Then GET /api/user/home-layout and reconcile: a
// change not yet saved (dirty) wins and is pushed; otherwise the server's copy is adopted (null is
// the default home). On a new device the default paints first and the server's layout lands once,
// one re-order: accepted.
// set() applies at once (state and cache, dirty) and PUTs after a 600 ms debounce; a success clears
// dirty. A failed PUT stays dirty and is retried on 'online', on the next load and on the next
// change. flush() sends a pending PUT now; on pagehide it goes with keepalive. Back in the
// foreground after 5 minutes with nothing dirty, it asks the server again; another tab's change
// arrives by the storage event. An answer is never allowed to undo a change made after its request
// went out (pull() compares versionRef): a slow load GET that comes back after the user edited and
// saved is dropped. Every localStorage access is guarded (private mode: memory and the
// server only). Guests: the default layout, no storage, no requests. The key is per user, so a
// sign-out needs nothing and one account never sees another's layout.
//
// status: 'synced'   nothing waiting, or a save under way while online
//         'pending'  a change waiting after its save failed (it is retried)
//         'offline'  a change waiting while the device is offline
import { useCallback, useEffect, useRef, useState } from 'react';
import { API_URL } from '../utils/api.js';
import { cacheKey, normalise, reconcile } from '../utils/home-layout.js';

const DEBOUNCE_MS = 600;
const STALE_MS = 5 * 60 * 1000;
const ENDPOINT = '/user/home-layout';

function readCache(key) {
  if (!key) return { layout: null, dirty: false };
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { layout: null, dirty: false };
    const j = JSON.parse(raw);
    return { layout: normalise(j && j.layout), dirty: !!(j && j.dirty) };
  } catch { return { layout: null, dirty: false }; }
}
function writeCache(key, layout, dirty) {
  if (!key) return;
  try { localStorage.setItem(key, JSON.stringify({ layout, dirty })); } catch { /* storage unavailable: memory and the server */ }
}
const onlineNow = () => (typeof navigator === 'undefined' || navigator.onLine !== false);

export default function useHomeLayout({ token, isGuest, userId }) {
  const key = !isGuest && token && userId != null ? cacheKey(userId) : null;
  const [st, setSt] = useState(() => ({ key, ...readCache(key), failed: false }));
  const [online, setOnline] = useState(onlineNow);
  // Another account (or signed out): its own cache, read before this render paints.
  let cur = st;
  if (st.key !== key) {
    cur = { key, ...readCache(key), failed: false };
    setSt(cur);
  }

  const keyRef = useRef(key);
  const tokenRef = useRef(token);
  const layoutRef = useRef(cur.layout);
  const dirtyRef = useRef(cur.dirty);
  const versionRef = useRef(0);   // bumped by every change, so a late answer never overwrites a newer one
  const timerRef = useRef(null);
  const inflightRef = useRef(false);
  const againRef = useRef(false);
  const lastGetRef = useRef(0);
  tokenRef.current = token;

  const commit = useCallback((patch) => setSt((s) => (s.key === keyRef.current ? { ...s, ...patch } : s)), []);

  const push = useCallback(async () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    const k = keyRef.current, t = tokenRef.current;
    if (!k || !t || !dirtyRef.current) return;
    if (inflightRef.current) { againRef.current = true; return; }
    const ver = versionRef.current;
    inflightRef.current = true;
    try {
      const r = await fetch(API_URL + ENDPOINT, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ layout: layoutRef.current }),
      });
      if (r.status >= 500) throw new Error(String(r.status));
      const j = await r.json().catch(() => null);
      if (keyRef.current !== k) return;
      if (!r.ok) {
        // Refused for good (a 4xx: the session went, or a document this server will not take):
        // retrying cannot help. The layout stays on this device.
        dirtyRef.current = false;
        writeCache(k, layoutRef.current, false);
        commit({ dirty: false, failed: false });
        return;
      }
      if (versionRef.current !== ver) return; // changed again meanwhile: that change is still dirty
      const stored = j ? normalise(j.layout) : null;
      layoutRef.current = stored;
      dirtyRef.current = false;
      writeCache(k, stored, false);
      commit({ layout: stored, dirty: false, failed: false });
    } catch {
      if (keyRef.current === k) commit({ failed: true });
    } finally {
      inflightRef.current = false;
      if (againRef.current) { againRef.current = false; if (dirtyRef.current) push(); }
    }
  }, [commit]);

  const pull = useCallback(async () => {
    const k = keyRef.current, t = tokenRef.current;
    if (!k || !t) return;
    lastGetRef.current = Date.now();
    const ver = versionRef.current;
    let server;
    try {
      const r = await fetch(API_URL + ENDPOINT, { headers: { Authorization: `Bearer ${t}` } });
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      server = j && j.layout !== undefined ? j.layout : null;
    } catch { server = undefined; }
    if (keyRef.current !== k) return;
    // The layout changed while this GET was on its way and that change is already saved (or came
    // from another tab): the answer was read before it, so it is older than what this device holds
    // and would put the home, the sheet and the cache back. A change still unsaved falls through:
    // reconcile keeps it and pushes it.
    if (versionRef.current !== ver && !dirtyRef.current) return;
    const { doc, push: mustPush } = reconcile({ local: { layout: layoutRef.current, dirty: dirtyRef.current }, server });
    if (server === undefined) return; // offline or failed: the local copy stands
    if (mustPush) { push(); return; }
    versionRef.current++;
    layoutRef.current = doc;
    dirtyRef.current = false;
    writeCache(k, doc, false);
    commit({ layout: doc, dirty: false, failed: false });
  }, [commit, push]);

  // A new account (or the first mount): the refs follow the cache just read, then the server.
  useEffect(() => {
    keyRef.current = key;
    layoutRef.current = cur.layout;
    dirtyRef.current = cur.dirty;
    versionRef.current++;
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (key) pull();
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = useCallback((doc) => {
    const d = doc ? normalise(doc) : null;
    const k = keyRef.current;
    versionRef.current++;
    layoutRef.current = d;
    dirtyRef.current = !!k;
    setSt((s) => ({ ...s, layout: d, dirty: !!k, failed: false }));
    if (!k) return; // a guest: memory only (and they get no Edit home)
    writeCache(k, d, true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(push, DEBOUNCE_MS);
  }, [push]);

  const flush = useCallback(() => {
    if (timerRef.current || dirtyRef.current) push();
  }, [push]);

  useEffect(() => {
    const goOnline = () => { setOnline(true); if (dirtyRef.current) push(); };
    const goOffline = () => setOnline(false);
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || !keyRef.current) return;
      if (!dirtyRef.current && Date.now() - lastGetRef.current > STALE_MS) pull();
    };
    // Leaving the page with a change unsent: send it anyway (keepalive outlives the page).
    const onHide = () => {
      if (!keyRef.current || !tokenRef.current || !dirtyRef.current) return;
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      try {
        fetch(API_URL + ENDPOINT, {
          method: 'PUT', keepalive: true,
          headers: { Authorization: `Bearer ${tokenRef.current}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ layout: layoutRef.current }),
        }).catch(() => {});
      } catch { /* the cache still says dirty: the next load pushes it */ }
    };
    // Another tab changed it: adopt that tab's layout (that tab saves it).
    const onStorage = (e) => {
      if (!keyRef.current || e.key !== keyRef.current) return;
      let next = null;
      try { next = e.newValue ? JSON.parse(e.newValue) : null; } catch { next = null; }
      versionRef.current++;
      layoutRef.current = next ? normalise(next.layout) : null;
      dirtyRef.current = false;
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      commit({ layout: layoutRef.current, dirty: false, failed: false });
    };
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pagehide', onHide);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('storage', onStorage);
    };
  }, [push, pull, commit]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const status = !cur.dirty ? 'synced' : !online ? 'offline' : cur.failed ? 'pending' : 'synced';
  return { layout: cur.layout, set, flush, status };
}

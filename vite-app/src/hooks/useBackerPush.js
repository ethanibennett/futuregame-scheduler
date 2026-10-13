import { useCallback, useEffect, useRef, useState } from 'react';
import { API_URL } from '../utils/api.js';

/**
 * Web push for a backer's page (/b/<token>): the opt-in the old server-rendered page had, as a
 * hook. The service worker is /b/sw.js, scoped to /b/ (server.js), and the subscription is stored
 * against the token by POST /api/backer/:token/subscribe; /unsubscribe removes it.
 *
 * state:
 *   'checking'     reading the current subscription
 *   'unsupported'  no service worker / PushManager / Notification here (iOS Safari outside a
 *                  Home Screen web app is the common case: `installHint` says so)
 *   'unavailable'  the server has no VAPID key, so it cannot push to anyone
 *   'blocked'      the browser's permission is denied; only its settings can change that
 *   'off' | 'on'   not subscribed / subscribed
 *   'busy'         a subscribe or unsubscribe in flight
 *
 * Permission is asked for inside the tap (enable), never on load: iOS drops a request that does
 * not come from a user gesture. requestPermission is called before anything is awaited, so the
 * gesture is still live when it runs.
 */
function urlB64(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const supported = () => typeof window !== 'undefined'
  && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export default function useBackerPush(token) {
  const [state, setState] = useState('checking');
  const [error, setError] = useState('');
  const key = useRef(null);

  const iosWeb = typeof document !== 'undefined' && document.documentElement.getAttribute('data-platform') === 'ios-web';
  const standalone = typeof window !== 'undefined' && (window.navigator.standalone
    || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches));

  const refresh = useCallback(async () => {
    if (!supported()) { setState('unsupported'); return; }
    try {
      if (key.current === null) {
        const r = await fetch(`${API_URL}/backer/vapid`);
        key.current = r.ok ? ((await r.json()).key || '') : '';
      }
      if (!key.current) { setState('unavailable'); return; }
      if (Notification.permission === 'denied') { setState('blocked'); return; }
      const reg = await navigator.serviceWorker.getRegistration('/b/');
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      setState(sub ? 'on' : 'off');
    } catch {
      setState('off');
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const enable = useCallback(async () => {
    if (!supported() || !key.current) return;
    setError('');
    // Both started inside the gesture: the permission prompt first.
    const perm = Notification.permission === 'granted' ? Promise.resolve('granted') : Notification.requestPermission();
    const regP = navigator.serviceWorker.register('/b/sw.js', { scope: '/b/' });
    setState('busy');
    try {
      const p = await perm;
      if (p !== 'granted') { setState(p === 'denied' ? 'blocked' : 'off'); return; }
      const reg = await regP;
      await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64(key.current) });
      const r = await fetch(`${API_URL}/backer/${token}/subscribe`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub }),
      });
      if (!r.ok) throw new Error('the server did not take the subscription');
      setState('on');
    } catch (e) {
      setError('Notifications are not available here' + (e && e.message ? ` (${e.message})` : '') + '. This link still works anytime.');
      refresh();
    }
  }, [token, refresh]);

  const disable = useCallback(async () => {
    setError('');
    setState('busy');
    try {
      const reg = await navigator.serviceWorker.getRegistration('/b/');
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe();
        await fetch(`${API_URL}/backer/${token}/unsubscribe`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint }),
        });
      }
    } catch { /* the state below says where it ended up */ }
    refresh();
  }, [token, refresh]);

  return { state, error, enable, disable, installHint: iosWeb && !standalone && !supported() };
}

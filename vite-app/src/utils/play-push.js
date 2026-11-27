// "Tell me when it is my turn" on play.futurega.me (lib/play-push.js has the server's half; public/play-sw.js shows the
// push and opens the table). A web push from the play origin only: the app (main.jsx, App.jsx) imports none of this.
//
// The server is the truth for "on": a browser's subscription counts only once the server has it for this account
// (GET /api/tables/push?endpoint=), so a subscription another account left on this browser, or one the push service
// dropped, reads as off until the player turns it on again.

import { fetchApi } from './api.js';

export const SW_URL = '/play-sw.js';

async function json(res) {
  let body = null;
  try { body = await res.json(); } catch { /* empty */ }
  if (!res.ok) {
    const err = new Error((body && body.error) || `The server answered ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

/** What this browser can do: push at all, and whether it is an iPhone or iPad not opened from the Home Screen. */
export function pushSupport(w = typeof window === 'undefined' ? null : window) {
  if (!w) return { supported: false, ios: false, standalone: false };
  const nav = w.navigator || {};
  const ua = String(nav.userAgent || '');
  const ios = /iPad|iPhone|iPod/.test(ua) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
  let standalone = nav.standalone === true;
  try { standalone = standalone || (w.matchMedia && w.matchMedia('(display-mode: standalone)').matches); } catch { /* old browser */ }
  const supported = 'serviceWorker' in nav && 'PushManager' in w && 'Notification' in w;
  return { supported, ios, standalone: !!standalone };
}

/**
 * The control's state, from what the browser and the server say:
 *   'hidden'      not known yet, or the server cannot push (no VAPID key)
 *   'install'     an iPhone or iPad in a browser tab: push needs the page opened from the Home Screen
 *   'unsupported' a browser with no web push
 *   'blocked'     notifications refused for this site
 *   'on' | 'off'
 */
export function turnPushState({ support, permission, key, subscribed }) {
  if (!support || key === undefined) return 'hidden';
  if (!key) return 'hidden';
  if (!support.supported) return support.ios && !support.standalone ? 'install' : 'unsupported';
  if (permission === 'denied') return 'blocked';
  return subscribed ? 'on' : 'off';
}

/** The VAPID key from the server, base64url, as the bytes pushManager.subscribe takes. */
export function keyBytes(base64url) {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const b64 = (base64url + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registration() {
  if (!('serviceWorker' in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration('/')) || null;
}

/** This browser's subscription, if it has one (no prompt). */
export async function currentSubscription() {
  try {
    const reg = await registration();
    return reg && reg.pushManager ? await reg.pushManager.getSubscription() : null;
  } catch { return null; }
}

/** { key, subscribed } for this browser and this account. */
export async function readTurnPush() {
  const sub = await currentSubscription();
  const q = sub ? `?endpoint=${encodeURIComponent(sub.endpoint)}` : '';
  const r = await json(await fetchApi(`/tables/push${q}`));
  return { key: r.key || null, subscribed: !!(sub && r.subscribed) };
}

/** Asks for permission (from a tap), subscribes this browser and gives the server its subscription. -> 'on' | 'blocked' */
export async function enableTurnPush(key) {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    await disableTurnPush().catch(() => {});
    return 'blocked';
  }
  const reg = (await navigator.serviceWorker.register(SW_URL)) && (await navigator.serviceWorker.ready);
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
  await json(await fetchApi('/tables/push', { method: 'POST', body: { subscription: sub.toJSON() } }));
  return 'on';
}

/** Takes this browser off the server's list (Turn off, sign-out, notifications refused) and drops its subscription. */
export async function disableTurnPush() {
  const sub = await currentSubscription();
  if (!sub) return;
  try { await fetchApi('/tables/push/off', { method: 'POST', body: { endpoint: sub.endpoint } }); } catch { /* signed out already */ }
  try { await sub.unsubscribe(); } catch { /* gone already */ }
}

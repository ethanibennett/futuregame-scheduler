/**
 * Lock the app with Face ID or Touch ID (Features 43, 2026-11-11). Native apps only: the AppLock plugin
 * compiled into ios/App/App/AppDelegate.swift (LocalAuthentication, falling back to the device passcode).
 * The web has no equivalent, so the switch is not offered there.
 *
 * The setting is this device's: localStorage.appLock = { on, after } (after: minutes away, 1, 5 or 15).
 * The app locks at launch and when it comes back after `after` minutes in the background. The plugin
 * also blurs the app-switcher snapshot while the lock is on.
 */

const KEY = 'appLock';

function plugin() {
  try {
    const C = window.Capacitor;
    if (!C || !C.isNativePlatform || !C.isNativePlatform()) return null;
    if (C.isPluginAvailable && !C.isPluginAvailable('AppLock')) return null;
    return C.registerPlugin ? C.registerPlugin('AppLock') : (C.Plugins && C.Plugins.AppLock) || null;
  } catch { return null; }
}

/** { available, biometry: 'faceID' | 'touchID' | 'opticID' | 'passcode' } or null off the native apps. */
export async function lockAvailability() {
  const p = plugin();
  if (!p) return null;
  try { return await p.available(); } catch { return null; }
}

export function lockSettings() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    return { on: !!(v && v.on), after: [1, 5, 15].includes(v && v.after) ? v.after : 1 };
  } catch { return { on: false, after: 1 }; }
}

export function saveLockSettings(next) {
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private window */ }
  const p = plugin();
  if (p && p.setPrivacyScreen) p.setPrivacyScreen({ enabled: !!next.on }).catch(() => {});
}

/** Resolves true when the player proved it is them (Face ID, Touch ID or the passcode). */
export async function unlock(reason = 'Unlock futurega.me') {
  const p = plugin();
  if (!p) return true;
  try { const r = await p.authenticate({ reason }); return !!(r && r.ok); } catch { return false; }
}

export function biometryName(b) {
  return b === 'faceID' ? 'Face ID' : b === 'touchID' ? 'Touch ID' : b === 'opticID' ? 'Optic ID' : 'your passcode';
}

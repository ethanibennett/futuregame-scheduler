import { useEffect, useState } from 'react';

// ── The shared display currency (the Results tab's setting, localStorage 'trackingCurrency') ──
// Results sets it; the home follows it (utils/home.js homeCurrency maps Native to USD there, since
// a total of euros and dollars is in no currency). The home used to read the key once, at mount, so
// a change in Results reached it only on a reload: on desktop and the web, where the app stays open,
// the home's 'USD' sat beside Results' EUR. Setting it here tells every view that follows it at
// once, in this tab (a window event) and in another tab of the same app (the 'storage' event).
const KEY = 'trackingCurrency';
const EVENT = 'display-currency-change';

export function readDisplayCurrency() {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

/** Store the display currency and tell everything that follows it. */
export function publishDisplayCurrency(code) {
  try { localStorage.setItem(KEY, code); } catch { /* private mode: this tab still hears it */ }
  try { window.dispatchEvent(new CustomEvent(EVENT, { detail: code })); } catch { /* no window */ }
}

/** The stored display currency (as stored: 'NATIVE', 'USD', 'EUR', ... or null), kept current. */
export default function useDisplayCurrency() {
  const [code, setCode] = useState(readDisplayCurrency);
  useEffect(() => {
    const onChange = (e) => setCode(e && e.detail != null ? e.detail : readDisplayCurrency());
    const onStorage = (e) => { if (!e.key || e.key === KEY) setCode(readDisplayCurrency()); };
    window.addEventListener(EVENT, onChange);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener('storage', onStorage);
    };
  }, []);
  return code;
}

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchApi } from '../utils/api.js';
import { CURRENCY_CONFIG } from '../utils/utils.js';
import { fmtMoney } from '../utils/home.js';
import { noiseLine, analyticsPath, resultsVersion, summaryVersion, cashSpread, windowGame } from '../utils/home-noise.js';

// ── The signal-or-noise line (verdict section 6; admins) ─────────────────────────────────────────
// One plain sentence under the period block's card, about the window that card shows (the month,
// the trip or the series): how often the player's own long-run rate produces a stretch like it, and
// whether that rate can yet be told apart from break-even. Under 30 entries it is progress instead
// ('18 of 30 entries before this can separate skill from luck'). The words are utils/home-noise.js.
//
// Data, admins only (the parent renders this only for them), each asked for AFTER the first paint
// and cached per version, so a remount or a re-render asks again only when something changed:
//   tournaments  GET /api/analytics?from=&to=[&venue=][&bankroll=] (the window against the whole
//                history), keyed on the window, the currency and the results' version;
//   cash         only when the sentence is about cash: the whole combined ledger for the window's
//                scope (GET /api/bankrolls/ledger, no from), reduced to its per-hour spread, keyed on
//                the bankroll totals' version.
// Tapping opens Analytics (tournaments), or the bankroll dashboard's Overview for a cash sentence:
// the deep view where those figures live.

const ANALYTICS = new Map(); // key -> Promise<payload | false>
const CASH = new Map();      // key -> Promise<spread | false>
function cached(map, key, load) {
  if (!map.has(key)) {
    const p = load().catch(() => false);
    map.set(key, p);
    p.then((v) => { if (v === false && map.get(key) === p) map.delete(key); }); // a failure is retried next time
    while (map.size > 6) map.delete(map.keys().next().value);
  }
  return map.get(key);
}
// After the first paint: the next frame, then a task, so the home is on screen before it asks.
function afterPaint(fn) {
  let t = null;
  const raf = requestAnimationFrame(() => { t = setTimeout(fn, 0); });
  return () => { cancelAnimationFrame(raf); if (t) clearTimeout(t); };
}
const NO_CASH = { sessions: 0, hours: 0, profit: 0, hourly: null, sd: null };
// WebKit breaks a line after a hyphen ('long-' | 'run rate'): a hyphenated word is kept whole.
// (The figures are whole by their own rule, .hm-noise-em.)
function unbroken(text) {
  return text.split(/(\S*\w-\w\S*)/).map((part, i) => (i % 2 ? <span key={i} className="hm-noise-nw">{part}</span> : part));
}

export default function HomeNoiseLine({ model, results, currency = 'USD', bk, onOpen }) {
  const win = model ? model.window : null;
  const stats = model ? model.stats : null;
  const cur = CURRENCY_CONFIG[currency] || CURRENCY_CONFIG.USD;
  const money = useCallback((v, signed) => fmtMoney(v, cur, { signed: !!signed }), [cur]);

  const version = useMemo(() => resultsVersion(results), [results]);
  const path = win ? analyticsPath(win, currency) : null;
  const aKey = path ? `${path}|${version}` : null;
  const [analytics, setAnalytics] = useState(null); // { key, data }
  useEffect(() => {
    if (!aKey) return undefined;
    let on = true;
    const stop = afterPaint(() => {
      cached(ANALYTICS, aKey, () => fetchApi(path).then((r) => (r.ok ? r.json() : false)))
        .then((d) => { if (on) setAnalytics({ key: aKey, data: d }); });
    });
    return () => { on = false; stop(); };
  }, [aKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const scope = win ? win.scope || 'all' : 'all';
  const summary = bk ? bk.summary : null;
  const cKey = stats && windowGame(stats) === 'cash' ? `${scope}|${currency}|${summaryVersion(summary)}` : null;
  const [cash, setCash] = useState(null); // { key, data }
  useEffect(() => {
    if (!cKey || !bk) return undefined;
    let on = true;
    const stop = afterPaint(() => {
      cached(CASH, cKey, () => bk.call('GET', `/ledger?bankroll=${encodeURIComponent(scope)}&currency=${encodeURIComponent(currency)}`)
        .then((d) => cashSpread(d && d.entries) || NO_CASH))
        .then((d) => { if (on) setCash({ key: cKey, data: d }); });
    });
    return () => { on = false; stop(); };
  }, [cKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const a = analytics && analytics.key === aKey ? analytics.data : null;
  const c = cash && cash.key === cKey ? cash.data : null;
  const fresh = useMemo(() => (stats ? noiseLine({ stats, analytics: a, cash: c, money }) : null), [stats, a, c, money]);
  // While a new answer is on its way (a result just logged changes the version, so the key), the
  // sentence already on show stays, rather than unmounting for the request's half second and pulling
  // the goals card up 3n+1 r and back. It goes only when an answer says there is nothing to say.
  const pending = (!!aKey && !(analytics && analytics.key === aKey)) || (!!cKey && !(cash && cash.key === cKey));
  const held = useRef(null);
  if (fresh || !pending) held.current = fresh;
  const line = fresh || held.current;
  if (!line) return null;
  const where = line.game === 'cash' ? 'the bankroll overview' : 'Analytics';
  return (
    <button type="button" className="hm-noise" data-kind={line.kind} onClick={() => onOpen && onOpen(line.game, scope)}
      aria-label={`${line.text} Open ${where}.`}>
      <span className="hm-noise-t">
        {line.segs.map((s, i) => (typeof s === 'string'
          ? <React.Fragment key={i}>{unbroken(s)}</React.Fragment>
          : <span key={i} className="hm-noise-em">{s.em}</span>))}
        <span className="hm-noise-go" aria-hidden="true">{' ›'}</span>
      </span>
    </button>
  );
}

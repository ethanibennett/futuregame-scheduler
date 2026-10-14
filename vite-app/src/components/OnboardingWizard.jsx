import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon.jsx';
import { API_URL } from '../utils/api.js';
import { getToday } from '../utils/utils.js';
import { US_STATES, stateName } from '../utils/online-sites.js';
import {
  readLocalLocation, writeLocalLocation, pushServerLocation, readLocalFilters, writeLocalFilters, markOnboarded,
} from '../utils/location-prefs.js';
import {
  SETUP_REGION_ORDER, REGION_LABEL, RADII, GAME_CHIPS, BUYIN_CHIPS, WIZARD_DEFAULTS, ROW_STEP,
  STEP_TITLES, STEP_LEADS, LOCATE_ERRORS,
  answersFrom, chooseRegion, choosePoint, choosePlace, learnPlace, pickState, sitesShown, withFirstRunRows,
  locationFrom, filtersFrom, wizardSubset, countSetup, isLocated, statusLine, showLabel, pushServerOnboarding,
} from '../utils/onboarding.js';

/* First-run setup: three optional questions, each preset to a default, with a running count of
   what the answers do to the list. The logic (what each answer reads and writes) lives in
   utils/onboarding.js; the spec and the exact copy in docs/onboarding.md.

   Auto-opened once per ACCOUNT by App (users.onboarding; the localStorage flag is its cache);
   re-opened from the location menu ("Run setup again", the 'reopen-onboarding' event), pre-filled
   from the current filters. Skip (or Esc) keeps the steps already confirmed with Next. */

const STEPS = STEP_TITLES.length;

export default function OnboardingWizard({ token, isGuest = false, tournaments, firstRun = true, onDone }) {
  // What this device had when setup opened: the answers start from it, and an untouched row is
  // written back exactly as it was.
  const prev = useRef(null);
  if (!prev.current) prev.current = { loc: readLocalLocation(), filters: readLocalFilters() };
  const [step, setStep] = useState(0);
  const [a, setA] = useState(() => answersFrom(prev.current.loc, prev.current.filters, { firstRun }));
  // Rows the user changed (ROW_STEP's keys). Only these are written.
  const [touched, setTouched] = useState({});
  const touch = (row) => setTouched(t => (t[row] ? t : { ...t, [row]: true }));
  // The answers as they stood when the current step was reached: what Skip saves.
  const confirmed = useRef(null);
  const [locating, setLocating] = useState(false);
  const [err, setErr] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const searchTimer = useRef(null);
  const searchSeq = useRef(0);
  const userChose = useRef(false);
  const titleRef = useRef(null);
  const closed = useRef(false);
  const remote = !!token && !isGuest;
  const auth = token ? { headers: { Authorization: 'Bearer ' + token } } : undefined;

  /* "Use my location". Never asks for permission without a tap (the automatic attempt below runs
     only when it is already granted). The point is the answer at once; the reverse lookup that
     names the place and works out the state follows, and a failed one costs only the state. */
  const locate = useCallback(() => {
    if (typeof window !== 'undefined' && window.isSecureContext === false) { setErr(LOCATE_ERRORS.insecure); return; }
    if (typeof navigator === 'undefined' || !navigator.geolocation) { setErr(LOCATE_ERRORS.unsupported); return; }
    setLocating(true);
    setErr('');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const point = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setLocating(false);
        setA(x => choosePlace(x, { kind: 'current', point, name: null }));
        touch('place');
        setQuery(''); setResults([]);
        fetch(`${API_URL}/geocode/reverse?lat=${point.lat}&lng=${point.lng}`, auth)
          .then(r => (r.ok ? r.json() : null))
          .then(d => { if (d) setA(x => learnPlace(x, point, d)); })
          .catch(() => { /* the location stands; only the state is unknown */ });
      },
      (e) => {
        setLocating(false);
        setErr(e && e.code === 1 ? LOCATE_ERRORS.denied : e && e.code === 3 ? LOCATE_ERRORS.timeout : LOCATE_ERRORS.unavailable);
      },
      { enableHighAccuracy: false, timeout: 10000 }
    );
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Nothing saved and location already allowed: locate at once and pre-select the tile. The
  // Permissions API is missing from older WebKit (and may throw); then the tile waits for a tap.
  useEffect(() => {
    const saved = prev.current.loc;
    if (saved && (saved.userLocation || saved.locationRegion)) return undefined;
    let live = true;
    try {
      const q = navigator.permissions && navigator.permissions.query && navigator.permissions.query({ name: 'geolocation' });
      if (q && typeof q.then === 'function') {
        q.then(st => { if (live && st && st.state === 'granted' && !userChose.current) locate(); }).catch(() => {});
      }
    } catch (e) { /* unsupported */ }
    return () => { live = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // City search: 2 characters at least, 400 ms after the last keystroke (as the location menu).
  const onQuery = (v) => {
    setQuery(v);
    clearTimeout(searchTimer.current);
    const q = v.trim();
    if (q.length < 2) { searchSeq.current++; setResults([]); return; }
    searchTimer.current = setTimeout(() => {
      const seq = ++searchSeq.current;
      fetch(`${API_URL}/geocode?q=${encodeURIComponent(q)}`, auth)
        .then(r => { if (!r.ok) throw new Error('geocode ' + r.status); return r.json(); })
        .then(d => {
          if (seq !== searchSeq.current) return;
          setResults(((d && d.results) || []).slice(0, 4));
          setErr(e => (e === LOCATE_ERRORS.search ? '' : e));
        })
        .catch(() => { if (seq === searchSeq.current) { setResults([]); setErr(LOCATE_ERRORS.search); } });
    }, 400);
  };
  useEffect(() => () => clearTimeout(searchTimer.current), []);

  const pickResult = (r) => {
    userChose.current = true;
    setA(x => choosePoint(x, r));
    touch('place');
    searchSeq.current++;
    setResults([]); setQuery(''); setErr('');
  };
  const pickRegion = (key) => {
    userChose.current = true;
    setA(x => chooseRegion(x, key));
    touch('place');
    searchSeq.current++;
    setResults([]); setQuery(''); setErr('');
  };
  const pickRadius = (r) => { setA(x => ({ ...x, radius: r })); touch('radius'); };
  const setOnline = (on) => { setA(x => ({ ...x, online: on })); touch('online'); };
  const toggleSites = () => { setA(x => ({ ...x, onlyAvailable: !x.onlyAvailable })); touch('sites'); };
  const setState = (code) => { setA(x => pickState(x, code)); touch('state'); };
  const toggleIn = (key, list) => (list.includes(key) ? list.filter(k => k !== key) : [...list, key]);
  const toggleGame = (key) => { setA(x => ({ ...x, games: toggleIn(key, x.games) })); touch('games'); };
  const toggleBuyin = (key) => { setA(x => ({ ...x, buyins: toggleIn(key, x.buyins) })); touch('buyins'); };

  /* The rows that count. A first run answers step 2 by default (online off, and the sites filter
     on where a state is known: the launch plan's live-only defaults); everything else counts only
     once touched. */
  const showSites = sitesShown(a);
  const rowsFor = useCallback((ans, t) => (firstRun ? withFirstRunRows(ans, t) : t), [firstRun]);
  const rows = useMemo(() => rowsFor(a, touched), [a, touched, rowsFor]);

  // The live count, with the answers as they stand.
  const loc = useMemo(() => locationFrom(a, prev.current.loc, rows), [a, rows]);
  const merged = useMemo(() => filtersFrom(a, prev.current.filters, rows), [a, rows]);
  const showOnlineNow = merged.showOnline !== false;
  const counts = useMemo(() => (tournaments && tournaments.length ? countSetup(tournaments, loc, merged, getToday()) : null),
    [tournaments, loc, merged]);
  const status = statusLine(counts, { located: isLocated(loc), showOnline: showOnlineNow });

  // Writes the answers in `ans` for the rows in `t`. Nothing else in storage changes.
  const commit = (ans, t, skipped) => {
    const prevLoc = prev.current.loc;
    const locTouched = !!(t.place || t.radius || t.state);
    const nextLoc = locationFrom(ans, prevLoc, t);
    if (locTouched) {
      writeLocalLocation(nextLoc);
      // null clears the account's copy too (choosing Everywhere on a re-run).
      if (remote) pushServerLocation(token, nextLoc);
    }
    const nextFilters = filtersFrom(ans, readLocalFilters(), t);
    writeLocalFilters(nextFilters);
    const sub = wizardSubset(nextFilters);
    // A mounted Schedule or Calendar takes the same answers at once (it would otherwise keep its
    // own state until a reload, and write it back over these on the next filter change).
    const detail = { filters: { ...WIZARD_DEFAULTS, ...sub } };
    if (locTouched) detail.location = nextLoc;
    window.dispatchEvent(new CustomEvent('onboarding-applied', { detail }));
    markOnboarded();
    if (remote) pushServerOnboarding(token, { skipped, filters: sub });
  };

  const finish = () => {
    if (closed.current) return;
    closed.current = true;
    commit(a, rows, false);
    onDone({ applied: true });
  };
  // Skip keeps the steps already confirmed with Next, as they were confirmed; the step on screen
  // and any after it keep what is saved. Except that a first run never leaves online events on
  // without a yes: unless Next confirmed step 2, the default (No) is written.
  const skip = useCallback(() => {
    if (closed.current) return;
    closed.current = true;
    const snap = confirmed.current;
    const t = {};
    let ans = a;
    if (snap && step > 0) {
      for (const [row, st] of Object.entries(ROW_STEP)) if (st < step && snap.rows[row]) t[row] = true;
      ans = snap.a;
    }
    if (firstRun && !t.online) { ans = { ...ans, online: false }; t.online = true; }
    commit(ans, t, true);
    onDone({ applied: false });
  }, [step, a]); // eslint-disable-line react-hooks/exhaustive-deps
  const next = () => {
    confirmed.current = { a, rows };
    setStep(s => Math.min(STEPS - 1, s + 1));
  };
  const back = () => setStep(s => Math.max(0, s - 1));

  // Esc is Skip. A click on the backdrop does nothing (an answer half-given is not a dismissal).
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); skip(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [skip]);

  // Each step announces itself: focus moves to its title.
  useEffect(() => {
    if (titleRef.current) titleRef.current.focus({ preventScroll: true });
  }, [step]);

  const opt = (on, extra) => 'onboarding-option ' + extra + (on ? ' is-on' : '');

  // ── Step 1: where ──
  const isPoint = a.place.kind === 'current' || a.place.kind === 'point';
  const isCurrent = a.place.kind === 'current';
  const radiusIsChip = RADII.includes(String(a.radius));
  const tileTitle = locating ? 'Finding you…' : isCurrent ? (a.place.name ? `Near ${a.place.name}` : 'Near you') : 'Use my location';
  const tileSub = isCurrent && !locating ? `Within ${a.radius} miles` : `Events within ${radiusIsChip ? a.radius : '100'} miles of you`;
  const placeRows = results.length
    ? results.map(r => ({ key: `${r.lat},${r.lng}`, label: r.short || r.display, on: false, onClick: () => pickResult(r) }))
    : a.place.kind === 'point'
      ? [{ key: 'picked', label: a.place.label || 'Picked place', on: true, onClick: () => {} }]
      : [];
  const step1 = (
    <>
      <div className="ob-group" role="radiogroup" aria-label="Your location">
        <button type="button" role="radio" aria-checked={isCurrent} className={opt(isCurrent, 'ob-tile ob-tile--icon')}
          onClick={() => { userChose.current = true; locate(); }}>
          <span className="ob-tile-icon" aria-hidden="true"><Icon.mapPin /></span>
          <span className="ob-tile-text">
            <span className="ob-tile-title">{tileTitle}</span>
            <span className="ob-tile-sub">{tileSub}</span>
          </span>
        </button>
        <input className="ob-search" type="text" inputMode="search" enterKeyHint="search" autoComplete="off"
          placeholder="Or search a city or postal code" aria-label="Search a city or postal code"
          value={query} onChange={e => onQuery(e.target.value)} />
        {placeRows.length > 0 && (
          <div className="ob-results">
            {placeRows.map(r => (
              <button key={r.key} type="button" role="radio" aria-checked={r.on} className={opt(r.on, 'ob-row')} onClick={r.onClick}>
                <span className="ob-row-label">{r.label}</span>
                {r.on && <span className="ob-row-check" aria-hidden="true"><Icon.check /></span>}
              </button>
            ))}
          </div>
        )}
      </div>
      {err && <p className="ob-error" role="alert">{err}</p>}
      {isPoint && (
        <>
          <p className="ob-label" id="ob-distance">Distance{!radiusIsChip && <span className="ob-label-note"> · Now: {a.radius} mi</span>}</p>
          <div className="ob-chips" role="radiogroup" aria-labelledby="ob-distance">
            {RADII.map(r => (
              <button key={r} type="button" role="radio" aria-checked={String(a.radius) === r}
                className={opt(String(a.radius) === r, 'ob-chip ctl')} onClick={() => pickRadius(r)}>{r} mi</button>
            ))}
          </div>
        </>
      )}
      <p className="ob-label" id="ob-regions">Or pick a region</p>
      <div className="ob-grid2" role="radiogroup" aria-labelledby="ob-regions">
        {SETUP_REGION_ORDER.map(key => {
          const on = key === 'everywhere' ? a.place.kind === 'everywhere' : (a.place.kind === 'region' && a.place.region === key);
          return (
            <button key={key} type="button" role="radio" aria-checked={on} className={opt(on, 'ob-cell ctl')} onClick={() => pickRegion(key)}>
              {REGION_LABEL[key]}
            </button>
          );
        })}
      </div>
    </>
  );

  // ── Step 2: online ──
  const fromLocation = !!(a.jurisdiction && !a.jurisdictionManual);
  const step2 = (
    <>
      <div className="ob-group ob-stack" role="radiogroup" aria-labelledby="ob-title">
        <button type="button" role="radio" aria-checked={a.online} className={opt(a.online, 'ob-tile')} onClick={() => setOnline(true)}>
          <span className="ob-tile-text">
            <span className="ob-tile-title">Yes, show online events</span>
            <span className="ob-tile-sub">ACR, GGPoker, WSOP.com, Phenom and ClubWPT Gold</span>
          </span>
        </button>
        <button type="button" role="radio" aria-checked={!a.online} className={opt(!a.online, 'ob-tile')} onClick={() => setOnline(false)}>
          <span className="ob-tile-text">
            <span className="ob-tile-title">No, live only</span>
            <span className="ob-tile-sub">The Online switch on the Schedule brings them back</span>
          </span>
        </button>
      </div>
      {a.online && a.country !== 'other' && (
        <>
          <label className="ob-label" htmlFor="ob-state">Your state{fromLocation && <span className="ob-label-note"> · from your location</span>}</label>
          <span className="ob-select-wrap">
            <select id="ob-state" className="ob-select" value={a.jurisdiction || ''} onChange={e => setState(e.target.value)}>
              <option value="">Not set</option>
              {US_STATES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
            </select>
            <span className="ob-select-chev" aria-hidden="true"><Icon.chevronDown /></span>
          </span>
          <p className="ob-help">Online sites are licensed state by state.</p>
          {showSites && (
            <>
              <button type="button" role="checkbox" aria-checked={!!a.onlyAvailable} className={opt(!!a.onlyAvailable, 'ob-check')} onClick={toggleSites}>
                <span className="ob-check-box" aria-hidden="true">{a.onlyAvailable && <Icon.check />}</span>
                <span className="ob-check-label">Only sites open in {stateName(a.jurisdiction)}</span>
              </button>
              <p className="ob-help">Sites that publish no state list always show.</p>
            </>
          )}
        </>
      )}
      {a.online && a.country === 'other' && <p className="ob-help ob-help--gap">Site availability is checked for US states only.</p>}
    </>
  );

  // ── Step 3: what ──
  const extras = !touched.games ? a.gameExtras.length : 0;
  const step3 = (
    <>
      <p className="ob-label ob-label--first" id="ob-games">Games</p>
      <div className="ob-chips" role="group" aria-labelledby="ob-games">
        {GAME_CHIPS.map(c => {
          const on = a.games.includes(c.key);
          return <button key={c.key} type="button" role="checkbox" aria-checked={on} className={opt(on, 'ob-chip ctl')} onClick={() => toggleGame(c.key)}>{c.label}</button>;
        })}
      </div>
      <p className="ob-help">Mixed is every other game: Omaha Hi-Lo, Stud, Draw, HORSE and more.</p>
      {extras > 0 && <p className="ob-help">+{extras} more set in Filters</p>}
      <p className="ob-label" id="ob-buyins">Buy-ins</p>
      <div className="ob-chips" role="group" aria-labelledby="ob-buyins">
        {BUYIN_CHIPS.map(c => {
          const on = a.buyins.includes(c.key);
          return <button key={c.key} type="button" role="checkbox" aria-checked={on} className={opt(on, 'ob-chip ctl')} onClick={() => toggleBuyin(c.key)}>{c.label}</button>;
        })}
      </div>
    </>
  );

  return createPortal(
    <div className="modal-backdrop">
      <div className="modal-content snap-place ob" role="dialog" aria-modal="true" aria-labelledby="ob-title">
        <div className="ob-head">
          <span className="ob-step">Step {step + 1} of {STEPS}</span>
          <button type="button" className="btn btn-ghost btn-sm snap-g" onClick={skip}>Skip</button>
        </div>
        <div className="ob-progress" role="progressbar" aria-label="Setup progress" aria-valuemin={1} aria-valuemax={STEPS} aria-valuenow={step + 1}>
          {Array.from({ length: STEPS }, (_, i) => <span key={i} className={'ob-seg' + (i <= step ? ' is-on' : '')} />)}
        </div>
        <h3 id="ob-title" className="ob-title" tabIndex={-1} ref={titleRef}>{STEP_TITLES[step]}</h3>
        <p className="ob-lead">{STEP_LEADS[step]}</p>
        {/* Keyed by step: each step mounts its own controls, so a tile is never one step's
            control re-dressed as the next one's (a ring animating from its old state). */}
        <React.Fragment key={step}>{step === 0 ? step1 : step === 1 ? step2 : step3}</React.Fragment>
        <p className={'ob-status' + (status ? '' : ' ob-hide')} role="status" aria-live="polite">{status || ' '}</p>
        <div className="ob-foot">
          <button type="button" className={'btn btn-ghost btn-sm snap-g' + (step === 0 ? ' ob-hide' : '')} onClick={back} disabled={step === 0}>Back</button>
          {step < STEPS - 1
            ? <button type="button" className="btn btn-primary btn-sm snap-g" onClick={next}>Next</button>
            : <button type="button" className="btn btn-primary btn-sm snap-g" onClick={finish}>{showLabel(counts, { showOnline: showOnlineNow })}</button>}
        </div>
      </div>
    </div>,
    document.body
  );
}

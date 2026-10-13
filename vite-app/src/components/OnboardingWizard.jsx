import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { API_URL } from '../utils/api.js';
import { LOCATION_REGIONS } from '../utils/utils.js';
import { US_STATES } from '../utils/online-sites.js';
import { writeLocalLocation, pushServerLocation, writeLocalFilters, markOnboarded } from '../utils/location-prefs.js';

/* First-run wizard. Four quick questions that seed the schedule's filters so a
 * new user's first look is relevant instead of "every venue in the country" or
 * an empty list. Auto-opens once (App gates on hasOnboarded()); skippable; and
 * re-openable later. It writes the SAME persisted stores the filters already use
 * — savedLocation (location + jurisdiction) and savedFilters (games, buy-in,
 * online) — so TournamentsView picks the answers up when it mounts. */

const GAME_CHOICES = [
  { key: 'holdem',     label: "Hold'em only",     sub: 'NLH',              filters: { selectedGames: ['NLH'], mixedOnly: false } },
  { key: 'holdem_plo', label: "Hold'em + PLO",    sub: 'NLH and Omaha',    filters: { selectedGames: ['NLH', 'PLO'], mixedOnly: false } },
  { key: 'mixed',      label: 'Mixed games',      sub: 'HORSE, 8-Game, …', filters: { selectedGames: [], mixedOnly: true } },
  { key: 'all',        label: 'Everything',       sub: 'no game filter',   filters: { selectedGames: [], mixedOnly: false } },
];

const BUYIN_CHOICES = [
  { key: 'low',    label: 'Under $500',      ranges: ['0-500'] },
  { key: 'mid',    label: '$500 – $1,500',   ranges: ['500-1500'] },
  { key: 'high',   label: '$1,500 – $5,000', ranges: ['1500-5000'] },
  { key: 'roller', label: 'High roller ($5K+)', ranges: ['5000-10000', '10000+'] },
  { key: 'any',    label: 'Any buy-in',      ranges: [] },
];

export default function OnboardingWizard({ token, onDone }) {
  const [step, setStep] = useState(0);
  // location
  const [locChoice, setLocChoice] = useState(null);   // region key | 'current' | 'everywhere'
  const [coords, setCoords] = useState(null);         // {lat,lng} for 'current'
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState('');
  // online + state
  const [playsOnline, setPlaysOnline] = useState(null); // true | false | null
  const [jurisdiction, setJurisdiction] = useState('');
  // games / buy-in
  const [games, setGames] = useState(null);
  const [buyin, setBuyin] = useState(null);

  const regions = Object.entries(LOCATION_REGIONS); // [[key,{label}],…]

  const useMyLocation = () => {
    if (!navigator.geolocation) { setLocError('Location not available on this device.'); return; }
    // WebKit refuses geolocation on a non-secure page (an http dev server); say so.
    if (window.isSecureContext === false) { setLocError('Location needs a secure page (it works in the installed app). Pick a region instead.'); return; }
    setLocating(true); setLocError('');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const c = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setCoords(c); setLocChoice('current'); setLocating(false);
        // Reverse-lookup the state so "Available to me" can work even if they skip the online step.
        fetch(`${API_URL}/geocode/reverse?lat=${c.lat}&lng=${c.lng}`, token ? { headers: { Authorization: 'Bearer ' + token } } : undefined)
          .then(r => r.ok ? r.json() : null)
          .then(d => { const code = d && (d.region || d.state); if (code) setJurisdiction(String(code).toUpperCase()); })
          .catch(() => {});
      },
      (err) => {
        setLocating(false);
        setLocError(err && err.code === 1 ? 'Location permission is off for futurega.me. Pick a region instead.'
          : err && err.code === 2 ? 'No location fix available (in the Simulator: Features → Location). Pick a region instead.'
          : 'Could not get your location. Pick a region instead.');
      },
      { timeout: 8000 }
    );
  };

  const finish = () => {
    // Location → savedLocation
    let loc = null;
    if (locChoice === 'current' && coords) {
      loc = { userLocation: coords, maxDistance: '100', locationRegion: null, locationLabel: 'Current Location' };
    } else if (locChoice && locChoice !== 'everywhere' && LOCATION_REGIONS[locChoice]) {
      loc = { userLocation: null, maxDistance: '', locationRegion: locChoice, locationLabel: null };
    }
    if (jurisdiction) loc = { ...(loc || { userLocation: null, maxDistance: '', locationRegion: null, locationLabel: null }), jurisdiction, jurisdictionManual: true };
    writeLocalLocation(loc);
    if (token && loc) pushServerLocation(token, loc);

    // Games / buy-in / online → savedFilters
    const g = GAME_CHOICES.find(x => x.key === games);
    const b = BUYIN_CHOICES.find(x => x.key === buyin);
    const sf = {};
    if (g) { sf.selectedGames = g.filters.selectedGames; sf.mixedOnly = g.filters.mixedOnly; }
    if (b) sf.buyinRanges = b.ranges;
    if (playsOnline === false) sf.showOnline = false;
    // Only showOnline. This used to also set onlyAvailableOnline when a state was
    // given, but that filter no longer has a control in the UI (the "Available
    // to me" checkbox was removed 2026-09-25), so writing it here would hide
    // events the user could never unhide.
    if (playsOnline === true) { sf.showOnline = true; }
    writeLocalFilters(sf);

    markOnboarded();
    onDone(true);
  };

  const skip = () => { markOnboarded(); onDone(false); };

  // ── per-step validity (so Next/Finish only lights up on an answer) ──
  const canAdvance =
    step === 0 ? (!!locChoice) :
    step === 1 ? (playsOnline === false || (playsOnline === true && !!jurisdiction)) :
    step === 2 ? (!!games) :
    /* step 3 */ (!!buyin);

  const STEPS = ['Location', 'Online', 'Games', 'Buy-in'];

  // On the grid: the cell's whole g wide, 6r tall (9r with a second line), the label set at the
  // start and centred vertically in the box.
  const optBtn = (active, onClick, main, sub) => (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center', gap: 'var(--space-2xs)',
        width: '100%', height: sub ? 'calc(var(--subrow) * 9)' : 'calc(var(--subrow) * 6)', boxSizing: 'border-box', lineHeight: 1,
        textAlign: 'left', padding: '0 var(--gu)', borderRadius: 'calc(var(--subrow) * 1.25)',
        border: `var(--bw-1) solid ${active ? 'var(--brand)' : 'var(--border)'}`,
        background: active ? 'var(--surface)' : 'var(--bg)',
        boxShadow: active ? '0 0 0 calc(var(--subrow) * 0.125) var(--brand)' : 'none',
        color: 'var(--text)', cursor: 'pointer', font: 'inherit',
      }}
    >
      <span style={{ fontSize: 'calc(var(--gu) * 1.399)', fontWeight: 600, lineHeight: 1 }}>{main}</span>
      {sub && <span style={{ fontSize: 'calc(var(--gu) * 1.104)', color: 'var(--text-muted)', lineHeight: 1 }}>{sub}</span>}
    </button>
  );

  return createPortal(
    <div className="modal-backdrop">
      <div className="modal-content snap-place" onClick={e => e.stopPropagation()}>
        {/* header: step dots + skip, one 4r row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 'calc(var(--subrow) * 4)', marginBottom: 'var(--subrow)' }}>
          <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
            {STEPS.map((_, i) => (
              <span key={i} style={{ width: i === step ? 'calc(var(--subrow) * 2.5)' : 'calc(var(--subrow) * 0.875)', height: 'calc(var(--subrow) * 0.875)', borderRadius: 'var(--radius-xs)', background: i <= step ? 'var(--brand)' : 'var(--border)', transition: 'width .15s' }} />
            ))}
          </div>
          <button className="btn btn-ghost btn-sm snap-g" onClick={skip}>Skip</button>
        </div>

        {step === 0 && (
          <>
            <h3>Where do you play?</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: 'calc(var(--gu) * 1.252)' }}>
              We'll show live events near you. You can change this anytime from the location button.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--subrow) var(--gu)' }}>
              {regions.map(([key, { label }]) => optBtn(locChoice === key, () => { setLocChoice(key); setCoords(null); }, label))}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', marginTop: 'var(--space-md)' }}>
              {optBtn(locChoice === 'current', useMyLocation, locating ? 'Locating…' : (locChoice === 'current' ? 'Using my location ✓' : '📍 Use my location'), locChoice === 'current' ? 'within 100 miles' : null)}
              {optBtn(locChoice === 'everywhere', () => { setLocChoice('everywhere'); setCoords(null); }, 'Everywhere / I travel', 'no location filter')}
            </div>
            {locError && <div style={{ color: 'var(--danger, #d66)', fontSize: 'calc(var(--gu) * 1.178)', lineHeight: 'calc(var(--subrow) * 2)', marginTop: 'var(--space-md)' }}>{locError}</div>}
          </>
        )}

        {step === 1 && (
          <>
            <h3>Do you play online?</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: 'calc(var(--gu) * 1.252)' }}>
              Online events have no location, so they're shown separately.
            </p>
            <div style={{ display: 'flex', gap: 'var(--gu)' }}>
              <div style={{ flex: 1 }}>{optBtn(playsOnline === true, () => setPlaysOnline(true), 'Yes')}</div>
              <div style={{ flex: 1 }}>{optBtn(playsOnline === false, () => setPlaysOnline(false), 'No')}</div>
            </div>
            {playsOnline === true && (
              <div style={{ marginTop: 'calc(var(--subrow) * 2)' }}>
                <label htmlFor="ob-state" style={{ display: 'block', fontSize: 'calc(var(--gu) * 1.178)', color: 'var(--text-muted)', lineHeight: 'calc(var(--subrow) * 2)', marginBottom: 'var(--subrow)' }}>
                  Which state are you in? <span style={{ color: 'var(--text-faint, var(--text-muted))' }}>(so we can show which sites are available to you)</span>
                </label>
                <select id="ob-state" value={jurisdiction} onChange={e => setJurisdiction(e.target.value)}
                  style={{ display: 'block', width: '100%', height: 'calc(var(--subrow) * 5)', padding: '0 var(--space-lg)', borderRadius: 'var(--radius-sm)', border: 'var(--bw-hair) solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 'calc(var(--gu) * 1.399)', boxSizing: 'border-box' }}>
                  <option value="">Select your state…</option>
                  {US_STATES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
                </select>
              </div>
            )}
          </>
        )}

        {step === 2 && (
          <>
            <h3>What do you play?</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: 'calc(var(--gu) * 1.252)' }}>
              Sets your game filter — loosen it anytime.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
              {GAME_CHOICES.map(c => optBtn(games === c.key, () => setGames(c.key), c.label, c.sub))}
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h3>Typical buy-in?</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: 'calc(var(--gu) * 1.252)' }}>
              We'll focus the list on your range.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
              {BUYIN_CHOICES.map(c => optBtn(buyin === c.key, () => setBuyin(c.key), c.label))}
            </div>
          </>
        )}

        {/* footer nav */}
        <div style={{ display: 'flex', gap: 'var(--gu)', marginTop: 'calc(var(--subrow) * 2)', justifyContent: 'space-between' }}>
          <button className="btn btn-ghost btn-sm snap-g" onClick={() => setStep(s => Math.max(0, s - 1))} disabled={step === 0} style={{ visibility: step === 0 ? 'hidden' : 'visible' }}>Back</button>
          {step < 3
            ? <button className="btn btn-primary btn-sm snap-g" onClick={() => setStep(s => s + 1)} disabled={!canAdvance}>Next</button>
            : <button className="btn btn-primary btn-sm snap-g" onClick={finish} disabled={!canAdvance}>Show my schedule</button>}
        </div>
      </div>
    </div>,
    document.body
  );
}

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
      () => { setLocating(false); setLocError('Could not get your location — pick a region instead.'); },
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
    if (playsOnline === true) { sf.showOnline = true; if (jurisdiction) sf.onlyAvailableOnline = true; }
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

  const optBtn = (active, onClick, main, sub) => (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '2px',
        width: '100%', textAlign: 'left', padding: '12px 14px', borderRadius: '10px',
        border: `1.5px solid ${active ? 'var(--brand)' : 'var(--border)'}`,
        background: active ? 'var(--surface)' : 'var(--bg)',
        boxShadow: active ? '0 0 0 1px var(--brand)' : 'none',
        color: 'var(--text)', cursor: 'pointer', font: 'inherit',
      }}
    >
      <span style={{ fontSize: '0.95rem', fontWeight: 600 }}>{main}</span>
      {sub && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{sub}</span>}
    </button>
  );

  return createPortal(
    <div className="modal-backdrop">
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '420px', width: '100%' }}>
        {/* header: step dots + skip */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
          <div style={{ display: 'flex', gap: '6px' }}>
            {STEPS.map((_, i) => (
              <span key={i} style={{ width: i === step ? '20px' : '7px', height: '7px', borderRadius: '4px', background: i <= step ? 'var(--brand)' : 'var(--border)', transition: 'width .15s' }} />
            ))}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={skip} style={{ marginRight: '-6px' }}>Skip</button>
        </div>

        {step === 0 && (
          <>
            <h3 style={{ marginBottom: '4px' }}>Where do you play?</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '14px' }}>
              We'll show live events near you. You can change this anytime from the location button.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              {regions.map(([key, { label }]) => optBtn(locChoice === key, () => { setLocChoice(key); setCoords(null); }, label))}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
              {optBtn(locChoice === 'current', useMyLocation, locating ? 'Locating…' : (locChoice === 'current' ? 'Using my location ✓' : '📍 Use my location'), locChoice === 'current' ? 'within 100 miles' : null)}
              {optBtn(locChoice === 'everywhere', () => { setLocChoice('everywhere'); setCoords(null); }, 'Everywhere / I travel', 'no location filter')}
            </div>
            {locError && <div style={{ color: 'var(--danger, #d66)', fontSize: '0.8rem', marginTop: '8px' }}>{locError}</div>}
          </>
        )}

        {step === 1 && (
          <>
            <h3 style={{ marginBottom: '4px' }}>Do you play online?</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '14px' }}>
              Online events have no location, so they're shown separately.
            </p>
            <div style={{ display: 'flex', gap: '8px' }}>
              <div style={{ flex: 1 }}>{optBtn(playsOnline === true, () => setPlaysOnline(true), 'Yes')}</div>
              <div style={{ flex: 1 }}>{optBtn(playsOnline === false, () => setPlaysOnline(false), 'No')}</div>
            </div>
            {playsOnline === true && (
              <div style={{ marginTop: '14px' }}>
                <label htmlFor="ob-state" style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
                  Which state are you in? <span style={{ color: 'var(--text-faint, var(--text-muted))' }}>(so we can show which sites are available to you)</span>
                </label>
                <select id="ob-state" value={jurisdiction} onChange={e => setJurisdiction(e.target.value)}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: '0.95rem', boxSizing: 'border-box' }}>
                  <option value="">Select your state…</option>
                  {US_STATES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
                </select>
              </div>
            )}
          </>
        )}

        {step === 2 && (
          <>
            <h3 style={{ marginBottom: '4px' }}>What do you play?</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '14px' }}>
              Sets your game filter — loosen it anytime.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {GAME_CHOICES.map(c => optBtn(games === c.key, () => setGames(c.key), c.label, c.sub))}
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h3 style={{ marginBottom: '4px' }}>Typical buy-in?</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '14px' }}>
              We'll focus the list on your range.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {BUYIN_CHOICES.map(c => optBtn(buyin === c.key, () => setBuyin(c.key), c.label))}
            </div>
          </>
        )}

        {/* footer nav */}
        <div style={{ display: 'flex', gap: '8px', marginTop: '18px', justifyContent: 'space-between' }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setStep(s => Math.max(0, s - 1))} disabled={step === 0} style={{ visibility: step === 0 ? 'hidden' : 'visible' }}>Back</button>
          {step < 3
            ? <button className="btn btn-primary btn-sm" onClick={() => setStep(s => s + 1)} disabled={!canAdvance}>Next</button>
            : <button className="btn btn-primary btn-sm" onClick={finish} disabled={!canAdvance}>Show my schedule</button>}
        </div>
      </div>
    </div>,
    document.body
  );
}

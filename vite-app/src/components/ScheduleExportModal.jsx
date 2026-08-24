import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { getVenueInfo, currencySymbol, normaliseDate, getToday, parseTournamentTime, VENUE_COORDS, LOCATION_REGIONS } from '../utils/utils.js';
import { generateSchedulePDF, generateScheduleImages, shareOrDownloadCanvas } from '../utils/export.js';

const DEFAULT_BUYIN_RANGES = [
  { label: 'Up to $1,500', min: 0, max: 1500 },
  { label: 'Up to $3,000', min: 1501, max: 3000 },
  { label: '$5,000 \u2013 $10,000', min: 5000, max: 10000 },
  { label: '$25,000+', min: 25000, max: Infinity },
];

export default function ScheduleExportModal({ events, onClose }) {
  const [mode, setMode] = useState('menu'); // menu | preview
  const [canvases, setCanvases] = useState([]);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [generating, setGenerating] = useState(false);
  const previewRef = useRef(null);

  const [docTitle, setDocTitle] = useState('MY SCHEDULE');

  // The export functions themselves drop past dates and non-restart
  // restarts, then sort chronologically. We mirror that filter here so
  // the venue picker, totals, and previews never reference series that
  // already finished.
  const upcomingEvents = useMemo(() => {
    const todayISO = getToday();
    // Decorate-sort-undecorate — parseTournamentTime is now memoized but
    // calling it O(n) instead of O(n log n) is still a meaningful win and
    // keeps the call shape consistent with TournamentsView / ScheduleView.
    const passed = events.filter(e => !e.is_restart && normaliseDate(e.date) >= todayISO);
    const decorated = passed.map(t => ({ t, ts: parseTournamentTime(t) }));
    decorated.sort((a, b) => a.ts - b.ts);
    return decorated.map(x => x.t);
  }, [events]);

  const venueList = useMemo(() => {
    const seen = new Map();
    upcomingEvents.forEach(e => {
      const v = getVenueInfo(e.venue);
      if (!seen.has(v.abbr)) seen.set(v.abbr, { longName: v.longName || v.abbr, color: v.color || '#808080' });
    });
    return [...seen.entries()];
  }, [upcomingEvents]);

  // Default venue selection: only Vegas venues. Computed from each
  // upcoming event's raw venue name + VENUE_COORDS, tested against the
  // shared LOCATION_REGIONS.lasvegas predicate (~30mi from the strip).
  // Out-of-state series start unchecked but the user can toggle them on.
  const vegasVenueAbbrs = useMemo(() => {
    const isVegas = LOCATION_REGIONS.lasvegas?.test;
    const out = new Set();
    if (!isVegas) return out;
    upcomingEvents.forEach(e => {
      const c = VENUE_COORDS[e.venue];
      if (c && isVegas(c)) out.add(getVenueInfo(e.venue).abbr);
    });
    return out;
  }, [upcomingEvents]);

  const [selectedVenues, setSelectedVenues] = useState(() => new Set(vegasVenueAbbrs));
  // If the venue list re-computes (e.g., events fetched after mount),
  // and the user hasn't touched the selection yet, sync to Vegas-only.
  const userTouchedSelectionRef = useRef(false);
  useEffect(() => {
    if (userTouchedSelectionRef.current) return;
    setSelectedVenues(new Set(vegasVenueAbbrs));
  }, [vegasVenueAbbrs]);
  const [excludeSatellites, setExcludeSatellites] = useState(false);
  const [lightMode, setLightMode] = useState(true);
  const [groupByBuyin, setGroupByBuyin] = useState(true);
  const [buyinRanges, setBuyinRanges] = useState(DEFAULT_BUYIN_RANGES);

  const allSelected = selectedVenues.size === venueList.length;
  const toggleAll = () => {
    userTouchedSelectionRef.current = true;
    if (allSelected) setSelectedVenues(new Set());
    else setSelectedVenues(new Set(venueList.map(([a]) => a)));
  };
  const toggleVenue = (abbr) => {
    userTouchedSelectionRef.current = true;
    setSelectedVenues(prev => {
      const next = new Set(prev);
      if (next.has(abbr)) next.delete(abbr); else next.add(abbr);
      return next;
    });
  };

  const filteredEvents = useMemo(() =>
    upcomingEvents.filter(e => {
      if (!selectedVenues.has(getVenueInfo(e.venue).abbr)) return false;
      if (excludeSatellites && e.is_satellite) return false;
      if (groupByBuyin && buyinRanges.length > 0) {
        const b = Number(e.buyin) || 0;
        if (!buyinRanges.some(r => b >= r.min && b <= (r.max === Infinity ? 1e12 : r.max))) return false;
      }
      return true;
    }),
    [upcomingEvents, selectedVenues, excludeSatellites, groupByBuyin, buyinRanges]
  );

  const handlePDF = async () => {
    if (!filteredEvents.length) return;
    try {
      await generateSchedulePDF(filteredEvents, docTitle, { light: lightMode, groupByBuyin, buyinRanges: groupByBuyin ? buyinRanges : undefined });
      onClose();
    } catch (err) {
      console.error('PDF generation failed:', err);
      alert('PDF generation failed: ' + (err.message || 'Unknown error'));
    }
  };

  const handleImages = () => {
    if (!filteredEvents.length) return;
    setGenerating(true);
    setTimeout(() => {
      const imgs = generateScheduleImages(filteredEvents, docTitle, { light: lightMode, groupByBuyin, buyinRanges: groupByBuyin ? buyinRanges : undefined });
      setCanvases(imgs);
      setMode('preview');
      setGenerating(false);
    }, 50);
  };

  useEffect(() => {
    if (mode !== 'preview' || !previewRef.current || canvases.length === 0) return;
    const cvs = previewRef.current;
    cvs.width = 1080; cvs.height = 1920;
    const ctx = cvs.getContext('2d');
    ctx.drawImage(canvases[currentSlide], 0, 0);
  }, [mode, currentSlide, canvases]);

  const handleShareSlide = async () => {
    if (canvases[currentSlide]) {
      await shareOrDownloadCanvas(canvases[currentSlide], 'my-schedule-' + (currentSlide + 1) + '.png');
    }
  };

  const handleDownloadAll = async () => {
    for (let i = 0; i < canvases.length; i++) {
      await shareOrDownloadCanvas(canvases[i], 'my-schedule-' + (i + 1) + '.png');
      if (i < canvases.length - 1) await new Promise(r => setTimeout(r, 400));
    }
  };

  const totalMax = useMemo(() => {
    return filteredEvents.reduce((sum, e) => {
      if (e.is_restart) return sum;
      const buyin = Number(e.buyin) || 0;
      const entries = e.planned_entries || 1;
      return sum + buyin * entries;
    }, 0);
  }, [filteredEvents]);

  return createPortal(
    <>
      <div className="share-menu-backdrop" onClick={onClose} />
      <div className="share-menu-panel" style={{ maxHeight: '85vh' }}>
        {mode === 'menu' ? (
          <>
            <h3>Export Schedule</h3>

            {/* Document title input */}
            <div className="filter-group" style={{ marginBottom: '12px' }}>
              <label>Document Title</label>
              <input
                type="text"
                value={docTitle}
                onChange={e => setDocTitle(e.target.value)}
                placeholder="MY SCHEDULE"
                style={{ padding: '8px 12px', border: '1.5px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg)', color: 'var(--text)', fontFamily: "'Univers Condensed', 'Univers', sans-serif", fontSize: '0.9rem', width: '100%', boxSizing: 'border-box' }}
              />
            </div>

            {/* Series filter checkboxes */}
            <div style={{ marginBottom: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <label style={{ fontSize: '0.78rem', fontWeight: 'var(--fw-bold)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Include Series</label>
                <button
                  onClick={toggleAll}
                  style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: '0.75rem', cursor: 'pointer', fontFamily: "'Univers Condensed', 'Univers', sans-serif", padding: 0 }}
                >{allSelected ? 'None' : 'All'}</button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '140px', overflowY: 'auto' }}>
                {venueList.map(([abbr, info]) => (
                  <label
                    key={abbr}
                    style={{ fontSize: '0.82rem', fontFamily: "'Univers Condensed', 'Univers', sans-serif", fontWeight: 'var(--fw-regular)', color: info.color, cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', gap: '8px' }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedVenues.has(abbr)}
                      onChange={() => toggleVenue(abbr)}
                      style={{ width: '16px', height: '16px', accentColor: 'var(--accent)', cursor: 'pointer' }}
                    />
                    {info.longName}
                  </label>
                ))}
              </div>
            </div>

            {/* Exclude satellites + event count */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem', fontFamily: "'Univers Condensed', 'Univers', sans-serif", fontWeight: 'var(--fw-regular)', color: 'var(--text)', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={excludeSatellites}
                  onChange={e => setExcludeSatellites(e.target.checked)}
                  style={{ width: '16px', height: '16px', accentColor: 'var(--accent)', cursor: 'pointer' }}
                />
                Exclude Satellites
              </label>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                {filteredEvents.length} event{filteredEvents.length !== 1 ? 's' : ''}
              </span>
            </div>

            {/* Light mode toggle */}
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem', fontFamily: "'Univers Condensed', 'Univers', sans-serif", fontWeight: 'var(--fw-regular)', color: 'var(--text)', cursor: 'pointer', marginBottom: '12px' }}>
              <input
                type="checkbox"
                checked={lightMode}
                onChange={e => setLightMode(e.target.checked)}
                style={{ width: '16px', height: '16px', accentColor: 'var(--accent)', cursor: 'pointer' }}
              />
              Export in Light Mode
            </label>

            {/* Group by buy-in range toggle */}
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem', fontFamily: "'Univers Condensed', 'Univers', sans-serif", fontWeight: 'var(--fw-regular)', color: 'var(--text)', cursor: 'pointer', marginBottom: groupByBuyin ? '8px' : '12px' }}>
              <input
                type="checkbox"
                checked={groupByBuyin}
                onChange={e => setGroupByBuyin(e.target.checked)}
                style={{ width: '16px', height: '16px', accentColor: 'var(--accent)', cursor: 'pointer' }}
              />
              Group by Buy-in Range
            </label>

            {/* Buy-in range editor */}
            {groupByBuyin && (
              <div style={{ marginBottom: '12px', padding: '10px 12px', background: 'var(--surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <span style={{ fontSize: '0.72rem', fontWeight: 'var(--fw-bold)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: "'Univers Condensed', 'Univers', sans-serif" }}>Ranges</span>
                  <button
                    onClick={() => setBuyinRanges(prev => [...prev, { min: 0, max: 0, label: '' }])}
                    style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: '0.75rem', cursor: 'pointer', fontFamily: "'Univers Condensed', 'Univers', sans-serif", padding: 0 }}
                  >+ Add Range</button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {buyinRanges.map((range, idx) => (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <input
                        type="text"
                        value={range.label}
                        onChange={e => {
                          const next = [...buyinRanges];
                          next[idx] = { ...next[idx], label: e.target.value };
                          setBuyinRanges(next);
                        }}
                        placeholder="Label"
                        style={{ flex: 1, padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg)', color: 'var(--text)', fontFamily: "'Univers Condensed', 'Univers', sans-serif", fontSize: '0.78rem' }}
                      />
                      <input
                        type="number"
                        value={range.min === 0 ? '0' : range.min}
                        onChange={e => {
                          const next = [...buyinRanges];
                          next[idx] = { ...next[idx], min: Number(e.target.value) || 0 };
                          setBuyinRanges(next);
                        }}
                        placeholder="Min"
                        style={{ width: '55px', padding: '4px 6px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg)', color: 'var(--text)', fontFamily: "'Univers Condensed', 'Univers', sans-serif", fontSize: '0.78rem', textAlign: 'right' }}
                      />
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{'\u2013'}</span>
                      <input
                        type="text"
                        value={range.max === Infinity ? '' : range.max}
                        onChange={e => {
                          const next = [...buyinRanges];
                          const val = e.target.value.trim();
                          next[idx] = { ...next[idx], max: val === '' ? Infinity : (Number(val) || 0) };
                          setBuyinRanges(next);
                        }}
                        placeholder={'\u221E'}
                        style={{ width: '55px', padding: '4px 6px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg)', color: 'var(--text)', fontFamily: "'Univers Condensed', 'Univers', sans-serif", fontSize: '0.78rem', textAlign: 'right' }}
                      />
                      {buyinRanges.length > 1 && (
                        <button
                          onClick={() => setBuyinRanges(prev => prev.filter((_, i) => i !== idx))}
                          style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.9rem', padding: '0 2px', lineHeight: 1 }}
                        >{'\u00D7'}</button>
                      )}
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => setBuyinRanges(DEFAULT_BUYIN_RANGES)}
                  style={{ marginTop: '6px', background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '0.68rem', cursor: 'pointer', fontFamily: "'Univers Condensed', 'Univers', sans-serif", padding: 0 }}
                >Reset to Defaults</button>
              </div>
            )}

            {/* Total max buyins */}
            {totalMax > 0 && (
              <div style={{ marginBottom: '12px', padding: '10px 12px', background: 'var(--surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 'var(--fw-bold)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px', fontFamily: "'Univers Condensed', 'Univers', sans-serif" }}>Total Maximum Buy-ins</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text)', fontFamily: "'Univers Condensed', 'Univers', sans-serif" }}>{'$' + totalMax.toLocaleString()}</div>
              </div>
            )}

            {/* Export buttons */}
            <div className="export-options">
              <button className="export-option-btn" onClick={handlePDF} disabled={!filteredEvents.length}>
                <span className="export-option-icon">{'\uD83D\uDCC4'}</span>
                <div>
                  <div className="export-option-label">Download PDF</div>
                  <div className="export-option-desc">Table layout, great for printing</div>
                </div>
              </button>
              <button className="export-option-btn" onClick={handleImages} disabled={generating || !filteredEvents.length}>
                <span className="export-option-icon">{generating ? '\u23F3' : '\uD83D\uDDBC\uFE0F'}</span>
                <div>
                  <div className="export-option-label">{generating ? 'Generating...' : 'Download Images'}</div>
                  <div className="export-option-desc">Story-sized, perfect for sharing</div>
                </div>
              </button>
            </div>
            <div style={{ textAlign: 'center', marginTop: '12px' }}>
              <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
            </div>
          </>
        ) : (
          <>
            <h3>Schedule Images</h3>
            {canvases.length > 1 && (
              <div className="wrapup-slide-picker">
                {canvases.map((_, i) => (
                  <button
                    key={i}
                    className={currentSlide === i ? 'active' : ''}
                    onClick={() => setCurrentSlide(i)}
                  >Page {i + 1}</button>
                ))}
              </div>
            )}
            <div style={{ textAlign: 'center', margin: '12px 0' }}>
              <canvas
                ref={previewRef}
                style={{ width: '200px', height: '356px', borderRadius: '8px', border: '1px solid var(--border)' }}
              />
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
              <button className="btn btn-primary btn-sm" onClick={handleShareSlide}>
                {canvases.length > 1 ? 'Share This Page' : 'Share Image'}
              </button>
              {canvases.length > 1 && (
                <button className="btn btn-ghost btn-sm" onClick={handleDownloadAll}>Download All</button>
              )}
              <button className="btn btn-ghost btn-sm" onClick={() => { setMode('menu'); setCanvases([]); setCurrentSlide(0); }}>Back</button>
            </div>
          </>
        )}
      </div>
    </>,
    document.body
  );
}

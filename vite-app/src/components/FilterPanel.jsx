import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon.jsx';
import { getVenueInfo, haptic } from '../utils/utils.js';

export default function FilterPanel({
  gameVariants, venues,
  selectedVenues, setSelectedVenues,
  selectedGames, setSelectedGames,
  buyinMin, setBuyinMin,
  buyinMax, setBuyinMax,
  dateFrom, setDateFrom,
  dateTo, setDateTo,
  onClose,
}) {
  const [openSection, setOpenSection] = useState(null);

  const toggleSection = (s) => setOpenSection(prev => prev === s ? null : s);

  const toggleVenue = (v) => {
    setSelectedVenues(prev =>
      prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]
    );
  };

  const toggleGame = (g) => {
    setSelectedGames(prev =>
      prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g]
    );
  };

  const clearAll = () => {
    setSelectedVenues([]);
    setSelectedGames([]);
    setBuyinMin('');
    setBuyinMax('');
    setDateFrom('');
    setDateTo('');
  };

  const hasFilters = selectedVenues.length > 0 || selectedGames.length > 0 || buyinMin || buyinMax || dateFrom || dateTo;

  return createPortal(
    <>
      <div className="dropdown-backdrop" onClick={onClose} />
      <div className="filter-panel">
        <div className="filter-panel-header">
          <span className="filter-panel-title">Filters</span>
          {hasFilters && (
            <button className="btn btn-ghost btn-sm" onClick={clearAll}>Clear All</button>
          )}
        </div>

        {/* Date Range */}
        <div className="filter-section">
          <div className="filter-section-header" onClick={() => toggleSection('date')}>
            <span>When?</span>
            <Icon.chevRight />
          </div>
          {openSection === 'date' && (
            <div className="filter-section-body">
              <div style={{display:'flex',gap:'calc(var(--subrow) * 1)'}}>
                <div className="form-field" style={{flex:1}}>
                  <label>From</label>
                  <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
                </div>
                <div className="form-field" style={{flex:1}}>
                  <label>To</label>
                  <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Venue */}
        <div className="filter-section">
          <div className="filter-section-header" onClick={() => toggleSection('venue')}>
            <span>Where? {selectedVenues.length > 0 ? `(${selectedVenues.length})` : ''}</span>
            <Icon.chevRight />
          </div>
          {openSection === 'venue' && (
            <div className="filter-section-body">
              {(venues || []).map(v => (
                <label key={v} className="filter-checkbox">
                  <input type="checkbox" checked={selectedVenues.includes(v)} onChange={() => toggleVenue(v)} />
                  {getVenueInfo(v).abbr} - {v}
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Game Variant */}
        <div className="filter-section">
          <div className="filter-section-header" onClick={() => toggleSection('game')}>
            <span>Variant {selectedGames.length > 0 ? `(${selectedGames.length})` : ''}</span>
            <Icon.chevRight />
          </div>
          {openSection === 'game' && (
            <div className="filter-section-body">
              {(gameVariants || []).map(g => (
                <label key={g} className="filter-checkbox">
                  <input type="checkbox" checked={selectedGames.includes(g)} onChange={() => toggleGame(g)} />
                  {g}
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Buy-in Range */}
        <div className="filter-section">
          <div className="filter-section-header" onClick={() => toggleSection('buyin')}>
            <span>Buy-in / Rake</span>
            <Icon.chevRight />
          </div>
          {openSection === 'buyin' && (
            <div className="filter-section-body">
              <div style={{display:'flex',gap:'calc(var(--subrow) * 1)'}}>
                <div className="form-field" style={{flex:1}}>
                  <label>Min $</label>
                  <input type="number" value={buyinMin} onChange={e => setBuyinMin(e.target.value)} placeholder="0" />
                </div>
                <div className="form-field" style={{flex:1}}>
                  <label>Max $</label>
                  <input type="number" value={buyinMax} onChange={e => setBuyinMax(e.target.value)} placeholder="Any" />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>,
    document.body
  );
}

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon.jsx';
import { FirstRun } from './EmptyState.jsx';
import { API_URL } from '../utils/api.js';
import { formatBuyin } from '../utils/utils.js';

// ── Staking Platform ────────────────────────────────────────

export const BACKER_TYPE_LABELS = {
  pay_per_play: 'Pay Per Play',
  open_commitment: 'Open Commitment',
  budget_capped: 'Budget Capped',
  flat_package: 'Flat Package',
  profit_share_only: 'Profit Share',
  makeup: 'Makeup',
  tiered_markup: 'Tiered Markup',
  swap: 'Swap',
  crossbook: 'Crossbook'
};

// ── Staking Settings (Sell Params + Markup) ──────────────

function StakingSettings({ token, tournaments, onBack }) {
  const [sellParams, setSellParams] = useState([]);
  const [markupSettings, setMarkupSettings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState('sell'); // sell | markup

  const BUYIN_TIERS = [
    { key: '0-500', label: '\u2264 $500' },
    { key: '500-1000', label: '$500\u2013$1K' },
    { key: '1000-3000', label: '$1K\u2013$3K' },
    { key: '3000-10000', label: '$3K\u2013$10K' },
    { key: '10000+', label: '$10K+' },
  ];

  const GAME_PRESETS = useMemo(() => {
    if (!tournaments) return [];
    const vars = new Set();
    tournaments.forEach(t => { if (t.game_variant) vars.add(t.game_variant); });
    return [...vars].sort().slice(0, 12);
  }, [tournaments]);

  useEffect(() => {
    (async () => {
      try {
        const [sp, ms] = await Promise.all([
          fetch(`${API_URL}/staking/sell-params`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
          fetch(`${API_URL}/staking/markup-settings`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
        ]);
        if (Array.isArray(sp)) setSellParams(sp);
        if (Array.isArray(ms)) setMarkupSettings(ms);
      } catch {}
      setLoading(false);
    })();
  }, []);

  const getSellPct = (type, key) => {
    const p = sellParams.find(s => s.param_type === type && s.param_key === key);
    return p ? p.sell_pct : '';
  };

  const setSellPct = (type, key, val) => {
    setSellParams(prev => {
      const idx = prev.findIndex(s => s.param_type === type && s.param_key === key);
      const entry = { param_type: type, param_key: key, sell_pct: parseFloat(val) || 0 };
      if (idx >= 0) { const copy = [...prev]; copy[idx] = { ...copy[idx], ...entry }; return copy; }
      return [...prev, entry];
    });
  };

  const getMarkup = (type, key) => {
    const m = markupSettings.find(s => s.setting_type === type && s.setting_key === key);
    return m ? m.markup : '';
  };

  const setMarkupVal = (type, key, val) => {
    setMarkupSettings(prev => {
      const idx = prev.findIndex(s => s.setting_type === type && s.setting_key === key);
      const entry = { setting_type: type, setting_key: key, markup: parseFloat(val) || 1.0 };
      if (idx >= 0) { const copy = [...prev]; copy[idx] = { ...copy[idx], ...entry }; return copy; }
      return [...prev, entry];
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const validSell = sellParams.filter(s => s.sell_pct > 0);
      const validMarkup = markupSettings.filter(m => m.markup > 0);
      await Promise.all([
        fetch(`${API_URL}/staking/sell-params`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(validSell)
        }),
        fetch(`${API_URL}/staking/markup-settings`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(validMarkup)
        }),
      ]);
    } catch {}
    setSaving(false);
  };

  if (loading) return <div style={{textAlign:'center',padding:40,color:'var(--text-muted)'}}>Loading&hellip;</div>;

  return (
    <div style={{padding:'0 0 20px'}}>
      <div className="section-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'16px 16px 8px'}}>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <button className="btn btn-ghost btn-sm" onClick={onBack} style={{fontSize:16,padding:'4px 8px'}}>&larr;</button>
          <h2 style={{fontFamily:'Univers Condensed, Univers, sans-serif',textTransform:'uppercase',letterSpacing:1,fontSize:14,margin:0,color:'var(--text-muted)'}}>Sell & Markup Settings</h2>
        </div>
        <button className="create-group-submit" style={{fontSize:12,padding:'6px 14px'}} onClick={handleSave} disabled={saving}>
          {saving ? 'Saving\u2026' : 'Save'}
        </button>
      </div>

      <div style={{display:'flex',gap:0,borderBottom:'1px solid var(--border)',margin:'0 16px 12px'}}>
        {[{k:'sell',l:'Default Sell %'},{k:'markup',l:'Default Markup'}].map(t => (
          <button key={t.k}
            style={{flex:1,padding:'10px 0',fontSize:12,fontWeight:tab === t.k ? 600 : 400,
              color: tab === t.k ? 'var(--accent)' : 'var(--text-muted)',
              borderBottom: tab === t.k ? '2px solid var(--accent)' : '2px solid transparent',
              background:'none',border:'none',cursor:'pointer'}}
            onClick={() => setTab(t.k)}>{t.l}</button>
        ))}
      </div>

      <div style={{padding:'0 16px'}}>
        {tab === 'sell' && (
          <div>
            <p style={{fontSize:11,color:'var(--text-muted)',margin:'0 0 12px'}}>
              Set default sell percentages by buyin tier or game type. These are used when creating new agreements.
            </p>
            <div style={{marginBottom:16}}>
              <div style={{fontSize:12,fontWeight: 'var(--fw-bold)',marginBottom:8,color:'var(--text-muted)'}}>By Buyin Tier</div>
              {BUYIN_TIERS.map(tier => (
                <div key={tier.key} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'6px 0',borderBottom:'1px solid var(--border)'}}>
                  <span style={{fontSize:12}}>{tier.label}</span>
                  <div style={{display:'flex',alignItems:'center',gap:4}}>
                    <input type="number" value={getSellPct('buyin_tier', tier.key)} onChange={e => setSellPct('buyin_tier', tier.key, e.target.value)}
                      placeholder="\u2014" min="0" max="100" step="5"
                      style={{width:60,textAlign:'right',fontSize:12,padding:'4px 6px',borderRadius:6,border:'1px solid var(--border)',background:'var(--surface)',color:'var(--text)'}} />
                    <span style={{fontSize:11,color:'var(--text-muted)'}}>%</span>
                  </div>
                </div>
              ))}
            </div>
            {GAME_PRESETS.length > 0 && (
              <div>
                <div style={{fontSize:12,fontWeight: 'var(--fw-bold)',marginBottom:8,color:'var(--text-muted)'}}>By Game Type</div>
                {GAME_PRESETS.map(game => (
                  <div key={game} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'6px 0',borderBottom:'1px solid var(--border)'}}>
                    <span style={{fontSize:12}}>{game}</span>
                    <div style={{display:'flex',alignItems:'center',gap:4}}>
                      <input type="number" value={getSellPct('game_type', game)} onChange={e => setSellPct('game_type', game, e.target.value)}
                        placeholder="\u2014" min="0" max="100" step="5"
                        style={{width:60,textAlign:'right',fontSize:12,padding:'4px 6px',borderRadius:6,border:'1px solid var(--border)',background:'var(--surface)',color:'var(--text)'}} />
                      <span style={{fontSize:11,color:'var(--text-muted)'}}>%</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'markup' && (
          <div>
            <p style={{fontSize:11,color:'var(--text-muted)',margin:'0 0 12px'}}>
              Set default markup multipliers by buyin tier or game type. 1.0 = no markup, 1.1 = 10% markup.
            </p>
            <div style={{marginBottom:16}}>
              <div style={{fontSize:12,fontWeight: 'var(--fw-bold)',marginBottom:8,color:'var(--text-muted)'}}>By Buyin Tier</div>
              {BUYIN_TIERS.map(tier => (
                <div key={tier.key} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'6px 0',borderBottom:'1px solid var(--border)'}}>
                  <span style={{fontSize:12}}>{tier.label}</span>
                  <div style={{display:'flex',alignItems:'center',gap:4}}>
                    <input type="number" value={getMarkup('buyin_tier', tier.key)} onChange={e => setMarkupVal('buyin_tier', tier.key, e.target.value)}
                      placeholder="\u2014" min="1" max="3" step="0.05"
                      style={{width:60,textAlign:'right',fontSize:12,padding:'4px 6px',borderRadius:6,border:'1px solid var(--border)',background:'var(--surface)',color:'var(--text)'}} />
                    <span style={{fontSize:11,color:'var(--text-muted)'}}>&times;</span>
                  </div>
                </div>
              ))}
            </div>
            {GAME_PRESETS.length > 0 && (
              <div>
                <div style={{fontSize:12,fontWeight: 'var(--fw-bold)',marginBottom:8,color:'var(--text-muted)'}}>By Game Type</div>
                {GAME_PRESETS.map(game => (
                  <div key={game} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'6px 0',borderBottom:'1px solid var(--border)'}}>
                    <span style={{fontSize:12}}>{game}</span>
                    <div style={{display:'flex',alignItems:'center',gap:4}}>
                      <input type="number" value={getMarkup('game_type', game)} onChange={e => setMarkupVal('game_type', game, e.target.value)}
                        placeholder="\u2014" min="1" max="3" step="0.05"
                        style={{width:60,textAlign:'right',fontSize:12,padding:'4px 6px',borderRadius:6,border:'1px solid var(--border)',background:'var(--surface)',color:'var(--text)'}} />
                      <span style={{fontSize:11,color:'var(--text-muted)'}}>&times;</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Staking View ──────────────────────────────────────

export default function StakingView({ token, tournaments, mySchedule }) {
  const [subView, setSubView] = useState('list'); // list | detail | backers | backerSummary | settings
  const [series, setSeries] = useState([]);
  const [backers, setBackers] = useState([]);
  const [activeSeriesId, setActiveSeriesId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showSeriesForm, setShowSeriesForm] = useState(false);
  const [editSeries, setEditSeries] = useState(null);

  const fetchSeries = async () => {
    try {
      const res = await fetch(`${API_URL}/staking/series`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setSeries(await res.json());
    } catch {} finally { setLoading(false); }
  };

  const fetchBackers = async () => {
    try {
      const res = await fetch(`${API_URL}/staking/backers`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setBackers(await res.json());
    } catch {}
  };

  useEffect(() => { fetchSeries(); fetchBackers(); }, []);

  const activeSeries = series.find(s => s.id === activeSeriesId);

  if (subView === 'settings') {
    return <StakingSettings token={token} tournaments={tournaments} onBack={() => setSubView('list')} />;
  }

  if (subView === 'backers') {
    return <BackerManager token={token} backers={backers} fetchBackers={fetchBackers} onBack={() => setSubView('list')} />;
  }

  if (subView === 'backerSummary') {
    return <BackerSummaryView token={token} onBack={() => setSubView('list')} onManage={() => setSubView('backers')} />;
  }

  if (subView === 'detail' && activeSeries) {
    return (
      <StakingSeriesDetail
        series={activeSeries}
        token={token}
        backers={backers}
        tournaments={tournaments}
        mySchedule={mySchedule}
        fetchSeries={fetchSeries}
        onBack={() => { setSubView('list'); setActiveSeriesId(null); }}
        onEdit={() => { setEditSeries(activeSeries); setShowSeriesForm(true); }}
      />
    );
  }

  return (
    <div>
      <StakingSeriesList
        series={series}
        loading={loading}
        onSelect={s => { setActiveSeriesId(s.id); setSubView('detail'); }}
        onCreate={() => { setEditSeries(null); setShowSeriesForm(true); }}
        onBackers={() => setSubView('backers')}
        onBackerSummary={() => setSubView('backerSummary')}
        onSettings={() => setSubView('settings')}
      />
      {showSeriesForm && (
        <StakingSeriesForm
          token={token}
          series={editSeries}
          tournaments={tournaments}
          onClose={() => { setShowSeriesForm(false); setEditSeries(null); }}
          onSaved={() => { setShowSeriesForm(false); setEditSeries(null); fetchSeries(); }}
        />
      )}
    </div>
  );
}

// ── Series List ────────────────────────────────────────────

function StakingSeriesList({ series, loading, onSelect, onCreate, onBackers, onBackerSummary, onSettings }) {
  if (loading) return <div style={{textAlign:'center',padding:40,color:'var(--text-muted)'}}>Loading&hellip;</div>;

  return (
    <div style={{padding:'0 0 20px'}}>
      <div className="section-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'16px 16px 8px'}}>
        <h2 style={{fontFamily:'Univers Condensed, Univers, sans-serif',textTransform:'uppercase',letterSpacing:1,fontSize:14,margin:0,color:'var(--text-muted)'}}>Staking</h2>
        <div style={{display:'flex',gap:8}}>
          <button className="btn btn-ghost btn-sm" style={{fontSize:12,padding:'6px 10px',color:'var(--text-muted)'}} onClick={onSettings} title="Sell & Markup Settings">{'\u2699'}</button>
          <button className="create-group-submit" style={{fontSize:12,padding:'6px 14px',background:'transparent',color:'var(--accent)',border:'1px solid var(--accent)'}} onClick={onBackerSummary}>Summary</button>
          <button className="create-group-submit" style={{fontSize:12,padding:'6px 14px',background:'transparent',color:'var(--accent)',border:'1px solid var(--accent)'}} onClick={onBackers}>Backers</button>
          <button className="create-group-submit" style={{fontSize:12,padding:'6px 14px'}} onClick={onCreate}>+ Series</button>
        </div>
      </div>

      {series.length === 0 ? (
        <FirstRun
          icon="handshake"
          title="Create your first series"
          body="A series groups the events a backing deal covers, so makeup and settlements calculate across the whole run."
          actionLabel="+ Series"
          onAction={onCreate}
        />
      ) : series.map(s => (
        <button key={s.id} className="staking-series-card" onClick={() => onSelect(s)}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
            <div style={{minWidth:0,flex:1}}>
              <div style={{fontWeight: 'var(--fw-bold)',fontSize:14}}>{s.name}</div>
              {s.venue && <div style={{fontSize:12,color:'var(--text-muted)',marginTop:2}}>{s.venue}</div>}
              {(s.start_date || s.end_date) && (
                <div style={{fontSize:11,color:'var(--text-muted)',marginTop:2}}>
                  {s.start_date && new Date(s.start_date + 'T12:00:00').toLocaleDateString('en-US', {month:'short',day:'numeric'})}
                  {s.start_date && s.end_date && ' \u2013 '}
                  {s.end_date && new Date(s.end_date + 'T12:00:00').toLocaleDateString('en-US', {month:'short',day:'numeric'})}
                </div>
              )}
            </div>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <span className={`staking-badge staking-badge-${s.status}`}>
                {s.status === 'pre' ? 'Pre' : s.status === 'active' ? 'Active' : 'Settled'}
              </span>
              <span style={{color:'var(--text-muted)',fontSize:16}}>&rsaquo;</span>
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

// ── Series Form (Create/Edit) ──────────────────────────────

function StakingSeriesForm({ token, series, tournaments, onClose, onSaved }) {
  const [name, setName] = useState(series?.name || '');
  const [venue, setVenue] = useState(series?.venue || '');
  const [startDate, setStartDate] = useState(series?.start_date || '');
  const [endDate, setEndDate] = useState(series?.end_date || '');
  const [currency, setCurrency] = useState(series?.currency || 'USD');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Build venue options from tournaments in DB
  const venueOptions = useMemo(() => {
    if (!tournaments) return [];
    return [...new Set(tournaments.map(t => t.venue))].sort();
  }, [tournaments]);

  const handleSave = async () => {
    if (!name.trim()) { setError('Name is required'); return; }
    setSaving(true);
    setError('');
    try {
      const body = { name: name.trim(), venue: venue || undefined, startDate: startDate || undefined, endDate: endDate || undefined, currency };
      const url = series ? `${API_URL}/staking/series/${series.id}` : `${API_URL}/staking/series`;
      const res = await fetch(url, {
        method: series ? 'PUT' : 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (res.ok) { onSaved(); } else {
        const d = await res.json(); setError(d.error || 'Failed to save');
      }
    } catch { setError('Network error'); }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!series || !confirm('Delete this series and all its agreements? This cannot be undone.')) return;
    try {
      await fetch(`${API_URL}/staking/series/${series.id}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token}` }
      });
      onSaved();
    } catch {}
  };

  return createPortal(
    <div className="notif-backdrop" onClick={onClose}>
      <div className="staking-modal" onClick={e => e.stopPropagation()}>
        <div className="staking-modal-header">
          <h3 style={{margin:0,fontSize:16,fontWeight: 'var(--fw-bold)'}}>{series ? 'Edit Series' : 'New Series'}</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>{'\u2715'}</button>
        </div>
        <div className="staking-modal-body">
          {error && <div style={{color:'#ef4444',fontSize:12,marginBottom:8}}>{error}</div>}
          <label className="staking-field"><span>Series *</span>
            <select value={name} onChange={e => {
              const v = e.target.value;
              setName(v);
              if (v) setVenue(v);
            }}>
              <option value="">Select a series&hellip;</option>
              {venueOptions.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
          <label className="staking-field"><span>Venue</span>
            <input type="text" value={venue} onChange={e => setVenue(e.target.value)} placeholder="Auto-filled from series" />
          </label>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
            <label className="staking-field"><span>Start Date</span>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
            </label>
            <label className="staking-field"><span>End Date</span>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
            </label>
          </div>
          <label className="staking-field"><span>Currency</span>
            <select value={currency} onChange={e => setCurrency(e.target.value)}>
              {['USD','EUR','GBP','CAD','AUD','CNY','JPY','CHF','SEK','NOK','DKK','MXN','BRL'].map(c => <option key={c}>{c}</option>)}
            </select>
          </label>
        </div>
        <div className="staking-modal-footer">
          {series && <button className="btn btn-ghost btn-sm" style={{color:'#ef4444'}} onClick={handleDelete}>Delete</button>}
          <div style={{flex:1}} />
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          <button className="create-group-submit" style={{fontSize:13,padding:'8px 20px'}} onClick={handleSave} disabled={saving}>
            {saving ? 'Saving\u2026' : 'Save'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Backer Manager ──────────────────────────────────────────

function BackerManager({ token, backers, fetchBackers, onBack }) {
  const [showForm, setShowForm] = useState(false);
  const [editBacker, setEditBacker] = useState(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const resetForm = () => { setName(''); setEmail(''); setPhone(''); setNotes(''); setEditBacker(null); setShowForm(false); setError(''); };

  const openEdit = (b) => {
    setEditBacker(b); setName(b.name); setEmail(b.email || ''); setPhone(b.phone || ''); setNotes(b.notes || ''); setShowForm(true);
  };

  const handleSave = async () => {
    if (!name.trim()) { setError('Name is required'); return; }
    setSaving(true); setError('');
    try {
      const body = { name: name.trim(), email: email || undefined, phone: phone || undefined, notes: notes || undefined };
      const url = editBacker ? `${API_URL}/staking/backers/${editBacker.id}` : `${API_URL}/staking/backers`;
      const res = await fetch(url, {
        method: editBacker ? 'PUT' : 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (res.ok) { resetForm(); fetchBackers(); } else {
        const d = await res.json(); setError(d.error || 'Failed');
      }
    } catch { setError('Network error'); }
    setSaving(false);
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this backer?')) return;
    try {
      const res = await fetch(`${API_URL}/staking/backers/${id}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) { const d = await res.json(); alert(d.error || 'Failed'); }
      else fetchBackers();
    } catch {}
  };

  return (
    <div>
      <div className="group-detail-header">
        <button className="group-back-btn" onClick={onBack}>&larr;</button>
        <div style={{flex:1}}><div className="social-buddy-name" style={{fontSize:16}}>Backers</div></div>
        <button className="create-group-submit" style={{fontSize:12,padding:'6px 14px'}} onClick={() => { resetForm(); setShowForm(!showForm); }}>
          {showForm ? 'Cancel' : '+ Add'}
        </button>
      </div>

      {showForm && (
        <div style={{padding:'12px 16px',borderBottom:'1px solid var(--border)'}}>
          {error && <div style={{color:'#ef4444',fontSize:12,marginBottom:8}}>{error}</div>}
          <label className="staking-field"><span>Name *</span>
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Backer name" />
          </label>
          <label className="staking-field"><span>Email</span>
            <input type="text" value={email} onChange={e => setEmail(e.target.value)} placeholder="email@example.com" />
          </label>
          <label className="staking-field"><span>Phone</span>
            <input type="text" value={phone} onChange={e => setPhone(e.target.value)} placeholder="Phone number" />
          </label>
          <label className="staking-field"><span>Notes</span>
            <input type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes" />
          </label>
          <button className="create-group-submit" style={{fontSize:13,padding:'8px 20px',width:'100%'}} onClick={handleSave} disabled={saving}>
            {saving ? 'Saving\u2026' : editBacker ? 'Update Backer' : 'Add Backer'}
          </button>
        </div>
      )}

      <div style={{padding:'12px 16px'}}>
        {backers.length === 0 ? (
          <FirstRun
            icon="people"
            title="Add your first backer"
            body="A backer needs to exist before you can write an agreement against them."
          />
        ) : backers.map(b => (
          <div key={b.id} className="staking-backer-card">
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontWeight: 'var(--fw-bold)',fontSize:14}}>{b.name}</div>
              {b.email && <div style={{fontSize:12,color:'var(--text-muted)'}}>{b.email}</div>}
              {b.phone && <div style={{fontSize:12,color:'var(--text-muted)'}}>{b.phone}</div>}
              {b.notes && <div style={{fontSize:11,color:'var(--text-muted)',fontStyle:'italic',marginTop:2}}>{b.notes}</div>}
            </div>
            <div style={{display:'flex',gap:6}}>
              <button className="btn btn-ghost btn-sm" onClick={() => openEdit(b)} style={{fontSize:11}}>Edit</button>
              <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(b.id)} style={{fontSize:11,color:'#ef4444'}}>{'\u2715'}</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Backer Summary View ─────────────────────────────────────

function BackerSummaryView({ token, onBack, onManage }) {
  const [summaries, setSummaries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_URL}/staking/backers/summary`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) setSummaries(await res.json());
      } catch {}
      setLoading(false);
    })();
  }, []);

  const get1099Status = (ytd) => {
    if (ytd >= 600) return { label: '1099 Required', color: '#ef4444', level: 2 };
    if (ytd >= 400) return { label: 'Near Threshold', color: '#f59e0b', level: 1 };
    return null;
  };

  if (loading) return <div style={{textAlign:'center',padding:40,color:'var(--text-muted)'}}>Loading&hellip;</div>;

  return (
    <div style={{padding:'0 0 20px'}}>
      <div className="section-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'16px 16px 8px'}}>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <button className="btn btn-ghost btn-sm" onClick={onBack} style={{fontSize:16,padding:'4px 8px'}}>&larr;</button>
          <h2 style={{fontFamily:'Univers Condensed, Univers, sans-serif',textTransform:'uppercase',letterSpacing:1,fontSize:14,margin:0,color:'var(--text-muted)'}}>Backer Summary</h2>
        </div>
        <button className="btn btn-ghost btn-sm" style={{fontSize:12}} onClick={onManage}>Manage</button>
      </div>

      {summaries.length === 0 ? (
        <FirstRun
          icon="people"
          title="No summaries yet"
          body="P&amp;L appears here once you have backers and logged events to calculate against."
        />
      ) : summaries.map(b => {
        const badge = get1099Status(b.ytd_winnings);
        const isExpanded = expandedId === b.id;
        return (
          <div key={b.id} className="staking-backer-card" style={{flexDirection:'column',alignItems:'stretch',cursor:'pointer'}}
            onClick={() => setExpandedId(isExpanded ? null : b.id)}>
            {/* Header row */}
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
              <div style={{minWidth:0,flex:1}}>
                <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                  <span style={{fontWeight: 'var(--fw-bold)',fontSize:14}}>{b.name}</span>
                  {badge && (
                    <span style={{
                      fontSize:10,fontWeight: 'var(--fw-bold)',color:'#fff',padding:'2px 8px',borderRadius:999,
                      background: badge.color, letterSpacing:0.5
                    }}>{badge.label}</span>
                  )}
                  {b.active_count > 0 && (
                    <span style={{fontSize:10,color:'var(--text-muted)',background:'var(--hover-overlay)',padding:'2px 6px',borderRadius:4}}>
                      {b.active_count} active
                    </span>
                  )}
                </div>
                {b.email && <div style={{fontSize:12,color:'var(--text-muted)',marginTop:2}}>{b.email}</div>}
                {b.phone && <div style={{fontSize:12,color:'var(--text-muted)'}}>{b.phone}</div>}
              </div>
              <div style={{textAlign:'right',flexShrink:0,marginLeft:12}}>
                <div style={{fontSize:13,fontWeight:700,color: b.net_pl >= 0 ? '#22c55e' : '#ef4444'}}>
                  {b.net_pl >= 0 ? '+' : ''}{formatBuyin(b.net_pl)}
                </div>
                <div style={{fontSize:11,color:'var(--text-muted)'}}>net P&amp;L</div>
              </div>
            </div>

            {/* Stats row */}
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginTop:10,paddingTop:8,borderTop:'1px solid var(--border)'}}>
              <div style={{textAlign:'center'}}>
                <div style={{fontSize:12,fontWeight: 'var(--fw-bold)'}}>{formatBuyin(b.total_invested)}</div>
                <div style={{fontSize:10,color:'var(--text-muted)'}}>Invested</div>
              </div>
              <div style={{textAlign:'center'}}>
                <div style={{fontSize:12,fontWeight: 'var(--fw-bold)'}}>{formatBuyin(b.total_returned)}</div>
                <div style={{fontSize:10,color:'var(--text-muted)'}}>Returned</div>
              </div>
              <div style={{textAlign:'center'}}>
                <div style={{fontSize:12,fontWeight: 'var(--fw-bold)',color: b.ytd_winnings > 0 ? '#f59e0b' : 'var(--text-muted)'}}>
                  {formatBuyin(b.ytd_winnings)}
                </div>
                <div style={{fontSize:10,color:'var(--text-muted)'}}>YTD</div>
              </div>
            </div>

            {/* Expanded: active agreements */}
            {isExpanded && b.agreements && b.agreements.length > 0 && (
              <div style={{marginTop:10,paddingTop:8,borderTop:'1px solid var(--border)'}}>
                <div style={{fontSize:11,fontWeight: 'var(--fw-bold)',color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:1,marginBottom:6,
                  fontFamily:'Univers Condensed, Univers, sans-serif'}}>Active Agreements</div>
                {b.agreements.map((ag, i) => (
                  <div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',
                    padding:'5px 0',borderBottom:'1px solid var(--border)',fontSize:12}}>
                    <div style={{minWidth:0,flex:1}}>
                      <span style={{fontWeight: 'var(--fw-regular)'}}>{ag.series_name}</span>
                      <span style={{marginLeft:6,fontSize:11,color:'var(--text-muted)'}}>{BACKER_TYPE_LABELS[ag.backer_type] || ag.backer_type}</span>
                    </div>
                    <span style={{color:'var(--accent)',fontWeight: 'var(--fw-bold)',flexShrink:0,marginLeft:8}}>{ag.pct}%</span>
                  </div>
                ))}
              </div>
            )}
            {isExpanded && b.agreements && b.agreements.length === 0 && (
              <div style={{marginTop:10,paddingTop:8,borderTop:'1px solid var(--border)',fontSize:12,color:'var(--text-muted)'}}>
                No active agreements
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Series Detail View ──────────────────────────────────────

function StakingSeriesDetail({ series, token, backers, tournaments, mySchedule, fetchSeries, onBack, onEdit }) {
  const [segment, setSegment] = useState('agreements');
  const [agreements, setAgreements] = useState([]);
  const [showAgreementForm, setShowAgreementForm] = useState(false);
  const [eventStatuses, setEventStatuses] = useState([]);
  const [settlementData, setSettlementData] = useState(null);

  const fetchAgreements = async () => {
    try {
      const res = await fetch(`${API_URL}/staking/series/${series.id}/agreements`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setAgreements(await res.json());
    } catch {}
  };

  const fetchEvents = async () => {
    try {
      const res = await fetch(`${API_URL}/staking/series/${series.id}/events`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setEventStatuses(await res.json());
    } catch {}
  };

  const fetchSettlement = async () => {
    try {
      const res = await fetch(`${API_URL}/staking/series/${series.id}/settlement`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setSettlementData(await res.json());
    } catch {}
  };

  useEffect(() => { fetchAgreements(); }, [series.id]);
  useEffect(() => {
    if (segment === 'events') fetchEvents();
    if (segment === 'settlement') fetchSettlement();
  }, [segment, series.id]);

  const totalPct = useMemo(() => agreements.filter(a => a.is_active && a.backer_type !== 'profit_share_only').reduce((s, a) => s + (a.percentage || 0), 0), [agreements]);

  return (
    <div className="group-detail-view">
      <div className="group-detail-header">
        <button className="group-back-btn" onClick={onBack}>&larr;</button>
        <div style={{flex:1}}>
          <div className="social-buddy-name" style={{fontSize:16}}>{series.name}</div>
          <div style={{fontSize:12,color:'var(--text-muted)'}}>
            {agreements.length} agreement{agreements.length !== 1 ? 's' : ''} &middot; {totalPct}% sold
          </div>
        </div>
        <span className={`staking-badge staking-badge-${series.status}`}>
          {series.status === 'pre' ? 'Pre' : series.status === 'active' ? 'Active' : 'Settled'}
        </span>
        <button className="btn btn-ghost btn-sm" onClick={onEdit} style={{fontSize:12,marginLeft:4}}>{'\u270E'}</button>
      </div>

      <div className="group-segments">
        {['agreements', 'events', 'settlement'].map(s => (
          <button key={s} className={`group-segment-btn${segment === s ? ' active' : ''}`} onClick={() => setSegment(s)}>
            {s === 'agreements' ? 'Agreements' : s === 'events' ? 'Events' : 'Settlement'}
          </button>
        ))}
      </div>

      {segment === 'agreements' && (
        <AgreementsList
          agreements={agreements}
          token={token}
          seriesId={series.id}
          backers={backers}
          fetchAgreements={fetchAgreements}
          onAdd={() => setShowAgreementForm(true)}
        />
      )}

      {segment === 'events' && (
        <StakingEventTracking
          seriesId={series.id}
          agreements={agreements}
          eventStatuses={eventStatuses}
          tournaments={tournaments}
          mySchedule={mySchedule}
          series={series}
          token={token}
          fetchEvents={fetchEvents}
        />
      )}

      {segment === 'settlement' && (
        <StakingSettlementView
          seriesId={series.id}
          settlementData={settlementData}
          token={token}
          fetchSettlement={fetchSettlement}
          fetchSeries={fetchSeries}
        />
      )}

      {showAgreementForm && (
        <AgreementForm
          token={token}
          seriesId={series.id}
          backers={backers}
          tournaments={tournaments}
          onClose={() => setShowAgreementForm(false)}
          onSaved={() => { setShowAgreementForm(false); fetchAgreements(); }}
        />
      )}
    </div>
  );
}

// ── Agreements List ─────────────────────────────────────────

function AgreementsList({ agreements, token, seriesId, backers, fetchAgreements, onAdd }) {
  const handleDelete = async (id) => {
    if (!confirm('Delete this agreement?')) return;
    try {
      await fetch(`${API_URL}/staking/agreements/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      fetchAgreements();
    } catch {}
  };

  const toggleActive = async (ag) => {
    try {
      await fetch(`${API_URL}/staking/agreements/${ag.id}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: ag.is_active ? false : true })
      });
      fetchAgreements();
    } catch {}
  };

  return (
    <div style={{padding:'12px 16px'}}>
      <button className="create-group-submit" style={{fontSize:13,padding:'8px 16px',marginBottom:12,width:'100%'}} onClick={onAdd}>
        + Add Agreement
      </button>

      {agreements.length === 0 ? (
        <div style={{textAlign:'center',color:'var(--text-muted)',padding:'30px 20px',fontSize:13}}>
          No agreements yet. Add a backer agreement to get started.
        </div>
      ) : agreements.map(ag => (
        <div key={ag.id} className={`staking-agreement-card${ag.is_active ? '' : ' inactive'}`}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
            <div style={{minWidth:0,flex:1}}>
              <div style={{fontWeight: 'var(--fw-bold)',fontSize:14}}>{ag.backer_name}</div>
              <div style={{display:'flex',gap:6,alignItems:'center',marginTop:4,flexWrap:'wrap'}}>
                <span className="staking-type-badge">{BACKER_TYPE_LABELS[ag.backer_type] || ag.backer_type}</span>
                {ag.backer_type !== 'profit_share_only' && ag.percentage > 0 && (
                  <span style={{fontSize:12,color:'var(--text-muted)'}}>{ag.percentage}%</span>
                )}
                {ag.markup > 1 && <span style={{fontSize:12,color:'var(--accent)'}}>{ag.markup}x markup</span>}
                {ag.backer_type === 'profit_share_only' && <span style={{fontSize:12,color:'var(--text-muted)'}}>{ag.percentage}% of profit</span>}
              </div>
              {(ag.buyin_range_min || ag.buyin_range_max) && (
                <div style={{fontSize:11,color:'var(--text-muted)',marginTop:2}}>
                  Buyin range: {ag.buyin_range_min ? formatBuyin(ag.buyin_range_min) : '$0'} &ndash; {ag.buyin_range_max ? formatBuyin(ag.buyin_range_max) : '\u221E'}
                </div>
              )}
              {(ag.scope === 'custom_dates' || ag.variant_filter || ag.start_date) && (
                <div style={{display:'flex',gap:4,flexWrap:'wrap',marginTop:4}}>
                  {ag.scope === 'custom_dates' && ag.start_date && (
                    <span style={{fontSize:10,background:'var(--hover-overlay)',padding:'1px 6px',borderRadius:4,color:'var(--text-muted)'}}>
                      {ag.start_date}{ag.end_date ? ` \u2192 ${ag.end_date}` : '+'}
                    </span>
                  )}
                  {ag.variant_filter && (() => {
                    try { const vf = JSON.parse(ag.variant_filter); return vf.map(v => (
                      <span key={v} style={{fontSize:10,background:'var(--hover-overlay)',padding:'1px 6px',borderRadius:4,color:'var(--text-muted)'}}>{v}</span>
                    )); } catch { return null; }
                  })()}
                </div>
              )}
            </div>
            <div style={{display:'flex',gap:4,alignItems:'center'}}>
              <label className="toggle-switch" style={{width:32,height:18}} title={ag.is_active ? 'Active' : 'Inactive'}>
                <input type="checkbox" checked={!!ag.is_active} onChange={() => toggleActive(ag)} />
                <span className="toggle-slider" />
              </label>
              <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(ag.id)} style={{fontSize:11,color:'#ef4444',padding:'2px 4px'}}>{'\u2715'}</button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Agreement Form ──────────────────────────────────────────

function AgreementForm({ token, seriesId, backers, onClose, onSaved, tournaments }) {
  const [backerId, setBackerId] = useState('');
  const [backerType, setBackerType] = useState('pay_per_play');
  const [percentage, setPercentage] = useState('');
  const [markup, setMarkup] = useState('1.0');
  const [buyinMin, setBuyinMin] = useState('');
  const [buyinMax, setBuyinMax] = useState('');
  const [scope, setScope] = useState('series');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [variantFilter, setVariantFilter] = useState([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const availableVariants = useMemo(() => {
    if (!tournaments || tournaments.length === 0) return [];
    const variants = new Set();
    tournaments.forEach(t => { if (t.game_variant) variants.add(t.game_variant); });
    return [...variants].sort();
  }, [tournaments]);

  const mvpTypes = ['pay_per_play', 'flat_package', 'profit_share_only'];

  const handleSave = async () => {
    if (!backerId) { setError('Select a backer'); return; }
    const pct = parseFloat(percentage);
    if (isNaN(pct) || pct <= 0 || pct > 100) { setError('Percentage must be 1\u2013100'); return; }
    const mkp = parseFloat(markup);
    if (backerType !== 'profit_share_only' && (isNaN(mkp) || mkp < 1)) { setError('Markup must be \u2265 1.0'); return; }
    setSaving(true); setError('');
    try {
      const body = {
        backerId: Number(backerId),
        backerType,
        percentage: pct,
        markup: backerType === 'profit_share_only' ? 1.0 : mkp,
        buyinRangeMin: buyinMin ? Number(buyinMin) : undefined,
        buyinRangeMax: buyinMax ? Number(buyinMax) : undefined,
        scope,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        variantFilter: variantFilter.length > 0 ? variantFilter : undefined,
        buyinMin: buyinMin ? Number(buyinMin) : undefined,
        buyinMax: buyinMax ? Number(buyinMax) : undefined,
      };
      const res = await fetch(`${API_URL}/staking/series/${seriesId}/agreements`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (res.ok) onSaved();
      else { const d = await res.json(); setError(d.error || 'Failed'); }
    } catch { setError('Network error'); }
    setSaving(false);
  };

  return createPortal(
    <div className="notif-backdrop" onClick={onClose}>
      <div className="staking-modal" onClick={e => e.stopPropagation()}>
        <div className="staking-modal-header">
          <h3 style={{margin:0,fontSize:16,fontWeight: 'var(--fw-bold)'}}>Add Agreement</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>{'\u2715'}</button>
        </div>
        <div className="staking-modal-body">
          {error && <div style={{color:'#ef4444',fontSize:12,marginBottom:8}}>{error}</div>}

          <label className="staking-field"><span>Backer *</span>
            <select value={backerId} onChange={e => setBackerId(e.target.value)}>
              <option value="">Select a backer&hellip;</option>
              {backers.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>

          <div className="staking-field"><span>Type</span>
            <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
              {mvpTypes.map(t => (
                <button key={t} className={`filter-chip${backerType === t ? ' active' : ''}`} onClick={() => setBackerType(t)}>
                  {BACKER_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </div>

          <label className="staking-field"><span>Percentage *</span>
            <input type="number" value={percentage} onChange={e => setPercentage(e.target.value)} placeholder="e.g. 50" min="1" max="100" step="1" />
          </label>

          {backerType !== 'profit_share_only' && (
            <label className="staking-field"><span>Markup</span>
              <input type="number" value={markup} onChange={e => setMarkup(e.target.value)} placeholder="1.0 = no markup" min="1" step="0.1" />
            </label>
          )}

          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
            <label className="staking-field"><span>Min Buyin</span>
              <input type="number" value={buyinMin} onChange={e => setBuyinMin(e.target.value)} placeholder="Optional" />
            </label>
            <label className="staking-field"><span>Max Buyin</span>
              <input type="number" value={buyinMax} onChange={e => setBuyinMax(e.target.value)} placeholder="Optional" />
            </label>
          </div>

          <button className="btn btn-ghost btn-sm" style={{fontSize:11,color:'var(--text-muted)',marginTop:4,padding:'4px 0'}} onClick={() => setShowAdvanced(!showAdvanced)}>
            {showAdvanced ? '\u25BE Hide Advanced' : '\u25B8 Advanced Options'}
          </button>

          {showAdvanced && (
            <div style={{borderTop:'1px solid var(--border)',paddingTop:10,marginTop:4}}>
              <div className="staking-field"><span>Scope</span>
                <div style={{display:'flex',gap:6}}>
                  {['series','custom_dates'].map(s => (
                    <button key={s} className={`filter-chip${scope === s ? ' active' : ''}`}
                      onClick={() => setScope(s)}>{s === 'series' ? 'Full Series' : 'Custom Dates'}</button>
                  ))}
                </div>
              </div>

              {scope === 'custom_dates' && (
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                  <label className="staking-field"><span>Start Date</span>
                    <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
                  </label>
                  <label className="staking-field"><span>End Date</span>
                    <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
                  </label>
                </div>
              )}

              {availableVariants.length > 0 && (
                <div className="staking-field"><span>Game Filter</span>
                  <div style={{display:'flex',gap:4,flexWrap:'wrap',maxHeight:80,overflowY:'auto'}}>
                    {availableVariants.map(v => (
                      <button key={v} className={`filter-chip${variantFilter.includes(v) ? ' active' : ''}`}
                        style={{fontSize:10,padding:'2px 8px'}}
                        onClick={() => setVariantFilter(f => f.includes(v) ? f.filter(x => x !== v) : [...f, v])}
                      >{v}</button>
                    ))}
                  </div>
                  {variantFilter.length > 0 && (
                    <div style={{fontSize:10,color:'var(--text-muted)',marginTop:2}}>
                      {variantFilter.length} game{variantFilter.length !== 1 ? 's' : ''} selected
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="staking-modal-footer">
          <div style={{flex:1}} />
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          <button className="create-group-submit" style={{fontSize:13,padding:'8px 20px'}} onClick={handleSave} disabled={saving}>
            {saving ? 'Saving\u2026' : 'Add'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Staking Event Tracking ──────────────────────────────────

function StakingEventTracking({ seriesId, agreements, eventStatuses, tournaments, mySchedule, series, token, fetchEvents }) {
  const [logFor, setLogFor] = useState(null); // { agreementId, tournamentId }
  const [bullets, setBullets] = useState('1');
  const [buyinAmt, setBuyinAmt] = useState('');
  const [cashAmt, setCashAmt] = useState('');
  const [tipAmt, setTipAmt] = useState('');
  const [saving, setSaving] = useState(false);

  // Get tournaments from user's schedule that fall within series date range
  const seriesEvents = useMemo(() => {
    if (!mySchedule || !tournaments) return [];
    const schedIds = new Set(mySchedule.map(s => s.tournament_id || s.id));
    return tournaments.filter(t => {
      if (!schedIds.has(t.id)) return false;
      if (series.start_date && t.date < series.start_date) return false;
      if (series.end_date && t.date > series.end_date) return false;
      return true;
    }).sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''));
  }, [mySchedule, tournaments, series]);

  // Build lookup: { tournamentId_agreementId -> status }
  const statusMap = useMemo(() => {
    const m = {};
    for (const es of eventStatuses) {
      m[`${es.tournament_id}_${es.agreement_id}`] = es;
    }
    return m;
  }, [eventStatuses]);

  const handleLog = async () => {
    if (!logFor) return;
    setSaving(true);
    try {
      await fetch(`${API_URL}/staking/events/${logFor.agreementId}/${logFor.tournamentId}/status`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bulletsUsed: Number(bullets) || 1,
          buyinAmount: Number(buyinAmt) || 0,
          cashAmount: Number(cashAmt) || 0,
          tipAmount: Number(tipAmt) || 0,
        })
      });
      setLogFor(null); setBullets('1'); setBuyinAmt(''); setCashAmt(''); setTipAmt('');
      fetchEvents();
    } catch {}
    setSaving(false);
  };

  const activeAgreements = agreements.filter(a => a.is_active);

  if (activeAgreements.length === 0) {
    return <div style={{textAlign:'center',color:'var(--text-muted)',padding:'30px 20px',fontSize:13}}>Add active agreements first to track events.</div>;
  }

  if (seriesEvents.length === 0) {
    return <div style={{textAlign:'center',color:'var(--text-muted)',padding:'30px 20px',fontSize:13}}>No scheduled tournaments in this series date range.</div>;
  }

  return (
    <div style={{padding:'12px 16px'}}>
      {seriesEvents.map(t => (
        <div key={t.id} className="staking-event-card">
          <div style={{fontWeight: 'var(--fw-bold)',fontSize:13}}>{t.event_name}</div>
          <div style={{fontSize:11,color:'var(--text-muted)',marginBottom:6}}>{t.date} &middot; {t.time} &middot; {formatBuyin(t.buyin)}</div>
          {activeAgreements.map(ag => {
            const key = `${t.id}_${ag.id}`;
            const status = statusMap[key];
            const isLogging = logFor && logFor.agreementId === ag.id && logFor.tournamentId === t.id;
            return (
              <div key={ag.id} style={{borderTop:'1px solid var(--border)',padding:'6px 0'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <div style={{fontSize:12}}>
                    <span style={{fontWeight: 'var(--fw-regular)'}}>{ag.backer_name}</span>
                    <span style={{color:'var(--text-muted)',marginLeft:4}}>{ag.percentage}%</span>
                  </div>
                  {status ? (
                    <div style={{fontSize:11}}>
                      <span style={{color:'var(--text-muted)'}}>B:{status.bullets_used || 1}</span>
                      <span style={{marginLeft:6,color:'var(--text-muted)'}}>In:{formatBuyin(status.buyin_amount || 0)}</span>
                      <span style={{marginLeft:6,color: (status.cash_amount || 0) > 0 ? '#22c55e' : 'var(--text-muted)'}}>
                        Out:{formatBuyin(status.cash_amount || 0)}
                      </span>
                    </div>
                  ) : (
                    <button className="btn btn-ghost btn-sm" style={{fontSize:11,color:'var(--accent)'}} onClick={() => {
                      setLogFor({ agreementId: ag.id, tournamentId: t.id });
                      setBuyinAmt(String(t.buyin || ''));
                    }}>Log</button>
                  )}
                </div>
                {isLogging && (
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:6,marginTop:6}}>
                    <label className="staking-field" style={{marginBottom:0}}><span style={{fontSize:10}}>Bullets</span>
                      <input type="number" value={bullets} onChange={e => setBullets(e.target.value)} min="1" />
                    </label>
                    <label className="staking-field" style={{marginBottom:0}}><span style={{fontSize:10}}>Buyin</span>
                      <input type="number" value={buyinAmt} onChange={e => setBuyinAmt(e.target.value)} />
                    </label>
                    <label className="staking-field" style={{marginBottom:0}}><span style={{fontSize:10}}>Cash</span>
                      <input type="number" value={cashAmt} onChange={e => setCashAmt(e.target.value)} />
                    </label>
                    <label className="staking-field" style={{marginBottom:0}}><span style={{fontSize:10}}>Tip</span>
                      <input type="number" value={tipAmt} onChange={e => setTipAmt(e.target.value)} />
                    </label>
                    <div style={{gridColumn:'span 4',display:'flex',gap:6}}>
                      <button className="create-group-submit" style={{fontSize:11,padding:'6px 12px',flex:1}} onClick={handleLog} disabled={saving}>
                        {saving ? '\u2026' : 'Save'}
                      </button>
                      <button className="btn btn-ghost btn-sm" style={{fontSize:11}} onClick={() => setLogFor(null)}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ── Staking Settlement ──────────────────────────────────────

function StakingSettlementView({ seriesId, settlementData, token, fetchSettlement, fetchSeries }) {
  const [settling, setSettling] = useState(false);
  const [backerYtd, setBackerYtd] = useState({}); // backerId -> ytd_winnings

  // Load backer YTD data for 1099 section
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_URL}/staking/backers/summary`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          const map = {};
          data.forEach(b => { map[b.id] = b.ytd_winnings; });
          setBackerYtd(map);
        }
      } catch {}
    })();
  }, []);

  const handleFinalize = async () => {
    if (!confirm('Finalize settlement? This will lock in the P&L calculations.')) return;
    setSettling(true);
    try {
      const res = await fetch(`${API_URL}/staking/series/${seriesId}/settle`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ settlements: settlementData?.settlements || [] })
      });
      if (res.ok) { fetchSettlement(); fetchSeries(); }
    } catch {}
    setSettling(false);
  };

  const handleMarkPaid = async (settlementId, isPaid) => {
    try {
      await fetch(`${API_URL}/staking/settlements/${settlementId}/paid`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPaid: !isPaid })
      });
      fetchSettlement();
    } catch {}
  };

  if (!settlementData) {
    return <div style={{textAlign:'center',color:'var(--text-muted)',padding:'30px 20px',fontSize:13}}>Loading settlement data&hellip;</div>;
  }

  const settlements = settlementData.settlements || [];

  if (settlements.length === 0) {
    return <div style={{textAlign:'center',color:'var(--text-muted)',padding:'30px 20px',fontSize:13}}>No agreements to settle. Add agreements and log events first.</div>;
  }

  // Build 1099 rows: backers with positive returns in this settlement
  const positiveSettlements = settlements.filter(s => {
    const grossReturn = s.gross_return || s.grossReturn || 0;
    return grossReturn > 0;
  });
  // De-dup by backerId, summing returns if multiple agreements
  const backerReturnMap = {};
  for (const s of positiveSettlements) {
    const bid = s.backer_id || s.backerId;
    const name = s.backer_name || s.backerName || 'Backer';
    const ret = s.gross_return || s.grossReturn || 0;
    if (!backerReturnMap[bid]) backerReturnMap[bid] = { id: bid, name, thisSettlement: 0 };
    backerReturnMap[bid].thisSettlement += ret;
  }
  const backerReturnRows = Object.values(backerReturnMap);

  return (
    <div style={{padding:'12px 16px'}}>
      {settlements.map((s, i) => {
        const netPl = (s.gross_return || s.grossReturn || 0) - (s.gross_investment || s.grossInvestment || 0);
        const amtOwed = s.amount_owed || s.amountOwed || 0;
        return (
          <div key={s.backer_id || s.backerId || i} className="staking-settlement-card">
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
              <div>
                <div style={{fontWeight: 'var(--fw-bold)',fontSize:14}}>{s.backer_name || s.backerName || 'Backer'}</div>
                <div style={{fontSize:12,color:'var(--text-muted)',marginTop:2}}>{BACKER_TYPE_LABELS[s.backer_type || s.backerType] || s.backer_type || s.backerType || ''} &middot; {s.percentage || 0}%</div>
              </div>
              {s.id && (
                <label className="toggle-switch" style={{width:32,height:18}} title={s.is_paid ? 'Paid' : 'Unpaid'}>
                  <input type="checkbox" checked={!!s.is_paid} onChange={() => handleMarkPaid(s.id, s.is_paid)} />
                  <span className="toggle-slider" />
                </label>
              )}
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:4,marginTop:8,fontSize:12}}>
              <div>Invested: <strong>{formatBuyin(s.gross_investment || s.grossInvestment || 0)}</strong></div>
              <div>Returned: <strong>{formatBuyin(s.gross_return || s.grossReturn || 0)}</strong></div>
              {(s.markup_amount || s.markupAmount) > 0 && <div>Markup: <strong>{formatBuyin(s.markup_amount || s.markupAmount || 0)}</strong></div>}
              <div>Owed: <strong className={amtOwed >= 0 ? 'staking-pnl-pos' : 'staking-pnl-neg'}>{formatBuyin(Math.abs(amtOwed))}</strong></div>
            </div>
            <div style={{marginTop:6,fontSize:14,fontWeight:700}} className={netPl >= 0 ? 'staking-pnl-pos' : 'staking-pnl-neg'}>
              {netPl >= 0 ? '+' : ''}{formatBuyin(netPl)} net
            </div>
            {s.is_paid && <div style={{fontSize:11,color:'#22c55e',marginTop:4}}>{'\u2713'} Paid{s.paid_at ? ` \u00b7 ${new Date(s.paid_at).toLocaleDateString()}` : ''}</div>}
          </div>
        );
      })}

      {/* 1099 Summary Section */}
      {backerReturnRows.length > 0 && (
        <div style={{marginTop:20,paddingTop:16,borderTop:'2px solid var(--border)'}}>
          <div style={{fontFamily:'Univers Condensed, Univers, sans-serif',textTransform:'uppercase',letterSpacing:1,
            fontSize:12,fontWeight:700,color:'var(--text-muted)',marginBottom:10}}>1099 Summary</div>
          {backerReturnRows.map(row => {
            const ytd = backerYtd[row.id] || 0;
            // After this settlement, YTD would be ytd (which already includes any settled amounts)
            // Use ytd as the "total including this settlement" approximation
            let indicator;
            if (ytd >= 600) {
              indicator = { icon: '\u26d4', label: 'Required ($600+)', color: '#ef4444' };
            } else if (ytd >= 400) {
              indicator = { icon: '\u26a0', label: 'Near threshold ($400+)', color: '#f59e0b' };
            } else {
              indicator = { icon: '\u2713', label: 'Under threshold', color: '#22c55e' };
            }
            return (
              <div key={row.id} style={{
                display:'flex',justifyContent:'space-between',alignItems:'center',
                padding:'8px 10px',marginBottom:6,borderRadius:8,
                background:'var(--surface)',border:'1px solid var(--border)',fontSize:12
              }}>
                <div style={{minWidth:0,flex:1}}>
                  <div style={{fontWeight: 'var(--fw-bold)'}}>{row.name}</div>
                  <div style={{color:'var(--text-muted)',marginTop:2}}>
                    This settlement: <strong>{formatBuyin(row.thisSettlement)}</strong>
                    {' \u00b7 '}YTD: <strong style={{color: ytd >= 600 ? '#ef4444' : ytd >= 400 ? '#f59e0b' : 'inherit'}}>
                      {formatBuyin(ytd)}
                    </strong>
                  </div>
                </div>
                <div style={{flexShrink:0,marginLeft:10,textAlign:'right',fontSize:11,color:indicator.color,fontWeight: 'var(--fw-bold)'}}>
                  <span style={{fontSize:14,marginRight:4}}>{indicator.icon}</span>
                  {indicator.label}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!settlementData.isSettled && (
        <button
          className="create-group-submit"
          style={{fontSize:13,padding:'10px 20px',width:'100%',marginTop:12}}
          onClick={handleFinalize}
          disabled={settling}
        >
          {settling ? 'Finalizing\u2026' : 'Finalize Settlement'}
        </button>
      )}
    </div>
  );
}

// Named exports for all sub-components
export {
  StakingSettings,
  StakingSeriesList,
  StakingSeriesForm,
  BackerManager,
  BackerSummaryView,
  StakingSeriesDetail,
  AgreementsList,
  AgreementForm,
  StakingEventTracking,
  StakingSettlementView
};

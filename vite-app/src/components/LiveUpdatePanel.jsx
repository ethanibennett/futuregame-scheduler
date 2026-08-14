import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon.jsx';
import { CameraOverlay, RegistrationCameraFlow } from './CameraOverlay.jsx';
import { API_URL } from '../utils/api.js';
import {
  getToday, getNow, normaliseDate, parseLateRegEnd, parseDateTime,
  getGamePills, haptic, HAND_CONFIG, HAND_CONFIG_DEFAULT,
  formatLiveUpdate, ordinalSuffix, parseShorthand, formatBuyin,
} from '../utils/utils.js';
import { parseCardNotation, dualPlaceholder, evaluateHand, assignNeutralSuits, GAME_EVAL } from '../utils/poker-engine.js';
import { loadCardImages, drawHandImageOverlay } from '../utils/export.js';

// ── Card Row (inline, shows card notation as visual cards) ──
function CardRow({ text, stud, max, placeholderCount }) {
  const SUIT_SYMBOLS = {h:'\u2665',d:'\u2666',c:'\u2663',s:'\u2660'};
  let cards = parseCardNotation(text);
  if (!cards.length && placeholderCount > 0) {
    return (
      <div className="card-row">
        {Array.from({ length: placeholderCount }, (_, i) => (
          <div key={'ph' + i} className="card-placeholder" />
        ))}
      </div>
    );
  }
  if (!cards.length) return null;
  if (max && cards.length > max) cards = cards.slice(0, max);
  const downIdx = stud ? new Set([0, 1, 6]) : null;
  return (
    <div className="card-row">
      {cards.map((c, i) => {
        const k = c.rank + c.suit + '_' + i;
        if (c.suit === 'x') {
          return <div key={k} className="card-unknown" />;
        }
        const isRed = c.suit === 'h' || c.suit === 'd';
        return (
          <div key={k} className={'card-classic' + (isRed ? ' card-classic-red' : ' card-classic-dark')}>
            <span className="card-classic-rank">{c.rank.toUpperCase()}</span>
            <span className="card-classic-suit">{SUIT_SYMBOLS[c.suit] || ''}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function LiveUpdatePanel({ mySchedule, myActiveUpdates, onPost, onAddTracking }) {
  const containerRef = useRef(null);
  const panelRef = useRef(null);
  const toggleRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [selectedTournamentId, setSelectedTournamentId] = useState(null);
  const [stack, setStack] = useState('');
  const [sb, setSb] = useState('');
  const [bb, setBb] = useState('');
  const [bbAnte, setBbAnte] = useState('');
  const [isRegClosed, setIsRegClosed] = useState(false);
  const [bubble, setBubble] = useState('');
  const [isItm, setIsItm] = useState(false);
  const [lockedAmount, setLockedAmount] = useState('');
  const [isFinalTable, setIsFinalTable] = useState(false);
  const [placesLeft, setPlacesLeft] = useState('');
  const [firstPlacePrize, setFirstPlacePrize] = useState('');
  const [isDeal, setIsDeal] = useState(false);
  const [dealPlace, setDealPlace] = useState('');
  const [dealPayout, setDealPayout] = useState('');
  const [isBusted, setIsBusted] = useState(false);
  const [totalEntries, setTotalEntries] = useState('');
  const [isBagged, setIsBagged] = useState(false);
  const [bagDay, setBagDay] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [stackHistory, setStackHistory] = useState([]);
  const [isRegistered, setIsRegistered] = useState(false);
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [hasJoinLevel, setHasJoinLevel] = useState(false);
  const [joiningSb, setJoiningSb] = useState('');
  const [joiningBb, setJoiningBb] = useState('');
  const [joiningAnte, setJoiningAnte] = useState('');
  const [updateType, setUpdateType] = useState('update');
  const externalTabRef = useRef(null);
  const externalBagRef = useRef(null);

  // Listen for external requests to open to a specific tab + tournament
  useEffect(() => {
    const handler = (e) => {
      const { tab, tournamentId, bag } = e.detail || {};
      if (tab) externalTabRef.current = tab;
      if (bag) externalBagRef.current = bag;
      if (tournamentId) setSelectedTournamentId(tournamentId);
      if (tab) setUpdateType(tab);
      if (bag) { setIsBagged(true); setBagDay(String(bag)); }
      setOpen(true);
    };
    window.addEventListener('openLiveUpdate', handler);
    return () => window.removeEventListener('openLiveUpdate', handler);
  }, []);

  const [bustPlace, setBustPlace] = useState('');
  const [bustPayout, setBustPayout] = useState('');
  const [bustNote, setBustNote] = useState('');
  const [heroHand, setHeroHand] = useState('');
  const [boardCards, setBoardCards] = useState('');
  const [numOpponents, setNumOpponents] = useState(1);
  const [opponentHands, setOpponentHands] = useState(['', '', '', '', '']);
  const [handNote, setHandNote] = useState('');
  const hasOpponents = opponentHands.slice(0, numOpponents).some(h => parseCardNotation(h).length > 0);
  const activeOpponents = opponentHands.slice(0, numOpponents);
  const [handGame, setHandGame] = useState(null);

  const todayISO = getToday();
  const activeUpdateMap = useMemo(() => {
    const map = {};
    (myActiveUpdates || []).forEach(u => { map[u.tournament_id] = u; });
    return map;
  }, [myActiveUpdates]);

  const todayTournaments = useMemo(() =>
    (mySchedule || []).filter(t =>
      normaliseDate(t.date) === todayISO && t.venue !== 'Personal'
    ),
    [mySchedule, todayISO]
  );

  const previousActive = useMemo(() => {
    const todayIds = new Set(todayTournaments.map(t => t.id));
    const bustedMap = {};
    (myActiveUpdates || []).filter(u => u.is_busted).forEach(u => { bustedMap[u.tournament_id] = u; });
    const now = Date.now();
    return (mySchedule || []).filter(t => {
      if (todayIds.has(t.id) || t.venue === 'Personal') return false;
      if (normaliseDate(t.date) >= todayISO) return false;
      if (!bustedMap[t.id]) return true;
      if (!t.reentry) return false;
      const lateEnd = parseLateRegEnd(t.late_reg_end, t.date);
      return !isNaN(lateEnd) && now < lateEnd;
    });
  }, [mySchedule, todayTournaments, myActiveUpdates, todayISO]);

  const allOptions = useMemo(() => {
    const today = todayTournaments.map(t => ({ id: t.id, name: t.event_name, group: 'Today' }));
    const prev = previousActive.map(t => ({ id: t.id, name: t.event_name, group: 'In Progress' }));
    return [...today, ...prev];
  }, [todayTournaments, previousActive]);

  const isRegPastClose = (tournamentId) => {
    const t = todayTournaments.find(x => x.id === tournamentId);
    if (!t?.late_reg_end) return false;
    const now = new Date();
    const [h, m] = t.late_reg_end.split(':').map(Number);
    const closeTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
    return now >= closeTime;
  };

  const resetFields = (prefill, tournamentId) => {
    setStack(prefill?.stack || '');
    setSb(prefill?.sb || '');
    setBb(prefill?.bb || '');
    setBbAnte(prefill?.bb_ante || '');
    setIsRegClosed(prefill ? !!prefill.is_reg_closed : isRegPastClose(tournamentId));
    setBubble(prefill?.bubble || '');
    setIsItm(!!prefill?.is_itm);
    setLockedAmount(prefill?.locked_amount || '');
    setIsFinalTable(!!prefill?.is_final_table);
    setPlacesLeft(prefill?.places_left || '');
    setFirstPlacePrize(prefill?.first_place_prize || '');
    setIsDeal(!!prefill?.is_deal);
    setDealPlace(prefill?.deal_place || '');
    setDealPayout(prefill?.deal_payout || '');
    setIsBusted(!!prefill?.is_busted);
    setTotalEntries(prefill?.total_entries || '');
    if (externalBagRef.current) {
      setIsBagged(true);
      setBagDay(String(externalBagRef.current));
      externalBagRef.current = null;
    } else {
      setIsBagged(!!prefill?.is_bagged);
      setBagDay(prefill?.bag_day || '');
    }
    setBustPlace('');
    setBustPayout('');
    setBustNote('');
    setHeroHand('');
    setBoardCards('');
    setNumOpponents(1);
    setOpponentHands(['', '', '', '', '']);
    setHandNote('');
    setHandGame(null);
    if (externalTabRef.current) {
      setUpdateType(externalTabRef.current);
      externalTabRef.current = null;
    } else if (prefill && !prefill.is_busted) {
      setUpdateType('update');
    } else if (!prefill) {
      setUpdateType('register');
    }
  };

  useEffect(() => {
    if (!open) return;
    const mostRecent = (myActiveUpdates || [])[0];
    if (mostRecent && allOptions.find(o => o.id === mostRecent.tournament_id)) {
      setSelectedTournamentId(mostRecent.tournament_id);
      resetFields(mostRecent, mostRecent.tournament_id);
    } else if (allOptions.length === 1) {
      setSelectedTournamentId(allOptions[0].id);
      resetFields(activeUpdateMap[allOptions[0].id] || null, allOptions[0].id);
    } else {
      setSelectedTournamentId(null);
      resetFields(null, null);
    }
  }, [open, allOptions, myActiveUpdates]);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      // Don't close panel while camera or registration overlay is active
      if (cameraOpen || registrationOpen) return;
      if (panelRef.current && panelRef.current.contains(e.target)) return;
      if (toggleRef.current && toggleRef.current.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, cameraOpen, registrationOpen]);

  const ps = (v) => Number(parseShorthand(v)) || 0;

  const selectedTournamentName = useMemo(() => {
    const opt = allOptions.find(o => o.id === selectedTournamentId);
    return opt ? opt.name : '';
  }, [allOptions, selectedTournamentId]);

  const selectedTournament = useMemo(() =>
    (mySchedule || []).find(t => t.id === selectedTournamentId) || null,
    [mySchedule, selectedTournamentId]);

  const entryLabel = useMemo(() => {
    const bc = activeUpdateMap[selectedTournamentId]?.bust_count || 0;
    if (bc === 0) return 'Register';
    const n = bc + 1;
    return n + ordinalSuffix(n) + ' Entry';
  }, [activeUpdateMap, selectedTournamentId]);

  const nextEvent = useMemo(() => {
    const now = Date.now();
    const upcoming = (mySchedule || [])
      .filter(t => {
        if (t.id === selectedTournamentId) return false;
        const startMs = parseLateRegEnd(t.time, t.date);
        return !isNaN(startMs) && startMs > now;
      })
      .sort((a, b) => parseLateRegEnd(a.time, a.date) - parseLateRegEnd(b.time, b.date));
    if (!upcoming.length) return null;
    const t = upcoming[0];
    const startMs = parseLateRegEnd(t.time, t.date);
    const diffMs = startMs - now;
    const hours = Math.floor(diffMs / 3600000);
    const mins = Math.floor((diffMs % 3600000) / 60000);
    const timeStr = hours > 0 ? hours + 'h ' + mins + 'm' : mins + 'm';
    return { name: t.event_name, buyin: t.buyin, venue: t.venue, timeUntil: timeStr };
  }, [mySchedule, selectedTournamentId]);

  // Game variant pills for hand tab
  const gamePills = useMemo(() =>
    selectedTournament ? getGamePills(selectedTournament.game_variant, selectedTournament.event_name) : ['NLH'],
    [selectedTournament]);
  const activeGame = handGame || gamePills[0] || 'NLH';
  const gameConfig = HAND_CONFIG[activeGame] || HAND_CONFIG_DEFAULT;

  const handResult = useMemo(() => {
    if (!hasOpponents || !GAME_EVAL[activeGame]) return null;
    const hRaw = parseCardNotation(heroHand);
    const bCards = gameConfig.hasBoard ? parseCardNotation(boardCards) : [];
    if (gameConfig.hasBoard && bCards.length < 3) return null;
    const boardSuits = new Set(bCards.map(c => c.suit));
    const usedKeys = bCards.map(c => c.rank + c.suit);

    let hCards;
    if (gameConfig.isStud) {
      hCards = hRaw.filter(c => c.suit !== 'x');
      if (hCards.length < 5) return null;
    } else {
      if (hRaw.length < gameConfig.heroCards) return null;
      hCards = assignNeutralSuits(hRaw, usedKeys, boardSuits);
    }
    hCards.forEach(c => { if (c.suit !== 'x') usedKeys.push(c.rank + c.suit); });

    const results = [];
    for (let i = 0; i < numOpponents; i++) {
      const oRaw = parseCardNotation(opponentHands[i]);
      let oCards;
      if (gameConfig.isStud) {
        oCards = oRaw.filter(c => c.suit !== 'x');
        if (oCards.length < 5) continue;
      } else {
        if (oRaw.length < gameConfig.heroCards) continue;
        oCards = assignNeutralSuits(oRaw, usedKeys, boardSuits);
      }
      const ev = evaluateHand(activeGame, hCards, oCards, bCards);
      if (ev && ev.result) results.push({ index: i, ...ev });
      oCards.forEach(c => { if (c.suit !== 'x') usedKeys.push(c.rank + c.suit); });
    }
    return results.length ? results : null;
  }, [heroHand, opponentHands, numOpponents, boardCards, activeGame, gameConfig]);

  const buildUpdateData = () => {
    const base = { tournamentId: selectedTournamentId, updateType };
    if (updateType === 'finish') {
      return {
        ...base,
        stack: stack ? ps(stack) : 0,
        sb: sb ? ps(sb) : null, bb: bb ? ps(bb) : null, bbAnte: bbAnte ? ps(bbAnte) : null,
        isBusted: true,
        placesLeft: bustPlace ? Number(bustPlace) : null,
        dealPayout: bustPayout ? Number(bustPayout) : null,
        updateText: bustNote || null,
        totalEntries: totalEntries ? Number(totalEntries) : null,
      };
    }
    if (updateType === 'hand') {
      const handPayload = {
        game: activeGame, hero: heroHand,
        board: gameConfig.hasBoard ? (boardCards || null) : null,
        opponents: hasOpponents ? activeOpponents.filter(h => h) : null, note: handNote || null
      };
      if (handResult && handResult.length > 0) {
        handPayload.results = handResult.map(r => ({
          oppIndex: r.index,
          outcome: r.result.outcome,
          text: r.result.text,
          heroHand: r.heroHigh?.name || r.heroLow?.name || r.heroBadugi?.name || null,
          opponentHand: r.opponentHigh?.name || r.opponentLow?.name || r.opponentBadugi?.name || null
        }));
      }
      return { ...base, updateText: JSON.stringify(handPayload) };
    }
    if (updateType === 'register') {
      return { ...base, isRegistered: true };
    }
    // 'update' tab
    return {
      ...base,
      stack: ps(stack), sb: sb ? ps(sb) : null, bb: bb ? ps(bb) : null, bbAnte: bbAnte ? ps(bbAnte) : null,
      isRegClosed, bubble: isRegClosed && !isItm && bubble ? Number(bubble) : null,
      isItm, lockedAmount: isItm && lockedAmount ? Number(lockedAmount) : null,
      isFinalTable, placesLeft: isFinalTable && placesLeft ? Number(placesLeft) : null,
      firstPlacePrize: isFinalTable && firstPlacePrize ? Number(firstPlacePrize) : null,
      isDeal, dealPlace: isDeal && dealPlace ? Number(dealPlace) : null,
      dealPayout: isDeal && dealPayout ? Number(dealPayout) : null,
      isBusted, totalEntries: totalEntries ? Number(totalEntries) : null,
      isBagged, bagDay: isBagged && bagDay ? Number(bagDay) : null
    };
  };

  const shareHandImage = async () => {
    if (!parseCardNotation(heroHand).length) return;
    const handDataObj = {
      heroHand, opponents: hasOpponents ? activeOpponents : [],
      boardCards: gameConfig.hasBoard ? boardCards : null,
      activeGame, gameConfig, handResult
    };
    const allCards = [
      ...parseCardNotation(heroHand),
      ...(hasOpponents ? activeOpponents.flatMap(h => h ? parseCardNotation(h) : []) : []),
      ...(gameConfig.hasBoard && boardCards ? parseCardNotation(boardCards) : [])
    ];
    try {
      const images = await loadCardImages(allCards);
      const outW = 1080, outH = 1080;
      const canvas = document.createElement('canvas');
      canvas.width = outW; canvas.height = outH;
      const ctx = canvas.getContext('2d');
      // Dark gradient background
      const grad = ctx.createLinearGradient(0, 0, 0, outH);
      grad.addColorStop(0, '#1a1a2e');
      grad.addColorStop(1, '#0f0f1a');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, outW, outH);
      // Draw felt-like subtle texture line
      ctx.strokeStyle = 'rgba(34,197,94,0.08)';
      ctx.lineWidth = 1;
      for (let y = 0; y < outH; y += 40) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(outW, y); ctx.stroke();
      }
      drawHandImageOverlay(ctx, outW, outH, handDataObj, images, selectedTournamentName);
      const dataUrl = canvas.toDataURL('image/png');
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], 'hand-history.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file] });
      } else {
        const a = document.createElement('a');
        a.href = dataUrl; a.download = 'hand-history.png'; a.click();
      }
    } catch (e) { console.error('Share hand error:', e); }
  };

  const openCamera = async () => {
    if (!selectedTournamentId) return;
    try {
      const tk = localStorage.getItem('token');
      const resp = await fetch(`${API_URL}/live-updates/history/${selectedTournamentId}`, {
        headers: { Authorization: 'Bearer ' + tk }
      });
      if (resp.ok) setStackHistory(await resp.json());
      else setStackHistory([]);
    } catch (e) { console.error('Stack history fetch failed:', e); setStackHistory([]); }
    setCameraOpen(true);
  };

  const handleSubmit = () => {
    if (!selectedTournamentId) return;
    if (updateType === 'update' && !isBusted && !stack) return;
    if (updateType === 'hand' && !parseCardNotation(heroHand).length) return;
    haptic(25);
    const data = buildUpdateData();
    onPost(data);
    // Auto-create tracking entry on bust
    if ((updateType === 'finish' || (updateType === 'update' && data.isBusted)) && onAddTracking) {
      const bc = activeUpdateMap[selectedTournamentId]?.bust_count || 0;
      const payout = data.dealPayout || 0;
      onAddTracking({
        tournamentId: selectedTournamentId,
        numEntries: bc + 1,
        cashed: payout > 0,
        finishPlace: data.placesLeft || null,
        cashAmount: payout,
        notes: data.updateText || null,
        totalFieldSize: data.totalEntries || null
      });
    }
    setOpen(false);
  };

  const hasActive = (myActiveUpdates || []).some(u => !u.is_busted);

  return (
    <div ref={containerRef} style={{position:'relative'}}>
      <button
        ref={toggleRef}
        className={`btn btn-ghost btn-icon live-update-btn ${hasActive ? 'has-update' : ''}`}
        onClick={() => setOpen(o => !o)}
        title="Post live update"
      >
        <Icon.signal />
      </button>
      {open && !cameraOpen && !registrationOpen && createPortal(
        <div className="dropdown-backdrop" onClick={() => setOpen(false)} />,
        document.body
      )}
      {open && !cameraOpen && !registrationOpen && createPortal(
        <div ref={panelRef} className="live-update-panel" style={(() => {
          const r = toggleRef.current?.getBoundingClientRect();
          if (!r) return { top: 68, left: '50%', transform: 'translateX(-50%)' };
          const vw = window.innerWidth || document.documentElement.clientWidth || 375;
          const vh = window.innerHeight || document.documentElement.clientHeight || 700;
          const panelW = 300;
          const left = Math.max(8, Math.min((vw - panelW) / 2, vw - panelW - 8));
          return { top: r.bottom + 8, left, maxWidth: vw - 16, maxHeight: vh - r.bottom - 16 };
        })()}>
          {allOptions.length === 0 ? (
            <div className="live-update-empty">Nothing on your schedule today — live updates attach to an event you are playing.</div>
          ) : (
            <>
              {allOptions.length > 1 ? (
                <select
                  value={selectedTournamentId || ''}
                  onChange={e => { const id = Number(e.target.value); setSelectedTournamentId(id); resetFields(activeUpdateMap[id] || null, id); }}
                >
                  <option value="">Select tournament...</option>
                  {todayTournaments.length > 0 && (
                    <optgroup label="Today">
                      {todayTournaments.map(t => (
                        <option key={t.id} value={t.id}>{t.event_name}</option>
                      ))}
                    </optgroup>
                  )}
                  {previousActive.length > 0 && (
                    <optgroup label="In Progress">
                      {previousActive.map(t => (
                        <option key={t.id} value={t.id}>{t.event_name}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
              ) : (
                <div className="live-update-tournament-label">
                  {allOptions[0].name}
                </div>
              )}

              {activeUpdateMap[selectedTournamentId] && (
                <div className="live-update-last">
                  Last: {formatLiveUpdate(activeUpdateMap[selectedTournamentId])}
                </div>
              )}

              {/* Tab bar */}
              <div className="live-update-tabs">
                <button className={updateType === 'register' ? 'active' : ''} onClick={() => setUpdateType('register')}>{entryLabel}</button>
                <button className={updateType === 'update' ? 'active' : ''} onClick={() => setUpdateType('update')}>Update</button>
                <button className={updateType === 'hand' ? 'active' : ''} onClick={() => setUpdateType('hand')}>Hand</button>
                <button className={updateType === 'finish' ? 'active' : ''} onClick={() => setUpdateType('finish')}>Finish</button>
              </div>

              {/* Register tab */}
              {updateType === 'register' && (
                <>
                  <div className="live-update-registered-section">
                    <div className="live-update-row">
                      <label className="live-update-toggle">
                        <input type="checkbox" checked={hasJoinLevel} onChange={e => { setHasJoinLevel(e.target.checked); if (!e.target.checked) { setJoiningSb(''); setJoiningBb(''); setJoiningAnte(''); } }} />
                        Join Level
                      </label>
                      {hasJoinLevel && (
                        <>
                          <div className="live-update-field">
                            <label>SB</label>
                            <input type="text" inputMode="decimal" placeholder="100" value={joiningSb} onChange={e => {
                              const raw = e.target.value; setJoiningSb(raw);
                              const num = Number(parseShorthand(raw));
                              if (num > 0) { setJoiningBb(String(num * 2)); setJoiningAnte(String(num * 2)); }
                            }} onBlur={e => { const v = parseShorthand(e.target.value); if (v !== e.target.value) setJoiningSb(v); }} />
                          </div>
                          <div className="live-update-field">
                            <label>BB</label>
                            <input type="text" inputMode="decimal" placeholder="200" value={joiningBb} onChange={e => { const raw = e.target.value; setJoiningBb(raw); const num = Number(parseShorthand(raw)); if (num > 0) setJoiningAnte(String(num)); }} onBlur={e => { const v = parseShorthand(e.target.value); if (v !== e.target.value) setJoiningBb(v); }} />
                          </div>
                          <div className="live-update-field">
                            <label>Ante</label>
                            <input type="text" inputMode="decimal" placeholder="200" value={joiningAnte} onChange={e => setJoiningAnte(e.target.value)} onBlur={e => { const v = parseShorthand(e.target.value); if (v !== e.target.value) setJoiningAnte(v); }} />
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </>
              )}

              {/* Update tab */}
              {updateType === 'update' && (
                <>
                  <div className={`live-update-field${isBagged ? ' bag-highlight' : ''}`}>
                    <label>Stack</label>
                    <input type="text" inputMode="decimal" placeholder="275k" value={stack} onChange={e => setStack(e.target.value)} onBlur={e => { const v = parseShorthand(e.target.value); if (v !== e.target.value) setStack(v); }} autoFocus />
                  </div>

                  <div className="live-update-row">
                    <div className={`live-update-field${isBagged ? ' bag-highlight' : ''}`}>
                      <label>SB</label>
                      <input type="text" inputMode="decimal" placeholder="1k" value={sb} onChange={e => {
                        const raw = e.target.value;
                        setSb(raw);
                        const parsed = parseShorthand(raw);
                        const num = Number(parsed);
                        if (num > 0) { setBb(String(num * 2)); setBbAnte(String(num * 2)); }
                      }} onBlur={e => { const v = parseShorthand(e.target.value); if (v !== e.target.value) setSb(v); }} />
                    </div>
                    <div className={`live-update-field${isBagged ? ' bag-highlight' : ''}`}>
                      <label>BB</label>
                      <input type="text" inputMode="decimal" placeholder="2k" value={bb} onChange={e => { const raw = e.target.value; setBb(raw); const num = Number(parseShorthand(raw)); if (num > 0) setBbAnte(String(num)); }} onBlur={e => { const v = parseShorthand(e.target.value); if (v !== e.target.value) setBb(v); }} />
                    </div>
                    <div className={`live-update-field${isBagged ? ' bag-highlight' : ''}`}>
                      <label>BB Ante</label>
                      <input type="text" inputMode="decimal" placeholder="2k" value={bbAnte} onChange={e => setBbAnte(e.target.value)} onBlur={e => { const v = parseShorthand(e.target.value); if (v !== e.target.value) setBbAnte(v); }} />
                    </div>
                  </div>

                  <div className="live-update-field">
                    <label>Total Entries</label>
                    <input type="number" placeholder="1234" value={totalEntries} onChange={e => setTotalEntries(e.target.value)} />
                  </div>

                  <div className="live-update-row">
                    <label className="live-update-toggle">
                      <input type="checkbox" checked={isRegClosed} onChange={e => { setIsRegClosed(e.target.checked); if (!e.target.checked) { setBubble(''); setIsItm(false); setLockedAmount(''); setIsFinalTable(false); setPlacesLeft(''); setFirstPlacePrize(''); setIsDeal(false); setDealPlace(''); setDealPayout(''); } }} />
                      Reg Closed
                    </label>
                  </div>

                  {isRegClosed && !isItm && (
                    <div className="live-update-field">
                      <label>Bubble (players from money)</label>
                      <input type="number" placeholder="12" value={bubble} onChange={e => setBubble(e.target.value)} min="0" />
                    </div>
                  )}

                  <div className="live-update-row">
                    <label className="live-update-toggle">
                      <input type="checkbox" checked={isItm} onChange={e => { setIsItm(e.target.checked); if (e.target.checked) { setIsRegClosed(true); setBubble(''); } if (!e.target.checked) { setLockedAmount(''); setIsFinalTable(false); setPlacesLeft(''); setFirstPlacePrize(''); setIsDeal(false); setDealPlace(''); setDealPayout(''); } }} />
                      ITM?
                    </label>
                    {isItm && (
                      <div className="live-update-field" style={{flex:'0 0 100px'}}>
                        <label>Locked $</label>
                        <input type="number" placeholder="5000" value={lockedAmount} onChange={e => setLockedAmount(e.target.value)} />
                      </div>
                    )}
                  </div>

                  <div className="live-update-row">
                    <label className="live-update-toggle">
                      <input type="checkbox" checked={isBagged} onChange={e => { setIsBagged(e.target.checked); if (!e.target.checked) setBagDay(''); }} />
                      Bagged
                    </label>
                    {isBagged && (
                      <div className="live-update-field bag-highlight" style={{flex:'0 0 70px'}}>
                        <label>For Day #</label>
                        <input type="number" placeholder="2" value={bagDay} onChange={e => setBagDay(e.target.value)} min="1" />
                      </div>
                    )}
                  </div>

                  {isItm && (
                    <div className="live-update-row live-update-row-indent">
                      <label className="live-update-toggle">
                        <input type="checkbox" checked={isFinalTable} onChange={e => { setIsFinalTable(e.target.checked); if (!e.target.checked) { setPlacesLeft(''); setFirstPlacePrize(''); } }} />
                        Final Table
                      </label>
                      {isFinalTable && (
                        <>
                          <div className="live-update-field" style={{flex:'0 0 70px'}}>
                            <label>Places Left</label>
                            <input type="number" placeholder="6" value={placesLeft} onChange={e => setPlacesLeft(e.target.value)} min="1" />
                          </div>
                          <div className="live-update-field" style={{flex:'0 0 90px'}}>
                            <label>1st Prize $</label>
                            <input type="number" placeholder="50000" value={firstPlacePrize} onChange={e => setFirstPlacePrize(e.target.value)} />
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {isItm && (
                    <div className="live-update-row live-update-row-indent">
                      <label className="live-update-toggle">
                        <input type="checkbox" checked={isDeal} onChange={e => { setIsDeal(e.target.checked); if (!e.target.checked) { setDealPlace(''); setDealPayout(''); } }} />
                        Deal
                      </label>
                      {isDeal && (
                        <>
                          <div className="live-update-field" style={{flex:'0 0 70px'}}>
                            <label>Place</label>
                            <input type="number" placeholder="3" value={dealPlace} onChange={e => setDealPlace(e.target.value)} min="1" />
                          </div>
                          <div className="live-update-field" style={{flex:'0 0 90px'}}>
                            <label>Payout $</label>
                            <input type="number" placeholder="25000" value={dealPayout} onChange={e => setDealPayout(e.target.value)} />
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </>
              )}

              {/* Hand tab */}
              {updateType === 'hand' && (
                <>
                  {gamePills.length > 1 ? (
                    <div className="hand-game-pills">
                      {gamePills.map(g => (
                        <button key={g} className={activeGame === g ? 'active' : ''} onClick={() => setHandGame(g)}>{g}</button>
                      ))}
                    </div>
                  ) : (
                    <div className="hand-game-label">{activeGame}</div>
                  )}
                  {(() => {
                    const cardKeys = (str) => parseCardNotation(str).filter(c => c.suit !== 'x').map(c => c.rank + c.suit);
                    const hasDupes = (newVal, ...others) => {
                      const used = new Set(others.flatMap(cardKeys));
                      const incoming = cardKeys(newVal);
                      const seen = new Set();
                      for (const k of incoming) {
                        if (used.has(k) || seen.has(k)) return true;
                        seen.add(k);
                      }
                      return false;
                    };
                    const oppOthers = (idx) => [heroHand, boardCards, ...opponentHands.filter((_, j) => j !== idx).slice(0, numOpponents)];
                    return <>
                      <div className="live-update-field">
                        <label>Hero Hand</label>
                        <input type="text" placeholder={dualPlaceholder(gameConfig.heroPlaceholder)} value={heroHand} onChange={e => { const v = e.target.value; if (parseCardNotation(v).length <= gameConfig.heroCards && !hasDupes(v, boardCards, ...opponentHands.slice(0, numOpponents))) setHeroHand(v); }} autoFocus />
                        <CardRow text={heroHand} stud={gameConfig.isStud} max={gameConfig.heroCards} />
                      </div>
                      {gameConfig.hasBoard && (
                        <div className="live-update-field">
                          <label>Board</label>
                          <input type="text" placeholder={dualPlaceholder(gameConfig.boardPlaceholder)} value={boardCards} onChange={e => { const v = e.target.value; if (parseCardNotation(v).length <= gameConfig.boardMax && !hasDupes(v, heroHand, ...opponentHands.slice(0, numOpponents))) setBoardCards(v); }} />
                          <CardRow text={boardCards} max={gameConfig.boardMax} />
                        </div>
                      )}
                      <div className="live-update-field">
                        <label>Opponent Hand</label>
                        <input type="text" placeholder={dualPlaceholder(gameConfig.heroPlaceholder)} value={opponentHands[0]} onChange={e => { const v = e.target.value; if (parseCardNotation(v).length <= gameConfig.heroCards && !hasDupes(v, ...oppOthers(0))) setOpponentHands(prev => { const next = [...prev]; next[0] = v; return next; }); }} />
                        <CardRow text={opponentHands[0]} stud={gameConfig.isStud} max={gameConfig.heroCards} placeholderCount={!opponentHands[0] ? gameConfig.heroCards : 0} />
                      </div>
                      <div className="live-update-field">
                        <label>Additional Opponents</label>
                        <div style={{display:'flex',gap:'6px',marginTop:'4px'}}>
                          {[2, 3, 4, 5].map(n => (
                            <button key={n} type="button" className={`filter-chip ${numOpponents === n ? 'active' : ''}`} onClick={() => setNumOpponents(numOpponents === n ? 1 : n)}>
                              {n}
                            </button>
                          ))}
                        </div>
                      </div>
                      {Array.from({ length: Math.max(0, numOpponents - 1) }, (_, i) => (
                        <div className="live-update-field" key={'opp' + (i + 1)}>
                          <label>Opponent {i + 2}</label>
                          <input type="text" placeholder={dualPlaceholder(gameConfig.heroPlaceholder)} value={opponentHands[i + 1]} onChange={e => { const v = e.target.value; if (parseCardNotation(v).length <= gameConfig.heroCards && !hasDupes(v, ...oppOthers(i + 1))) setOpponentHands(prev => { const next = [...prev]; next[i + 1] = v; return next; }); }} />
                          <CardRow text={opponentHands[i + 1]} stud={gameConfig.isStud} max={gameConfig.heroCards} placeholderCount={!opponentHands[i + 1] ? gameConfig.heroCards : 0} />
                        </div>
                      ))}
                    </>;
                  })()}
                  {handResult && handResult.length > 0 && handResult.map((r, ri) => (
                    <div key={ri} className={`hand-result hand-result-${r.result.color === 'green' ? 'hero' : r.result.color === 'red' ? 'opponent' : 'split'}`}>
                      {numOpponents > 1 ? `vs Opp ${r.index + 1}: ` : ''}{r.result.text}
                    </div>
                  ))}
                  <div className="live-update-field">
                    <label>Notes</label>
                    <input type="text" placeholder="All in on flop, hero holds" value={handNote} onChange={e => setHandNote(e.target.value)} />
                  </div>
                </>
              )}

              {/* Finish tab */}
              {updateType === 'finish' && (
                <>
                  <div className="live-update-row">
                    <div className="live-update-field">
                      <label>Place (optional)</label>
                      <input type="number" placeholder="152" value={bustPlace} onChange={e => setBustPlace(e.target.value)} min="1" />
                    </div>
                    <div className="live-update-field">
                      <label>Payout $ (optional)</label>
                      <input type="number" placeholder="2500" value={bustPayout} onChange={e => setBustPayout(e.target.value)} />
                    </div>
                  </div>
                  <div className="live-update-row">
                    <div className="live-update-field">
                      <label>Note (optional)</label>
                      <input type="text" placeholder="AK < QQ all in pre" value={bustNote} onChange={e => setBustNote(e.target.value)} />
                    </div>
                    <div className="live-update-field" style={{flex:'0 0 90px'}}>
                      <label>Total Entries</label>
                      <input type="number" placeholder="1234" value={totalEntries} onChange={e => setTotalEntries(e.target.value)} />
                    </div>
                  </div>
                  {nextEvent && (
                    <div className="live-update-next-event">
                      Next: <strong>{nextEvent.name}</strong>
                      {nextEvent.buyin ? ' \u00b7 ' + nextEvent.buyin : ''}
                      {' \u00b7 in ' + nextEvent.timeUntil}
                    </div>
                  )}
                </>
              )}

              {/* ── Bottom row: camera + share + post ── */}
              <div style={{display:'flex',justifyContent:'flex-end',alignItems:'center',marginTop:'4px',gap:'6px'}}>
                {updateType === 'hand' && parseCardNotation(heroHand).length > 0 && (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={shareHandImage}
                    title="Share hand image"
                    style={{padding:'6px'}}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" style={{width:'16px',height:'16px'}}>
                      <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
                      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
                    </svg>
                  </button>
                )}
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={openCamera}
                  disabled={!selectedTournamentId}
                  title="Camera overlay"
                  style={{padding:'6px'}}
                >
                  <Icon.camera />
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleSubmit}
                  disabled={!selectedTournamentId || (updateType === 'update' && !isBusted && !stack) || (updateType === 'hand' && !parseCardNotation(heroHand).length)}
                >
                  {updateType === 'finish' ? 'Finish Event' : updateType === 'hand' ? 'Post Hand' : 'Post Update'}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Cancel</button>
              </div>
            </>
          )}
        </div>,
        document.body
      )}
      {cameraOpen && createPortal(
        <CameraOverlay
          updateData={buildUpdateData()}
          tournamentName={selectedTournamentName}
          tournament={selectedTournament}
          stackHistory={stackHistory}
          defaultOverlay={updateType === 'hand' ? 'hand' : updateType === 'finish' ? 'countdown' : 'stats'}
          handData={updateType === 'hand' && parseCardNotation(heroHand).length > 0 ? {
            heroHand, opponents: hasOpponents ? activeOpponents : [],
            boardCards: gameConfig.hasBoard ? boardCards : null,
            activeGame, gameConfig, handResult
          } : null}
          onClose={() => { setCameraOpen(false); setOpen(true); }}
        />,
        document.body
      )}
      {registrationOpen && selectedTournament && createPortal(
        <RegistrationCameraFlow
          tournament={selectedTournament}
          guarantee={selectedTournament.prize_pool || null}
          joiningSb={joiningSb}
          joiningBb={joiningBb}
          joiningAnte={joiningAnte}
          entryNumber={(activeUpdateMap[selectedTournamentId]?.bust_count || 0) + 1}
          onClose={() => { setRegistrationOpen(false); setOpen(true); }}
        />,
        document.body
      )}
    </div>
  );
}

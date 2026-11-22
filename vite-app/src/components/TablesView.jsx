// Play-money tables (docs/play-money-platform.md §6; owner, 2026-11-22: its own tab, app admins first).
//
// The lobby: the chip balance, your tables, a new table, an invite taken from a /play/<token> link. A table:
// the replayer's own felt playing the live hand, the way the drill plays one (HandReplayerReplayView's `drill`
// prop: the hand grows with every view the service streams, and the action bar takes the transport's place).
// Nothing here decides what is legal: the bar offers what the server's view says this player may do, and the
// server checks it again.
import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { T } from './StudyHead.jsx';
import { tablesApi, openTable, liveReplayHand, takeTableInvite, chips } from '../utils/play-tables.js';
import { parseMoney } from '../utils/money.js';
import { SITE_URL } from '../utils/api.js';
import './replayer-drill.css';
import './tables.css';

const Replay = lazy(() => import('./HandReplayerView.jsx').then((m) => ({ default: m.HandReplayerReplayView })));

const GAMES = [
  ['NLH', "No Limit Hold'em"], ['PLO', 'Pot Limit Omaha'], ['LHE', "Limit Hold'em"], ['PLH', "Pot Limit Hold'em"],
  ['PLO5', 'PLO5'], ['PLO6', 'PLO6'], ['PLO8', 'PLO8'], ['NLO8', 'NLO8'], ['O8', 'O8'], ['LO Hi', 'Limit Omaha Hi'],
  ['Big O', 'Big O'], ['PLO6 8/b', 'PLO6 8/b'],
  ['Stud Hi', 'Seven Card Stud'], ['Stud 8', 'Stud Hi-Lo'], ['Razz', 'Razz'],
  ['2-7 TD', '2-7 Triple Draw'], ['PL 2-7 TD', 'PL 2-7 Triple Draw'], ['Badugi', 'Badugi'],
  ['NL 2-7 SD', 'NL 2-7 Single Draw'], ['PL 5CD Hi', 'PL Five Card Draw'],
];
// The server decides (live-hand.js gameKind, maxSeatsFor); these only label the form and its seat list.
const STUD = new Set(['Stud Hi', 'Stud 8', 'Razz']);
const DRAW = new Set(['2-7 TD', 'PL 2-7 TD', 'Badugi', 'NL 2-7 SD', 'PL 5CD Hi']);
const seatsFor = (g) => (STUD.has(g) ? 7 : DRAW.has(g) ? 6 : 9);

/* A table's stakes in words: blinds (and ante) for the board and draw games; ante, bring-in and the bets in stud. */
function stakesText(gameType, b) {
  if (STUD.has(gameType)) return `ante ${chips(b.ante)} · bring-in ${chips(b.bringIn)} · ${chips(b.bb)}/${chips(b.bigBet || b.bb * 2)}`;
  return `${chips(b.sb)}/${chips(b.bb)}${b.ante ? ` · ante ${chips(b.ante)}` : ''}`;
}

const secs = (ms) => Math.max(0, Math.ceil(ms / 1000));

/* The time left on the clock, counting down between views. */
function useCountdown(view) {
  const [, tick] = useState(0);
  const at = useRef({ deadlineIn: null, got: 0 });
  useEffect(() => {
    at.current = { deadlineIn: view && view.table ? view.table.deadlineIn : null, got: performance.now() };
  }, [view]);
  useEffect(() => { const id = setInterval(() => tick((n) => n + 1), 250); return () => clearInterval(id); }, []);
  const { deadlineIn, got } = at.current;
  return deadlineIn == null ? null : Math.max(0, deadlineIn - (performance.now() - got));
}

// ── Chat (owner, 2026-11-22, decision 6: free text, with the moderation App Review asks for) ──
/* The button on the table's bars and in the lobby: "Chat", and how many messages came since it was last open. */
function ChatButton({ unread, onOpen }) {
  return (
    <button type="button" className="hs-btn tb-chat-btn" onClick={onOpen} aria-label={unread ? `Chat, ${unread} new` : 'Chat'}>
      <span className="hs-t" style={T(3)}>{unread ? `Chat · ${unread}` : 'Chat'}</span>
    </button>
  );
}

/* The panel: the table's last messages (never from anyone blocked either way), Report on another's, Mute for the
   host, and a box to write in. Portalled to the body, over the felt, as the app's sheets are. */
function TableChat({ view, hidden, onSay, onMute, onReport, onClose }) {
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const list = useRef(null);
  const msgs = (view.chat || []).filter((m) => m.mine || !hidden.has(m.userId));
  const host = view.table.mutedIds != null;
  const mutedIds = new Set(view.table.mutedIds || []);
  useEffect(() => { if (list.current) list.current.scrollTop = list.current.scrollHeight; }, [msgs.length]);
  const send = async () => {
    if (!text.trim() || sending) return;
    setSending(true); setNote('');
    try { await onSay(text); setText(''); } catch (e) { setNote(e.message); } finally { setSending(false); }
  };
  const report = async (m) => {
    setNote('');
    try { await onReport(m.id); setNote(`Reported. Thank you: an admin will look at ${m.name}'s message.`); } catch (e) { setNote(e.message); }
  };
  return createPortal(
    <div className="tb-chat hs-view" role="dialog" aria-label="Table chat">
      <div className="tb-chat-head">
        <div className="hs-t hs-sm" style={T(3)}>Table chat</div>
        <button type="button" className="hs-btn tb-chat-close" onClick={onClose}><span className="hs-t" style={T(3)}>Close</span></button>
      </div>
      <ul className="tb-chat-list" ref={list}>
        {!msgs.length && <li className="hs-t hs-sm hs-mut" style={T(3)}>No messages yet.</li>}
        {msgs.map((m) => (
          <li key={m.id} className="tb-chat-msg">
            <div className="hs-t hs-sm rd-wrap"><b>{m.mine ? 'You' : m.name}</b>{` ${m.text}`}</div>
            {!m.mine && (
              <div className="tb-chat-acts">
                <button type="button" className="hs-btn tb-chat-act" onClick={() => report(m)}><span className="hs-t" style={T(2)}>Report</span></button>
                {host && (
                  <button type="button" className="hs-btn tb-chat-act" onClick={() => onMute(m.userId, !mutedIds.has(m.userId)).catch((e) => setNote(e.message))}>
                    <span className="hs-t" style={T(2)}>{mutedIds.has(m.userId) ? 'Unmute' : 'Mute'}</span>
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      {note && <div className="hs-t hs-xs rd-wrap hs-mut">{note}</div>}
      {view.table.muted
        ? <div className="hs-t hs-sm hs-mut" style={T(3)}>The host has muted you at this table.</div>
        : (
          <div className="tb-chat-say">
            <input className="tb-amount tb-chat-input" aria-label="Message" maxLength={280} value={text} disabled={sending}
              onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') send(); }} />
            <button type="button" className="hs-btn rd-primary tb-go" disabled={sending || !text.trim()} onClick={send}><span className="hs-t" style={T(3)}>Send</span></button>
          </div>
        )}
    </div>,
    document.body,
  );
}

function Field({ label, children }) {
  return <label className="tb-field"><span className="tb-field-label">{label}</span>{children}</label>;
}

// ── The action bar: what the view says this player may do ──
function TableBar({ view, busy, onAct, left, chat, thrown }) {
  const h = view.hand;
  const L = h.live.legal;
  const names = h.hand.players.map((p) => p.name);
  const [amount, setAmount] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => { setAmount(L && L.canRaise && L.minTo != null ? String(L.minTo) : ''); setErr(''); }, [h.live.seq]); // eslint-disable-line react-hooks/exhaustive-deps
  const clock = left == null ? '' : ` · ${secs(left)}s`;

  // A draw: the cards are marked on the felt (the drill's tap-to-throw), the bar sends them.
  if (h.live.draw) {
    const n = thrown ? thrown.size : 0;
    return (
      <div className="hs-view rd-bar tb-bar snap-place">
        <div className="hs-t hs-sm rd-status" style={T(2)}>{`Tap your cards to throw${clock}`}</div>
        <div className="hs-cols3" style={{ '--hs-n': 2 }}>
          <button type="button" className="hs-btn rd-primary" disabled={busy} onClick={() => onAct({ action: 'draw', discard: [...(thrown || [])] })}>
            <span className="hs-t" style={T(3)}>{n === 0 ? 'Stand pat' : `Draw ${n}`}</span>
          </button>
          {chat}
        </div>
      </div>
    );
  }

  if (!L) {
    const who = h.live.toAct >= 0 ? names[h.live.toAct] : '';
    const me = view.table.you >= 0 ? view.table.seats[view.table.you] : null;
    return (
      <div className="hs-view rd-bar tb-bar snap-place">
        {me && me.waiting && <div className="hs-t hs-sm rd-status" style={T(2)}>Waiting for the big blind</div>}
        <div className="hs-t hs-sm rd-status" style={T(2)}>{who ? `${who} to ${h.live.drawing ? 'draw' : 'act'}${clock}` : 'Dealing…'}</div>
        {chat}
      </div>
    );
  }

  const raiseTo = (to) => onAct({ action: L.raiseWord === 'Bet' ? 'bet' : L.raiseWord === 'Complete' ? 'complete' : 'raise', to });
  const typed = () => {
    const r = parseMoney(amount);
    if (r.error) { setErr(r.error); return; }
    const to = Math.round(r.value);
    if (to < L.minTo || to > L.maxTo) { setErr(`From ${chips(L.minTo)} to ${chips(L.maxTo)}`); return; }
    raiseTo(to);
  };
  // The buttons this turn offers, each [label, act].
  const buttons = [];
  if (L.canFold) buttons.push(['Fold', () => onAct({ action: 'fold' })]);
  if (L.bringIn) buttons.push([`Bring in ${chips(L.bringIn)}`, () => onAct({ action: 'bring-in' })]);
  else if (L.canCheck) buttons.push(['Check', () => onAct({ action: 'check' })]);
  else buttons.push([`Call ${chips(L.call)}`, () => onAct({ action: 'call' })]);
  if (L.canRaise && L.fixedTo != null) buttons.push([`${L.raiseWord} ${chips(L.fixedTo)}`, () => raiseTo(L.fixedTo)]);
  /* Three short labels share a row of three (9g each on a phone); two, or a long label ("Complete 100",
     "Call 12,500"), take a row of two 15g columns, a third going under. Every width whole g. */
  const three = buttons.length === 3 && buttons.every(([label]) => label.length <= 9);
  return (
    <div className="hs-view rd-bar tb-bar snap-place">
      <div className="hs-t hs-sm rd-status" style={T(2)}>{`Your turn${clock}`}</div>
      <div className={three ? 'hs-cols3' : 'hs-cols'} style={{ '--hs-n': 2 }}>
        {buttons.map(([label, onClick]) => (
          <button key={label} type="button" className="hs-btn rd-act" disabled={busy} onClick={onClick}><span className="hs-t" style={T(3)}>{label}</span></button>
        ))}
      </div>
      {L.canRaise && L.fixedTo == null && (
        <div className="tb-raise">
          <input className="tb-amount" inputMode="numeric" aria-label={L.raiseWord} value={amount} disabled={busy}
            onChange={(e) => { setAmount(e.target.value); setErr(''); }} onKeyDown={(e) => { if (e.key === 'Enter') typed(); }} />
          <button type="button" className="hs-btn tb-pill" disabled={busy} onClick={() => setAmount(String(L.minTo))}><span className="hs-t" style={T(3)}>Min</span></button>
          <button type="button" className="hs-btn tb-pill" disabled={busy} onClick={() => setAmount(String(L.maxTo))}><span className="hs-t" style={T(3)}>{L.maxTo >= L.contrib + L.stack ? 'All-in' : 'Pot'}</span></button>
          <button type="button" className="hs-btn rd-primary tb-go" disabled={busy} onClick={typed}><span className="hs-t" style={T(3)}>{L.raiseWord}</span></button>
        </div>
      )}
      {err && <div className="hs-t hs-xs rd-wrap rd-warn">{err}</div>}
    </div>
  );
}

// ── After the hand: the result, and what the player can do between hands ──
function OverBar({ view, busy, onLeave, onRebuy, onSitIn, chat }) {
  const me = view.table.you >= 0 ? view.table.seats[view.table.you] : null;
  return (
    <div className="hs-view rd-bar tb-bar snap-place">
      {/* The felt shows who won as the replay reaches the result; the bar does not say it first. */}
      <div className="hs-t hs-sm rd-status" style={T(2)}>{me && me.status === 'busted' ? 'Out of chips' : 'Hand over'}{me && me.status === 'playing' ? (me.waiting ? ' · you come in on the big blind' : ' · next hand soon') : ''}</div>
      <div className="hs-cols3" style={{ '--hs-n': 2 }}>
        {me && me.status === 'busted' && <button type="button" className="hs-btn rd-primary" disabled={busy} onClick={onRebuy}><span className="hs-t" style={T(3)}>Buy in again</span></button>}
        {me && me.status === 'sitting-out' && <button type="button" className="hs-btn rd-primary" disabled={busy} onClick={onSitIn}><span className="hs-t" style={T(3)}>Sit in</span></button>}
        <button type="button" className="hs-btn" disabled={busy} onClick={onLeave}><span className="hs-t" style={T(3)}>Leave</span></button>
        {chat}
      </div>
    </div>
  );
}

// ── One table ──
function LiveTable({ tableId, heroName, cardSplay, onBack }) {
  const [view, setView] = useState(null);
  const [status, setStatus] = useState('connecting');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [buyIn, setBuyIn] = useState('');
  const seat = useRef(null);
  useEffect(() => {
    const s = openTable(tableId, { onView: setView, onStatus: (st, msg) => { setStatus(st); if (msg) setError(msg); } });
    seat.current = s;
    return () => s.close();
  }, [tableId]);
  const left = useCountdown(view);

  const run = useCallback(async (fn) => {
    setBusy(true); setError('');
    try { await fn(seat.current); } catch (e) { setError(e.message || 'That did not go through'); } finally { setBusy(false); }
  }, []);
  const act = useCallback((move) => run((s) => s.act({ ...move, seq: view && view.hand ? view.hand.live.seq : undefined })), [run, view]);

  const hand = useMemo(() => liveReplayHand(view), [view]);
  const handNo = view && view.hand ? view.hand.handNo : 0;
  const over = !!(view && view.hand && view.hand.live.over);
  const table = view && view.table;
  const me = table && table.you >= 0 ? table.seats[table.you] : null;

  // Chat: who is hidden (blocked either way), whether the panel is open, and the last message seen in it.
  const [hidden, setHidden] = useState(() => new Set());
  useEffect(() => { tablesApi.hidden().then(setHidden).catch(() => {}); }, []);
  const [chatOpen, setChatOpen] = useState(false);
  const [seenId, setSeenId] = useState(0);
  const shown = useMemo(() => ((view && view.chat) || []).filter((m) => m.mine || !hidden.has(m.userId)), [view, hidden]);
  const lastId = shown.length ? shown[shown.length - 1].id : 0;
  useEffect(() => { if (chatOpen) setSeenId(lastId); }, [chatOpen, lastId]);
  const unread = shown.filter((m) => !m.mine && m.id > seenId).length;
  const chatButton = <ChatButton unread={unread} onOpen={() => setChatOpen(true)} />;
  const chatPanel = chatOpen && view && (
    <TableChat view={view} hidden={hidden} onClose={() => setChatOpen(false)}
      onSay={(text) => seat.current.say(text)}
      onMute={(userId, muted) => seat.current.mute(userId, muted)}
      onReport={(msgId) => tablesApi.report(tableId, msgId)} />
  );

  // A draw: the cards this player has marked to throw, cleared with every new view of the hand.
  const [thrown, setThrown] = useState(() => new Set());
  const seq = view && view.hand ? `${handNo}:${view.hand.live.seq}` : '';
  useEffect(() => { setThrown(new Set()); }, [seq]);
  const toggleThrown = useCallback((c) => setThrown((prev) => {
    const next = new Set(prev);
    if (next.has(c)) next.delete(c); else next.add(c);
    return next;
  }), []);

  const drill = useMemo(() => {
    if (!view || !view.hand) return null;
    return {
      rev: `${handNo}:${view.hand.live.seq}`,
      over,
      startAtEnd: false,
      discard: view.hand.live.draw ? { thrown, toggle: toggleThrown, disabled: busy } : null,
      bar: <TableBar view={view} busy={busy} onAct={act} left={left} chat={chatButton} thrown={thrown} />,
      overBar: <OverBar view={view} busy={busy} chat={chatButton}
        onLeave={() => run((s) => s.leave()).then(onBack)}
        onSitIn={() => run((s) => s.sitIn())}
        onRebuy={() => run((s) => s.rebuy(table.buyIn.max))} />,
    };
  }, [view, busy, act, left, over, handNo, run, onBack, table, unread, thrown, toggleThrown]); // eslint-disable-line react-hooks/exhaustive-deps

  if (status === 'gone') {
    return (
      <div className="hs-view rd-setup">
        <div className="hs-t hs-sm rd-wrap">This table is closed.</div>
        <button type="button" className="hs-btn" onClick={onBack}><span className="hs-t" style={T(3)}>Back</span></button>
      </div>
    );
  }
  if (!view) return <div className="hs-view rd-setup"><div className="hs-t hs-sm hs-mut" style={T(3)}>Joining the table…</div></div>;

  // Not seated, or seated with no hand yet: the seats, and a way to sit.
  if (!me || !hand) {
    const sit = () => {
      const r = parseMoney(buyIn || String(table.buyIn.max));
      if (r.error) { setError(r.error); return; }
      run((s) => s.sit(null, Math.round(r.value)));
    };
    return (
      <div className="hs-view rd-setup tb-lobby">
        <h2 className="screen-title hs-t hs-title" style={T(4)}>{table.name}</h2>
        <div className="hs-t hs-sm hs-mut" style={T(3)}>{`${table.gameType} · ${stakesText(table.gameType, table.blinds)} · ${table.clock.decision}s a decision`}</div>
        <ul className="tb-seats">
          {table.seats.map((s, i) => (
            <li key={i} className="hs-t hs-sm" style={T(3)}>{`Seat ${i + 1}: `}{s ? `${s.name} · ${chips(s.stack)}${s.status !== 'playing' ? ` (${s.status.replace('-', ' ')})` : s.waiting ? ' (waiting for the big blind)' : ''}` : 'open'}</li>
          ))}
        </ul>
        {!me && (
          <>
            <Field label={`Buy in (${chips(table.buyIn.min)} to ${chips(table.buyIn.max)})`}>
              <input inputMode="numeric" value={buyIn} placeholder={String(table.buyIn.max)} onChange={(e) => setBuyIn(e.target.value)} />
            </Field>
            <button type="button" className="hs-btn rd-primary" disabled={busy} onClick={sit}><span className="hs-t" style={T(3)}>Sit down</span></button>
          </>
        )}
        {me && <div className="hs-t hs-sm hs-mut" style={T(3)}>Waiting for another player…</div>}
        {error && <div className="hs-t hs-sm rd-wrap rd-warn">{error}</div>}
        {status !== 'live' && <div className="hs-t hs-xs hs-mut" style={T(2)}>{status === 'connecting' ? 'Connecting…' : 'Reconnecting…'}</div>}
        <div className="hs-cols" style={{ '--hs-n': me ? 3 : 2 }}>
          <button type="button" className="hs-btn" onClick={onBack}><span className="hs-t" style={T(3)}>Back</span></button>
          {me && <button type="button" className="hs-btn" disabled={busy} onClick={() => run((s) => s.leave()).then(onBack)}><span className="hs-t" style={T(3)}>Leave</span></button>}
          {chatButton}
        </div>
        {chatPanel}
      </div>
    );
  }

  return (
    <div className="replayer-view is-replay tb-live" data-table={tableId}>
      {error && <div className="hs-view"><div className="hs-t hs-sm rd-wrap rd-warn rd-error">{error}</div></div>}
      {status !== 'live' && <div className="hs-view"><div className="hs-t hs-xs hs-mut rd-error">Reconnecting…</div></div>}
      <Suspense fallback={null}>
        <Replay key={`${tableId}:${handNo}`} hand={hand} token={null} heroName={heroName} cardSplay={cardSplay}
          onBack={onBack} onEdit={() => {}} drill={drill} />
      </Suspense>
      {chatPanel}
    </div>
  );
}

// ── The lobby ──
function NewTable({ onMade, onCancel }) {
  const [f, setF] = useState({ name: '', gameType: 'NLH', sb: '50', bb: '100', ante: '0', maxSeats: '6', min: '2000', max: '10000', decision: '30', bank: '60' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const stud = STUD.has(f.gameType);
  const most = seatsFor(f.gameType);
  // A game with fewer seats takes the seat count down with it; stud's stakes start with an ante.
  const pickGame = (e) => {
    const g = e.target.value;
    setF((p) => ({ ...p, gameType: g, maxSeats: String(Math.min(Number(p.maxSeats), seatsFor(g))), ...(STUD.has(g) && !Number(p.ante) ? { ante: '10' } : {}) }));
  };
  const make = async () => {
    setBusy(true); setError('');
    try {
      const t = await tablesApi.create({
        name: f.name || undefined, gameType: f.gameType, sb: Number(f.sb), bb: Number(f.bb), ante: Number(f.ante) || 0,
        maxSeats: Number(f.maxSeats), buyIn: { min: Number(f.min), max: Number(f.max) }, decision: Number(f.decision), bank: Number(f.bank),
      });
      onMade(t);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="hs-view rd-setup tb-new">
      <h2 className="screen-title hs-t hs-title" style={T(4)}>New table</h2>
      <Field label="Name"><input value={f.name} placeholder="Friday game" onChange={set('name')} /></Field>
      <Field label="Game">
        <select value={f.gameType} onChange={pickGame}>{GAMES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
      </Field>
      <div className="tb-row is-3">
        <Field label={stud ? 'Bring-in' : 'Small blind'}><input inputMode="numeric" value={f.sb} onChange={set('sb')} /></Field>
        <Field label={stud ? 'Small bet' : 'Big blind'}><input inputMode="numeric" value={f.bb} onChange={set('bb')} /></Field>
        <Field label="Ante"><input inputMode="numeric" value={f.ante} onChange={set('ante')} /></Field>
      </div>
      <div className="tb-row is-3">
        <Field label="Seats"><select value={f.maxSeats} onChange={set('maxSeats')}>{Array.from({ length: most - 1 }, (_, i) => i + 2).map((n) => <option key={n}>{n}</option>)}</select></Field>
        <Field label="Buy-in from"><input inputMode="numeric" value={f.min} onChange={set('min')} /></Field>
        <Field label="to"><input inputMode="numeric" value={f.max} onChange={set('max')} /></Field>
      </div>
      <div className="tb-row">
        <Field label="Seconds a decision"><input inputMode="numeric" value={f.decision} onChange={set('decision')} /></Field>
        <Field label="Time bank (s)"><input inputMode="numeric" value={f.bank} onChange={set('bank')} /></Field>
      </div>
      {error && <div className="hs-t hs-sm rd-wrap rd-warn">{error}</div>}
      <div className="hs-cols" style={{ '--hs-n': 2 }}>
        <button type="button" className="hs-btn" onClick={onCancel}><span className="hs-t" style={T(3)}>Cancel</span></button>
        <button type="button" className="hs-btn rd-primary" disabled={busy} onClick={make}><span className="hs-t" style={T(3)}>Create</span></button>
      </div>
    </div>
  );
}

export default function TablesView({ heroName, cardSplay, active = true }) {
  const [screen, setScreen] = useState({ kind: 'lobby' });
  const [balance, setBalance] = useState(null);
  const [list, setList] = useState([]);
  const [invite, setInvite] = useState(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');

  const refresh = useCallback(() => {
    tablesApi.chips().then((c) => setBalance(c.balance)).catch(() => {});
    tablesApi.list().then((l) => setList(l.tables || [])).catch(() => {});
  }, []);
  useEffect(() => { if (active && screen.kind === 'lobby') refresh(); }, [active, screen.kind, refresh]);

  // A /play/<token> link: show the table it opens, and join it on a yes.
  useEffect(() => {
    const token = takeTableInvite();
    if (!token) return;
    tablesApi.invite(token).then((t) => setInvite({ token, table: t })).catch((e) => setError(e.message));
  }, []);

  if (screen.kind === 'table') {
    return <LiveTable tableId={screen.id} heroName={heroName} cardSplay={cardSplay} onBack={() => setScreen({ kind: 'lobby' })} />;
  }
  if (screen.kind === 'new') {
    return <NewTable onCancel={() => setScreen({ kind: 'lobby' })} onMade={(t) => { setList((l) => [t, ...l]); setScreen({ kind: 'lobby' }); }} />;
  }

  const copy = async (t) => {
    try { await navigator.clipboard.writeText(t.invite); setCopied(t.id); } catch { setCopied(''); }
  };
  return (
    <div className="hs-view rd-setup tb-lobby">
      <h2 className="screen-title hs-t hs-title" style={T(4)}>Tables</h2>
      <div className="hs-t hs-sm hs-mut rd-wrap">Play-money tables with friends. The chips are free: never bought, cashed out or sent to anyone.</div>
      <div className="hs-t hs-sm hs-bold" style={T(3)} data-testid="chip-balance">{balance == null ? '' : `${chips(balance)} chips`}</div>
      {invite && (
        <div className="hs-panel hs-stack tb-invite">
          <div className="hs-t hs-sm" style={T(3)}>{`You're invited to ${invite.table.name}`}</div>
          <div className="hs-t hs-xs hs-mut" style={T(2)}>{`${invite.table.gameType} · ${stakesText(invite.table.gameType, invite.table.blinds)}`}</div>
          <button type="button" className="hs-btn rd-primary" onClick={async () => {
            try { const t = await tablesApi.accept(invite.token); setInvite(null); setScreen({ kind: 'table', id: t.id }); } catch (e) { setError(e.message); }
          }}><span className="hs-t" style={T(3)}>Join the table</span></button>
        </div>
      )}
      {list.map((t) => (
        <div key={t.id} className="hs-panel hs-stack tb-item">
          <div className="hs-t hs-sm hs-bold" style={T(3)}>{t.name}</div>
          <div className="hs-t hs-xs hs-mut" style={T(2)}>{`${t.gameType} · ${stakesText(t.gameType, t.blinds)} · ${t.maxSeats} seats`}</div>
          <div className="hs-cols" style={{ '--hs-n': 2 }}>
            <button type="button" className="hs-btn rd-primary" onClick={() => setScreen({ kind: 'table', id: t.id })}><span className="hs-t" style={T(3)}>Open</span></button>
            {t.invite && <button type="button" className="hs-btn" onClick={() => copy(t)}><span className="hs-t" style={T(3)}>{copied === t.id ? 'Link copied' : 'Copy invite'}</span></button>}
          </div>
        </div>
      ))}
      {error && <div className="hs-t hs-sm rd-wrap rd-warn">{error}</div>}
      <button type="button" className="hs-btn" onClick={() => setScreen({ kind: 'new' })}><span className="hs-t" style={T(3)}>New table</span></button>
      <div className="hs-t hs-xs hs-mut rd-wrap">{`Invites open ${SITE_URL.replace(/^https?:\/\//, '')}/play/… links.`}</div>
    </div>
  );
}

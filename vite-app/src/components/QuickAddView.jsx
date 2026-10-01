import React, { useState, useMemo, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { API_URL } from '../utils/api.js';
import { HAND_CONFIG } from '../utils/utils.js';
import { findGaps, applyAnswer } from '../utils/quick-add/gaps.js';

/* Quick Add — describe a hand in words, then answer one question at a time
   until the replayer has what it needs. Contract: docs/quick-add-contract.md.
     1. describe → POST /api/quick-add/parse → a PARTIAL hand (+ notes)
     2. findGaps(hand) → ask the first gap; an option chip merges locally via
        applyAnswer, free text goes to POST /api/quick-add/answer
     3. every answer re-runs findGaps, so a fix that exposes a new gap is asked next
     4. no blocking gaps → open it in the replayer (or the entry form, to save)
   Grid: every width is whole g on the 1..36 x-lines, every height whole r; see the
   "Quick Add" section of styles.css for the arithmetic. */

// Valid vertical lines of the 37g screen: 1g margin, then 2g steps inside each 8g column.
const X_LINES = [1, 3, 5, 7, 9, 10, 12, 14, 16, 18, 19, 21, 23, 25, 27, 28, 30, 32, 34, 36];
const BUBBLE_MAX_G = 29;   // 1..30 for the app's bubbles, 7..36 for yours
const BUBBLE_MIN_G = 4;

// Widths a bubble may take, in g: anchored at 1 its right edge must be an x-line;
// anchored at 36 its left edge must be.
const BUBBLE_WIDTHS = {
  app: X_LINES.map(x => x - 1).filter(w => w >= BUBBLE_MIN_G && w <= BUBBLE_MAX_G),
  user: X_LINES.map(x => 36 - x).filter(w => w >= BUBBLE_MIN_G && w <= BUBBLE_MAX_G).sort((a, b) => a - b),
};

function gridUnitPx() {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;visibility:hidden;width:calc(var(--gu) * 100)';
  document.body.appendChild(probe);
  const g = probe.getBoundingClientRect().width / 100;
  probe.remove();
  return g || 1;
}
function subrowPx() {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;visibility:hidden;height:calc(var(--subrow) * 100)';
  document.body.appendChild(probe);
  const r = probe.getBoundingClientRect().height / 100;
  probe.remove();
  return r || 1;
}

// Rendered lines of a text element: distinct line tops of its text fragments.
// Independent of text-box-trim and of the box's own height.
function lineCount(el) {
  const range = document.createRange();
  range.selectNodeContents(el);
  const tops = new Set();
  for (const b of range.getClientRects()) if (b.height > 0) tops.add(Math.round(b.top));
  return Math.max(1, tops.size);
}

/* Whole-r height for a block of `lead` r to its first baseline, 2r lines, and
   `tail` r under the last: lead + 2(N − 1) + tail. Set once on the box, so the
   height is ONE rounding of a whole-r calc, not a sum of trimmed line boxes (which
   came out 4.997r and let everything below drift). */
function fitHeight(box, text, lead, tail) {
  if (!box || !text) return;
  box.style.height = `calc(var(--subrow) * ${lead + 2 * (lineCount(text) - 1) + tail})`;
}

/* A chat bubble sized to its text: width snapped UP to the nearest step that keeps
   both edges on x-lines (the text is measured on one line in a hidden twin; past 29g
   it wraps inside the 29g bubble), height 3r to the first baseline + 2r per extra
   line + 2r under the last. */
function Bubble({ side = 'app', tone, text }) {
  const box = useRef(null), body = useRef(null), twin = useRef(null);
  useLayoutEffect(() => {
    let live = true;
    const fit = () => {
      if (!live || !box.current || !twin.current) return;
      const need = twin.current.getBoundingClientRect().width / gridUnitPx() + 2; // + 1g each side
      const steps = BUBBLE_WIDTHS[side === 'user' ? 'user' : 'app'];
      box.current.style.width = `calc(var(--gu) * ${steps.find(w => w >= need) || BUBBLE_MAX_G})`;
      fitHeight(box.current, body.current, 3, 2);
    };
    fit();
    document.fonts?.ready?.then(fit);
    window.addEventListener('resize', fit);
    return () => { live = false; window.removeEventListener('resize', fit); };
  }, [text, side, tone]);
  return (
    <div ref={box} className={'qa-bubble is-' + side + (tone ? ' is-' + tone : '')}>
      <p ref={body} className="qa-bubble-text">{text}</p>
      <span ref={twin} className="qa-bubble-twin" aria-hidden="true">{text}</span>
    </div>
  );
}

// An error line: first baseline 2r down, 2r lines.
function Status({ text }) {
  const el = useRef(null);
  useLayoutEffect(() => {
    let live = true;
    const fit = () => { if (live && el.current) fitHeight(el.current, el.current, 2, 0); };
    fit();
    document.fonts?.ready?.then(fit);
    window.addEventListener('resize', fit);
    return () => { live = false; window.removeEventListener('resize', fit); };
  }, [text]);
  return <p ref={el} className="qa-status" role="alert">{text}</p>;
}

// ── Summary formatting ──────────────────────────────────────────────
function chips(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return null;
  if (v >= 1e6) return +(v / 1e6).toFixed(v % 1e6 ? 1 : 0) + 'M';
  if (v >= 1e4) return +(v / 1e3).toFixed(v % 1e3 ? 1 : 0) + 'k';
  return v.toLocaleString();
}
const spacedCards = s => (String(s || '').replace(/\s+/g, '').match(/[2-9TJQKA][hdcsx]?|x/gi) || []).join(' ');

function summarize(hand) {
  if (!hand) return [];
  const cfg = HAND_CONFIG[hand.gameType] || {};
  const rows = [];
  const mode = hand.gameMode === 'cash' ? 'Cash' + (hand.currency ? ' ' + hand.currency : '') : hand.gameMode === 'mtt' ? 'Tournament' : null;
  rows.push(['Game', [hand.gameType, mode].filter(Boolean).join(' · ') || null]);
  const bl = hand.blinds || {};
  let stakes = null;
  if (bl.bb) {
    stakes = cfg.betting === 'fl' ? chips(bl.bb) + '/' + chips(bl.bigBet || bl.bb * 2) : (chips(bl.sb) || '?') + '/' + chips(bl.bb);
    if (bl.ante) stakes += ' · ' + chips(bl.ante) + ' ante';
    if (bl.straddle) stakes += ' · ' + chips(bl.straddle) + ' straddle';
  }
  rows.push(['Stakes', stakes]);
  const heroIdx = hand.heroIdx != null ? hand.heroIdx : 0;
  const players = hand.players || [];
  rows.push(['Seats', players.length ? players.map((p, i) =>
    (p?.position || p?.name || 'Seat ' + (i + 1)) + (i === heroIdx ? ' (you)' : '') + ' ' + (chips(p?.startingStack) || '?')
  ).join(' · ') : null]);
  const streets = hand.streets || [];
  rows.push(['Hero', spacedCards(streets[0]?.cards?.hero) || null]);
  const board = streets.map(s => s?.cards?.board || '').join('');
  if (cfg.hasBoard !== false || board) rows.push(['Board', spacedCards(board) || null]);
  const acted = streets.filter(s => (s?.actions || []).length);
  rows.push(['Action', acted.length ? acted.map(s => (s.name || 'Street') + ' ' + s.actions.length).join(' · ') : null]);
  return rows;
}

// Structural defaults only — arrays and objects the replayer walks. Values are never guessed.
function toReplayable(hand) {
  const h = { ...hand };
  h.players = Array.isArray(h.players) ? h.players : [];
  h.streets = (Array.isArray(h.streets) ? h.streets : []).map(s => ({
    ...s,
    cards: { hero: '', board: '', ...(s?.cards || {}), opponents: Array.isArray(s?.cards?.opponents) ? s.cards.opponents : [] },
    actions: Array.isArray(s?.actions) ? s.actions : [],
    draws: Array.isArray(s?.draws) ? s.draws : [],
  }));
  h.blinds = h.blinds || {};
  if (h.heroIdx == null) h.heroIdx = 0;
  delete h.quickAddDismissed; // the gaps engine's "don't ask again" list
  return h;
}

/* The gaps engine marks some gaps `auto`: a mechanical fix whose first option follows from
   the hand itself (an implied fold, a relabelled action). Those are applied without asking —
   each at most once, so a fix that does not settle its gap cannot loop — and announced in the
   chat so nothing changes silently. `provisional` gaps are previews (asked after the real
   question settles the game or seating), never questions. */
function settleAuto(hand) {
  let h = hand; const notes = []; const done = new Set();
  for (let i = 0; i < 25; i++) {
    const g = findGaps(h).find(x => x.auto && !x.provisional && !done.has(x.id) && x.options && x.options.length);
    if (!g) break;
    done.add(g.id);
    h = applyAnswer(h, g, g.options[0].value);
    notes.push({ side: 'app', tone: 'note', text: 'Filled in: ' + g.options[0].label });
  }
  return { hand: h, notes };
}
const isDismiss = o => o && o.value && typeof o.value === 'object' && o.value.op === 'dismiss';

// Plain-English failures. `kind` is 'parse' or 'answer'.
function describeFailure(status, kind) {
  if (status === 0) return "Couldn't reach the server. Check your connection and try again.";
  if (status === 401) return 'Your session has expired. Sign in again to use quick add.';
  if (status === 403) return 'Quick add is for admins only for now.';
  if (status === 429) return 'Too many hands in a short time. Wait a minute, then try again.';
  if (status === 503) return 'The hand reader is unavailable right now. Try again in a few minutes.';
  if (status === 400 || status === 422) return kind === 'parse'
    ? "Couldn't make a hand out of that. Try adding the game, stakes and the action street by street."
    : "Couldn't use that answer. Try saying it another way, or pick one of the options.";
  return `Something went wrong (error ${status}). Try again.`;
}

async function postJson(path, token, body) {
  let res;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: JSON.stringify(body),
    });
  } catch { return { ok: false, status: 0 }; }
  let data = null;
  try { data = await res.json(); } catch { /* empty or not JSON */ }
  return { ok: res.ok, status: res.status, data };
}

/* One-tap answers on the column tracks: four 8g, two 17g or one 35g per row. Starts
   as dense as the count allows and steps wider while any label would be cut off, so
   the choice comes from the rendered text, not a character count. */
const CHIP_LAYOUTS = ['is-4', 'is-2', 'is-1'];
function ChipGrid({ label, items, busy, primaryFirst, onPick }) {
  const grid = useRef(null);
  const [layout, setLayout] = useState(items.length >= 3 ? 'is-4' : 'is-2');
  useLayoutEffect(() => {
    const cut = [...(grid.current?.querySelectorAll('.qa-chip > span') || [])].some(s => s.scrollWidth > s.clientWidth + 0.5);
    const i = CHIP_LAYOUTS.indexOf(layout);
    if (cut && i < CHIP_LAYOUTS.length - 1) setLayout(CHIP_LAYOUTS[i + 1]);
  }, [layout, items]);
  return (
    <div ref={grid} className={'qa-chips ' + layout} role="group" aria-label={label}>
      {items.map((o, i) => (
        <button key={i} type="button" disabled={busy}
          className={'qa-chip' + (i === 0 && primaryFirst && !o.skip ? ' is-best' : '') + (o.skip ? ' is-skip' : '')}
          onClick={() => onPick(o)}>
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}

export default function QuickAddView({ token, heroName, onBack, onOpen }) {
  const [phase, setPhase] = useState('describe');      // 'describe' | 'chat'
  const [text, setText] = useState('');
  const [hand, setHand] = useState(null);
  const [log, setLog] = useState([]);                   // { side, tone?, text }
  const [busy, setBusy] = useState(null);               // null | 'parse' | 'answer'
  const [error, setError] = useState(null);
  const [reply, setReply] = useState('');
  const [skipped, setSkipped] = useState(() => new Set());
  const activeRef = useRef(null);

  const gaps = useMemo(() => (hand ? findGaps(hand).filter(g => !g.provisional) : []), [hand]);
  const open = useMemo(() => gaps.filter(g => !skipped.has(g.id)), [gaps, skipped]);
  const blocking = gaps.filter(g => g.blocking);
  const ready = phase === 'chat' && hand && blocking.length === 0;
  const current = open[0] || null;
  const summary = useMemo(() => summarize(hand), [hand]);

  const say = useCallback((...entries) => setLog(l => [...l, ...entries]), []);

  const parse = async () => {
    const description = text.trim();
    if (!description || busy) return;
    setBusy('parse'); setError(null);
    const { ok, status, data } = await postJson('/quick-add/parse', token, {
      text: description, source: 'text', hints: heroName ? { heroName } : undefined,
    });
    setBusy(null);
    if (!ok || !data?.hand) { setError(describeFailure(ok ? 500 : status, 'parse')); return; }
    const notes = Array.isArray(data.notes) ? data.notes.filter(Boolean) : [];
    const settled = settleAuto(data.hand);
    setHand(settled.hand);
    setLog([{ side: 'user', text: description }, ...notes.map(n => ({ side: 'app', tone: 'note', text: n })), ...settled.notes]);
    setSkipped(new Set());
    setPhase('chat');
  };

  // After any answer: if the same gap still leads, say so instead of silently re-asking.
  const afterAnswer = (gap, nextHand) => {
    const next = findGaps(nextHand).filter(g => !g.provisional && !skipped.has(g.id))[0];
    if (next && next.id === gap.id) say({ side: 'app', tone: 'note', text: "That didn't settle it. Try another way." });
  };

  const choose = (gap, option) => {
    if (busy) return;
    const settled = settleAuto(applyAnswer(hand, gap, option.value));
    say({ side: 'app', text: gap.question }, { side: 'user', tone: isDismiss(option) ? 'skip' : undefined, text: option.label }, ...settled.notes);
    setHand(settled.hand); setError(null); setReply('');
    if (!isDismiss(option)) afterAnswer(gap, settled.hand);
  };

  const skip = gap => {
    say({ side: 'app', text: gap.question }, { side: 'user', tone: 'skip', text: 'Skip' });
    setSkipped(s => new Set(s).add(gap.id));
    setReply(''); setError(null);
  };

  const sendReply = async gap => {
    const answer = reply.trim();
    if (!answer || busy) return;
    setBusy('answer'); setError(null);
    const { ok, status, data } = await postJson('/quick-add/answer', token, { hand, gap, answer });
    setBusy(null);
    if (!ok || !data?.hand) { setError(describeFailure(ok ? 500 : status, 'answer')); return; }
    const settled = settleAuto(data.hand);
    say({ side: 'app', text: gap.question }, { side: 'user', text: answer }, ...settled.notes);
    setHand(settled.hand); setReply('');
    afterAnswer(gap, settled.hand);
  };

  const startOver = () => {
    setPhase('describe'); setHand(null); setLog([]); setError(null); setReply(''); setBusy(null);
    setSkipped(new Set());
  };

  /* Keep the live question in view. The target is a whole r (content starts on a whole
     r, so the scrolled content stays on the overlay's r-lines) — and because the
     browser lands scrollTop on whole pixels, the whole r chosen, from the first that
     is far enough to the next three, is the one nearest a whole pixel. */
  useEffect(() => {
    const el = activeRef.current;
    if (!el || phase !== 'chat') return;
    const scroller = el.closest('.content-area');
    if (!scroller) return;
    const r = subrowPx();
    const box = scroller.getBoundingClientRect();
    const target = el.getBoundingClientRect();
    const visibleBottom = box.bottom - r;
    let delta = target.bottom - visibleBottom;
    delta = Math.min(delta, target.top - box.top - r); // a tall block shows its top first
    if (delta <= 0) return;
    const first = Math.ceil((scroller.scrollTop + delta) / r);
    let k = first;
    for (let c = first + 1; c <= first + 3; c++) {
      const off = n => Math.abs(n * r - Math.round(n * r));
      if (off(c) < off(k) - 0.01) k = c;
    }
    const top = k * r;
    scroller.scrollTo({ top, behavior: 'smooth' });
  }, [log.length, phase, current?.id, ready, busy, error]);

  const question = gap => {
    if (!gap) return null;
    const options = (gap.options || []).slice();
    const all = options.map(o => ({ ...o }));
    if (!gap.blocking && !options.some(isDismiss)) all.push({ label: 'Skip', value: undefined, skip: true });
    // One filled action per region: once the Open button exists, it is the one.
    const sendIsPrimary = !options.length && !ready;
    return (
      <div className="qa-question" key={gap.id}>
        <Bubble side="app" tone="ask" text={(gap.blocking ? '' : 'Optional: ') + gap.question} />
        {all.length > 0 && (
          <ChipGrid label={gap.question} items={all} busy={!!busy} primaryFirst={!ready}
            onPick={o => (o.skip ? skip(gap) : choose(gap, o))} />
        )}
        {gap.allowFree && (
          <form className="qa-reply" onSubmit={e => { e.preventDefault(); sendReply(gap); }}>
            <input type="text" value={reply} disabled={busy === 'answer'}
              aria-label={'Answer: ' + gap.question}
              placeholder={options.length ? 'Or type your answer' : 'Type your answer'}
              onChange={e => setReply(e.target.value)} />
            <button type="submit" className={'qa-chip' + (sendIsPrimary ? ' is-best' : '')}
              disabled={!reply.trim() || !!busy}>
              <span>{busy === 'answer' ? 'Sending' : 'Send'}</span>
            </button>
          </form>
        )}
      </div>
    );
  };

  return (
    <div className="qa-view">
      <div className="qa-head">
        <button type="button" className="qa-chip qa-head-back" onClick={onBack}><span>Back</span></button>
        <div className="qa-head-title"><span>Quick Add</span></div>
        {phase === 'chat' && (
          <button type="button" className="qa-chip qa-head-reset" onClick={startOver}><span>Start over</span></button>
        )}
      </div>

      {phase === 'describe' ? (
        <div className="qa-describe">
          <Bubble side="app" text="Describe the hand: game, stakes, positions, stacks, your cards and the action street by street. Leave out what you don't remember and I'll ask." />
          <div className="qa-field">
            <label htmlFor="qa-describe-text">Describe the hand</label>
            <textarea id="qa-describe-text" value={text} disabled={busy === 'parse'}
              placeholder={'e.g. 200/400 400 ante, I open AKs on the button to 1000, BB calls. Flop Q72 rainbow, check, I bet 1200, call. Turn 5s…'}
              onChange={e => setText(e.target.value)} />
            <p className="qa-hint">Type it, or tap the mic on your keyboard and say it.</p>
          </div>
          <button type="button" className="qa-chip is-best qa-wide" disabled={!text.trim() || !!busy} onClick={parse}>
            <span>{busy === 'parse' ? 'Reading the hand…' : 'Read hand'}</span>
          </button>
          {error && <Status text={error} />}
        </div>
      ) : (
        <div className="qa-chat">
          <div className="qa-log" aria-live="polite">
            {log.map((m, i) => <Bubble key={i} side={m.side} tone={m.tone} text={m.text} />)}
          </div>

          <div className="qa-summary" aria-label="What's known so far"
            style={{ height: `calc(var(--subrow) * ${3 + 2 * summary.length})` }}>
            {summary.map(([label, value]) => (
              <div className="qa-summary-row" key={label}>
                <span className="qa-summary-label">{label}</span>
                <span className={'qa-summary-value' + (value ? '' : ' is-unknown')}>{value || '—'}</span>
              </div>
            ))}
          </div>

          <div className="qa-active" ref={activeRef}>
            {ready && (
              <div className="qa-ready">
                <p className="qa-ready-text">{open.length
                  ? "That's enough to replay it. The rest is optional."
                  : "That's everything. Ready to replay."}</p>
                <div className="qa-ready-actions">
                  <button type="button" className="qa-chip is-best" onClick={() => onOpen(toReplayable(hand), 'replay')}>
                    <span>Open in replayer</span>
                  </button>
                  <button type="button" className="qa-chip" onClick={() => onOpen(toReplayable(hand), 'entry')}>
                    <span>Review &amp; save</span>
                  </button>
                </div>
              </div>
            )}
            {busy === 'answer' && <Bubble side="app" tone="note" text="Reading your answer…" />}
            {question(current)}
            {error && <Status text={error} />}
          </div>
        </div>
      )}
    </div>
  );
}

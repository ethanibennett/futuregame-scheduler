// ── Quick-add: action rules ───────────────────────────────────────────────
// Replays the recorded actions street by street on a Table (betting.js) and
// reports the first thing that cannot have happened. Checking stops at the first
// BLOCKING action problem: everything after a wrong action is read against a
// state that is already wrong, so the next problem is only worth asking about
// once this one is answered (findGaps re-runs after every answer).

import { Table, seatOrder, straddles, lastStraddleSeat, findStudBringIn, findStudBestBoard, studUpCards, doorCard } from './betting.js';
import { referencedSeats, hasCards } from './seats.js';
import { isLowStud } from './game.js';
import { cardsOf } from './cards.js';
import { roundChips } from './pending.js';
import { STAGE, makeGap, fmt, playerName, streetName, listWords, num, dismissOption } from './common.js';

export const KNOWN_ACTIONS = ['fold', 'check', 'call', 'bet', 'raise', 'all-in', 'bring-in'];

const ACTION_ALIASES = {
  folds: 'fold', f: 'fold', muck: 'fold', mucks: 'fold', folded: 'fold',
  checks: 'check', x: 'check', checked: 'check',
  calls: 'call', c: 'call', limp: 'call', limps: 'call', flat: 'call', flats: 'call', called: 'call', overlimp: 'call',
  bets: 'bet', b: 'bet', lead: 'bet', leads: 'bet', donk: 'bet', donks: 'bet', cbet: 'bet', 'c-bet': 'bet', complete: 'bet', completes: 'bet', bet: 'bet', open: 'bet',
  raises: 'raise', r: 'raise', '3bet': 'raise', '3-bet': 'raise', '4bet': 'raise', '4-bet': 'raise', '5bet': 'raise', reraise: 'raise', 're-raise': 'raise', 'check-raise': 'raise', checkraise: 'raise', iso: 'raise', isolate: 'raise', squeeze: 'raise', opens: 'raise', raised: 'raise',
  allin: 'all-in', 'all in': 'all-in', 'all-in': 'all-in', shove: 'all-in', shoves: 'all-in', jam: 'all-in', jams: 'all-in', push: 'all-in', pushes: 'all-in', shoved: 'all-in',
  'bring in': 'bring-in', bringin: 'bring-in', bi: 'bring-in', 'brings in': 'bring-in', 'brings-in': 'bring-in',
};

export function normalizeActionName(raw) {
  if (typeof raw !== 'string') return null;
  const t = raw.trim().toLowerCase();
  if (KNOWN_ACTIONS.includes(t)) return t;
  return ACTION_ALIASES[t] || ACTION_ALIASES[t.replace(/\s+/g, '')] || null;
}

const isIdx = (v, n) => Number.isInteger(v) && v >= 0 && v < n;

/* Has anything happened after the betting on street si? Then that betting
   round must have closed. */
export function laterContent(hand, si, env) {
  const streets = hand.streets;
  if ((streets[si].draws || []).length && env.isDraw) return true;
  for (let sj = si + 1; sj < streets.length; sj++) {
    const st = streets[sj];
    if ((st.actions || []).length) return true;
    if (env.category === 'community' && cardsOf(st.cards.board).length) return true;
    if (env.isDraw && (st.draws || []).length) return true;
    if (env.isStud) {
      if (cardsOf(st.cards.hero).length) return true;
      if ((st.cards.opponents || []).some(o => cardsOf(o).length)) return true;
    }
  }
  return false;
}

/* Does player p do anything after this point (later on this street, on any
   later street, in a draw from this street on, or win the pot)? A player who
   is still around later cannot have folded now. */
function actsLater(hand, p, si, ai) {
  const streets = hand.streets;
  for (let sj = si; sj < streets.length; sj++) {
    const acts = streets[sj].actions || [];
    for (let k = sj === si ? ai + 1 : 0; k < acts.length; k++) if (acts[k] && acts[k].player === p) return true;
    if ((streets[sj].draws || []).some(d => d && d.player === p)) return true;
  }
  const winners = (hand.result && Array.isArray(hand.result.winners)) ? hand.result.winners : [];
  return winners.some(w => w && w.playerIdx === p);
}

function act(player, action, amount) { return { player, action, amount: amount || 0 }; }

function describe(hand, a, t) {
  const who = playerName(hand, a.player);
  const amt = num(a.amount);
  switch (a.action) {
    case 'fold': return who + ' folds';
    case 'check': return who + ' checks';
    case 'call': return who + ' calls ' + fmt(amt);
    case 'bet': return who + ' bets ' + fmt(amt);
    case 'raise': return who + ' raises to ' + fmt((t ? t.contrib[a.player] : 0) + amt);
    case 'all-in': return who + ' is all-in' + (Number.isFinite(amt) && amt > 0 ? ' for ' + fmt(amt) + ' more' : '');
    case 'bring-in': return who + ' brings it in for ' + fmt(amt);
    default: return who + ' ' + a.action;
  }
}

/* Labels for a filled-in action, from the acting seat's point of view. */
function optionLabel(hand, t, a) {
  const who = playerName(hand, a.player);
  if (a.action === 'raise' || (a.action === 'bet' && t.maxBet > 0)) return who + ' raises to ' + fmt(t.contrib[a.player] + a.amount);
  if (a.action === 'all-in') return who + ' is all-in (' + fmt(t.contrib[a.player] + a.amount) + ' total)';
  return describe(hand, a, t);
}

/* Run every street's betting. Pushes gaps into `out`; returns the trace the
   later rules (draws, board, showdown) read. */
export function checkActions(hand, env, out) {
  const n = env.n;
  const streets = hand.streets;
  const trace = {
    completed: true, stoppedAt: null, openAt: null, lastClosed: -1, bettingOver: false,
    handOverAt: null, foldedBefore: [], foldedAfter: [], closed: [], live: [], table: null,
  };
  const t = new Table(hand, env);
  trace.table = t;
  const low = isLowStud(hand.gameType);
  const key = (si, ai, sub) => [STAGE.actions, si, ai, sub || 0];
  const emit = (g, si, ai, sub) => { out.push(makeGap(g, key(si, ai, sub))); };
  const stop = (si, ai) => { trace.completed = false; trace.stoppedAt = { si, ai }; trace.live = t.live(); return trace; };
  const dismissed = env.dismissed;
  /* A silent seat: not the hero, no cards, and nothing in the hand refers to
     it. When the only thing missing is such a seat's fold, the fold follows
     from the hand (it never did anything, so it folded when the action reached
     it — the server's insertImplicitFolds draws the same line), and the gap
     is a non-blocking auto-fix that the checking carries on past. */
  const referenced = referencedSeats(hand);
  const silent = (q) => q !== hand.heroIdx && !hasCards(hand, q) && !referenced.has(q);
  const silentFolds = (fills) => fills.length > 0 && fills.every(f => f.action === 'fold' && silent(f.player));

  for (let si = 0; si < streets.length; si++) {
    const st = streets[si];
    const actions = st.actions || [];
    trace.foldedBefore[si] = new Set(t.folded);
    const sName = streetName(hand, si);

    // The hand was over before this street (everyone else folded).
    if (t.live().length <= 1) {
      if (actions.length) {
        const winner = t.live()[0];
        emit({
          id: 'ended:' + si + ':0', kind: 'impossible', field: 'streets.' + si + '.actions',
          question: 'Everyone but ' + playerName(hand, winner) + ' had folded before the ' + sName + ', but there is action on it. Drop the action from the ' + sName + ' on?',
          options: [{ label: 'Yes, drop it', value: { op: 'truncateActions', street: si, index: 0 } }],
          allowFree: true, blocking: true,
        }, si, 0);
        return stop(si, 0);
      }
      trace.foldedAfter[si] = new Set(t.folded);
      trace.closed[si] = true;
      continue;
    }

    // ── Seat order for the street ──
    let order;
    let biComputed = -1;
    if (env.isStud) {
      let start;
      if (si === 0) {
        biComputed = findStudBringIn(hand, low);
        const first = actions[0];
        if (first && first.action === 'bring-in' && isIdx(first.player, n)) start = first.player;
        else if (biComputed >= 0) start = biComputed;
        else if (first && isIdx(first.player, n)) start = first.player;
        else start = 0;
      } else {
        /* Who opens a later street is the best board showing — but the
           replayer scores boards as high hands even in razz, where an ace up
           is the best board, not the worst (findStudBestBoard). The
           description's own first actor is the better witness, so it opens;
           the board decides only when nobody acted yet. */
        const live = t.live().filter(pi => !t.allIn.has(pi));
        const first = actions.find(a => a && isIdx(a.player, n) && !t.folded.has(a.player));
        const known = live.every(pi => studUpCards(hand, pi, si).length >= Math.min(si, 3) + 1);
        if (first) start = first.player;
        else if (known) start = findStudBestBoard(hand, si, t.folded, low);
        else start = live[0];
        if (!(start >= 0)) start = t.live()[0];
      }
      order = [];
      for (let i = 0; i < n; i++) order.push((start + i) % n);
    } else {
      const strad = si === 0 ? lastStraddleSeat(straddles(hand.players, hand.blinds)) : -1;
      order = seatOrder(n, si === 0, strad);
    }
    t.startStreet(si, hand, order);

    for (let ai = 0; ai < actions.length; ai++) {
      const a = actions[ai];
      const field = 'streets.' + si + '.actions.' + ai;
      const nth = 'action ' + (ai + 1) + ' on the ' + sName;
      const expected = t.nextToAct();
      const exp = expected ? expected.p : -1;

      // ── Who acted ──
      if (!isIdx(a.player, n)) {
        const opts = [];
        if (exp >= 0) opts.push({ label: playerName(hand, exp), value: { op: 'replaceAction', street: si, index: ai, action: { ...a, player: exp } } });
        for (let pi = 0; pi < n; pi++) {
          if (pi === exp || t.folded.has(pi)) continue;
          opts.push({ label: playerName(hand, pi), value: { op: 'replaceAction', street: si, index: ai, action: { ...a, player: pi } } });
        }
        emit({
          id: 'action:' + si + ':' + ai, kind: 'missing', field: field + '.player',
          question: 'Who made ' + nth + ' (' + (a.action || 'an action') + (num(a.amount) > 0 ? ' ' + fmt(num(a.amount)) : '') + ')?',
          options: opts, allowFree: true, blocking: true,
        }, si, ai);
        return stop(si, ai);
      }
      const p = a.player;
      const who = playerName(hand, p);

      // ── What they did ──
      let kind = a.action;
      if (!KNOWN_ACTIONS.includes(kind)) {
        const guess = normalizeActionName(kind);
        const opts = [];
        if (guess) opts.push({ label: who + ' ' + guess + (guess === 'all-in' ? '' : 's'), value: { op: 'replaceAction', street: si, index: ai, action: { ...a, action: guess } } });
        for (const k of ['fold', 'check', 'call', 'bet', 'raise', 'all-in']) {
          if (k !== guess) opts.push({ label: who + ' ' + (k === 'all-in' ? 'goes all-in' : k + 's'), value: { op: 'replaceAction', street: si, index: ai, action: { ...a, action: k } } });
        }
        emit({
          id: 'action:' + si + ':' + ai, kind: guess ? 'ambiguous' : 'missing', field: field + '.action',
          question: 'What did ' + who + ' do on the ' + sName + '? (recorded as "' + (kind == null ? '' : kind) + '")',
          options: opts, allowFree: true, blocking: true, auto: !!guess,
        }, si, ai);
        return stop(si, ai);
      }

      // ── Is it their turn ──
      if (t.folded.has(p)) {
        const opts = [];
        if (exp >= 0) opts.push({ label: 'It was ' + playerName(hand, exp) + "'s action", value: { op: 'replaceAction', street: si, index: ai, action: { ...a, player: exp } } });
        opts.push({ label: 'Remove it', value: { op: 'removeAction', street: si, index: ai } });
        emit({
          id: 'action:' + si + ':' + ai, kind: 'impossible', field: field + '.player',
          question: who + ' had already folded, but ' + describe(hand, a, t).replace(who + ' ', '') + ' on the ' + sName + '. Whose action was it?',
          options: opts, allowFree: true, blocking: true,
        }, si, ai);
        return stop(si, ai);
      }
      if (t.allIn.has(p)) {
        const opts = [];
        if (exp >= 0) opts.push({ label: 'It was ' + playerName(hand, exp) + "'s action", value: { op: 'replaceAction', street: si, index: ai, action: { ...a, player: exp } } });
        opts.push({ label: 'Remove it', value: { op: 'removeAction', street: si, index: ai } });
        emit({
          id: 'action:' + si + ':' + ai, kind: 'impossible', field: field + '.player',
          question: who + ' was already all-in and cannot act again. Whose action was "' + describe(hand, a, t) + '"?',
          options: opts, allowFree: true, blocking: true,
        }, si, ai);
        return stop(si, ai);
      }
      // Stud: the round opens with a bring-in (or the bring-in seat completing).
      if (env.isStud && si === 0 && ai === 0 && kind !== 'bring-in') {
        const completesItself = (kind === 'bet' || kind === 'all-in') && (biComputed < 0 || biComputed === p);
        if (!completesItself) {
          const amount = env.bringIn;
          // A seat all-in from the ante cannot post it.
          const able = (pi) => !t.allIn.has(pi) && !t.folded.has(pi);
          const cands = biComputed >= 0 && able(biComputed) ? [biComputed] : [];
          for (let pi = 0; pi < n; pi++) if (!cands.includes(pi) && pi !== p && able(pi)) cands.push(pi);
          if (!cands.includes(p)) cands.push(p);
          emit({
            id: 'bringin', kind: 'missing', field: 'streets.0.actions',
            question: 'Who brought it in on 3rd street' + (amount ? ' (for ' + fmt(amount) + ')' : '') + '?',
            options: cands.map(pi => ({ label: playerName(hand, pi) + (pi === biComputed ? ' (lowest door card)' : ''), value: { op: 'insertActions', street: 0, index: 0, actions: [act(pi, 'bring-in', amount)] } })),
            allowFree: true, blocking: true,
          }, si, ai);
          return stop(si, ai);
        }
      }
      if (kind === 'bring-in') {
        if (!env.isStud || si !== 0 || ai !== 0) {
          const c = t.callAmount(p);
          const opts = [];
          if (c > 0) opts.push({ label: who + ' calls ' + fmt(Math.min(c, t.remaining(p))), value: { op: 'replaceAction', street: si, index: ai, action: act(p, 'call', Math.min(c, t.remaining(p))) } });
          opts.push({ label: 'Remove it', value: { op: 'removeAction', street: si, index: ai } });
          emit({
            id: 'action:' + si + ':' + ai, kind: 'impossible', field: field + '.action',
            question: 'Only the first action on 3rd street in stud can be a bring-in. What did ' + who + ' do?',
            options: opts, allowFree: true, blocking: true,
          }, si, ai);
          return stop(si, ai);
        }
        // Every door card known and a different seat holds the lowest (in
        // razz the highest): the bring-in is that seat's.
        const doorsKnown = hand.players.every((_, pi) => { const d = doorCard(hand, pi); return d && d.suit !== 'x'; });
        if (biComputed >= 0 && biComputed !== p && doorsKnown && !dismissed.has('bringin-door')) {
          emit({
            id: 'bringin-door', kind: 'ambiguous', field: 'streets.0.actions.0.player',
            question: 'By the door cards ' + playerName(hand, biComputed) + ' brings it in (' + (low ? 'highest' : 'lowest') + ' card up), but the hand has ' + who + ' bringing it in. Which was it?',
            options: [
              { label: playerName(hand, biComputed) + ' brought it in', value: { op: 'replaceAction', street: 0, index: 0, action: { ...a, player: biComputed } } },
              dismissOption('Keep it as described'),
            ],
            allowFree: true, blocking: false,
          }, si, ai);
        }
      }

      if (!expected) {
        // The round was already closed.
        const opts = [];
        const nextSt = streets[si + 1];
        if (nextSt && t.live().length >= 2 && t.canAct().length >= 2) {
          opts.push({ label: 'It happened on the ' + streetName(hand, si + 1), value: { op: 'moveActionsToNextStreet', street: si, index: ai } });
        }
        opts.push({ label: 'Remove it', value: { op: 'removeAction', street: si, index: ai } });
        const why = t.canAct().length <= 1
          ? 'Everyone else still in was all-in, so the betting was over'
          : 'The ' + sName + ' betting was already over';
        emit({
          id: 'action:' + si + ':' + ai, kind: 'impossible', field: field,
          question: why + ' when ' + describe(hand, a, t) + '. Where does it belong?',
          options: opts, allowFree: true, blocking: true,
        }, si, ai);
        return stop(si, ai);
      }

      let skippedSilently = false;
      if (p !== exp && t.needsToAct(p)) {
        // Seats between the expected actor and p said nothing: the usual
        // reason is that the description skipped the folds (and checks).
        const sim = t.clone();
        const fills = [];
        for (const q of t.owingBefore(p)) {
          if (!sim.needsToAct(q)) continue;
          const c = sim.callAmount(q);
          let f;
          if (c > 0) f = actsLater(hand, q, si, ai - 1) ? act(q, 'call', Math.min(c, sim.remaining(q))) : act(q, 'fold', 0);
          else f = act(q, 'check', 0);
          sim.apply(q, f.action, f.amount);
          fills.push(f);
        }
        const said = fills.map(f => playerName(hand, f.player) + ' ' + (f.action === 'fold' ? 'folded' : f.action === 'check' ? 'checked' : 'called'));
        const allFold = fills.every(f => f.action === 'fold');
        const quiet = silentFolds(fills);
        const question = allFold
          ? 'Nothing is recorded for ' + listWords(fills.map(f => playerName(hand, f.player))) + ' before ' + describe(hand, a, t) + ' on the ' + sName + '. Did ' + (fills.length > 1 ? 'they' : playerName(hand, fills[0].player)) + ' fold?'
          : 'Before ' + describe(hand, a, t) + ' on the ' + sName + ': ' + listWords(said) + '?';
        emit({
          id: 'action:' + si + ':' + ai, kind: 'ambiguous', field: 'streets.' + si + '.actions',
          question,
          options: [
            { label: allFold ? (fills.length > 1 ? 'Yes, they folded' : 'Yes, ' + playerName(hand, fills[0].player) + ' folded') : 'Yes — ' + listWords(said), value: { op: 'insertActions', street: si, index: ai, actions: fills } },
            { label: 'It was ' + playerName(hand, exp) + "'s action, not " + who + "'s", value: { op: 'replaceAction', street: si, index: ai, action: { ...a, player: exp } } },
          ],
          allowFree: true, blocking: !quiet, auto: quiet,
        }, si, ai);
        if (!quiet) return stop(si, ai);
        for (const f of fills) t.apply(f.player, f.action, f.amount);
        skippedSilently = true;
      }
      const expNow = skippedSilently ? t.nextToAct() : expected;
      const exp2 = expNow ? expNow.p : -1;
      if (p !== exp2) {
        const opts = [];
        if (exp2 >= 0) opts.push({ label: 'It was ' + playerName(hand, exp2) + "'s action", value: { op: 'replaceAction', street: si, index: ai, action: { ...a, player: exp2 } } });
        opts.push({ label: 'Remove it', value: { op: 'removeAction', street: si, index: ai } });
        emit({
          id: 'action:' + si + ':' + ai, kind: 'impossible', field: field + '.player',
          question: who + ' had already acted and nobody bet since, so "' + describe(hand, a, t) + '" on the ' + sName + ' is out of turn. Whose action was it?',
          options: opts, allowFree: true, blocking: true,
        }, si, ai, 1);
        return stop(si, ai);
      }

      // ── Amounts ──
      const res = checkAmount(hand, env, t, si, ai, a, kind);
      if (res.gap) {
        emit(res.gap, si, ai, res.sub || 0);
        if (res.gap.blocking) return stop(si, ai);
      }
      t.apply(p, res.kind || kind, res.amount != null ? res.amount : (num(a.amount) || 0));
    }

    // ── End of the street ──
    trace.foldedAfter[si] = new Set(t.folded);
    if (t.live().length <= 1) { trace.handOverAt = si; trace.closed[si] = true; continue; }
    let owe = t.nextToAct();
    if (owe) {
      // Only silent seats owe action and they would fold: fill it in, carry on.
      const sim0 = t.clone();
      const quietFills = [];
      let g0 = 0, nx0;
      while ((nx0 = sim0.nextToAct()) && g0++ < 4 * n) {
        const q = nx0.p;
        const f = sim0.callAmount(q) > 0 && !actsLater(hand, q, si + 1, -1) ? act(q, 'fold', 0) : act(q, sim0.callAmount(q) > 0 ? 'call' : 'check', Math.min(sim0.callAmount(q), sim0.remaining(q)) || 0);
        sim0.apply(q, f.action, f.amount);
        quietFills.push(f);
      }
      if (silentFolds(quietFills)) {
        emit({
          id: 'street-open:' + si, kind: 'ambiguous', field: 'streets.' + si + '.actions',
          question: 'Nothing is recorded for ' + listWords(quietFills.map(f => playerName(hand, f.player))) + ' on the ' + sName + '. Did ' + (quietFills.length > 1 ? 'they' : playerName(hand, quietFills[0].player)) + ' fold?',
          options: [{ label: 'Yes', value: { op: 'appendActions', street: si, actions: quietFills } }],
          allowFree: true, blocking: false, auto: true,
        }, si, actions.length);
        for (const f of quietFills) t.apply(f.player, f.action, f.amount);
        trace.foldedAfter[si] = new Set(t.folded);
        if (t.live().length <= 1) { trace.handOverAt = si; trace.closed[si] = true; continue; }
        owe = t.nextToAct();
      }
    }
    if (owe) {
      if (laterContent(hand, si, env)) {
        const sim = t.clone();
        const fills = [];
        let guard = 0;
        let nx;
        while ((nx = sim.nextToAct()) && guard++ < 4 * n) {
          const q = nx.p;
          const c = sim.callAmount(q);
          let f;
          if (c > 0) f = actsLater(hand, q, si + 1, -1) || (streets[si].draws || []).some(d => d && d.player === q) ? act(q, 'call', Math.min(c, sim.remaining(q))) : act(q, 'fold', 0);
          else f = act(q, 'check', 0);
          sim.apply(q, f.action, f.amount);
          fills.push(f);
        }
        const said = fills.map(f => playerName(hand, f.player) + ' ' + (f.action === 'fold' ? 'folded' : f.action === 'check' ? 'checked' : 'called ' + fmt(f.amount)));
        const opts = [{ label: 'Yes — ' + listWords(said), value: { op: 'appendActions', street: si, actions: fills } }];
        // The plain alternatives, in case the guess is wrong.
        const allCall = []; const sim2 = t.clone(); guard = 0;
        while ((nx = sim2.nextToAct()) && guard++ < 4 * n) {
          const q = nx.p; const c = sim2.callAmount(q);
          const f = c > 0 ? act(q, 'call', Math.min(c, sim2.remaining(q))) : act(q, 'check', 0);
          sim2.apply(q, f.action, f.amount); allCall.push(f);
        }
        opts.push({ label: 'They all called', value: { op: 'appendActions', street: si, actions: allCall } });
        const question = actions.length
          ? 'The ' + sName + ' betting never finishes before the hand goes on. Did ' + listWords(said) + '?'
          : 'Nothing is recorded on the ' + sName + '. Did ' + listWords(said) + '?';
        emit({
          id: 'street-open:' + si, kind: 'ambiguous', field: 'streets.' + si + '.actions',
          question, options: opts, allowFree: true, blocking: true,
        }, si, actions.length);
        return stop(si, actions.length);
      }
      // The description ends here, mid-round: ask what happened next.
      trace.openAt = si;
      trace.live = t.live();
      const id = 'next:' + si + ':' + actions.length;
      // Asked after the street's cards and the draw before it: "what did X do
      // on the flop" comes once the flop is known.
      if (!dismissed.has(id)) out.push(makeGap(nextActionGap(hand, env, t, si, owe.p, id, actions.length === 0), [STAGE.board, si, 999]));
      return trace;
    }
    trace.closed[si] = true;
    trace.lastClosed = si;
    if (t.canAct().length <= 1) trace.bettingOver = true;
  }
  trace.live = t.live();
  return trace;
}

/* "What did X do next?" with the legal choices as options. */
function nextActionGap(hand, env, t, si, p, id, streetEmpty) {
  const who = playerName(hand, p);
  const sz = t.sizing(p, hand);
  const rem = t.remaining(p);
  const c = sz.call;
  const opts = [];
  const add = (a) => opts.push({ label: optionLabel(hand, t, a), value: { op: 'appendActions', street: si, actions: [a] } });
  if (c > 0) {
    add(act(p, 'fold', 0));
    add(act(p, 'call', Math.min(c, rem)));
    if (rem > c && !sz.capped) {
      if (env.betting === 'fl') add(act(p, 'raise', Math.min(sz.flTarget - t.contrib[p], rem)));
      else {
        add(act(p, 'raise', Math.min(sz.minTotal - t.contrib[p], rem)));
        if (env.betting === 'pl') add(act(p, 'raise', Math.min(sz.plMaxTotal - t.contrib[p], rem)));
      }
    }
  } else {
    add(act(p, 'check', 0));
    if (env.betting === 'fl') add(act(p, t.maxBet > 0 ? 'raise' : 'bet', Math.min(sz.flTarget - t.contrib[p], rem)));
    else if (t.maxBet > 0) add(act(p, 'raise', Math.min(sz.minTotal - t.contrib[p], rem)));
    else {
      const half = Math.max(env.bb || 0, Math.round(sz.potBefore / 2));
      add(act(p, 'bet', Math.min(half, rem)));
      add(act(p, 'bet', Math.min(env.betting === 'pl' ? sz.plMaxTotal : sz.potBefore, rem)));
    }
  }
  if (env.betting !== 'fl' && Number.isFinite(rem) && rem > c && !(env.betting === 'pl' && t.contrib[p] + rem > sz.plMaxTotal)) {
    add(act(p, 'all-in', rem));
  }
  if (streetEmpty && t.live().length >= 2) {
    const down = checkDownPlan(hand, env, t, si);
    if (down) opts.push({ label: 'It was checked down to the end', value: down });
  }
  opts.push(dismissOption("That's where the hand ends"));
  return {
    id, kind: 'missing', field: 'streets.' + si + '.actions',
    question: streetEmpty
      ? 'The hand stops before the ' + streetName(hand, si) + ' with ' + listWords(t.live().map(i => playerName(hand, i))) + ' still in. What did ' + who + ' do first?'
      : 'What did ' + who + ' do next on the ' + streetName(hand, si) + '?',
    options: opts, allowFree: true, blocking: false,
  };
}

/* Checks from every live seat on this and every later street. */
function checkDownPlan(hand, env, t, si) {
  const ops = [];
  const live = t.live().filter(i => !t.allIn.has(i));
  if (live.length < 2) return null;
  for (let sj = si; sj < hand.streets.length; sj++) {
    let order;
    if (env.isStud) order = live.slice();
    else order = seatOrder(env.n, sj === 0, -1).filter(i => live.includes(i));
    if (sj === 0) return null; // preflop can't be checked down from nothing
    ops.push({ op: 'appendActions', street: sj, actions: order.map(i => act(i, 'check', 0)) });
  }
  return ops.length ? { op: 'batch', ops } : null;
}

/* The amount checks for one action. Returns { gap?, kind?, amount? }: the gap
   to raise (if any) and, when the action can still be read, how to apply it. */
function checkAmount(hand, env, t, si, ai, a, kind) {
  const p = a.player;
  const who = playerName(hand, p);
  const sName = streetName(hand, si);
  const field = 'streets.' + si + '.actions.' + ai;
  const A = num(a.amount);
  const rem = t.remaining(p);
  const c = t.callAmount(p);
  const sz = t.sizing(p, hand);
  const bb = env.bb || 0;
  const contrib = t.contrib[p];
  const id = 'action:' + si + ':' + ai;
  const replace = (changes) => ({ op: 'replaceAction', street: si, index: ai, action: { ...a, ...changes } });
  const finiteRem = Number.isFinite(rem);
  const fl = env.betting === 'fl';
  const pl = env.betting === 'pl';

  // Is x chips added a legal bet/raise right now?
  const legalWager = (x) => {
    if (!(x > 0) || x > rem) return false;
    const total = contrib + x;
    if (total <= t.maxBet) return false;
    const allIn = finiteRem && x === rem;
    if (fl) return allIn ? total <= sz.flTarget : (total === sz.flTarget || total === sz.flTargetAlt);
    if (pl && total > sz.plMaxTotal) return false;
    return allIn || total >= sz.minTotal;
  };
  const wagerKind = () => (t.maxBet > 0 ? 'raise' : 'bet');
  const wagerLabel = (x) => (t.maxBet > 0 ? who + ' raises to ' + fmt(contrib + x) : who + ' bets ' + fmt(x));
  /* Other readings of a wager amount that does not work as given: the number
     was the raise-TO total, or it was in big blinds. Then the standard sizes. */
  const wagerOptions = (given, standard) => {
    const cands = [];
    if (Number.isFinite(given) && given > 0) {
      if (contrib > 0) cands.push(given - contrib);
      if (bb > 1 && given * bb <= (finiteRem ? rem : Infinity)) {
        cands.push(given * bb);
        if (contrib > 0) cands.push(given * bb - contrib);
      }
    }
    for (const s of standard) cands.push(s);
    const seen = new Set();
    const opts = [];
    for (const x of cands) {
      if (!legalWager(x) || seen.has(x) || x === given) continue;
      seen.add(x);
      const isAllIn = finiteRem && x === rem;
      opts.push({ label: isAllIn ? who + ' is all-in (' + fmt(contrib + x) + ' total)' : wagerLabel(x), value: replace({ action: isAllIn && kind === 'all-in' ? 'all-in' : wagerKind(), amount: x }) });
    }
    return opts;
  };
  const standardSizes = () => {
    const s = [];
    if (fl) s.push(sz.flTarget - contrib);
    else if (pl) { s.push(sz.plMaxTotal - contrib); s.push(sz.minTotal - contrib); }
    else {
      s.push(sz.minTotal - contrib);
      if (t.maxBet > 0) s.push(t.maxBet * 3 - contrib);
      else { s.push(Math.round(sz.potBefore / 2)); s.push(Math.round(sz.potBefore * 2 / 3)); s.push(sz.potBefore); }
    }
    if (finiteRem) s.push(rem);
    return s.filter(x => x > 0).map(x => (finiteRem ? Math.min(x, rem) : x));
  };
  const exceed = (x) => ({
    gap: {
      id, kind: 'impossible', field: field + '.amount',
      question: who + ' put in ' + fmt(x) + ' on the ' + sName + ' but had only ' + fmt(rem) + ' left. Which is right?',
      options: [
        { label: who + ' was all-in for ' + fmt(rem), value: replace({ amount: rem }) },
        { label: who + ' started with ' + fmt(hand.players[p].startingStack + (x - rem)), value: { op: 'set', path: 'players.' + p + '.startingStack', value: hand.players[p].startingStack + (x - rem) } },
      ],
      allowFree: true, blocking: true,
    },
  });

  switch (kind) {
    case 'fold':
      return { kind: 'fold', amount: 0 };

    case 'check': {
      if (c > 0) {
        const callOpt = { label: who + ' calls ' + fmt(Math.min(c, rem)), value: replace({ action: 'call', amount: Math.min(c, rem) }) };
        const foldOpt = { label: who + ' folds', value: replace({ action: 'fold', amount: 0 }) };
        return {
          gap: {
            id, kind: 'impossible', field: field + '.action',
            question: who + ' checked on the ' + sName + ', but was facing a bet of ' + fmt(c) + '. Did ' + who + ' call or fold?',
            options: actsLater(hand, p, si, ai) ? [callOpt, foldOpt] : [foldOpt, callOpt],
            allowFree: true, blocking: true,
          },
        };
      }
      if (A > 0) {
        return {
          gap: {
            id, kind: 'impossible', field: field + '.amount',
            question: who + ' checked on the ' + sName + ' but is recorded putting in ' + fmt(A) + '. Which was it?',
            options: [
              { label: who + ' checks', value: replace({ amount: 0 }) },
              ...wagerOptions(NaN, [A]),
            ],
            allowFree: true, blocking: true,
          },
        };
      }
      return { kind: 'check', amount: 0 };
    }

    case 'call': {
      if (c <= 0) {
        const opts = [{ label: who + ' checks', value: replace({ action: 'check', amount: 0 }) }];
        if (A > 0) opts.push(...wagerOptions(A, [A]));
        return {
          gap: {
            id, kind: 'impossible', field: field + '.action',
            question: who + ' called on the ' + sName + ', but there was no bet to call. What did ' + who + ' do?',
            options: opts, allowFree: true, blocking: true,
          },
        };
      }
      const want = Math.min(c, rem);
      if (!(A > 0)) {
        return {
          gap: {
            id, kind: 'missing', field: field + '.amount',
            question: 'How much did ' + who + ' call on the ' + sName + '?',
            options: [{ label: who + ' calls ' + fmt(want), value: replace({ amount: want }) }],
            allowFree: true, blocking: true, auto: true,
          },
        };
      }
      if (finiteRem && A > rem) return exceed(A);
      if (A !== want) {
        const opts = [{ label: who + ' calls ' + fmt(want) + (want < c ? ' (all-in)' : ''), value: replace({ amount: want }) }];
        if (legalWager(A)) opts.push({ label: who + ' raises to ' + fmt(contrib + A), value: replace({ action: 'raise', amount: A }) });
        if (legalWager(A - contrib) && contrib > 0) opts.push({ label: who + ' raises to ' + fmt(A), value: replace({ action: 'raise', amount: A - contrib }) });
        return {
          gap: {
            id, kind: 'impossible', field: field + '.amount',
            question: who + ' called ' + fmt(A) + ' on the ' + sName + ', but the price was ' + fmt(want) + (contrib > 0 ? ' (' + fmt(contrib) + ' was already in)' : '') + '. Which is right?',
            options: opts, allowFree: true, blocking: true,
          },
        };
      }
      return { kind: 'call', amount: A };
    }

    case 'bring-in': {
      // The bring-in is under the small bet; a configured one that is not is
      // itself wrong, so fall back to the replayer's default (a quarter).
      const want = env.bringIn > 0 && env.bringIn < bb ? env.bringIn
        : (bb >= 4 ? Math.floor(bb / 4) : Math.round(bb / 4 * 100) / 100);
      if (!(A > 0)) {
        return {
          gap: {
            id, kind: 'missing', field: field + '.amount',
            question: 'How much was the bring-in?',
            options: [{ label: fmt(want), value: replace({ amount: want }) }],
            allowFree: true, blocking: true, auto: true,
          },
        };
      }
      if (finiteRem && A > rem) return exceed(A);
      if (bb > 0 && A >= bb) {
        return {
          gap: {
            id, kind: 'impossible', field: field + '.amount',
            question: 'A bring-in of ' + fmt(A) + ' is a full bet (the small bet is ' + fmt(bb) + '). Did ' + who + ' bring it in or complete?',
            options: [
              { label: who + ' brings it in for ' + fmt(want), value: replace({ amount: want }) },
              { label: who + ' completes to ' + fmt(bb), value: replace({ action: 'bet', amount: bb }) },
            ],
            allowFree: true, blocking: true,
          },
        };
      }
      return { kind: 'bring-in', amount: A };
    }

    case 'bet':
    case 'raise':
    case 'all-in': {
      // Amount missing.
      if (!(A > 0)) {
        if (kind === 'all-in') {
          const saidTo = num(a.toAmount) > 0 ? num(a.toAmount) : (num(a.toAmountBB) > 0 && bb > 0 ? roundChips(num(a.toAmountBB) * bb, hand.blinds) : NaN);
          if (finiteRem && saidTo - contrib > rem) return exceed(saidTo - contrib);
          if (finiteRem && rem > 0) {
            return {
              gap: {
                id, kind: 'missing', field: field + '.amount',
                question: 'How much did ' + who + ' move in on the ' + sName + '?',
                options: [{ label: who + ' is all-in for ' + fmt(rem) + ' more (' + fmt(contrib + rem) + ' total)', value: replace({ amount: rem }) }],
                allowFree: true, blocking: true, auto: true,
              },
            };
          }
          return {
            gap: {
              id, kind: 'missing', field: field + '.amount',
              question: 'How much did ' + who + ' move all-in for on the ' + sName + '?',
              allowFree: true, blocking: true,
            },
          };
        }
        // A size the server could not finish ("to 3 BB", "half pot") is
        // worked out here once what it waited on is known.
        const pendingTo = num(a.toAmount) > 0 ? num(a.toAmount)
          : (num(a.toAmountBB) > 0 && bb > 0 ? roundChips(num(a.toAmountBB) * bb, hand.blinds)
            : (num(a.potFraction) > 0 ? (t.maxBet === 0 || kind === 'bet'
              ? contrib + roundChips(num(a.potFraction) * t.pot, hand.blinds)
              : roundChips(t.maxBet + num(a.potFraction) * (t.pot + c), hand.blinds)) : NaN));
        const pendingX = pendingTo - contrib;
        const opts = wagerOptions(NaN, (pendingX > 0 ? [pendingX] : []).concat(standardSizes()));
        const fromPending = pendingX > 0 && opts.length > 0 && opts[0].value.action.amount === pendingX;
        return {
          gap: {
            id, kind: 'missing', field: field + '.amount',
            question: kind === 'raise' || t.maxBet > 0
              ? 'How much did ' + who + ' raise to on the ' + sName + '?'
              : 'How much did ' + who + ' bet on the ' + sName + '?',
            options: opts, allowFree: true, blocking: true, auto: (fl && opts.length > 0) || fromPending,
          },
        };
      }
      if (finiteRem && A > rem) return exceed(A);
      const total = contrib + A;
      const allIn = (finiteRem && A === rem) || kind === 'all-in';

      // All-in with an amount that is not the stack.
      if (kind === 'all-in' && finiteRem && A !== rem) {
        const opts = [{ label: who + ' is all-in for ' + fmt(rem) + ' more (' + fmt(contrib + rem) + ' total)', value: replace({ amount: rem }) }];
        if (total > t.maxBet && legalWager(A)) opts.push({ label: wagerLabel(A) + ' (not all-in)', value: replace({ action: wagerKind(), amount: A }) });
        else if (total <= t.maxBet && A === Math.min(c, rem)) opts.push({ label: who + ' calls ' + fmt(A), value: replace({ action: 'call', amount: A }) });
        return {
          gap: {
            id, kind: 'impossible', field: field + '.amount',
            question: who + ' went all-in on the ' + sName + ' for ' + fmt(A) + ', but had ' + fmt(rem) + ' behind. Which is right?',
            options: opts, allowFree: true, blocking: true,
          },
        };
      }

      // Not more than the current bet: it is a call (or less).
      if (total <= t.maxBet) {
        if (allIn) {
          // All-in for no more than the price: a call.
          if (kind !== 'all-in') {
            return {
              kind: 'call', amount: A,
              gap: {
                id: 'action-label:' + si + ':' + ai, kind: 'ambiguous', field: field + '.action',
                question: who + "'s all-in for " + fmt(A) + ' only calls. Record it as a call?',
                options: [{ label: who + ' calls ' + fmt(A) + ' (all-in)', value: replace({ action: 'call' }) }],
                blocking: false, auto: true,
              },
            };
          }
          return { kind: 'call', amount: A };
        }
        const opts = [];
        if (c > 0 && A === c) opts.push({ label: who + ' calls ' + fmt(A), value: replace({ action: 'call' }) });
        opts.push(...wagerOptions(A, standardSizes()));
        if (c > 0 && A !== c) opts.push({ label: who + ' calls ' + fmt(Math.min(c, rem)), value: replace({ action: 'call', amount: Math.min(c, rem) }) });
        return {
          gap: {
            id, kind: 'impossible', field: field + '.amount',
            question: (kind === 'bet' ? who + ' bet ' : who + ' raised by ') + fmt(A) + ' on the ' + sName + ', which does not raise the ' + fmt(t.maxBet) + ' already bet. What did ' + who + ' do?',
            options: opts, allowFree: true, blocking: true,
          },
        };
      }

      // Pot limit: no more than the pot, all-in or not.
      if (pl && total > sz.plMaxTotal) {
        const opts = wagerOptions(A, [sz.plMaxTotal - contrib]);
        return {
          gap: {
            id, kind: 'impossible', field: field + '.amount',
            question: (t.maxBet > 0 ? who + ' raised to ' + fmt(total) : who + ' bet ' + fmt(total)) + ' on the ' + sName + ', but the pot-limit maximum was ' + fmt(sz.plMaxTotal) + '. What was the size?',
            options: opts, allowFree: true, blocking: true,
          },
        };
      }
      // Fixed limit: exactly the bet size (or all-in for less).
      if (fl) {
        const ok = allIn ? total <= sz.flTarget : (total === sz.flTarget || total === sz.flTargetAlt);
        if (!ok) {
          const want = sz.flTarget - contrib;
          const opts = wagerOptions(A, [want]);
          return {
            gap: {
              id, kind: 'impossible', field: field + '.amount',
              question: 'In a limit game the ' + sName + ' ' + (t.maxBet > 0 ? 'raise goes to ' + fmt(sz.flTarget) : 'bet is ' + fmt(sz.fixed)) + ', but ' + who + ' put in ' + fmt(A) + '. Use the limit size?',
              options: opts, allowFree: true, blocking: true, auto: opts.length > 0 && opts[0].value.action.amount === want,
            },
          };
        }
        if (sz.capped && t.maxBet > 0 && !sz.completing) {
          return {
            kind: 'raise', amount: A,
            gap: {
              id: 'raise-cap:' + si + ':' + ai, kind: 'ambiguous', field: 'blinds.betCap',
              question: 'That is more raises on the ' + sName + ' than the cap of ' + sz.cap + ' bets allows. Was the cap higher?',
              options: [
                { label: 'The cap was ' + (t.raiseCount + 1) + ' bets', value: { op: 'set', path: 'blinds.betCap', value: t.raiseCount + 1 } },
                { label: who + ' just called', value: replace({ action: 'call', amount: Math.min(c, rem) }) },
              ],
              allowFree: true, blocking: false,
            },
          };
        }
      } else if (!allIn && total < sz.minTotal) {
        const opts = wagerOptions(A, standardSizes());
        return {
          gap: {
            id, kind: 'impossible', field: field + '.amount',
            question: t.maxBet > 0
              ? who + ' raised to ' + fmt(total) + ' on the ' + sName + ', but the minimum raise was to ' + fmt(sz.minTotal) + '. What was the size?'
              : who + ' bet ' + fmt(total) + ' on the ' + sName + ', less than the ' + fmt(sz.minTotal) + ' minimum. What was the size?',
            options: opts, allowFree: true, blocking: true,
          },
        };
      }

      // The word for it: a bet into a bet is a raise and a raise into nothing
      // is a bet. The chips are the same, so this never blocks.
      const right = kind === 'all-in' ? 'all-in' : (t.maxBet > 0 && !(sz.completing && kind === 'bet') ? 'raise' : (t.maxBet === 0 ? 'bet' : kind));
      if (right !== kind && kind !== 'all-in') {
        return {
          kind: right, amount: A,
          gap: {
            id: 'action-label:' + si + ':' + ai, kind: 'ambiguous', field: field + '.action',
            question: right === 'raise'
              ? who + "'s bet on the " + sName + ' came after a bet, so it is a raise to ' + fmt(total) + '. Record it as a raise?'
              : who + "'s raise on the " + sName + ' was the first bet. Record it as a bet of ' + fmt(A) + '?',
            options: [{ label: 'Yes', value: replace({ action: right }) }],
            blocking: false, auto: true,
          },
        };
      }
      return { kind, amount: A };
    }
    default:
      return { kind, amount: A };
  }
}

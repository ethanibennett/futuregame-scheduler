// ── Quick-add: draws, showdown and result ─────────────────────────────────

import { evaluateShowdown } from '../poker-engine.js';
import { cardsOf, notationProblem, isMuck, backs, oppSlot, computeDrawHand, getPlayerDrawsByStreet, drawDeadCards, knownKeys } from './cards.js';
import { seatOrder } from './betting.js';
import { STAGE, makeGap, playerName, streetName, listWords, num, dismissOption } from './common.js';

const isIdx = (v, n) => Number.isInteger(v) && v >= 0 && v < n;

function drawWord(hand, si) {
  const nm = streetName(hand, si + 1);
  return 'the ' + (nm ? nm.toLowerCase() : 'draw');
}

/* Draw rules. Convention (the replayer's, and the trap that bit before): the
   draw that happens AFTER betting round si is recorded on street si — the first
   draw on street 0, none on the last street. */
export function drawRules(hand, env, out, ctx) {
  const streets = hand.streets;
  const n = hand.players.length;
  const heroIdx = hand.heroIdx;
  const anyDraws = streets.some(st => (st.draws || []).length);
  if (!env.isDraw) {
    if (anyDraws) {
      out.push(makeGap({
        id: 'draws', kind: 'impossible', field: 'streets',
        question: hand.gameType + ' has no draws, but draws are recorded. Drop them?',
        options: [{ label: 'Drop them', value: { op: 'batch', ops: streets.map((_, si) => ({ op: 'removeDrawsOnStreet', street: si })) } }],
        blocking: false, auto: true,
      }, [STAGE.draws, -1]));
    }
    return;
  }
  const last = env.numStreets - 1;
  const lastDraws = (streets[last] && streets[last].draws) || [];
  if (lastDraws.length) {
    const opts = [];
    const firstEmpty = !(streets[0].draws || []).length;
    if (firstEmpty) opts.push({ label: 'Move every draw one round earlier', value: { op: 'shiftDraws', by: -1 } });
    opts.push({ label: 'Drop the draws on the ' + streetName(hand, last), value: { op: 'removeDrawsOnStreet', street: last } });
    out.push(makeGap({
      id: 'draws-shifted', kind: 'impossible', field: 'streets.' + last + '.draws',
      question: 'Draws are recorded on the ' + streetName(hand, last) + ', but nothing is drawn after the last betting round. ' + (firstEmpty ? 'A draw belongs on the betting round before it — move them all back one?' : 'Drop them?'),
      options: opts, allowFree: true, blocking: true, auto: firstEmpty,
    }, [STAGE.draws, -1]));
    return;
  }
  if (!ctx.trace) return; // the betting has to read first
  const liveAfter = (si) => {
    const f = ctx.foldedAfter(si);
    const out2 = [];
    for (let i = 0; i < n; i++) if (!f.has(i)) out2.push(i);
    return out2;
  };
  const needed = (si) => si < last && ctx.closed(si) && liveAfter(si).length >= 2 && ctx.reached(si + 1);

  // Every draw a street late: nothing on street 0, the first round's draws on 1.
  if (needed(0) && !(streets[0].draws || []).length && (streets[1].draws || []).length && !ctx.dismissed.has('draws-late')) {
    out.push(makeGap({
      id: 'draws-late', kind: 'ambiguous', field: 'streets.1.draws',
      question: 'Nothing is drawn after the first betting round, but draws are recorded after the second. A draw is recorded on the round BEFORE it — move every draw one round earlier?',
      options: [
        { label: 'Yes, move them', value: { op: 'shiftDraws', by: -1 } },
        dismissOption('No, they are on the right rounds'),
      ],
      allowFree: false, blocking: false,
    }, [STAGE.draws, -1]));
    return;
  }

  for (let si = 0; si < last; si++) {
    const entries = streets[si].draws || [];
    if (!entries.length && !needed(si)) continue;
    const live = liveAfter(si);
    const field = 'streets.' + si + '.draws';
    const dw = drawWord(hand, si);
    const seen = new Set();
    entries.forEach((d, k) => {
      const key = [STAGE.draws, si, 0, k];
      if (!isIdx(d.player, n) || !live.includes(d.player) || seen.has(d.player)) {
        const why = !isIdx(d.player, n) ? 'a player who isn’t at the table'
          : seen.has(d.player) ? playerName(hand, d.player) + ' twice'
            : playerName(hand, d.player) + ', who was no longer in the hand';
        out.push(makeGap({
          id: 'draw-x:' + si + ':' + k, kind: 'impossible', field: field + '.' + k,
          question: 'A draw on ' + dw + ' is recorded for ' + why + '. Drop it?',
          options: [{ label: 'Drop it', value: { op: 'removeDraw', street: si, index: k } }],
          allowFree: true, blocking: !isIdx(d.player, n), auto: isIdx(d.player, n),
        }, key));
        return;
      }
      seen.add(d.player);
    });
    if (!needed(si)) continue;
    const order = seatOrder(n, false, -1).filter(p => live.includes(p));
    const maxD = env.cfg.heroCards;
    for (const p of order) {
      const k = entries.findIndex(d => d.player === p);
      const isHero = p === heroIdx;
      const name = playerName(hand, p);
      const key = [STAGE.draws, si, 1, order.indexOf(p)];
      const counts = (label, extra) => {
        const opts = [];
        for (let c = 0; c <= maxD; c++) opts.push({ label: c === 0 ? 'Stood pat' : 'Drew ' + c, value: { op: 'setDraw', street: si, player: p, draw: { discarded: c, ...(extra || {}) } } });
        return opts;
      };
      if (k < 0) {
        const id = 'draw:' + si + ':' + p;
        if (!isHero && ctx.dismissed.has(id)) continue;
        const opts = counts();
        if (!isHero) opts.push(dismissOption('I don’t know'));
        out.push(makeGap({
          id, kind: 'missing', field,
          question: isHero ? 'How many cards did you draw on ' + dw + '?' : 'How many cards did ' + name + ' draw on ' + dw + '?',
          options: opts, allowFree: true, blocking: isHero,
        }, key));
        continue;
      }
      const d = entries[k];
      const dpath = field + '.' + k;
      const D = num(d.discarded);
      if (notationProblem(d.discardedCards) || notationProblem(d.newCards)) continue; // cardRules asks
      const dc = cardsOf(d.discardedCards);
      const nc = cardsOf(d.newCards);
      const id = 'draw:' + si + ':' + p;
      if (!(Number.isInteger(D) && D >= 0 && D <= maxD)) {
        const guess = dc.length || nc.length;
        const opts = counts();
        if (guess > 0 && guess <= maxD) opts.unshift(opts.splice(guess, 1)[0]);
        out.push(makeGap({
          id, kind: d.discarded == null ? 'missing' : 'impossible', field: dpath + '.discarded',
          question: isHero ? 'How many cards did you draw on ' + dw + '?' : 'How many cards did ' + name + ' draw on ' + dw + '?',
          options: opts, allowFree: true, blocking: isHero,
        }, key));
        continue;
      }
      if (dc.length && dc.length !== D) {
        out.push(makeGap({
          id, kind: 'impossible', field: dpath,
          question: (isHero ? 'You' : name) + ' drew ' + D + ' on ' + dw + ' but ' + dc.length + ' discards are listed (' + d.discardedCards + '). Which is right?',
          options: [
            { label: 'Drew ' + dc.length, value: { op: 'setDraw', street: si, player: p, draw: { discarded: dc.length } } },
            { label: 'Drew ' + D + ' (drop the list)', value: { op: 'setDraw', street: si, player: p, draw: { discardedCards: '' } } },
          ],
          allowFree: true, blocking: isHero,
        }, key));
        continue;
      }
      if (nc.length > D) {
        const opts = [];
        if (!dc.length || dc.length === nc.length) opts.push({ label: 'Drew ' + nc.length, value: { op: 'setDraw', street: si, player: p, draw: { discarded: nc.length } } });
        opts.push({ label: 'Drew ' + D + ' (drop the new cards)', value: { op: 'setDraw', street: si, player: p, draw: { newCards: '' } } });
        out.push(makeGap({
          id, kind: 'impossible', field: dpath,
          question: (isHero ? 'You' : name) + ' drew ' + D + ' on ' + dw + ' but ' + nc.length + ' new cards are listed (' + d.newCards + '). Which is right?',
          options: opts, allowFree: true, blocking: isHero,
        }, key));
        continue;
      }
      if (nc.length && nc.length < D) {
        out.push(makeGap({
          id, kind: 'missing', field: dpath + '.newCards',
          question: (isHero ? 'You' : name) + ' drew ' + D + ' on ' + dw + ' but only ' + nc.length + ' new card' + (nc.length > 1 ? 's are' : ' is') + ' recorded. What were the others?',
          options: [{ label: 'The rest are unknown', value: { op: 'setDraw', street: si, player: p, draw: { newCards: nc.map(c => c.rank + c.suit).join('') + backs(D - nc.length) } } }],
          allowFree: true, blocking: isHero,
        }, key));
        continue;
      }
      // Discards must come out of the hand going into the draw.
      if (dc.length) {
        if (isHero) {
          const base = hand.streets[0].cards.hero;
          const going = computeDrawHand(base, getPlayerDrawsByStreet(hand, p), si - 1, hand.gameType);
          const goingCards = cardsOf(going);
          const allKnown = goingCards.length && goingCards.every(c => c.suit !== 'x');
          if (allKnown) {
            const have = new Set(goingCards.map(c => c.rank + c.suit));
            const stray = knownKeys(d.discardedCards).filter(c => !have.has(c));
            if (stray.length) {
              out.push(makeGap({
                id, kind: 'impossible', field: dpath + '.discardedCards',
                question: 'You discarded ' + listWords(stray) + ' on ' + dw + ', but your hand going in was ' + going + '. What did you throw?',
                options: [{ label: 'Drop the discard list (throw the ' + (D === 1 ? 'worst card' : D + ' worst cards') + ')', value: { op: 'setDraw', street: si, player: p, draw: { discardedCards: '' } } }],
                allowFree: true, blocking: true,
              }, key));
              continue;
            }
          }
        } else {
          const final = new Set(knownKeys((hand.streets[0].cards.opponents || [])[oppSlot(p, heroIdx)]));
          const kept = knownKeys(d.discardedCards).filter(c => final.has(c));
          if (kept.length) {
            out.push(makeGap({
              id, kind: 'impossible', field: dpath + '.discardedCards',
              question: name + ' discarded ' + listWords(kept) + ' on ' + dw + ', but ' + (kept.length > 1 ? 'they are' : 'it is') + ' in ' + name + '’s final hand. Which is right?',
              options: [{ label: 'Drop the discard list', value: { op: 'setDraw', street: si, player: p, draw: { discardedCards: '' } } }],
              allowFree: true, blocking: true,
            }, key));
            continue;
          }
        }
      }
      // Drawn cards cannot be dead (mirrors drawDeadCards, which the entry
      // form uses to refuse them).
      if (nc.length) {
        const dead = drawDeadCards(hand, si, p);
        const bad = knownKeys(d.newCards).find(c => dead.has(c));
        if (bad) {
          const replaced = nc.map(c => (c.rank + c.suit === bad ? 'Ax' : c.rank + c.suit)).join('');
          out.push(makeGap({
            id: 'draw-dead:' + si + ':' + p, kind: 'impossible', field: dpath + '.newCards',
            question: (isHero ? 'You' : name) + ' can’t have drawn ' + bad + ' on ' + dw + ' — it is ' + dead.get(bad) + '. What was the card?',
            options: [{ label: 'Unknown card instead', value: { op: 'setDraw', street: si, player: p, draw: { newCards: replaced } } }],
            allowFree: true, blocking: true,
          }, key));
        }
      }
    }
  }
}

/* A player's cards at showdown, the way the replayer evaluates them. */
function showdownCards(hand, env, pi) {
  const heroIdx = hand.heroIdx;
  if (env.isStud) {
    let acc = '';
    hand.streets.forEach(st => {
      const s = pi === heroIdx ? st.cards.hero : (st.cards.opponents || [])[oppSlot(pi, heroIdx)];
      if (s && !isMuck(s)) acc += s;
    });
    return acc;
  }
  if (pi === heroIdx) {
    const base = hand.streets[0].cards.hero || '';
    return env.isDraw ? computeDrawHand(base, getPlayerDrawsByStreet(hand, pi), hand.streets.length - 1, hand.gameType) : base;
  }
  return (hand.streets[0].cards.opponents || [])[oppSlot(pi, heroIdx)] || '';
}

/* The winner(s) by the cards, when every live hand and the board are known. */
function evaluatedWinners(hand, env, live) {
  const board = env.category === 'community'
    ? hand.streets.reduce((acc, st) => acc.concat(cardsOf(st.cards.board).filter(c => c.suit !== 'x')), [])
    : [];
  if (env.category === 'community' && board.length < 5) return null;
  const need = env.isStud ? 5 : env.cfg.heroCards;
  const hands = [];
  for (const pi of live) {
    const s = showdownCards(hand, env, pi);
    if (pi !== hand.heroIdx && isMuck((hand.streets[0].cards.opponents || [])[oppSlot(pi, hand.heroIdx)])) continue;
    const cards = cardsOf(s).filter(c => c.suit !== 'x');
    if (cards.length < need) return null;
    hands.push({ idx: pi, cards });
  }
  if (!hands.length) return null;
  if (hands.length === 1) return [{ playerIdx: hands[0].idx, split: false }];
  try {
    const w = evaluateShowdown(hand.gameType, hands, board);
    return w && w.length ? w : null;
  } catch (e) {
    return null;
  }
}

export function showdownRules(hand, env, out, ctx) {
  const n = hand.players.length;
  const heroIdx = hand.heroIdx;
  const winners = (hand.result && Array.isArray(hand.result.winners)) ? hand.result.winners.filter(Boolean) : [];
  const live = ctx.live;
  const setWinner = (pi) => ({ label: playerName(hand, pi) + ' won', value: { op: 'setResult', winners: [{ playerIdx: pi, split: false }] } });

  if (winners.some(w => !isIdx(w.playerIdx, n))) {
    out.push(makeGap({
      id: 'result', kind: 'impossible', field: 'result.winners',
      question: 'The winner is a player who isn’t at the table. Who won?',
      options: (live.length ? live : hand.players.map((_, i) => i)).map(setWinner),
      allowFree: true, blocking: true,
    }, [STAGE.result]));
    return;
  }
  if (!ctx.trace || !ctx.trace.completed) return;
  if (live.length === 1) {
    if (winners.length && !(winners.length === 1 && winners[0].playerIdx === live[0])) {
      out.push(makeGap({
        id: 'result', kind: 'impossible', field: 'result.winners',
        question: 'Everyone but ' + playerName(hand, live[0]) + ' folded, so ' + playerName(hand, live[0]) + ' won the pot. Record that?',
        options: [setWinner(live[0])], allowFree: true, blocking: true, auto: true,
      }, [STAGE.result]));
    }
    return;
  }
  const folded = winners.filter(w => !live.includes(w.playerIdx));
  if (folded.length) {
    out.push(makeGap({
      id: 'result', kind: 'impossible', field: 'result.winners',
      question: listWords(folded.map(w => playerName(hand, w.playerIdx))) + ' folded and can’t win the pot. Who won?',
      options: live.map(setWinner), allowFree: true, blocking: true,
    }, [STAGE.result]));
    return;
  }
  if (!ctx.showdown) return;

  // Cards shown down.
  for (const pi of live) {
    if (pi === heroIdx) continue;
    const id = 'showdown:' + pi;
    if (ctx.dismissed.has(id)) continue;
    const slot = oppSlot(pi, heroIdx);
    const s0 = (hand.streets[0].cards.opponents || [])[slot];
    if (isMuck(s0)) continue;
    const name = playerName(hand, pi);
    if (env.isStud) {
      const known = cardsOf(showdownCards(hand, env, pi)).filter(c => c.suit !== 'x').length;
      if (known >= 7) continue;
      out.push(makeGap({
        id, kind: 'missing', field: 'streets.0.cards.opponents.' + slot,
        question: 'What did ' + name + ' show down?',
        // Stud stays optional: the opponent's up cards are already on the table.
        options: [{ ...dismissOption('Not shown / unknown'), fallback: true }], allowFree: true, blocking: false,
      }, [STAGE.showdown, 50 + pi]));
      continue;
    }
    if (cardsOf(s0).length) continue;
    /* Asked BEFORE the hand counts as ready (blocking — 'I don’t know' still settles it): the
       showdown is the point of the replay, and as an optional question it came after "Open
       in replayer", so a hand opened with the opponent's cards never shown (seen 2026-10-01).
       After an all-in the cards are tabled, so 'mucked' is not an answer. */
    const anyAllIn = hand.streets.some(st => (st.actions || []).some(a => a && a.action === 'all-in'));
    out.push(makeGap({
      id, kind: 'missing', field: 'streets.0.cards.opponents.' + slot,
      question: 'What did ' + name + ' show down?',
      options: [
        ...(anyAllIn ? [] : [{ label: name + ' mucked', fallback: true, value: { op: 'set', path: 'streets.0.cards.opponents.' + slot, value: 'MUCK' } }]),
        { ...dismissOption('I don’t know'), fallback: true },
      ],
      allowFree: true, blocking: true,
    }, [STAGE.showdown, 50 + pi]));
  }

  if (!winners.length && !ctx.dismissed.has('result')) {
    const opts = [];
    const ev = evaluatedWinners(hand, env, live);
    if (ev) {
      const names = ev.map(w => playerName(hand, w.playerIdx));
      opts.push({ label: (ev.length > 1 ? listWords(names) + ' split it' : names[0] + ' won') + ' (from the cards)', value: { op: 'setResult', winners: ev } });
    }
    live.forEach(pi => opts.push(setWinner(pi)));
    opts.push({ label: 'They split it', value: { op: 'setResult', winners: live.map(pi => ({ playerIdx: pi, split: true })) } });
    out.push(makeGap({
      id: 'result', kind: 'missing', field: 'result.winners',
      question: 'Who won at showdown?',
      options: opts, allowFree: true, blocking: false,
    }, [STAGE.result]));
  }
}

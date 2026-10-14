// ── Hand history: a prepared hand rendered as PokerStars text ───────────────
// Lines only — prepare.js has already decided every verb, amount, pot and
// share. The order and wording of every line follow genuine PokerStars hands;
// docs/hand-history-io.md section 4 lists each construct and where it was seen.

import {
  COMMUNITY_HEADERS, STUD_HEADERS, DRAW_HEADERS, SHOWDOWN_HEADER, SUMMARY_HEADER,
  money, foldPhrase, cardText, toRoman, formatET,
} from './ps-format.js';

/* prep: prepareHand's output. h: { site, handId, tournamentId, buyInText,
   level, tableName, maxSeats, playedAt, showFoldedCards }. -> lines */
export function renderPokerStars(prep, h) {
  const { meta: m, events: ev, settle: s, model } = prep;
  const L = [];
  const sym = m.sym;
  const amt = (c) => money(c, sym);
  const nm = (p) => m.names[p];
  const allIn = (x) => (x ? ' and is all-in' : '');
  const fl = m.cfg.betting === 'fl' || m.isStud;
  const [sa, sb] = fl ? [m.env.bb, m.env.bigBet] : [m.env.sb, m.env.bb];
  const gameWords = m.stars.game + ' ' + m.stars.limit;
  const when = formatET(h.playedAt) + ' ET';

  // ── Header and table ──
  if (m.cash) {
    L.push(`${h.site} Hand #${h.handId}:  ${gameWords} (${amt(sa)}/${amt(sb)} ${m.currency}) - ${when}`);
  } else {
    L.push(`${h.site} Hand #${h.handId}: Tournament #${h.tournamentId}, ${h.buyInText} ${gameWords} - Level ${toRoman(h.level)} (${money(sa, '')}/${money(sb, '')}) - ${when}`);
  }
  L.push(m.isStud
    ? `Table '${h.tableName}' ${h.maxSeats}-max`
    : `Table '${h.tableName}' ${h.maxSeats}-max Seat #${m.seatNumbers[m.btnIdx]} is the button`);
  const bySeat = m.names.map((_, i) => i).sort((a, b) => m.seatNumbers[a] - m.seatNumbers[b]);
  for (const p of bySeat) L.push(`Seat ${m.seatNumbers[p]}: ${nm(p)} (${amt(Math.round(model.players[p].startingStack * 100))} in chips)`);

  // ── Forced bets ──
  const postWord = { ante: 'posts the ante', sb: 'posts small blind', bb: 'posts big blind', straddle: 'posts straddle' };
  const antes = ev.forced.filter(f => f.kind === 'ante').sort((a, b) => m.seatNumbers[a.p] - m.seatNumbers[b.p]);
  for (const f of antes.concat(ev.forced.filter(f => f.kind !== 'ante'))) {
    L.push(`${nm(f.p)}: ${postWord[f.kind]} ${amt(f.amount)}${allIn(f.allIn)}`);
  }

  // ── Streets ──
  const hero = m.heroIdx;
  const inAtStart = (p, si) => m.foldedOn[p] == null || m.foldedOn[p] >= si;
  const board = m.board;
  for (const e of ev.streets) {
    const si = e.si;
    if (m.category === 'community') {
      if (si === 0) {
        L.push(COMMUNITY_HEADERS[0]);
        L.push(`Dealt to ${nm(hero)} [${cardText(m.holeOf(hero))}]`);
      } else if (si === 1) L.push(`${COMMUNITY_HEADERS[1]} [${cardText(board.slice(0, 3))}]`);
      else L.push(`${COMMUNITY_HEADERS[si]} [${cardText(board.slice(0, si + 1))}] [${cardText(board.slice(si + 1, si + 2))}]`);
    } else if (m.isStud) {
      L.push(STUD_HEADERS[si]);
      for (const p of bySeat) {
        if (!inAtStart(p, si)) continue;
        if (p === hero) {
          const per = m.stud.heroStreets[hero];
          const prev = per.slice(0, si).flat();
          L.push(si === 0 ? `Dealt to ${nm(p)} [${cardText(per[0])}]` : `Dealt to ${nm(p)} [${cardText(prev)}] [${cardText(per[si])}]`);
        } else if (si <= 3) {
          const ups = m.stud.up[p];
          L.push(si === 0 ? `Dealt to ${nm(p)} [${cardText([ups[0]])}]` : `Dealt to ${nm(p)} [${cardText(ups.slice(0, si))}] [${cardText([ups[si]])}]`);
        }
      }
    } else {
      if (si === 0) {
        L.push(DRAW_HEADERS[0]);
        L.push(`Dealt to ${nm(hero)} [${cardText(heroDealt(prep))}]`);
      } else {
        // Triple draw: a header per draw. Single draw has none — its discards
        // follow the pre-draw betting directly (observed).
        if (m.category === 'draw_triple') L.push(DRAW_HEADERS[si]);
        for (const d of (ev.streets.find(x => x.si === si - 1) || {}).draws || []) L.push(...drawLines(d, nm, hero));
      }
    }
    for (const a of e.actions) L.push(actionLine(a, nm(a.p), amt) + allIn(a.allIn));
    if (e.uncalled) L.push(`Uncalled bet (${amt(e.uncalled.amount)}) returned to ${nm(e.uncalled.p)}`);
  }

  // ── Showdown / collects ──
  const potName = (k) => (s.pots.length === 1 ? 'pot' : k === 0 ? 'main pot' : s.pots.length === 2 ? 'side pot' : 'side pot-' + k);
  const descOf = (p) => {
    const c = m.holeOf(p);
    if (!c || c.length < m.holeCount || !c.every(x => x.suit !== 'x')) return null;
    return { cards: c, d: m.descs[p] || null };
  };
  if (m.showdown) {
    // Pot by pot, the highest side pot first, as Stars writes it: the players
    // in for that pot who have not shown yet show (in showdown order), then
    // that pot's collect lines.
    L.push(SHOWDOWN_HEADER);
    const sdOrder = showdownOrder(prep);
    const done = new Set();
    const show = (p) => {
      done.add(p);
      const x = descOf(p);
      if (x && x.d) L.push(`${nm(p)}: shows [${cardText(x.cards)}] (${x.d.shows})`);
      else if (!s.won[p]) L.push(`${nm(p)}: mucks hand`);
    };
    for (let k = s.pots.length - 1; k >= 0; k--) {
      for (const p of sdOrder) if (!done.has(p) && s.pots[k].players.includes(p)) show(p);
      for (const l of s.lines) if (l.pot === k) L.push(`${nm(l.p)} collected ${amt(l.amount)} from ${potName(l.pot)}`);
    }
    for (const p of sdOrder) if (!done.has(p)) show(p);
  } else {
    for (const l of s.lines) L.push(`${nm(l.p)} collected ${amt(l.amount)} from ${potName(l.pot)}`);
    for (const p of m.live) L.push(`${nm(p)}: doesn't show hand`);
  }
  if (h.showFoldedCards && !m.isStud) {
    for (const p of bySeat) {
      if (p === hero || m.foldedOn[p] == null) continue;
      const c = model.streets[0].cards.opponents[p < hero ? p : p - 1];
      if (c && c !== 'MUCK') L.push(`${nm(p)}: shows [${cardText(splitPairs(c))}]`);
    }
  }

  // ── Summary ──
  L.push(SUMMARY_HEADER);
  const rake = amt(0);
  if (s.pots.length === 1) L.push(`Total pot ${amt(s.total)} | Rake ${rake}`);
  else {
    const sides = s.pots.length === 2
      ? ` Side pot ${amt(s.pots[1].amount)}.`
      : s.pots.slice(1).map((p, i) => ` Side pot-${i + 1} ${amt(p.amount)}.`).join('');
    L.push(`Total pot ${amt(s.total)} Main pot ${amt(s.pots[0].amount)}.${sides} | Rake ${rake}`);
  }
  if (m.category === 'community' && board.length) L.push(`Board [${cardText(board)}]`);
  for (const p of bySeat) {
    let annot = '';
    const pos = model.players[p].position;
    if (!m.isStud) {
      if (pos === 'BTN/SB') annot = ' (button) (small blind)';
      else if (pos === 'BTN') annot = ' (button)';
      else if (pos === 'SB') annot = ' (small blind)';
      else if (pos === 'BB') annot = ' (big blind)';
    }
    let out;
    const won = s.won[p] || 0;
    if (m.foldedOn[p] != null) out = foldPhrase(m.category, m.gameType, m.foldedOn[p], m.beyondAnte[p] === 0);
    else if (m.showdown) {
      const x = descOf(p);
      if (x && x.d) out = won > 0 ? `showed [${cardText(x.cards)}] and won (${amt(won)}) with ${x.d.summary}` : `showed [${cardText(x.cards)}] and lost with ${x.d.summary}`;
      else out = won > 0 ? `collected (${amt(won)})` : 'mucked';
    } else out = `collected (${amt(won)})`;
    L.push(`Seat ${m.seatNumbers[p]}: ${nm(p)}${annot} ${out}`);
  }
  return L;
}

function splitPairs(s) {
  const out = [];
  const t = String(s).replace(/\s+/g, '');
  for (let i = 0; i + 1 < t.length; i += 2) out.push({ rank: t[i], suit: t[i + 1] });
  return out;
}

/* The hero's five (badugi: four) as dealt. */
function heroDealt(prep) {
  return splitPairs(prep.model.streets[0].cards.hero);
}

function actionLine(a, name, amt) {
  switch (a.verb) {
    case 'fold': return `${name}: folds`;
    case 'check': return `${name}: checks`;
    case 'call': return `${name}: calls ${amt(a.amount)}`;
    case 'bet': return `${name}: bets ${amt(a.amount)}`;
    case 'raise': return `${name}: raises ${amt(a.by)} to ${amt(a.to)}`;
    case 'bring-in': return `${name}: brings in for ${amt(a.amount)}`;
    default: throw new Error('hand-history: no PokerStars verb for ' + a.verb);
  }
}

function drawLines(d, nm, hero) {
  const out = [];
  const who = nm(d.p);
  if (d.discarded === 0) {
    out.push(d.p === hero && d.pat ? `${who}: stands pat on [${cardText(d.pat)}]` : `${who}: stands pat`);
    return out;
  }
  out.push(`${who}: discards ${d.discarded} card${d.discarded === 1 ? '' : 's'}` + (d.discardedCards ? ` [${cardText(d.discardedCards)}]` : ''));
  if (d.newCards) out.push(d.kept && d.kept.length ? `Dealt to ${who} [${cardText(d.kept)}] [${cardText(d.newCards)}]` : `Dealt to ${who} [${cardText(d.newCards)}]`);
  return out;
}

/* Who shows first: the last player to bet or raise on the final betting
   street; with no bet there, the first player still in, in that street's order
   (postflop order; stud, the order the 7th street was opened in). Then
   clockwise. */
export function showdownOrder(prep) {
  const m = prep.meta;
  const n = m.n;
  const live = new Set(m.live);
  let start = -1;
  const withActions = prep.events.streets.filter(e => e.actions.some(a => !a.implicit));
  const last = withActions[withActions.length - 1];
  if (last) {
    for (let i = last.actions.length - 1; i >= 0; i--) {
      const a = last.actions[i];
      if ((a.verb === 'bet' || a.verb === 'raise') && live.has(a.p)) { start = a.p; break; }
    }
  }
  if (start < 0) {
    const finalOrder = m.isStud ? (m.studOrders[m.lastStreet] || []) : postflopOrder(n);
    start = finalOrder.find(p => live.has(p));
  }
  const out = [];
  for (let k = 0; k < n; k++) { const p = (start + k) % n; if (live.has(p)) out.push(p); }
  return out;
}

function postflopOrder(n) {
  if (n === 2) return [1, 0];
  const btn = n <= 3 ? 0 : n - 3, sb = n <= 3 ? 1 : n - 2, bb = n - 1;
  const out = [sb, bb];
  for (let i = 0; i < btn; i++) out.push(i);
  out.push(btn);
  return out;
}

// The corpus hand as PokerKit played it: the per-action model that scripts/check-replayer-entry-oracle.mjs (the
// entry screen, in WebKit) and test/replayer-oracle/check-rules.mjs (utils/poker-rules, in plain Node) both
// hold their code to. Moved here unchanged from the entry oracle, 2026-11-22.

// corpus game -> [family, betting, the picker's row]
export const GAMES = {
  NLH: ['flop', 'nl', "No Limit Hold'em"], PLH: ['flop', 'pl', "Pot Limit Hold'em"], LHE: ['flop', 'fl', "Limit Hold'em"],
  PLO: ['flop', 'pl', 'Pot Limit Omaha'], PLO5: ['flop', 'pl', 'PLO5'], PLO6: ['flop', 'pl', 'PLO6'], 'LO Hi': ['flop', 'fl', 'Limit Omaha Hi'],
  PLO8: ['flop', 'pl', 'PLO8'], NLO8: ['flop', 'nl', 'NLO8'], O8: ['flop', 'fl', 'O8'], 'Big O': ['flop', 'pl', 'Big O'], 'PLO6 8/b': ['flop', 'pl', 'PLO6 8/b'],
  'Stud Hi': ['stud', 'fl', 'Stud Hi'], 'Stud 8': ['stud', 'fl', 'Stud 8/b'], Razz: ['stud', 'fl', 'Razz'],
  '2-7 TD': ['draw3', 'fl', '2-7 Triple Draw'], 'PL 2-7 TD': ['draw3', 'pl', 'Pot Limit 2-7 Triple Draw'], Badugi: ['draw3', 'fl', 'Badugi'],
  'NL 2-7 SD': ['draw1', 'nl', 'No Limit 2-7 Single Draw'], 'PL 5CD Hi': ['draw1', 'pl', 'Pot Limit 5-Card Draw'],
};
export const STREETS = {
  flop: ['Preflop', 'Flop', 'Turn', 'River'], stud: ['3rd Street', '4th Street', '5th Street', '6th Street', '7th Street'],
  draw3: ['Pre-Draw', 'First Draw', 'Second Draw', 'Third Draw'], draw1: ['Pre-Draw', 'Draw'],
};
export const cardsOf = (s) => (s || '').match(/[2-9TJQKA][hdcs]/g) || [];
export const slotOf = (i, hero) => (i > hero ? i - 1 : i);
export const sum = (a) => a.reduce((x, y) => x + y, 0);

// ── The corpus hand as PokerKit played it ───────────────────────────────────────────────────────────────
// Whole units (cents in a cash game, chips in a tournament). Each action carries the table as it stood
// before it: the price to call, whether a raise was allowed and why not, the smallest and the pot-sized
// raise. The raise rules are PokerKit's, line for line:
//   - a round starts with no raise size on record, so its first bet or raise is always a full one;
//   - the smallest raise is to (the largest raise so far this round, or the street's bet if larger) over the
//     current bet; over a stud bring-in the completion is to the street's bet itself;
//   - no raise: for a player who cannot cover the call; when nobody else could call more; in a limit game
//     after four bets and raises (a stud completion counts); and when what the player faces is less than a
//     full raise over what they already answered: an all-in for less does not reopen the betting, unless
//     several of them add up to a full raise.
export function model(rec) {
  const [family, betting] = GAMES[rec.game];
  const h = rec.hand;
  const U = rec.mode === 'cash' ? 100 : 1;
  const c = (v) => Math.round((v || 0) * U);
  const n = h.players.length;
  const b = h.blinds || {};
  const sb = c(b.sb), bb = c(b.bb), big = c(b.bigBet || b.bb * 2), ante = c(b.ante), bringIn = c(b.bringIn);
  const start = h.players.map((p) => c(p.startingStack));
  const stacks = start.slice();
  const folded = new Array(n).fill(false);
  const events = [], warn = [], flags = new Set();
  let pot = 0;
  let contrib = new Array(n).fill(0);
  let sbIdx = -1, bbIdx = -1;
  if (family === 'stud') {
    for (let i = 0; i < n; i++) { const a = Math.min(ante, stacks[i]); stacks[i] -= a; pot += a; }
    events.push({ type: 'third' });
  } else {
    sbIdx = h.players.findIndex((p) => p.position === 'SB' || p.position === 'BTN/SB');
    bbIdx = h.players.findIndex((p) => p.position === 'BB');
    const s = Math.min(sb, stacks[sbIdx]); stacks[sbIdx] -= s; contrib[sbIdx] = s; pot += s;
    const g = Math.min(bb, stacks[bbIdx]); stacks[bbIdx] -= g; contrib[bbIdx] = g; pot += g;
    const a = Math.min(ante, stacks[bbIdx]); stacks[bbIdx] -= a; pot += a;      // a big-blind ante: dead money, after the blind
    if (s < sb || g < bb) flags.add('short-blind');
  }
  const posted = stacks.slice();
  // Stud: a door card paired by the 4th-street card. PokerKit bets the small bet there all the same; the
  // entry screen moves the whole street to the big bet, so a 4th-street bet in such a hand is where they part.
  let openPair4 = false;
  if (family === 'stud' && h.streets[1]) {
    for (let i = 0; i < n; i++) {
      const of = (si) => cardsOf(i === h.heroIdx ? h.streets[si].cards.hero : (h.streets[si].cards.opponents || [])[slotOf(i, h.heroIdx)]);
      const c0 = of(0), c1 = of(1);
      const door = i === h.heroIdx ? c0[2] : c0[c0.length - 1];
      if (door && c1[0] && door[0] === c1[0][0]) openPair4 = true;
    }
    if (openPair4 && (h.streets[1].actions || []).some((a) => a.action === 'bet' || a.action === 'raise')) flags.add('open-pair-4th');
  }
  let over = false;
  const last = h.streets.length - 1;
  for (let si = 0; si <= last && !over; si++) {
    const st = h.streets[si];
    if (si > 0) contrib = new Array(n).fill(0);
    const streetMin = betting === 'fl' ? (si <= 1 ? bb : big) : bb;
    let cbra = 0, count = 0, shorts = [], acted = new Set(), shortSeen = false;
    let completion = family === 'stud' && si === 0 && bringIn > 0;
    for (let ai = 0; ai < (st.actions || []).length; ai++) {
      const a = st.actions[ai];
      const p = a.player, amt = c(a.amount);
      const at = `${rec.id} s${si}a${ai}`;
      const maxBet = Math.max(...contrib);
      const oweFull = maxBet - contrib[p];
      const owe = Math.min(stacks[p], oweFull);
      const allInTo = contrib[p] + stacks[p];
      const others = [...Array(n).keys()].filter((i) => i !== p && !folded[i]);
      let noRaise = null;
      if (stacks[p] <= oweFull) noRaise = 'covered';
      else if (!others.some((i) => stacks[i] + contrib[i] > maxBet)) noRaise = 'no-one-to-call';
      else if (betting === 'fl' && count >= 4) noRaise = 'cap';
      else if (owe < cbra || (shorts.length && sum(shorts) < cbra && acted.has(p))) noRaise = 'not-reopened';
      const minTo = Math.min(allInTo, Math.max(cbra, streetMin) + (completion ? 0 : maxBet));
      const potTo = Math.min(allInTo, Math.max(minTo, 2 * maxBet - contrib[p] + pot));
      const ev = { type: 'act', street: si, index: ai, player: p, action: a.action, amount: amt, stackBefore: stacks[p], contribBefore: contrib[p],
        maxBet, oweFull, owe, pot, noRaise, minTo, potTo, allInTo, count, shortSeen, firstOfStreet: ai === 0, cbra, streetMin,
        // TDA rule 47-B: in a limit game half a bet reopens the betting. PokerKit asks for a whole one.
        halfBet: betting === 'fl' && noRaise === 'not-reopened' && owe * 2 >= streetMin };
      if (noRaise === 'not-reopened') flags.add('closed-raise-spot');
      if (noRaise === 'cap') flags.add('capped');
      if (noRaise === 'no-one-to-call') flags.add('no-one-to-call');
      if (a.action === 'fold') { ev.kind = 'fold'; folded[p] = true; if (owe <= 0) warn.push(`${at}: a fold with nothing to call`); }
      else if (a.action === 'check') { ev.kind = 'check'; if (amt !== 0 || owe !== 0) warn.push(`${at}: a check owing ${owe}`); }
      else if (a.action === 'bring-in') {
        ev.kind = 'bringin';
        if (amt !== Math.min(bringIn, ev.stackBefore)) warn.push(`${at}: bring-in ${amt}, the table's is ${bringIn}`);
        stacks[p] -= amt; contrib[p] += amt; pot += amt;
      } else {
        const to = contrib[p] + amt;
        if (amt > ev.stackBefore) warn.push(`${at}: more than the stack`);
        if (to <= maxBet) {
          ev.kind = 'call';
          if (amt !== owe || amt === 0) warn.push(`${at}: ${a.action} ${amt}, the price is ${owe}`);
          if (amt < oweFull) flags.add('call-for-less');
        } else {
          ev.kind = completion ? 'complete' : (maxBet === 0 ? 'bet' : 'raise');
          ev.to = to;
          ev.isAllIn = amt === ev.stackBefore;
          if (noRaise) warn.push(`${at}: a raise where the model allows none (${noRaise})`);
          if (betting === 'fl' && to !== minTo) warn.push(`${at}: limit ${a.action} to ${to}, the model says ${minTo}`);
          if (betting !== 'fl' && to < minTo) warn.push(`${at}: ${a.action} to ${to}, under the minimum ${minTo}`);
          if (betting === 'pl' && to > potTo) warn.push(`${at}: ${a.action} to ${to}, over the pot ${potTo}`);
          if (betting === 'pl' && to === potTo) { ev.potSized = true; flags.add('pot-raise'); }
          const r = to - maxBet;
          if (cbra > 0 && r < cbra) { flags.add('short-raise'); shortSeen = true; ev.short = true; }
          completion = false;
          if (r >= cbra) acted = new Set();
          cbra = Math.max(cbra, r);
          count++;
          if (ev.stackBefore - amt > 0) shorts = []; else shorts.push(r);
          if (sum(shorts) >= cbra) shorts = [];
        }
        stacks[p] -= amt; contrib[p] += amt; pot += amt;
      }
      acted.add(p);
      ev.stackAfter = stacks[p];
      ev.potAfter = pot;
      events.push(ev);
      if (folded.filter((f) => !f).length === 1) { over = true; break; }
    }
    if (over) break;
    if (si < last) {
      if (family === 'flop') events.push({ type: 'board', street: si + 1, cards: h.streets[si + 1].cards.board });
      else if (family === 'stud') events.push({ type: 'deal', street: si + 1 });
      else events.push({ type: 'draw', street: si, draws: st.draws || [] });
    }
  }
  const live = [...Array(n).keys()].filter((i) => !folded[i]);
  if (!over) events.push({ type: 'showdown', live });
  events.push({ type: 'result', live, winners: (h.result && h.result.winners) || [] });
  if (family === 'flop' && betting === 'fl' && b.bigBet && c(b.bigBet) !== 2 * bb) flags.add('odd-big-bet');
  return { events, warn, flags, family, betting, U, n, sb, bb, big, ante, bringIn, start, posted, sbIdx, bbIdx, live, folded, openPair4 };
}


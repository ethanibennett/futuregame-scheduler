// Each seat's stack at the end of a hand, read from a PokerStars-format hand history: the starting stack, less
// everything the seat put in, plus any uncalled bet returned and everything it collected. The replay check
// compares the felt against this seat by seat, so a pot paid to the wrong player fails even when the chips
// still add up.
//
// The grammar is the one our writer emits (and PokerStars uses): "posts small blind 1", "posts the ante 0.10",
// "brings in for 0.25", "bets 2", "calls 2", "raises 2 to 6" (to = the seat's total on this street),
// "Uncalled bet (1.70) returned to X", "X collected 6 from side pot-1". Amounts may carry $, € or £.

const AMT = String.raw`[$€£]?([\d,]+(?:\.\d+)?)`;
const num = (s) => Number(String(s).replace(/,/g, ''));

export function goldenFinals(text) {
  const lines = String(text).split(/\r?\n/);
  const start = new Map();
  for (const l of lines) {
    const m = new RegExp(String.raw`^Seat \d+: (.+) \(${AMT} in chips\)`).exec(l);
    if (m && !start.has(m[1])) start.set(m[1], num(m[2]));
    if (/^\*\*\* /.test(l)) break;
  }
  // Longest names first, so "bob the great 2" is never read as "bob the great".
  const names = [...start.keys()].sort((a, b) => b.length - a.length);
  const who = (l) => names.find((n) => l.startsWith(n + ': ') || l.startsWith(n + ' collected '));
  const put = new Map(names.map((n) => [n, 0]));
  const got = new Map(names.map((n) => [n, 0]));
  let street = new Map();
  // A single draw has no street header after it (5 Card Draw): the draw itself starts the next betting round.
  let drew = false;
  // `to` is the seat's total on this street ("raises 2 to 6"); without it the amount adds ("calls 2").
  const commit = (n, amount, to) => {
    if (drew) { street = new Map(); drew = false; }
    const was = street.get(n) || 0;
    const now = to ? amount : was + amount;
    put.set(n, put.get(n) + (now - was)); street.set(n, now);
  };
  for (const l of lines) {
    if (/^\*\*\* SUMMARY/.test(l)) break;
    if (/^\*\*\* /.test(l)) { if (!/HOLE CARDS|DEALING HANDS|SHOW DOWN/.test(l)) street = new Map(); continue; }
    const ret = new RegExp(String.raw`^Uncalled bet \(${AMT}\) returned to (.+)$`).exec(l);
    if (ret) { got.set(ret[2], got.get(ret[2]) + num(ret[1])); continue; }
    const n = who(l);
    if (!n) continue;
    const rest = l.slice(n.length);
    let m;
    if (/^: (discards|stands pat)/.test(rest)) drew = true;
    else if ((m = new RegExp(String.raw`^ collected ${AMT} from`).exec(rest))) got.set(n, got.get(n) + num(m[1]));
    else if ((m = new RegExp(String.raw`^: posts the ante ${AMT}`).exec(rest))) put.set(n, put.get(n) + num(m[1]));
    else if ((m = new RegExp(String.raw`^: (?:posts (?:small blind|big blind|straddle)|brings in for|bets|calls) ${AMT}`).exec(rest))) commit(n, num(m[1]), false);
    else if ((m = new RegExp(String.raw`^: raises ${AMT} to ${AMT}`).exec(rest))) commit(n, num(m[2]), true);
  }
  const out = new Map();
  for (const n of start.keys()) out.set(n,Math.round((start.get(n) - put.get(n) + got.get(n)) * 100) / 100);
  return { start, finals: out };
}

/**
 * The pay ladder (Features 13, 2026-11-11): where `left` players sit on a typed payouts board.
 * rows: [{ from, to, amount }] by place. -> { paid, nextOut, jumps: [{ place, amount, moreOut }], ft, first }
 * or null when the board does not reach the players left.
 */
export function payAt(rows, place) {
  const r = (rows || []).find((x) => place >= x.from && place <= x.to);
  return r ? r.amount : null;
}

export function ladder(rows, left) {
  const list = (rows || []).slice().sort((a, b) => a.from - b.from);
  if (!list.length || !(left >= 1)) return null;
  const paid = Math.max(...list.map((r) => r.to));
  if (left > paid) return { paid, nextOut: null, jumps: [], ft: payAt(list, Math.min(9, paid)), first: payAt(list, 1), bubble: left - paid };
  const nextOut = payAt(list, left);
  const jumps = [];
  let place = left;
  let amount = nextOut;
  // Walk up the board: each higher band is a jump, with how many more players must go out to reach it.
  for (const r of list.filter((x) => x.to < left).sort((a, b) => b.to - a.to)) {
    if (r.amount > amount) {
      jumps.push({ place: r.to, amount: r.amount, moreOut: left - r.to });
      amount = r.amount;
      place = r.to;
      if (jumps.length >= 2) break;
    }
  }
  void place;
  return { paid, nextOut, jumps, ft: payAt(list, Math.min(9, paid)), first: payAt(list, 1), bubble: 0 };
}

// ── One money parser for every amount field (UX pick 73) ────────────────────
// There were four rules: number fields (WebKit read "$1,200" as 1200 and refused "1.2k"), parseAmount
// (no "k"), the backer page's partCents (dropped every non-digit, so "1.2k" was $1.20 and "12,50" was
// $1,250) and the staking amounts (refused "$"). Every money field reads through this now, and shows
// what it read when that differs from what was typed.
//
// Accepted: a leading $ € or £, spaces, thousands commas ("1,200.50"), a lone decimal comma ("12,50",
// two digits at most after it), a k suffix ("1.2k"), and a minus where the field allows one. Anything
// else is refused with a reason rather than half read: "500 dollars" is not $500.

/** { value, cents } for a readable amount, else { error }. Empty text is an error ('Type an amount'). */
export function parseMoney(raw, { allowNegative = false } = {}) {
  let s = String(raw == null ? '' : raw).trim();
  if (!s) return { error: 'Type an amount' };
  let neg = false;
  const minus = () => {
    if (!/^[-−]/.test(s)) return true;
    if (!allowNegative || neg) return false;
    neg = true;
    s = s.slice(1).trim();
    return true;
  };
  const noMinus = { error: allowNegative ? 'Not an amount' : 'No minus sign here' };
  if (!minus()) return noMinus;
  s = s.replace(/^[$€£]\s*/, '');
  if (!minus()) return noMinus;
  s = s.replace(/\s+/g, '');
  let mult = 1;
  if (/[kK]$/.test(s)) { mult = 1000; s = s.slice(0, -1); }
  if (!s) return { error: 'Not an amount' };
  if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.');
  else if (s.includes(',')) {
    if (!/^\d{1,3}(,\d{3})+(\.\d*)?$/.test(s)) return { error: 'Not an amount' };
    s = s.replace(/,/g, '');
  }
  if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) return { error: 'Not an amount' };
  const v = Math.round(parseFloat(s) * mult * 100) / 100;
  if (!Number.isFinite(v) || v > 1e10) return { error: 'Too large' };
  const value = neg && v !== 0 ? -v : v;
  return { value, cents: Math.round(value * 100) };
}

/** "$1,200" or "$12.50": an amount as the echo shows it. */
export function formatMoney(value, sym = '$') {
  const n = Number(value) || 0;
  const abs = Math.abs(n);
  const body = abs.toLocaleString('en-US', { minimumFractionDigits: abs % 1 ? 2 : 0, maximumFractionDigits: 2 });
  return (n < 0 ? '−' : '') + sym + body;
}

/** The echo for a field: the reading, when it is not simply what was typed; else null. */
export function moneyEcho(text, value, sym = '$') {
  const typed = String(text == null ? '' : text).replace(/\s+/g, '');
  if (typed === String(value)) return null;
  return formatMoney(value, sym);
}

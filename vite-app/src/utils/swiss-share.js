// Share images in the Swiss theme (catalogue item 47, "Share cards on the same grid"; owner,
// 2026-10-16). While data-theme is swiss-light or swiss-dark, the Series Scorecard and the
// Countdown Story are drawn on the theme's grid: a giant thin numeral, a hairline, the event or the
// figures in bold, and the wordmark with its red full stop at the foot. Every other theme keeps the
// drawings in export.js. Canvas sizes are the platform's (1080 wide); the grid here is twelfths.

const FACE = '"Helvetica Neue", Helvetica, Arial, sans-serif';

export function isSwissTheme() {
  if (typeof document === 'undefined') return false;
  return (document.documentElement.getAttribute('data-theme') || '').startsWith('swiss');
}

function palette() {
  const dark = (document.documentElement.getAttribute('data-theme') || '') === 'swiss-dark';
  return dark
    ? { ground: '#000000', ink: '#ffffff', grey: '#a6a6a6', rule: '#595959', red: '#ff2a35' }
    : { ground: '#ffffff', ink: '#000000', grey: '#666666', rule: '#b3b3b3', red: '#e30613' };
}

function font(ctx, weight, size, track = 0) {
  ctx.font = `${weight} ${size}px ${FACE}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${Math.round(size * track * 100) / 100}px`;
}

function money(n) {
  const v = Math.round(Number(n) || 0);
  const s = '$' + Math.abs(v).toLocaleString('en-US');
  return v < 0 ? '−' + s : v > 0 ? '+' + s : s;
}

/** Text that fits `max` wide, shrinking the size down to `min` and then cutting with an ellipsis. */
function fitText(ctx, text, weight, size, min, max, track) {
  let s = size;
  font(ctx, weight, s, track);
  while (s > min && ctx.measureText(text).width > max) { s -= 4; font(ctx, weight, s, track); }
  let t = String(text);
  while (t.length > 1 && ctx.measureText(t).width > max) t = t.slice(0, -2) + '…';
  return { text: t, size: s };
}

/** Words wrapped to `max` wide, at most `lines` lines. */
function wrap(ctx, text, max, lines) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const out = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? cur + ' ' + w : w;
    if (ctx.measureText(next).width <= max || !cur) cur = next;
    else { out.push(cur); cur = w; if (out.length === lines) break; }
  }
  if (out.length < lines && cur) out.push(cur);
  if (out.length === lines && words.join(' ') !== out.join(' ')) out[lines - 1] = out[lines - 1].replace(/\s*\S*$/, '') + '…';
  return out;
}

function wordmark(ctx, x, y, p, size) {
  font(ctx, 700, size, -0.05);
  ctx.fillStyle = p.ink; ctx.fillText('futurega', x, y);
  const w1 = ctx.measureText('futurega').width;
  ctx.fillStyle = p.red; ctx.fillText('.', x + w1, y);
  const w2 = ctx.measureText('.').width;
  ctx.fillStyle = p.ink; ctx.fillText('me', x + w1 + w2, y);
}

function hairline(ctx, x, y, w, p, weight = 2, color) {
  ctx.fillStyle = color || p.ink;
  ctx.fillRect(x, y, w, weight);
}

/** The Series Scorecard (1080 x 1080): the net as the poster figure, four facts under a rule. */
export function drawSwissScorecard(ctx, W, H, d) {
  const p = palette();
  const m = W / 12;                 // one twelfth: the margin and the column unit
  ctx.fillStyle = p.ground; ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'alphabetic';

  hairline(ctx, m, m, W - 2 * m, p, 8);
  font(ctx, 700, 40, -0.02); ctx.fillStyle = p.ink;
  ctx.fillText(d.venueName || 'My Series', m, m + 76);
  font(ctx, 300, 32); ctx.fillStyle = p.grey;
  if (d.dateRange) ctx.fillText(String(d.dateRange), m, m + 124);

  const net = money(d.netPL);
  const big = fitText(ctx, net, 200, 260, 120, W - 2 * m, -0.05);
  ctx.fillStyle = Number(d.netPL) < 0 ? p.red : p.ink;
  font(ctx, 200, big.size, -0.05);
  ctx.fillText(big.text, m - big.size * 0.04, m + 124 + big.size * 0.95);
  const figBase = m + 124 + big.size * 0.95;
  font(ctx, 300, 32); ctx.fillStyle = p.grey;
  ctx.fillText('profit', m, figBase + 52);

  const roi = Number(d.roi);
  const facts = [
    ['Events', String(d.eventsPlayed ?? 0)],
    ['Cashes', `${d.cashCount ?? 0}${d.cashRate != null ? ` · ${Math.round(Number(d.cashRate))}%` : ''}`],
    ['ROI', Number.isFinite(roi) ? `${roi >= 0 ? '+' : '−'}${Math.abs(roi).toFixed(1)}%` : '—'],
    ['Biggest cash', d.biggestCash ? money(d.biggestCash).replace('+', '') : '—'],
  ];
  const top = figBase + 110;
  hairline(ctx, m, top, W - 2 * m, p, 2);
  const colW = (W - 2 * m) / 2;
  facts.forEach(([k, v], i) => {
    const x = m + (i % 2) * colW;
    const y = top + 70 + Math.floor(i / 2) * 150;
    font(ctx, 300, 30); ctx.fillStyle = p.grey; ctx.fillText(k, x, y);
    const fv = fitText(ctx, v, 700, 64, 36, colW - m / 2, -0.03);
    font(ctx, 700, fv.size, -0.03); ctx.fillStyle = p.ink; ctx.fillText(fv.text, x, y + 72);
  });

  hairline(ctx, m, H - m - 92, W - 2 * m, p, 2, p.rule);
  wordmark(ctx, m, H - m, p, 44);
}

/** The Countdown Story (1080 x 1920): the time left as the poster figure, the event in bold. */
export function drawSwissCountdown(ctx, W, H, d) {
  const p = palette();
  const m = W / 12;
  ctx.fillStyle = p.ground; ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'alphabetic';

  hairline(ctx, m, m * 1.5, W - 2 * m, p, 8);
  font(ctx, 700, 44, -0.02); ctx.fillStyle = p.ink;
  ctx.fillText('Next event', m, m * 1.5 + 84);

  // The countdown, giant and thin; "now" in red.
  const left = String(d.timeUntil || '—');
  const big = fitText(ctx, left, 200, 340, 140, W - 2 * m, -0.05);
  font(ctx, 200, big.size, -0.05);
  ctx.fillStyle = left === 'now' ? p.red : p.ink;
  const figBase = H * 0.42;
  ctx.fillText(big.text, m - big.size * 0.04, figBase);
  font(ctx, 300, 36); ctx.fillStyle = p.grey;
  ctx.fillText('until it starts', m, figBase + 64);

  const top = figBase + 150;
  hairline(ctx, m, top, W - 2 * m, p, 2);
  font(ctx, 700, 84, -0.04); ctx.fillStyle = p.ink;
  const lines = wrap(ctx, d.tournamentName || '', W - 2 * m, 3);
  lines.forEach((l, i) => ctx.fillText(l, m, top + 110 + i * 96));
  const after = top + 110 + (lines.length - 1) * 96;

  font(ctx, 300, 40); ctx.fillStyle = p.grey;
  const meta = [d.venue, d.gameType].filter(Boolean).join(' · ');
  if (meta) ctx.fillText(fitText(ctx, meta, 300, 40, 28, W - 2 * m, 0).text, m, after + 80);
  const when = [d.date, d.time].filter(Boolean).join(' · ');
  if (when) ctx.fillText(when, m, after + 136);
  if (d.buyin) {
    font(ctx, 700, 72, -0.03); ctx.fillStyle = p.ink;
    ctx.fillText('$' + Math.round(Number(d.buyin) || 0).toLocaleString('en-US'), m, after + 250);
  }

  hairline(ctx, m, H - m * 1.5 - 100, W - 2 * m, p, 2, p.rule);
  wordmark(ctx, m, H - m * 1.5, p, 52);
}

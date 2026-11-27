/* The room: 12 ideas in the space around the table, behind it, and (for frost) on the glass of the screen. */
(function () {
  const SS = window.SS, { TAU, clamp, lerp, sm, env, outCubic, inOut, outBack, spring } = SS;
  const outsideTable = (c, G) => { const p = new Path2D(); p.rect(0, 0, G.W, G.H); const r = Math.min(G.tw, G.th); p.moveTo(G.cx - G.tw + r, G.cy - G.th); p.lineTo(G.cx + G.tw - r, G.cy - G.th); p.arc(G.cx + G.tw - r, G.cy, r, -Math.PI / 2, Math.PI / 2); p.lineTo(G.cx - G.tw + r, G.cy + G.th); p.arc(G.cx - G.tw + r, G.cy, r, Math.PI / 2, Math.PI * 1.5); p.closePath(); c.clip(p, 'evenodd'); };

  /* Stage Rig: the beams are drawn in three layers (the room, the rail, the cloth) so they pass under every piece. */
  function beams(X, clip) {
    const { c, G, L, H, t } = X, e = env(t, 0.5, 1.2, 5.8, 7.0); if (e <= 0) return;
    const fx = [0.12, 0.36, 0.64, 0.88], gel = SS.SUITRGB[H.suit] || [255, 240, 210];
    c.save(); clip(); c.globalCompositeOperation = 'lighter';
    fx.forEach((f, i) => {
      const ox = f * G.W, oy = G.H * 0.02, start = { x: G.W * (i % 2 ? 0.15 : 0.85), y: G.H * 0.95 }, k = clamp(spring(t - 0.8 - i * 0.18, 0.45, 0.6), 0, 1.15);
      const tx = lerp(start.x, L.hero.x, k), ty = lerp(start.y, L.hero.y, k), ang = Math.atan2(ty - oy, tx - ox), wid = G.H * 0.07, nx = -Math.sin(ang), ny = Math.cos(ang);
      const rgb = i === 1 || i === 2 ? gel : [255, 240, 215], g = c.createLinearGradient(ox, oy, tx, ty);
      g.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${0.3 * e})`); g.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${0.06 * e})`);
      c.fillStyle = g; c.beginPath(); c.moveTo(ox + nx * 3, oy + ny * 3); c.lineTo(tx + nx * wid, ty + ny * wid); c.lineTo(tx - nx * wid, ty - ny * wid); c.lineTo(ox - nx * 3, oy - ny * 3); c.closePath(); c.fill();
    });
    c.restore();
  }
  SS.idea({
    zone: 'out', cat: 'royal', title: 'Stage Rig',
    desc: 'The room dims and four stage lights above the table swing round, two in the royal’s suit colour, overshooting and settling until every beam lands on the hero’s seat.',
    drives: 'Where the hero sits, and the suit of the royal for the gels.',
    back(X) {
      const { c, G, t } = X, e = env(t, 0.5, 1.6, 5.8, 7.0);
      c.save(); c.fillStyle = `rgba(0,0,0,${0.45 * e})`; c.fillRect(0, 0, G.W, G.H); c.restore();
      beams(X, () => outsideTable(c, G));
      [0.12, 0.36, 0.64, 0.88].forEach((f) => { c.save(); c.globalAlpha = sm(0.2, 0.6, t) * (1 - sm(6.2, 7, t)); c.fillStyle = '#2a2a33'; c.fillRect(f * G.W - 6, 0, 12, G.H * 0.035); c.fillStyle = '#fff6d8'; c.beginPath(); c.arc(f * G.W, G.H * 0.03, 3, 0, TAU); c.fill(); c.restore(); });
    },
    rail(X) { beams(X, () => SS.clipRing(X.c, X.G)); },
    light(X) { const { c, G, L, t } = X; beams(X, () => SS.clipFelt(c, G)); c.save(); c.globalCompositeOperation = 'lighter'; SS.glow(c, L.heroCards.x, L.heroCards.y, G.H * 0.2, [255, 240, 210], 0.3 * env(t, 2.0, 2.8, 5.8, 7.0)); c.restore(); },
  });

  SS.idea({
    zone: 'out', cat: 'flush', title: 'Suit Aurora',
    desc: 'Aurora curtains rise behind the table in the flush suit’s own colours, folding slowly in three layers, with the suit drifting faintly along their hems.',
    drives: 'The flush suit sets the palette and the pattern.',
    back(X) {
      const { c, G, H, t, S } = X, e = env(t, 0.4, 1.6, 5.6, 7.0); if (e <= 0) return;
      const PAL = { h: [[255, 90, 120], [255, 165, 95], [205, 80, 200]], d: [[80, 160, 255], [80, 230, 240], [140, 120, 255]], c: [[70, 230, 140], [170, 240, 120], [60, 200, 200]], s: [[205, 215, 245], [150, 140, 255], [120, 200, 255]] }[H.suit];
      if (!S.strips || S.strips.suit !== H.suit) S.strips = { suit: H.suit, cv: PAL.map((rgb) => { const cv = document.createElement('canvas'); cv.width = 1; cv.height = 64; const x = cv.getContext('2d'); const g = x.createLinearGradient(0, 0, 0, 64); g.addColorStop(0, `rgba(${rgb},0)`); g.addColorStop(0.7, `rgba(${rgb},0.6)`); g.addColorStop(1, `rgba(${rgb},1)`); x.fillStyle = g; x.fillRect(0, 0, 1, 64); return cv; }) };
      c.save(); c.globalCompositeOperation = 'lighter';
      for (let k = 2; k >= 0; k--) {
        for (let x = 0; x < G.W; x += 3) {
          const base = G.H * (0.24 + 0.05 * k) + Math.sin(x * 0.01 + t * 0.4 + k) * G.H * 0.03, h = G.H * (0.12 + 0.3 * SS.fbm(x * 0.007 + t * 0.15 + k * 9, k * 3.1));
          c.globalAlpha = 0.3 * e * (0.5 + 0.5 * SS.noise(x * 0.02 + k, t * 0.3));
          c.drawImage(S.strips.cv[k], x, base - h, 3, h);
        }
        for (let x = (t * 8 + k * 30) % 48; x < G.W; x += 48) { const base = G.H * (0.24 + 0.05 * k) + Math.sin(x * 0.01 + t * 0.4 + k) * G.H * 0.03; SS.suit(c, H.suit, x, base - G.H * 0.01, G.H * 0.03, 0, `rgb(${PAL[k]})`, 0.18 * e); }
      }
      c.restore();
    },
  });

  /* Points on a suit's outline, for a burst shaped like the suit. */
  const OUTLINE = {};
  function outline(s) {
    if (OUTLINE[s]) return OUTLINE[s];
    const N = 64, cv = document.createElement('canvas'); cv.width = cv.height = N; const x = cv.getContext('2d'); x.scale(N / 100, N / 100); x.fill(SS.SUIT[s]);
    const d = x.getImageData(0, 0, N, N).data, inn = (i, j) => i >= 0 && j >= 0 && i < N && j < N && d[(j * N + i) * 4 + 3] > 128, pts = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) if (inn(i, j) && (!inn(i - 1, j) || !inn(i + 1, j) || !inn(i, j - 1) || !inn(i, j + 1))) pts.push([i / N - 0.5, j / N - 0.5]);
    const out = []; const step = pts.length / 46; for (let k = 0; k < 46; k++) out.push(pts[Math.floor(k * step)]);
    return (OUTLINE[s] = out);
  }
  SS.idea({
    zone: 'out', cat: 'sf', title: 'Card Fireworks',
    desc: 'Five shells go up round the table, one for each card of the straight flush, in rank order. Each bursts in the shape of its suit, higher for a higher card, and its embers drift down and fade.',
    drives: 'The five cards: their order, rank and suit.',
    back(X) {
      const { c, G, H, t } = X, e = 1 - sm(6.4, 7.2, t); if (e <= 0) return;
      const xs = [0.07, 0.24, 0.5, 0.76, 0.93];
      c.save(); c.globalCompositeOperation = 'lighter';
      H.up.forEach((cd, k) => {
        const T = 0.5 + k * 0.5, x = xs[k] * G.W, by = G.H * (0.17 - 0.1 * (cd.r - 2) / 12), rise = (t - T) / 0.55, rgb = SS.SUITRGB[cd.s];
        if (rise > 0 && rise < 1) { const y = lerp(G.H * 1.02, by, outCubic(rise)); SS.glow(c, x, y, 5, [255, 240, 200], 0.9); for (let j = 1; j < 8; j++) SS.glow(c, x, lerp(G.H * 1.02, by, outCubic(rise - j * 0.03)), 3, [255, 200, 140], 0.25 * (1 - j / 8)); }
        const age = t - T - 0.55; if (age <= 0) return;
        const R = G.H * 0.13 * (0.75 + 0.25 * (cd.r - 2) / 12), a = sm(0, 0.06, age) * (1 - sm(0.7, 2.0, age)) * e;
        outline(cd.s).forEach(([px, py]) => {
          const g = outCubic(age / 0.8), drop = age * age * G.H * 0.12, x1 = x + px * 2 * R * g, y1 = by + py * 2 * R * g + drop, g0 = outCubic(Math.max(0, age - 0.08) / 0.8), x0 = x + px * 2 * R * g0, y0 = by + py * 2 * R * g0 + (age - 0.08) ** 2 * G.H * 0.12;
          c.strokeStyle = `rgba(${rgb},${a * 0.8})`; c.lineWidth = 1.4; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
          c.fillStyle = `rgba(255,250,235,${a * (1 - sm(0, 0.5, age)) * 0.9})`; c.fillRect(x1 - 1, y1 - 1, 2, 2);
        });
      });
      c.restore();
    },
  });

  SS.idea({
    zone: 'out', cat: 'scoop', title: 'Two-Sided Confetti',
    desc: 'Confetti bursts from the bottom corners of the room. Every piece tumbles in three dimensions, teal on one face and violet on the other for the two halves, catching gold as it falls behind the table.',
    drives: 'The two halves, in their colours.',
    back(X) {
      const { c, G, t, S } = X, e = 1 - sm(6.2, 7.2, t); if (e <= 0) return;
      if (!S.conf || S.conf.W !== G.W) { const R = SS.rng(21); S.conf = { W: G.W, p: Array.from({ length: 120 }, (_, i) => ({ side: i % 2 ? 1 : -1, t0: 0.6 + R() * 0.5, vx: G.W * (0.3 + R() * 1.4), vy: G.H * (2.9 + R() * 0.5), ph: R() * TAU, wf: 6 + R() * 8, rot: R() * TAU, wr: (R() - 0.5) * 6, pair: R() < 0.25 ? 1 : 0, sz: 0.8 + R() * 0.5 })) }; }
      const g = G.H * 0.3, k = 3.2;
      for (const p of S.conf.p) {
        const tau = t - p.t0; if (tau <= 0) continue;
        const ex = (1 - Math.exp(-k * tau)) / k, x = (p.side < 0 ? 0 : G.W) - p.side * p.vx * ex + Math.sin(tau * 1.3 + p.ph) * G.W * 0.02;
        const y = G.H - ((p.vy + g / k) * ex - (g / k) * tau);
        if (y > G.H + 10) continue;
        const flip = Math.cos(p.ph + p.wf * tau), front = flip >= 0, col = p.pair ? (front ? '#ffd76a' : '#fff3d6') : (front ? '#2fb3c6' : '#9b6ad8');
        c.save(); c.globalAlpha = e * sm(0, 0.05, tau); c.translate(x, y); c.rotate(p.rot + p.wr * tau); c.scale(1, Math.max(0.08, Math.abs(flip)));
        c.fillStyle = col; c.fillRect(-G.H * 0.012 * p.sz, -G.H * 0.007 * p.sz, G.H * 0.024 * p.sz, G.H * 0.014 * p.sz); c.restore();
      }
    },
  });

  const FLAP = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789,.+-';
  SS.idea({
    zone: 'out', cat: 'bigpot', title: 'Split-Flap Board',
    desc: 'A departure board above the table clatters through its letters, cell by cell, and lands on the pot and the hand that won it.',
    drives: 'The pot and the hand’s name.',
    back(X) {
      const { c, G, H, t } = X, e = env(t, 0.3, 0.7, 5.8, 7.0); if (e <= 0) return;
      const rows = ['POT ' + SS.fmt(H.pot), H.name.toUpperCase().replace(/[^A-Z0-9 ,.+-]/g, '').slice(0, 20)], top = G.H * 0.02, bandH = G.cy - G.th - G.H * 0.04, rh = bandH / 2 - 2, cw = rh * 0.68, n = 20, x0 = G.cx - (n * (cw + 2)) / 2;
      c.save(); c.globalAlpha = e; c.fillStyle = '#0c0c10'; c.fillRect(x0 - 6, top - 4, n * (cw + 2) + 10, bandH + 6);
      rows.forEach((txt, r) => {
        const pad = Math.floor((n - txt.length) / 2), y = top + r * (rh + 2);
        for (let i = 0; i < n; i++) {
          const ch = txt[i - pad] || ' ', tgt = Math.max(0, FLAP.indexOf(ch)), flips = ch === ' ' ? 0 : 6 + ((i * 7 + r * 3) % 9), from = (tgt - flips + FLAP.length) % FLAP.length;
          const start = 0.6 + i * 0.05 + r * 0.35, prog = clamp((t - start) / 0.075, 0, flips), idx = Math.floor(prog), frac = prog - idx;
          const cur = FLAP[(from + idx) % FLAP.length], next = FLAP[(from + idx + 1) % FLAP.length], x = x0 + i * (cw + 2);
          const done = prog >= flips;
          const half = (chr, which, sy = 1) => { c.save(); c.beginPath(); c.rect(x, which ? y + rh / 2 : y, cw, rh / 2); c.clip(); if (sy !== 1) { c.translate(0, y + rh / 2); c.scale(1, sy); c.translate(0, -(y + rh / 2)); } c.fillStyle = '#1c1c22'; c.fillRect(x, y, cw, rh); c.fillStyle = '#f4ecd8'; c.font = SS.font(700, rh * 0.78, SS.SANS); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(chr, x + cw / 2, y + rh / 2 + 1); c.restore(); };
          if (done || prog === 0) { half(done ? FLAP[tgt] : cur, 0); half(done ? FLAP[tgt] : cur, 1); }
          else { half(next, 0); half(cur, 1); if (frac < 0.5) half(cur, 0, Math.cos(frac * Math.PI)); else half(next, 1, -Math.cos(frac * Math.PI)); }
          c.fillStyle = '#050507'; c.fillRect(x, y + rh / 2 - 0.5, cw, 1);
        }
      });
      c.restore();
    },
  });

  SS.idea({
    zone: 'out', cat: 'bigpot', title: 'Chip Skyline',
    desc: 'A night skyline rises behind the table, one tower for each denomination in the pot, each crowned with its chip; their windows come on one by one.',
    drives: 'The pot, broken into its real chips.',
    back(X) {
      const { c, G, H, t } = X, e = env(t, 0.3, 0.9, 5.8, 7.0); if (e <= 0) return;
      const chips = SS.chipsOf(H.pot, 6), n = chips.length * 2, w = G.W / (n + 1);
      c.save(); c.globalAlpha = e;
      for (let i = 0; i < n; i++) {
        const ch = chips[i < chips.length ? chips.length - 1 - i : i - chips.length], grow = outCubic(sm(0.4 + i * 0.08, 1.6 + i * 0.08, t)), hgt = G.H * (0.3 + 0.32 * ((i * 37) % 7) / 7) * grow, x = (i + 0.5) * w + (i >= chips.length ? w : 0) - w * 0.1, y = G.H - hgt;
        c.fillStyle = '#121219'; c.fillRect(x, y, w * 0.82, hgt);
        c.fillStyle = ch.col; c.globalAlpha = e * 0.18; c.fillRect(x, y, w * 0.82, hgt); c.globalAlpha = e;
        for (let r = 0; r < hgt / (G.H * 0.03) - 1; r++) for (let k = 0; k < 3; k++) { const on = sm(1.2 + ((i * 13 + r * 7 + k * 3) % 23) / 9, 1.5 + ((i * 13 + r * 7 + k * 3) % 23) / 9, t); if (on <= 0) continue; c.fillStyle = `rgba(255,222,150,${0.75 * on})`; c.fillRect(x + w * (0.12 + k * 0.24), y + G.H * 0.02 + r * G.H * 0.03, w * 0.12, G.H * 0.013); }
        const cy = y - G.H * 0.012; c.fillStyle = ch.col; c.beginPath(); c.ellipse(x + w * 0.41, cy, w * 0.32, w * 0.11, 0, 0, TAU); c.fill(); c.strokeStyle = 'rgba(255,255,255,0.8)'; c.setLineDash([w * 0.08, w * 0.1]); c.beginPath(); c.ellipse(x + w * 0.41, cy, w * 0.26, w * 0.08, 0, 0, TAU); c.stroke(); c.setLineDash([]);
        c.fillStyle = 'rgba(255,246,230,0.8)'; c.font = SS.font(700, G.H * 0.024, SS.SANS); c.textAlign = 'center'; c.fillText(ch.v >= 1000 ? ch.v / 1000 + 'K' : String(ch.v), x + w * 0.41, cy - G.H * 0.03);
      }
      const haze = c.createLinearGradient(0, G.H * 0.6, 0, G.H); haze.addColorStop(0, 'rgba(60,40,90,0)'); haze.addColorStop(1, 'rgba(60,40,90,0.35)'); c.fillStyle = haze; c.fillRect(0, G.H * 0.6, G.W, G.H * 0.4);
      c.restore();
    },
  });

  SS.idea({
    zone: 'out', cat: 'wheel', title: 'Lanterns',
    desc: 'Five paper lanterns, each painted with a card of the wheel, are let go from below the table and rise past it on the warm air, swaying, glowing steadily.',
    drives: 'The wheel’s five cards.',
    back(X) {
      const { c, G, H, t } = X, e = 1 - sm(6.4, 7.2, t); if (e <= 0) return;
      H.up.forEach((cd, k) => {
        const tau = t - 0.2 - k * 0.3; if (tau <= 0) return;
        const depth = [0.85, 1.1, 0.95, 1.15, 0.9][k], x = G.W * [0.12, 0.3, 0.5, 0.7, 0.88][k] + Math.sin(tau * 1.1 + k) * G.W * 0.02 + (SS.noise(tau * 0.5, k * 7) - 0.5) * G.W * 0.03, yEnd = G.H * [0.1, 0.07, 0.12, 0.06, 0.11][k], y = yEnd + (G.H * 1.12 - yEnd) * Math.exp(-tau * 0.8 * depth), s = G.H * 0.075 * depth;
        if (y < -s * 2) return;
        c.save(); c.globalAlpha = e * sm(0, 0.3, tau); c.globalCompositeOperation = 'lighter'; SS.glow(c, x, y, s * 2.2, [255, 170, 80], 0.32); c.globalCompositeOperation = 'source-over';
        c.translate(x, y); c.rotate(Math.sin(tau * 1.3 + k) * 0.06);
        const g = c.createLinearGradient(-s * 0.4, 0, s * 0.4, 0); g.addColorStop(0, '#e98a35'); g.addColorStop(0.5, '#ffd79a'); g.addColorStop(1, '#e98a35');
        c.fillStyle = g; c.beginPath(); c.moveTo(-s * 0.3, -s * 0.5); c.lineTo(s * 0.3, -s * 0.5); c.quadraticCurveTo(s * 0.48, 0, s * 0.34, s * 0.5); c.lineTo(-s * 0.34, s * 0.5); c.quadraticCurveTo(-s * 0.48, 0, -s * 0.3, -s * 0.5); c.fill();
        c.strokeStyle = 'rgba(150,70,20,0.35)'; c.lineWidth = 0.7; for (let j = -1; j <= 1; j++) { c.beginPath(); c.moveTo(j * s * 0.15, -s * 0.5); c.quadraticCurveTo(j * s * 0.24, 0, j * s * 0.17, s * 0.5); c.stroke(); }
        c.fillStyle = '#5a1a10'; c.fillRect(-s * 0.3, -s * 0.56, s * 0.6, s * 0.07); c.fillRect(-s * 0.34, s * 0.5, s * 0.68, s * 0.06);
        c.fillStyle = '#8a1a12'; c.font = SS.font(700, s * 0.34, SS.SERIF); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(cd.r === 14 ? 'A' : SS.RLABEL[cd.r], 0, -s * 0.1);
        SS.suit(c, cd.s, 0, s * 0.2, s * 0.2, 0, cd.s === 'h' || cd.s === 'd' ? '#8a1a12' : '#3a1a10', 1);
        c.restore();
      });
    },
  });

  SS.idea({
    zone: 'out', cat: 'cooler', title: 'Frost on the Glass',
    desc: 'Frost grows across the corners of the screen in branching crystals, and the full house that lost is etched into it, cold, above the table. Then it melts.',
    drives: 'The loser’s hand.',
    top(X) {
      const { c, G, H, t, S } = X, e = env(t, 0.3, 0.8, 5.6, 7.0); if (e <= 0) return;
      if (!S.frost || S.frost.W !== G.W) {
        const R = SS.rng(5), segs = [];
        const grow = (x, y, a, len, d, t0) => { const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len; segs.push({ x, y, x2, y2, d, t0 }); if (d >= 4) return; const kids = 2 + (R() < 0.5 ? 1 : 0); for (let k = 0; k < kids; k++) { const f = 0.35 + R() * 0.55; grow(x + (x2 - x) * f, y + (y2 - y) * f, a + (R() < 0.5 ? -1 : 1) * (0.45 + R() * 0.5), len * (0.45 + R() * 0.2), d + 1, t0 + 0.25 + f * 0.3); } };
        [[0, 0, Math.PI / 4], [G.W, 0, Math.PI * 0.75], [0, G.H, -Math.PI / 4], [G.W, G.H, -Math.PI * 0.75]].forEach(([x, y, a]) => { for (let k = 0; k < 4; k++) grow(x, y, a + (k - 1.5) * 0.32, G.H * (0.22 + R() * 0.1), 0, 0.5 + R() * 0.3); });
        S.frost = { W: G.W, segs };
      }
      c.save(); c.lineCap = 'round';
      [[0, 0], [G.W, 0], [0, G.H], [G.W, G.H]].forEach(([x, y]) => { const g = c.createRadialGradient(x, y, 0, x, y, G.H * 0.45); g.addColorStop(0, `rgba(220,240,255,${0.14 * e * sm(0.5, 2, t)})`); g.addColorStop(1, 'rgba(220,240,255,0)'); c.fillStyle = g; c.fillRect(0, 0, G.W, G.H); });
      for (const s of S.frost.segs) { const p = sm(s.t0, s.t0 + 0.35, t); if (p <= 0) continue; const x2 = lerp(s.x, s.x2, p), y2 = lerp(s.y, s.y2, p); c.strokeStyle = `rgba(225,243,255,${0.18 * e})`; c.lineWidth = 3.2 - s.d * 0.5; c.beginPath(); c.moveTo(s.x, s.y); c.lineTo(x2, y2); c.stroke(); c.strokeStyle = `rgba(240,250,255,${0.6 * e})`; c.lineWidth = Math.max(0.5, 1.2 - s.d * 0.2); c.stroke(); }
      const tp = sm(2.4, 3.2, t); if (tp > 0) { c.globalAlpha = e * tp; c.font = SS.font('italic 400', G.H * 0.05, SS.SERIF); c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineWidth = 2.5; c.strokeStyle = 'rgba(200,230,255,0.25)'; c.strokeText(H.oppName, G.cx, (G.cy - G.th) / 2); c.fillStyle = 'rgba(235,247,255,0.75)'; c.fillText(H.oppName, G.cx, (G.cy - G.th) / 2); }
      c.restore();
    },
  });

  SS.idea({
    zone: 'out', cat: 'suckout', title: 'Meteor River',
    desc: 'The river card falls through the room as a meteor and strikes the far rail in a spreading glow; around it, a fainter streak for every other out burns out before it reaches the table.',
    drives: 'The river card and how many outs there were.',
    back(X) {
      const { c, G, H, t } = X, e = 1 - sm(6.2, 7.2, t); if (e <= 0) return;
      const end = SS.railPt(G, 0.5), sx = -G.W * 0.05, sy = -G.H * 0.05;
      c.save(); c.globalCompositeOperation = 'lighter';
      for (let k = 0; k < H.outs.length - 1; k++) { const R = SS.rng(k + 3), t0 = 0.5 + R() * 1.4, age = t - t0; if (age < 0 || age > 0.7) continue; const x0 = G.W * (0.1 + R() * 0.9), y0 = -G.H * 0.05, ang = Math.PI * (0.62 + R() * 0.14), len = G.H * 0.28, p = age / 0.7, hx = x0 + Math.cos(ang) * len * p, hy = y0 + Math.sin(ang) * len * p * 1.4;
        const g = c.createLinearGradient(hx - Math.cos(ang) * G.H * 0.1, hy - Math.sin(ang) * G.H * 0.14, hx, hy); g.addColorStop(0, 'rgba(255,230,190,0)'); g.addColorStop(1, `rgba(255,230,190,${0.6 * (1 - p) * e})`); c.strokeStyle = g; c.lineWidth = 1.2; c.beginPath(); c.moveTo(hx - Math.cos(ang) * G.H * 0.1, hy - Math.sin(ang) * G.H * 0.14); c.lineTo(hx, hy); c.stroke(); }
      const p = sm(1.0, 2.1, t) ** 1.6, hx = lerp(sx, end.x, p), hy = lerp(sy, end.y, p), ang = Math.atan2(end.y - sy, end.x - sx);
      if (p > 0 && p < 1) { const g = c.createLinearGradient(hx - Math.cos(ang) * G.H * 0.4, hy - Math.sin(ang) * G.H * 0.4, hx, hy); g.addColorStop(0, 'rgba(255,215,120,0)'); g.addColorStop(1, `rgba(255,225,150,${0.85 * e})`); c.strokeStyle = g; c.lineWidth = 4; c.beginPath(); c.moveTo(hx - Math.cos(ang) * G.H * 0.4, hy - Math.sin(ang) * G.H * 0.4); c.lineTo(hx, hy); c.stroke(); SS.glow(c, hx, hy, G.H * 0.07, [255, 220, 140], 0.8 * e); }
      c.restore();
      if (p > 0 && p < 0.97) { const w = G.cw * 0.55; c.save(); c.translate(hx, hy); c.rotate(ang - Math.PI / 2); SS.card(c, -w / 2, -w * 0.7, w, w * 1.4, H.river, e); c.restore(); }
      const lp = sm(2.3, 2.8, t); if (lp > 0) { c.save(); c.globalAlpha = lp * e; c.fillStyle = '#ffd76a'; c.font = SS.font('italic 400', G.H * 0.04, SS.SERIF); c.textAlign = 'right'; c.textBaseline = 'middle'; c.fillText('1 of ' + H.outs.length + ' outs', G.W * 0.97, (G.cy - G.th) * 0.45); c.restore(); }
    },
    rail(X) { const { c, G, t } = X, a = sm(2.05, 2.2, t) * (1 - sm(2.6, 4.6, t)), spread = 0.03 + 0.16 * sm(2.05, 3.6, t); if (a <= 0) return; for (let k = 0; k < 24; k++) { const s = 0.5 + (k / 23 - 0.5) * 2 * spread; SS.railStroke(c, G, s, s + spread / 11, G.rw * 0.8, `rgba(255,215,130,${0.6 * a * (1 - Math.abs(k / 23 - 0.5) * 2)})`, 1); } },
  });

  SS.idea({
    zone: 'out', cat: 'doubleup', title: 'The Scale',
    desc: 'A brass balance hangs above the table, the caller’s covering stack outweighing the hero’s. The pot drops into the hero’s pan and the beam swings over, overshoots and settles the other way.',
    drives: 'Both stacks before and after the all-in.',
    back(X) {
      const { c, G, H, t } = X, e = env(t, 0.3, 0.8, 5.8, 7.0); if (e <= 0) return;
      const px = G.cx, py = G.H * 0.045, len = G.W * 0.2, th = 0.13 - 0.26 * clamp(spring(t - 2.1, 0.55, 0.3), 0, 1.4), hang = (G.cy - G.th) * 0.5;
      c.save(); c.globalAlpha = e; c.strokeStyle = '#c9a13f'; c.lineWidth = 2; c.beginPath(); c.moveTo(px, 0); c.lineTo(px, py); c.stroke();
      c.save(); c.translate(px, py); c.rotate(th); const g = c.createLinearGradient(0, -3, 0, 3); g.addColorStop(0, '#f6dd8c'); g.addColorStop(1, '#8a6418'); c.fillStyle = g; c.fillRect(-len, -2.5, 2 * len, 5); c.restore();
      c.fillStyle = '#e8c25a'; c.beginPath(); c.arc(px, py, 4, 0, TAU); c.fill();
      const theirs = H.oppStack + H.before, mine = t < 2.1 ? H.before : H.before * 2;
      [[-1, mine, 'Hero'], [1, theirs, SS.NAMES[H.loser]]].forEach(([side, amount, who], k) => {
        const ex = px + Math.cos(th) * len * side, ey = py + Math.sin(th) * len * side, panY = ey + hang;
        c.strokeStyle = 'rgba(232,194,90,0.7)'; c.lineWidth = 0.8; c.beginPath(); c.moveTo(ex, ey); c.lineTo(ex - G.W * 0.04, panY); c.moveTo(ex, ey); c.lineTo(ex + G.W * 0.04, panY); c.stroke();
        c.fillStyle = '#b98f2f'; c.beginPath(); c.ellipse(ex, panY, G.W * 0.045, G.H * 0.012, 0, 0, Math.PI); c.fill();
        const stacks = SS.chipsOf(amount, 4); stacks.forEach((st, j) => { const n = Math.min(st.n, 8), sx = ex + (j - (stacks.length - 1) / 2) * G.W * 0.02; for (let m = 0; m < n; m++) { const drop = k === 0 && t >= 2.1 && amount > H.before ? sm(2.1 + (j * 8 + m) * 0.02, 2.25 + (j * 8 + m) * 0.02, t) : 1; c.globalAlpha = e * drop; c.fillStyle = st.col; c.beginPath(); c.ellipse(sx, panY - 2 - m * 2.2 - (1 - drop) * 10, G.W * 0.009, G.W * 0.0035, 0, 0, TAU); c.fill(); } }); c.globalAlpha = e;
        c.fillStyle = 'rgba(255,246,230,0.85)'; c.font = SS.font(600, G.H * 0.026, SS.SANS); c.textAlign = 'center'; c.fillText(who + ' ' + SS.fmt(amount), ex + side * G.W * 0.1, panY - G.H * 0.01);
      });
      c.restore();
    },
  });

  SS.idea({
    zone: 'out', cat: 'boat', title: 'Full House Marquee',
    desc: 'A theatre marquee hangs over the table. Its bulbs come on one after another and stay lit, the letter tiles turn to spell FULL HOUSE, and the hand that filled it sits underneath in gold.',
    drives: 'The full house, by name.',
    back(X) {
      const { c, G, H, t } = X, e = env(t, 0.3, 0.8, 5.8, 7.0); if (e <= 0) return;
      const w = G.W * 0.56, h = (G.cy - G.th) - G.H * 0.05, x = G.cx - w / 2, y = G.H * 0.02;
      c.save(); c.globalAlpha = e; c.fillStyle = '#1a0e14'; c.beginPath(); c.roundRect(x, y, w, h, 6); c.fill(); c.strokeStyle = '#8a6418'; c.lineWidth = 2; c.stroke();
      const per = 2 * (w + h), n = Math.floor(per / 9);
      for (let i = 0; i < n; i++) { let d = i / n * per, bx, by; if (d < w) { bx = x + d; by = y + 4; } else if ((d -= w) < h) { bx = x + w - 4; by = y + d; } else if ((d -= h) < w) { bx = x + w - d; by = y + h - 4; } else { d -= w; bx = x + 4; by = y + h - d; }
        const on = sm(0.5 + (i / n) * 2.0, 0.7 + (i / n) * 2.0, t); c.fillStyle = `rgba(255,${Math.round(lerp(120, 236, on))},${Math.round(lerp(80, 180, on))},${0.25 + 0.75 * on})`; c.beginPath(); c.arc(bx, by, 1.8, 0, TAU); c.fill(); if (on > 0) { c.globalCompositeOperation = 'lighter'; SS.glow(c, bx, by, 5, [255, 200, 120], 0.35 * on); c.globalCompositeOperation = 'source-over'; } }
      const word = 'FULL HOUSE', tw = h * 0.36, tx = G.cx - (word.length * (tw * 0.74)) / 2;
      [...word].forEach((ch, i) => { const p = sm(1.2 + i * 0.1, 1.5 + i * 0.1, t); if (p <= 0 || ch === ' ') return; const cx2 = tx + i * tw * 0.74 + tw * 0.37; c.save(); c.translate(cx2, y + h * 0.36); c.scale(Math.sin(p * Math.PI / 2), 1); c.fillStyle = '#f6ecd6'; c.fillRect(-tw * 0.33, -tw * 0.44, tw * 0.66, tw * 0.88); c.fillStyle = '#20141a'; c.font = SS.font(900, tw * 0.66, SS.SANS); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(ch, 0, 1); c.restore(); });
      const np = sm(2.6, 3.2, t); if (np > 0) { c.globalAlpha = e * np; c.fillStyle = '#ffd76a'; c.font = SS.font('italic 400', h * 0.2, SS.SERIF); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(H.name, G.cx, y + h * 0.76); }
      c.restore();
      [-1, 1].forEach((d) => { const cw = G.W * 0.075, cx = d < 0 ? 0 : G.W - cw; c.save(); c.globalAlpha = e; for (let k = 0; k < 6; k++) { const g = c.createLinearGradient(cx + k * cw / 6, 0, cx + (k + 1) * cw / 6, 0); g.addColorStop(0, '#5c0a1a'); g.addColorStop(0.5, '#a3192e'); g.addColorStop(1, '#5c0a1a'); c.fillStyle = g; c.fillRect(cx + k * cw / 6, 0, cw / 6 + 0.5, G.H); } c.fillStyle = '#c99a35'; c.fillRect(d < 0 ? cw - 2 : cx, 0, 2, G.H); c.restore(); });
    },
  });

  SS.idea({
    zone: 'out', cat: 'any', title: 'Trophy Cabinet',
    desc: 'A glass cabinet above the table keeps a trophy for every special hand this session. The new one is set on the shelf in gold, engraved with the hand and the pot.',
    drives: 'The hand’s name and the pot.',
    back(X) {
      const { c, G, H, t } = X, e = env(t, 0.3, 0.8, 5.8, 7.0); if (e <= 0) return;
      const w = G.W * 0.66, h = (G.cy - G.th) - G.H * 0.04, x = G.cx - w / 2, y = G.H * 0.015;
      c.save(); c.globalAlpha = e; c.fillStyle = '#2a1a10'; c.fillRect(x - 4, y - 3, w + 8, h + 6); c.fillStyle = '#14121a'; c.fillRect(x, y, w, h); c.fillStyle = '#4a3020'; c.fillRect(x, y + h * 0.82, w, 3);
      const cup = (cx, cy, s, gold, a) => { c.save(); c.globalAlpha = e * a; c.translate(cx, cy); c.scale(s, s); const g = c.createLinearGradient(-10, 0, 10, 0); if (gold) { g.addColorStop(0, '#8a6418'); g.addColorStop(0.45, '#fbe39a'); g.addColorStop(1, '#8a6418'); } else { g.addColorStop(0, '#5a5f6a'); g.addColorStop(0.45, '#d8dce6'); g.addColorStop(1, '#5a5f6a'); } c.fillStyle = g; c.beginPath(); c.moveTo(-10, -22); c.lineTo(10, -22); c.quadraticCurveTo(10, -6, 2, -2); c.lineTo(2, 4); c.lineTo(7, 8); c.lineTo(-7, 8); c.lineTo(-2, 4); c.lineTo(-2, -2); c.quadraticCurveTo(-10, -6, -10, -22); c.fill(); c.strokeStyle = g; c.lineWidth = 2; c.beginPath(); c.arc(-11, -15, 5, Math.PI * 0.5, Math.PI * 1.5); c.stroke(); c.beginPath(); c.arc(11, -15, 5, -Math.PI * 0.5, Math.PI * 0.5); c.stroke(); c.restore(); };
      const base = y + h * 0.82, s0 = h / 40;
      for (let i = 0; i < 4; i++) cup(x + w * (0.1 + i * 0.13), base - 8 * s0, s0 * 0.9, false, 0.65);
      const p = sm(1.0, 1.6, t), sc = s0 * 1.05 * (0.6 + 0.4 * outBack(p)), nx = x + w * 0.7;
      if (p > 0) { c.save(); c.globalCompositeOperation = 'lighter'; SS.glow(c, nx, base - 16 * s0, h * 0.5, [255, 210, 110], 0.3 * e * p); c.restore(); cup(nx, base - 8 * s0, sc, true, p); }
      const tp = sm(1.8, 2.4, t); if (tp > 0) { c.globalAlpha = e * tp; c.fillStyle = '#ffd76a'; c.font = SS.font('italic 400', h * 0.16, SS.SERIF); c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText(H.name, nx + h * 0.32, base - h * 0.42); c.fillStyle = 'rgba(255,246,230,0.75)'; c.font = SS.font(600, h * 0.11, SS.SANS); c.fillText('+' + SS.fmt(H.pot) + ' · 5th this session', nx + h * 0.32, base - h * 0.2); }
      c.globalAlpha = e * 0.07; c.fillStyle = '#fff'; c.beginPath(); c.moveTo(x + w * 0.2, y); c.lineTo(x + w * 0.28, y); c.lineTo(x + w * 0.16, y + h); c.lineTo(x + w * 0.08, y + h); c.fill(); c.beginPath(); c.moveTo(x + w * 0.62, y); c.lineTo(x + w * 0.65, y); c.lineTo(x + w * 0.53, y + h); c.lineTo(x + w * 0.5, y + h); c.fill();
      c.restore();
    },
  });
})();

/* The felt: 16 ideas on the cloth inside the rail, drawn under the cloth's own light and under every piece. */
(function () {
  const SS = window.SS, { TAU, clamp, lerp, sm, env, outCubic, inOut, outBack, spring } = SS;
  const boardTop = (L) => L.boardBox.y;
  const sorted = (H, L) => H.use.map((u) => ({ u, r: u.from === 'board' ? L.board[u.i] : L.hero.cards[u.i] }))
    .sort((a, b) => (a.u.from === b.u.from ? a.u.i - b.u.i : a.u.from === 'board' ? -1 : 1));
  function metaball(S, key, G, sources, paint) {
    const sc = 4, w = Math.ceil(G.W / sc), h = Math.ceil(G.H / sc);
    let M = S[key];
    if (!M || M.w !== w || M.h !== h) { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const x = cv.getContext('2d'); M = S[key] = { cv, x, img: x.createImageData(w, h), w, h, sc }; }
    const d = M.img.data, src = sources.map((s) => ({ x: s.x / sc, y: s.y / sc, r2: (s.r / sc) ** 2 })).filter((s) => s.r2 > 0.05);
    for (let y = 0, k = 0; y < h; y++) for (let x = 0; x < w; x++, k += 4) {
      let f = 0; for (const s of src) { const dx = x - s.x, dy = y - s.y; f += s.r2 / (dx * dx + dy * dy + 1); }
      const px = paint(f); d[k] = px[0]; d[k + 1] = px[1]; d[k + 2] = px[2]; d[k + 3] = px[3];
    }
    M.x.putImageData(M.img, 0, 0);
    return M.cv;
  }
  const NONE = [0, 0, 0, 0];

  SS.idea({
    zone: 'felt', cat: 'flush', title: 'Suit Tide',
    desc: 'The flush’s colour wells up under each of the five cards that make it, in the order they came, and the pools run together into one tide that drains toward the hero.',
    drives: 'The five cards that play, the order they came, their suit.',
    felt(X) {
      const { c, G, H, L, t, S } = X, e = env(t, 0.5, 1.1, 5.4, 6.8); if (e <= 0) return;
      const hc = L.heroCards, drift = sm(3.2, 5.6, t) * 0.6, [R, Gc, B] = SS.SUITRGB[H.suit];
      const srcs = sorted(H, L).map((o, k) => { const p = SS.centre(o.r), g = outCubic((t - 0.7 - k * 0.32) / 1.3); return { x: lerp(p.x, hc.x, drift), y: lerp(p.y, hc.y, drift), r: G.ch * 0.95 * g * (1 - 0.55 * sm(4.6, 6.4, t)) }; });
      const cv = metaball(S, 'tide', G, srcs, (f) => {
        if (f < 0.85) return NONE;
        const edge = clamp((f - 0.85) / 0.3, 0, 1), rim = 1 - clamp((f - 1.05) / 0.7, 0, 1), wh = rim * 0.45;
        return [R + (255 - R) * wh, Gc + (255 - Gc) * wh, B + (255 - B) * wh, 255 * edge * (0.22 + 0.32 * rim)];
      });
      c.save(); c.globalAlpha = e; c.imageSmoothingEnabled = true; c.drawImage(cv, 0, 0, G.W, G.H); c.restore();
    },
  });

  SS.idea({
    zone: 'felt', cat: 'straight', title: 'Rank Dial',
    desc: 'A dial of the thirteen ranks surfaces round the board. The run lights rank by rank, low to high, joined by one gold arc, and the dial names the top card.',
    drives: 'The straight’s ranks: a wheel wraps through the ace, Broadway ends on it.',
    felt(X) {
      const { c, G, H, L, t } = X, e = env(t, 0.4, 1.0, 5.8, 7.0); if (e <= 0) return;
      const b = L.boardBox, rx = G.fw * 0.8, ry = G.fh * 0.82, pos = (k) => { const a = -Math.PI / 2 + k * TAU / 13; return { x: b.cx + Math.cos(a) * rx, y: b.cy + Math.sin(a) * ry, a }; };
      const idx = (r) => (r === 14 ? 0 : r - 1);
      let seq = H.up.map((cd) => idx(cd.r)); for (let i = 1; i < 5; i++) while (seq[i] < seq[i - 1]) seq[i] += 13;
      if (H.hi === 5) seq = [0, 1, 2, 3, 4];
      c.save(); c.globalAlpha = e;
      c.strokeStyle = 'rgba(255,246,230,0.12)'; c.lineWidth = 1; c.beginPath(); c.ellipse(b.cx, b.cy, rx, ry, 0, 0, TAU); c.stroke();
      for (let k = 0; k < 13; k++) { const p = pos(k), q = pos(k + 0.5); c.strokeStyle = 'rgba(255,246,230,0.16)'; c.beginPath(); c.moveTo(lerp(q.x, b.cx, 0.02), lerp(q.y, b.cy, 0.02)); c.lineTo(lerp(q.x, b.cx, -0.02), lerp(q.y, b.cy, -0.02)); c.stroke(); }
      const prog = sm(0.9, 3.1, t) * 4;
      c.globalCompositeOperation = 'lighter';
      const N = 80, a0 = seq[0], a1 = seq[0] + (seq[4] - seq[0]) * (prog / 4);
      for (let i = 0; i < N; i++) { const k0 = lerp(a0, a1, i / N), k1 = lerp(a0, a1, (i + 1) / N), p = pos(k0), q = pos(k1); c.strokeStyle = `rgba(255,205,90,${0.55})`; c.lineWidth = lerp(1.2, 3.6, i / N); c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(q.x, q.y); c.stroke(); }
      c.globalCompositeOperation = 'source-over';
      const lit = new Map(); seq.forEach((k, i) => lit.set(((k % 13) + 13) % 13, i));
      for (let k = 0; k < 13; k++) {
        const p = pos(k), label = k === 0 ? 'A' : SS.RLABEL[k + 1], i = lit.get(k), on = i == null ? 0 : sm(i - 0.05, i + 0.35, prog);
        if (on > 0) { c.globalCompositeOperation = 'lighter'; SS.glow(c, p.x, p.y, G.H * 0.05, [255, 200, 90], 0.45 * on); c.globalCompositeOperation = 'source-over'; }
        c.fillStyle = on > 0 ? `rgba(255,${Math.round(lerp(246, 215, on))},${Math.round(lerp(230, 90, on))},${0.3 + 0.7 * on})` : 'rgba(255,246,230,0.28)';
        c.font = SS.font(on > 0.5 ? 700 : 400, G.H * (0.036 + 0.014 * on), SS.SERIF); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(label, p.x, p.y);
      }
      const top = pos(seq[4]), sa = sm(3.1, 3.7, t);
      if (sa > 0) { c.globalAlpha = e * sa; c.fillStyle = '#ffd76a'; c.font = SS.font('italic 400', G.H * 0.034, SS.SERIF); c.textAlign = top.x > b.cx ? 'left' : 'right'; c.fillText(H.hi === 5 ? 'Five-high' : SS.RWORD[H.hi] + '-high', top.x + (top.x > b.cx ? 1 : -1) * G.H * 0.045, top.y); }
      c.restore();
    },
  });

  SS.idea({
    zone: 'felt', cat: 'quads', title: 'Pressed Rank',
    desc: 'The rank of the four is pressed into the cloth like a die stamp, found by a raking light that crosses the felt, then one pip in each suit’s colour sets at its corners.',
    drives: 'The quads’ rank, and its kicker.',
    felt(X) {
      const { c, G, H, L, t, S, dpr } = X, e = env(t, 0.4, 1.0, 5.6, 7.0); if (e <= 0) return;
      const rank = SS.RLABEL[H.tb[0]], size = G.fh * 1.3, side = H.loser === 1 || H.loser === 2 ? -1 : 1, x0 = G.cx + side * G.fw * 0.62, y0 = G.cy + G.fh * 0.06, key = rank + G.W + side;
      if (!S.press || S.press.key !== key) {
        const { cv, c: p } = SS.canvas(G.W, G.H, dpr);
        p.font = SS.font(700, size, SS.SERIF); p.textAlign = 'center'; p.textBaseline = 'middle';
        p.fillStyle = 'rgba(0,0,0,0.6)'; p.fillText(rank, x0 + 2, y0 + 3);
        p.fillStyle = 'rgba(255,238,210,0.55)'; p.fillText(rank, x0 - 1.5, y0 - 2);
        p.globalCompositeOperation = 'destination-out'; p.fillStyle = '#000'; p.fillText(rank, x0, y0);
        p.globalCompositeOperation = 'source-over'; p.fillStyle = 'rgba(25,15,45,0.22)'; p.fillText(rank, x0, y0);
        S.press = { key, cv, w: p.measureText(rank).width };
      }
      const sweep = lerp(G.cx - G.fw, G.cx + G.fw + 60, sm(0.8, 3.0, t));
      c.save(); c.globalAlpha = e; c.beginPath(); c.rect(0, 0, sweep, G.H); c.clip(); c.drawImage(S.press.cv, 0, 0, G.W, G.H); c.restore();
      if (t < 3.2) { c.save(); c.globalAlpha = e * 0.9; c.globalCompositeOperation = 'lighter'; c.beginPath(); c.rect(sweep - 70, 0, 70, G.H); c.clip(); c.drawImage(S.press.cv, 0, 0, G.W, G.H); c.restore(); }
      const hw = S.press.w * 0.5 + G.H * 0.04, hh = size * 0.34;
      [['s', -1, -1], ['h', 1, -1], ['d', -1, 1], ['c', 1, 1]].forEach(([s, dx, dy], i) => {
        const p = sm(2.6 + i * 0.22, 3.0 + i * 0.22, t); if (p <= 0) return;
        SS.suit(c, s, x0 + dx * hw, y0 + dy * hh, G.H * 0.07 * (0.7 + 0.3 * outBack(p)), 0, SS.SUITCOL[s], 0.75 * e * p);
      });
      const kp = sm(3.6, 4.2, t); if (kp > 0) { c.save(); c.globalAlpha = e * kp * 0.7; c.fillStyle = SS.INK; c.font = SS.font('italic 400', G.H * 0.032, SS.SERIF); c.textAlign = 'center'; c.fillText('with a ' + SS.RWORD[H.tb[1]], x0, y0 + hh + G.H * 0.05); c.restore(); }
    },
  });

  SS.idea({
    zone: 'felt', cat: 'boat', title: 'The Full House',
    desc: 'A blueprint draws itself on the open side of the cloth, line by line: a house of three storeys, one for each card of the three of a kind, under a roof of two rafters for the pair, every part labelled with its card.',
    drives: 'The trips and the pair, card by card, and which side of the table is free.',
    felt(X) {
      const { c, G, H, L, t } = X, e = env(t, 0.4, 0.9, 5.8, 7.0); if (e <= 0) return;
      const trips = H.five.filter((cd) => cd.r === H.tb[0]), pair = H.five.filter((cd) => cd.r === H.tb[1]);
      const right = !(H.loser === 1 || H.loser === 2), inner = right ? L.boardBox.x + L.boardBox.w + G.cw * 0.4 : L.boardBox.x - G.cw * 0.4, outer = right ? G.cx + G.fw - G.fh * 0.42 : G.cx - G.fw + G.fh * 0.42;
      const midX = (inner + outer) / 2, top = G.cy - G.fh * 0.8, floor = G.cy + G.fh * 0.5, tall = floor - top, hw = Math.min(Math.abs(outer - inner) * 0.78, tall * 0.5);
      const roofH = tall * 0.3, storey = (tall - roofH) / 3, x0 = midX - hw / 2, x1 = midX + hw / 2, eaves = floor - 3 * storey, ridge = eaves - roofH;
      const segs = [[x0 - hw * 0.15, floor, x1 + hw * 0.15, floor], [x0, floor, x0, eaves], [x1, floor, x1, eaves]];
      for (let k = 1; k <= 3; k++) segs.push([x0, floor - k * storey, x1, floor - k * storey]);
      segs.push([x0 - hw * 0.12, eaves, midX, ridge], [midX, ridge, x1 + hw * 0.12, eaves]);
      for (let k = 0; k < 3; k++) { const fy = floor - (k + 1) * storey, wx = x1 - hw * 0.36, wy = fy + storey * 0.25, ww = hw * 0.22, wh = storey * 0.42; if (k === 0) { segs.push([x1 - hw * 0.4, floor, x1 - hw * 0.4, floor - storey * 0.7], [x1 - hw * 0.4, floor - storey * 0.7, x1 - hw * 0.16, floor - storey * 0.7], [x1 - hw * 0.16, floor - storey * 0.7, x1 - hw * 0.16, floor]); continue; } segs.push([wx, wy, wx + ww, wy], [wx + ww, wy, wx + ww, wy + wh], [wx + ww, wy + wh, wx, wy + wh], [wx, wy + wh, wx, wy], [wx + ww / 2, wy, wx + ww / 2, wy + wh]); }
      const dimX = right ? x0 - hw * 0.28 : x1 + hw * 0.28; segs.push([dimX, floor, dimX, eaves], [dimX, eaves, dimX, ridge]);
      const lens = segs.map((s) => Math.hypot(s[2] - s[0], s[3] - s[1])), total = lens.reduce((a, b) => a + b, 0);
      let left = total * sm(0.6, 3.3, t);
      c.save(); c.globalAlpha = e; c.strokeStyle = 'rgba(169,220,255,0.85)'; c.lineCap = 'round';
      segs.forEach((s, i) => { if (left <= 0) return; const f = Math.min(1, left / lens[i]); left -= lens[i]; c.lineWidth = i >= segs.length - 2 ? 0.7 : 1.3; c.beginPath(); c.moveTo(s[0], s[1]); c.lineTo(lerp(s[0], s[2], f), lerp(s[1], s[3], f)); c.stroke(); });
      const tick = sm(3.0, 3.3, t); if (tick > 0) { c.globalAlpha = e * tick; [floor, eaves, ridge].forEach((y) => { c.beginPath(); c.moveTo(dimX - 3, y); c.lineTo(dimX + 3, y); c.stroke(); }); }
      const lab = (txt, x, y, at, sz, align = 'center', font = 600) => { const p = sm(at, at + 0.4, t); if (p <= 0) return; c.globalAlpha = e * p; c.fillStyle = 'rgba(205,236,255,0.95)'; c.font = SS.font(font, sz, SS.SANS); c.textAlign = align; c.textBaseline = 'middle'; c.fillText(txt, x, y); };
      trips.forEach((cd, k) => { const y = floor - (k + 0.5) * storey, x = x0 + hw * 0.2, at = 1.4 + k * 0.3; lab(SS.RLABEL[cd.r], x, y, at, storey * 0.5, 'center', 700); SS.suit(c, cd.s, x + storey * 0.42, y, storey * 0.38, 0, SS.SUITCOL[cd.s], e * sm(at, at + 0.4, t)); });
      pair.forEach((cd, k) => { const x = lerp(k ? x1 : x0, midX, 0.42) + (k ? 1 : -1) * hw * 0.12, y = lerp(eaves, ridge, 0.5) - storey * 0.15, at = 2.4 + k * 0.3; lab(SS.RLABEL[cd.r], x - storey * 0.16, y, at, storey * 0.42, 'center', 700); SS.suit(c, cd.s, x + storey * 0.2, y, storey * 0.32, 0, SS.SUITCOL[cd.s], e * sm(at, at + 0.4, t)); });
      const sideAlign = right ? 'right' : 'left', dx = right ? -4 : 4;
      lab('3 × ' + SS.RWORD[H.tb[0]], dimX + dx, (floor + eaves) / 2, 3.1, G.H * 0.026, sideAlign);
      lab('2 × ' + SS.RWORD[H.tb[1]], dimX + dx, (eaves + ridge) / 2, 3.2, G.H * 0.026, sideAlign);
      lab(H.name.toUpperCase(), midX, floor + G.H * 0.04, 3.5, G.H * 0.024, 'center', 700);
      c.restore();
    },
  });

  SS.idea({
    zone: 'felt', cat: 'royal', title: 'Royal Procession',
    desc: 'Five gilt shields rise over the board in rank order, ten to ace, each bearing its card; a red ribbon unfurls beneath them and a crown draws itself above the ace.',
    drives: 'The suit of the royal and its five cards.',
    felt(X) {
      const { c, G, H, L, t } = X, e = env(t, 0.4, 0.9, 5.8, 7.0); if (e <= 0) return;
      const sw = G.cw * 0.78, sh = sw * 1.18, base = boardTop(L) - G.H * 0.05;
      const shield = (x, y) => { c.beginPath(); c.moveTo(x - sw / 2, y - sh / 2); c.lineTo(x + sw / 2, y - sh / 2); c.lineTo(x + sw / 2, y); c.quadraticCurveTo(x + sw / 2, y + sh * 0.38, x, y + sh / 2); c.quadraticCurveTo(x - sw / 2, y + sh * 0.38, x - sw / 2, y); c.closePath(); };
      const rp = sm(2.2, 3.2, t), ry = base + G.H * 0.012, rwid = sw * 5.6 * rp;
      if (rp > 0) { c.save(); c.globalAlpha = e; c.fillStyle = '#8f1730'; c.beginPath(); c.rect(G.cx - rwid / 2, ry - G.H * 0.018, rwid, G.H * 0.036); c.fill(); c.fillStyle = '#5e0d1f'; [-1, 1].forEach((d) => { const x = G.cx + d * rwid / 2; c.beginPath(); c.moveTo(x, ry - G.H * 0.018); c.lineTo(x + d * G.H * 0.03, ry - G.H * 0.018); c.lineTo(x + d * G.H * 0.018, ry); c.lineTo(x + d * G.H * 0.03, ry + G.H * 0.018); c.lineTo(x, ry + G.H * 0.018); c.fill(); });
        c.globalAlpha = e * sm(2.9, 3.4, t); c.fillStyle = '#f3d27a'; c.font = SS.font(700, G.H * 0.022, SS.SERIF); c.textAlign = 'center'; c.textBaseline = 'middle'; c.letterSpacing = '0.18em'; c.fillText('ROYAL FLUSH', G.cx, ry + 0.5); c.restore(); }
      H.up.forEach((cd, k) => {
        const x = G.cx + (k - 2) * sw * 1.18, y = base - sh / 2 - G.H * 0.02 - (2 - Math.abs(k - 2)) * G.H * 0.012, t0 = 0.8 + k * 0.28;
        const draw = sm(t0, t0 + 0.5, t), fill = sm(t0 + 0.35, t0 + 0.8, t); if (draw <= 0) return;
        c.save(); c.globalAlpha = e;
        if (fill > 0) { shield(x, y); const g = c.createLinearGradient(x - sw / 2, y - sh / 2, x + sw / 2, y + sh / 2); g.addColorStop(0, '#f6dd8c'); g.addColorStop(0.45, '#c99a35'); g.addColorStop(0.7, '#f3d27a'); g.addColorStop(1, '#8a6418'); c.fillStyle = g; c.globalAlpha = e * fill; c.fill(); c.globalAlpha = e; }
        shield(x, y); c.strokeStyle = '#ffe9a8'; c.lineWidth = 1.4; const per = sw * 2 + sh * 2.2; c.setLineDash([per * draw, per]); c.stroke(); c.setLineDash([]);
        c.globalAlpha = e * fill; c.fillStyle = '#3a2808'; c.font = SS.font(700, sh * 0.36, SS.SERIF); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(SS.RLABEL[cd.r], x, y - sh * 0.1);
        SS.suit(c, cd.s, x, y + sh * 0.22, sh * 0.22, 0, cd.s === 's' || cd.s === 'c' ? '#2a2208' : '#9e1b2a', e * fill);
        c.restore();
        if (k === 4) { const cp = sm(3.3, 4.0, t); if (cp > 0) { const cy2 = y - sh / 2 - G.H * 0.012, cw2 = sw * 0.8, chh = G.H * 0.04; const pts = [[-1, 0], [-1, -0.7], [-0.5, -0.3], [0, -1], [0.5, -0.3], [1, -0.7], [1, 0]].map(([a, b]) => [x + a * cw2 / 2, cy2 + b * chh]);
          c.save(); c.globalAlpha = e; c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.closePath(); c.fillStyle = `rgba(243,210,122,${cp})`; c.fill(); c.strokeStyle = '#ffe9a8'; c.lineWidth = 1; c.stroke(); c.restore(); } }
      });
    },
  });

  SS.idea({
    zone: 'felt', cat: 'sf', title: 'Refraction',
    desc: 'A beam of white light crosses the cloth to a prism beside the board and splits into five coloured bands, one landing under each card of the straight flush, violet on the lowest, red on the highest.',
    drives: 'Where each of the five cards sits, and their order by rank.',
    felt(X) {
      const { c, G, H, L, t } = X, e = env(t, 0.4, 0.8, 5.6, 7.0); if (e <= 0) return;
      const px = L.boardBox.x - G.cw * 0.95, py = L.boardBox.cy + G.ch * 0.25, sx = G.cx - G.fw + 4, sy = py - G.H * 0.07;
      c.save(); c.globalCompositeOperation = 'lighter';
      const pa = sm(0.4, 0.9, t); c.globalAlpha = e * pa; c.strokeStyle = 'rgba(255,255,255,0.55)'; c.lineWidth = 1; c.beginPath(); c.moveTo(px - G.H * 0.03, py + G.H * 0.03); c.lineTo(px + G.H * 0.03, py + G.H * 0.03); c.lineTo(px, py - G.H * 0.04); c.closePath(); c.stroke(); c.fillStyle = 'rgba(200,220,255,0.12)'; c.fill();
      const bp = sm(0.8, 1.5, t), bx = lerp(sx, px, bp), by = lerp(sy, py, bp);
      c.globalAlpha = e; const bg = c.createLinearGradient(sx, sy, px, py); bg.addColorStop(0, 'rgba(255,255,255,0)'); bg.addColorStop(1, 'rgba(255,255,255,0.65)'); c.strokeStyle = bg; c.lineWidth = 2.2; c.beginPath(); c.moveTo(sx, sy); c.lineTo(bx, by); c.stroke();
      const hues = [275, 222, 150, 52, 2];
      H.up.forEach((cd, k) => {
        const r = L.rectOf(cd); if (!r) return; const tgt = SS.centre(r), p = sm(1.5 + k * 0.22, 2.2 + k * 0.22, t); if (p <= 0) return;
        const ex = lerp(px, tgt.x, p), ey = lerp(py, tgt.y, p), ang = Math.atan2(ey - py, ex - px), wid = G.cw * 0.42 * p, nx = -Math.sin(ang), ny = Math.cos(ang);
        const g = c.createLinearGradient(px, py, ex, ey); g.addColorStop(0, `hsla(${hues[k]},95%,62%,0.05)`); g.addColorStop(0.5, `hsla(${hues[k]},95%,62%,0.32)`); g.addColorStop(1, `hsla(${hues[k]},95%,62%,0.18)`);
        c.fillStyle = g; c.beginPath(); c.moveTo(px + nx, py + ny); c.lineTo(ex + nx * wid, ey + ny * wid); c.lineTo(ex - nx * wid, ey - ny * wid); c.lineTo(px - nx, py - ny); c.closePath(); c.fill();
        if (p >= 1) { SS.glow(c, tgt.x, tgt.y, G.cw * 0.95, hsl(hues[k]), 0.32 * sm(2.2 + k * 0.22, 2.7 + k * 0.22, t)); for (let m = 0; m < 5; m++) { const u = (t * 0.16 + m / 5 + k * 0.13) % 1; c.fillStyle = `hsla(${hues[k]},100%,85%,${0.7 * Math.sin(Math.PI * u)})`; c.beginPath(); c.arc(lerp(px, tgt.x, u) + nx * wid * u * Math.sin(m * 3.1) * 0.6, lerp(py, tgt.y, u) + ny * wid * u * Math.sin(m * 3.1) * 0.6, 1.2, 0, TAU); c.fill(); } }
      });
      c.restore();
    },
  });
  function hsl(h) { const f = (n) => { const k = (n + h / 30) % 12; return 255 * (0.62 - 0.95 * 0.38 * Math.max(-1, Math.min(k - 3, 9 - k, 1))); }; return [f(0) | 0, f(8) | 0, f(4) | 0]; }

  SS.idea({
    zone: 'felt', cat: 'cooler', title: 'Interference',
    desc: 'Waves spread across the cloth from both full houses at once and cross in a moiré. The loser’s waves die away first; only the hero’s are still running when the cloth goes still.',
    drives: 'Where the hero and the loser sit.',
    felt(X) {
      const { c, G, L, t } = X, ein = sm(0.5, 1.2, t);
      if (ein <= 0) return;
      const lam = G.H * 0.045, v = G.fw * 0.42, rmax = G.fw * 1.5;
      const src = [{ p: L.heroCards, rgb: [255, 214, 120], amp: 0.24 * ein * (1 - sm(5.4, 6.8, t)) }, { p: L.loserCards, rgb: [150, 200, 255], amp: 0.22 * ein * (1 - sm(2.4, 3.8, t)) }];
      c.save(); c.globalCompositeOperation = 'lighter'; c.lineWidth = lam * 0.32;
      for (const s of src) { if (s.amp <= 0.003) continue; for (let k = 0; k < 18; k++) { const r = (t - 0.5) * v - k * lam; if (r <= 0 || r > rmax) continue; const a = s.amp * Math.pow(1 - r / rmax, 1.3) * sm(0, lam * 1.5, r); c.strokeStyle = `rgba(${s.rgb[0]},${s.rgb[1]},${s.rgb[2]},${a})`; c.beginPath(); c.arc(s.p.x, s.p.y, r, 0, TAU); c.stroke(); } }
      c.restore();
    },
  });

  SS.idea({
    zone: 'felt', cat: 'suckout', title: 'Equity Sweep',
    desc: 'A ring round the board shows the hero’s chance on the turn as a short red arc. The river card warms, and the arc sweeps the rest of the way to gold while the figure counts up to 100%.',
    drives: 'The hero’s real equity on the turn, worked out from the outs.',
    felt(X) {
      const { c, G, H, L, t } = X, e = env(t, 0.4, 0.9, 5.8, 7.0); if (e <= 0) return;
      const b = L.boardBox, rx = b.w / 2 + G.cw * 0.5, ry = G.ch * 1.02, a0 = -Math.PI / 2;
      const grow = sm(0.6, 1.3, t) * H.eq, fin = outCubic((t - 2.0) / 1.5), frac = t < 2 ? grow : lerp(H.eq, 1, clamp(fin, 0, 1)), warm = clamp(fin, 0, 1);
      c.save(); c.globalAlpha = e; c.strokeStyle = 'rgba(255,255,255,0.08)'; c.lineWidth = 3; c.beginPath(); c.ellipse(b.cx, b.cy, rx, ry, 0, 0, TAU); c.stroke();
      c.strokeStyle = `rgb(${Math.round(lerp(201, 255, warm))},${Math.round(lerp(120, 205, warm))},${Math.round(lerp(120, 90, warm))})`; c.lineWidth = 3.5; c.lineCap = 'round';
      if (frac > 0) { c.beginPath(); c.ellipse(b.cx, b.cy, rx, ry, 0, a0, a0 + TAU * frac); c.stroke(); }
      const rv = L.board[4], hp = sm(1.5, 2.1, t); c.globalCompositeOperation = 'lighter'; SS.glow(c, rv.x + rv.w / 2, rv.y + rv.h / 2, G.cw * 1.1, [255, 210, 110], 0.5 * hp); c.globalCompositeOperation = 'source-over';
      const ty = b.cy + G.ch * 0.92, pct = Math.round(100 * frac), t1 = 1 - sm(1.9, 2.3, t), t2 = sm(2.0, 2.4, t);
      c.textAlign = 'center'; c.textBaseline = 'middle';
      if (t1 > 0) { c.globalAlpha = e * t1 * sm(0.7, 1.1, t); c.fillStyle = 'rgba(255,220,220,0.85)'; c.font = SS.font(600, G.H * 0.03, SS.SANS); c.fillText(H.outs.length + ' outs · ' + Math.round(H.eq * 100) + '% on the turn', b.cx, ty); }
      if (t2 > 0) { c.globalAlpha = e * t2; c.fillStyle = '#ffd76a'; c.font = SS.font(700, G.H * 0.05, SS.SERIF); c.fillText(pct + '%', b.cx, ty); }
      c.restore();
    },
  });

  SS.idea({
    zone: 'felt', cat: 'suckout', title: 'The Rest of the Deck',
    desc: 'Every card the hero could not see on the turn is laid out in miniature. The outs light in gold, the rest fall away, and the one that came on the river is ringed.',
    drives: 'The unseen cards and the outs, counted from the hand.',
    felt(X) {
      const { c, G, H, L, t } = X, e = env(t, 0.4, 0.9, 5.8, 7.0); if (e <= 0) return;
      const list = H.unseen.slice().sort((a, b) => ('shdc'.indexOf(a[1]) - 'shdc'.indexOf(b[1])) || ('23456789TJQKA'.indexOf(a[0]) - '23456789TJQKA'.indexOf(b[0])));
      const per = Math.ceil(list.length / 2), w = Math.min(G.cw * 0.36, (G.fw * 1.72) / per - 2), h = w * 1.36, gap = 2, x0 = G.cx - (per * (w + gap) - gap) / 2, y0 = boardTop(L) - G.H * 0.035 - 2 * h - gap;
      const outs = new Set(H.outs);
      list.forEach((k, i) => {
        const col = i % per, row = Math.floor(i / per), x = x0 + col * (w + gap), y = y0 + row * (h + gap), cd = SS.cards(k)[0];
        const appear = sm(0.5 + col * 0.03, 0.9 + col * 0.03, t), isOut = outs.has(k), pick = sm(1.6 + col * 0.03, 2.1 + col * 0.03, t);
        const a = appear * (isOut ? lerp(0.55, 1, pick) : lerp(0.55, 0.18, pick));
        c.save(); c.globalAlpha = e * a; c.fillStyle = SS.FACE[cd.s]; c.beginPath(); c.roundRect(x, y, w, h, w * 0.14); c.fill();
        c.fillStyle = '#fff'; c.font = SS.font(800, w * 0.62, SS.SANS); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(SS.RLABEL[cd.r], x + w / 2, y + h * 0.5);
        if (isOut) { c.strokeStyle = `rgba(255,215,90,${pick})`; c.lineWidth = 1.4; c.stroke(); }
        c.restore();
        if (k === H.river.k) { const rp = sm(2.8, 3.3, t); if (rp > 0) { c.save(); c.globalAlpha = e * rp; c.strokeStyle = '#ffd76a'; c.lineWidth = 1.6; c.beginPath(); c.ellipse(x + w / 2, y + h / 2, w * 1.05, h * 0.82, 0, 0, TAU); c.stroke(); c.fillStyle = '#ffd76a'; c.font = SS.font('italic 400', G.H * 0.03, SS.SERIF); c.textAlign = 'center'; c.fillText('the river', x + w / 2, row ? y + h * 1.75 : y - h * 0.55); c.restore(); } }
      });
      const tp = sm(2.0, 2.5, t); if (tp > 0) { c.save(); c.globalAlpha = e * tp; c.fillStyle = 'rgba(255,246,230,0.85)'; c.font = SS.font(600, G.H * 0.028, SS.SANS); c.textAlign = 'center'; c.fillText(H.outs.length + ' outs in ' + H.unseen.length, G.cx, y0 - G.H * 0.03); c.restore(); }
    },
  });

  SS.idea({
    zone: 'felt', cat: 'bigpot', title: 'Gravity Well',
    desc: 'The cloth’s nap drifts like a slow current until the pot lands; then every thread of it bends toward the hero, as deep as the pot is big in big blinds.',
    drives: 'The pot’s size in big blinds sets the pull.',
    felt(X) {
      const { c, G, H, L, t, S } = X, e = env(t, 0.3, 0.9, 5.8, 7.0); if (e <= 0) return;
      const N = 280, well = { x: L.heroCards.x, y: L.heroCards.y - G.ch * 0.2 };
      if (!S.gw || t < S.gw.last || S.gw.W !== G.W) { const R = SS.rng(7); S.gw = { W: G.W, last: t, ps: Array.from({ length: N }, () => { const p = { x: G.cx + (R() * 2 - 1) * G.fw, y: G.cy + (R() * 2 - 1) * G.fh, age: R() * 2, tr: [] }; return p; }), R }; }
      const dt = clamp(t - S.gw.last, 0, 1 / 30); S.gw.last = t;
      const pull = sm(1.0, 2.6, t) * (1 - sm(5.0, 6.2, t)), depth = 0.55 + 0.45 * clamp(Math.log10(H.bbs) / 2.4, 0, 1);
      c.save(); c.globalCompositeOperation = 'lighter'; c.lineWidth = 1;
      for (const p of S.gw.ps) {
        const th = SS.fbm(p.x * 0.006, p.y * 0.006 + t * 0.08) * TAU * 2, dx = well.x - p.x, dy = well.y - p.y, d = Math.hypot(dx, dy) || 1;
        const vf = G.H * 0.05, vg = pull * depth * G.H * 0.9 * Math.min(2.4, G.H * 0.35 / d);
        p.x += (Math.cos(th) * vf + dx / d * vg) * dt; p.y += (Math.sin(th) * vf + dy / d * vg) * dt; p.age += dt;
        p.tr.push(p.x, p.y); if (p.tr.length > 14) p.tr.splice(0, 2);
        if (d < G.H * 0.03 || Math.abs(p.x - G.cx) > G.fw || Math.abs(p.y - G.cy) > G.fh) { p.x = G.cx + (S.gw.R() * 2 - 1) * G.fw; p.y = G.cy + (S.gw.R() * 2 - 1) * G.fh; p.age = 0; p.tr = []; continue; }
        if (p.tr.length < 4) continue;
        c.strokeStyle = `rgba(255,214,130,${0.32 * e * sm(0, 0.5, p.age)})`; c.beginPath(); c.moveTo(p.tr[0], p.tr[1]); for (let k = 2; k < p.tr.length; k += 2) c.lineTo(p.tr[k], p.tr[k + 1]); c.stroke();
      }
      c.globalCompositeOperation = 'source-over';
      for (let k = 1; k <= 4; k++) { c.strokeStyle = `rgba(255,214,130,${0.12 * pull * e})`; c.beginPath(); c.ellipse(well.x, well.y, G.H * 0.05 * k * depth, G.H * 0.03 * k * depth, 0, 0, TAU); c.stroke(); }
      const lp = sm(2.4, 3.0, t); if (lp > 0) { c.globalAlpha = e * lp; c.fillStyle = '#ffd76a'; c.font = SS.font('italic 400', G.H * 0.036, SS.SERIF); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(H.bbs + ' big blinds', well.x, L.boardBox.y + G.ch + G.H * 0.045); }
      c.restore();
    },
  });

  SS.idea({
    zone: 'felt', cat: 'doubleup', title: 'Twin Suns',
    desc: 'The hero’s stack rises as a small sun on the cloth. The caller’s matching sun crosses the felt from their seat, the two merge into one twice the size, and the count doubles beside it.',
    drives: 'The stack before and after, and where the caller sat.',
    felt(X) {
      const { c, G, H, L, t, S } = X, e = env(t, 0.4, 0.9, 5.8, 7.0); if (e <= 0) return;
      const home = { x: G.cx + G.fw * 0.42, y: G.cy + G.fh * 0.25 }, r0 = G.fh * 0.13 * clamp(Math.sqrt(H.before / 24000), 0.7, 1.4);
      const from = L.loserCards, p = inOut((t - 1.0) / 1.6), bx = lerp(from.x, home.x, p), by = lerp(from.y, home.y, p) - Math.sin(Math.PI * clamp(p, 0, 1)) * G.fh * 0.3;
      const merged = sm(2.6, 3.4, t), rA = r0 * (1 + (Math.SQRT2 - 1) * merged), rB = r0 * sm(0.9, 1.3, t) * (1 - merged);
      const cv = metaball(S, 'suns', G, [{ x: home.x, y: home.y, r: rA * sm(0.4, 0.9, t) }, { x: bx, y: by, r: rB }], (f) => { if (f < 0.8) return NONE; const a = clamp((f - 0.8) / 0.4, 0, 1), core = clamp((f - 1.2) / 2.5, 0, 1); return [255, lerp(196, 240, core), lerp(80, 190, core), 255 * a * 0.62]; });
      c.save(); c.globalAlpha = e; c.drawImage(cv, 0, 0, G.W, G.H); c.globalCompositeOperation = 'lighter'; SS.glow(c, home.x, home.y, rA * 2.6, [255, 190, 80], 0.25 * e); if (rB > 1) SS.glow(c, bx, by, rB * 2.4, [255, 190, 80], 0.2 * e); c.globalCompositeOperation = 'source-over';
      const val = lerp(H.before, H.before * 2, sm(2.6, 3.6, t)); c.fillStyle = '#ffd76a'; c.font = SS.font(700, G.H * 0.045, SS.SERIF); c.textAlign = 'right'; c.textBaseline = 'middle'; c.globalAlpha = e * sm(0.6, 1.0, t); c.fillText(SS.fmt(val), home.x - rA * 1.6, home.y);
      c.restore();
    },
  });

  SS.idea({
    zone: 'felt', cat: 'wheel', title: 'Gearwork',
    desc: 'Five brass gears, A to 5, mesh above the board. The ace turns the train, each gear at its own ratio, and the works slow, overshoot and lock with a glint.',
    drives: 'The wheel’s five cards and their suits.',
    felt(X) {
      const { c, G, H, L, t } = X, e = env(t, 0.4, 0.9, 5.8, 7.0); if (e <= 0) return;
      const R = G.H * 0.05, sizes = [1.0, 0.72, 0.9, 0.66, 0.84].map((k) => k * R), y = boardTop(L) - G.H * 0.1, pitch = G.H * 0.0068;
      const xs = []; let span = 0; sizes.forEach((r, i) => { if (i) span += (sizes[i - 1] + r) * 0.93; xs.push(span); });
      const x0 = G.cx - span / 2, master = TAU * 1.25 * spring(t - 0.7, 0.32, 0.62), angles = [master];
      for (let i = 1; i < 5; i++) { const n = Math.round(sizes[i] / pitch); angles.push(-angles[i - 1] * sizes[i - 1] / sizes[i] + Math.PI / n); }
      sizes.forEach((r, i) => {
        const n = Math.round(r / pitch), x = x0 + xs[i], a = angles[i], appear = sm(0.4 + i * 0.12, 0.9 + i * 0.12, t); if (appear <= 0) return;
        const path = new Path2D();
        for (let j = 0; j < n; j++) { const b = a + j * TAU / n, w = TAU / n; [[0, 0.86], [0.18, 0.86], [0.3, 1], [0.7, 1], [0.82, 0.86], [1, 0.86]].forEach(([u, rr], k) => { const ang = b + u * w, px = x + Math.cos(ang) * r * rr, py = y + Math.sin(ang) * r * rr; if (!j && !k) path.moveTo(px, py); else path.lineTo(px, py); }); }
        path.closePath();
        for (let k = 0; k < 3; k++) { const ang = a + k * TAU / 3; const hx = x + Math.cos(ang) * r * 0.5, hy = y + Math.sin(ang) * r * 0.5; path.moveTo(hx + r * 0.17, hy); path.arc(hx, hy, r * 0.17, 0, TAU); }
        c.save(); c.globalAlpha = e * appear;
        c.save(); c.translate(2, 3); c.fillStyle = 'rgba(0,0,0,0.35)'; c.fill(path, 'evenodd'); c.restore();
        const g = c.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r); g.addColorStop(0, '#fbe39a'); g.addColorStop(0.6, '#c99a35'); g.addColorStop(1, '#7a5512');
        c.fillStyle = g; c.fill(path, 'evenodd'); c.strokeStyle = '#5a3c0c'; c.lineWidth = 0.8; c.stroke(path);
        c.fillStyle = '#4a3208'; c.beginPath(); c.arc(x, y, r * 0.2, 0, TAU); c.fill();
        const cd = H.up[i]; c.fillStyle = '#fff2c8'; c.font = SS.font(700, r * 0.42, SS.SERIF); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(cd.r === 14 ? 'A' : SS.RLABEL[cd.r], x, y - r * 0.02);
        c.restore();
        SS.suit(c, cd.s, x, y + r * 1.28, r * 0.42, 0, SS.SUITCOL[cd.s], e * appear * 0.9);
      });
      const gl = sm(3.8, 4.8, t) * (1 - sm(4.8, 5.4, t)); if (gl > 0) { c.save(); c.globalCompositeOperation = 'lighter'; const gx = lerp(x0 - R, x0 + span + R, sm(3.8, 4.8, t)); const g2 = c.createLinearGradient(gx - 30, 0, gx + 30, 0); g2.addColorStop(0, 'rgba(255,240,200,0)'); g2.addColorStop(0.5, `rgba(255,240,200,${0.4 * e})`); g2.addColorStop(1, 'rgba(255,240,200,0)'); c.fillStyle = g2; c.fillRect(gx - 30, y - R * 1.2, 60, R * 2.4); c.restore(); }
    },
  });

  SS.idea({
    zone: 'felt', cat: 'scoop', title: 'Yin and Yang',
    desc: 'The cloth divides into the high half and the low half, each carrying the hand that won it. The divide turns like a yin-yang, and both halves become the hero’s gold.',
    drives: 'The high hand and the low hand the hero made.',
    felt(X) {
      const { c, G, H, L, t, S, dpr } = X, e = env(t, 0.4, 0.9, 5.8, 7.0); if (e <= 0) return;
      if (!S.yy || S.yy.W !== G.W) S.yy = { W: G.W, ...SS.canvas(G.W, G.H, dpr) };
      const o = S.yy.c, R = G.fw * 1.25, th = Math.PI * inOut(sm(1.1, 3.0, t)), gold = sm(2.8, 3.8, t);
      o.setTransform(dpr, 0, 0, dpr, 0, 0); o.clearRect(0, 0, G.W, G.H); o.fillStyle = 'rgb(155,106,216)'; o.fillRect(0, 0, G.W, G.H);
      o.save(); o.translate(G.cx, G.cy); o.scale(1, G.fh / G.fw); o.rotate(th);
      o.beginPath(); o.moveTo(0, -R); o.arc(0, 0, R, -Math.PI / 2, Math.PI / 2, false); o.arc(0, R / 2, R / 2, Math.PI / 2, Math.PI * 1.5, false); o.arc(0, -R / 2, R / 2, Math.PI / 2, -Math.PI / 2, true); o.closePath();
      o.fillStyle = 'rgb(47,179,198)'; o.fill(); o.restore();
      c.save(); c.globalAlpha = e * 0.3 * (1 - gold); c.drawImage(S.yy.cv, 0, 0, G.W, G.H); c.globalAlpha = e * 0.3 * gold; c.fillStyle = 'rgb(255,200,90)'; c.fillRect(0, 0, G.W, G.H);
      const tf = sm(0.9, 1.4, t) * (1 - sm(2.6, 3.2, t)); c.globalAlpha = e * tf; c.font = SS.font(700, G.H * 0.03, SS.SANS); c.textBaseline = 'middle'; c.letterSpacing = '0.08em';
      c.fillStyle = '#9ee9f4'; c.textAlign = 'left'; c.fillText('HIGH · ' + H.hiName.toUpperCase(), G.cx - G.fw * 0.86, G.cy - G.fh * 0.6);
      c.fillStyle = '#d9c2ff'; c.textAlign = 'right'; c.fillText('LOW · ' + H.loName, G.cx + G.fw * 0.86, G.cy + G.fh * 0.2);
      const sp = sm(3.4, 4.1, t); if (sp > 0) { c.globalAlpha = e * sp; c.fillStyle = '#ffd76a'; c.font = SS.font(700, G.H * 0.05, SS.SERIF); c.letterSpacing = (0.1 + 0.35 * (1 - sp)) + 'em'; c.textAlign = 'center'; c.fillText('SCOOP', G.cx, boardTop(L) - G.H * 0.07); }
      c.restore();
    },
  });

  SS.idea({
    zone: 'felt', cat: 'any', title: 'Brushed Name',
    desc: 'The winning hand’s name is written across the cloth in one long italic stroke, the ink feathering into the nap, and a red seal with the hero’s initial is pressed beside it.',
    drives: 'The hand’s own name.',
    felt(X) {
      const { c, G, H, L, t, S, dpr } = X, e = env(t, 0.4, 0.8, 5.8, 7.0); if (e <= 0) return;
      const size = G.H * 0.08, y = boardTop(L) - G.H * 0.085, key = H.name + G.W;
      if (!S.brush || S.brush.key !== key) { const T = SS.canvas(G.W, G.H, dpr); T.c.font = SS.font('italic 400', size, SS.SERIF); T.c.textAlign = 'center'; T.c.textBaseline = 'middle'; T.c.fillStyle = '#f3e9d6'; T.c.fillText(H.name, G.cx, y); S.brush = { key, cv: T.cv, w: T.c.measureText(H.name).width, tmp: SS.canvas(G.W, G.H, dpr) }; }
      const B = S.brush, x0 = G.cx - B.w / 2, feather = G.H * 0.12, xr = lerp(x0, x0 + B.w + feather, sm(0.7, 2.9, t)), m = B.tmp.c;
      m.setTransform(dpr, 0, 0, dpr, 0, 0); m.globalCompositeOperation = 'source-over'; m.clearRect(0, 0, G.W, G.H); m.drawImage(B.cv, 0, 0, G.W, G.H);
      m.globalCompositeOperation = 'destination-in'; const g = m.createLinearGradient(xr - feather, 0, xr, 0); g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)'); m.fillStyle = g; m.fillRect(0, 0, G.W, G.H);
      const bleed = lerp(0.4, 1.6, sm(1, 4, t));
      c.save(); c.globalAlpha = e * 0.12; for (let k = 0; k < 6; k++) { const a = k * TAU / 6; c.drawImage(B.tmp.cv, Math.cos(a) * bleed, Math.sin(a) * bleed, G.W, G.H); }
      c.globalAlpha = e * 0.9; c.drawImage(B.tmp.cv, 0, 0, G.W, G.H);
      const sp = sm(3.0, 3.4, t); if (sp > 0) { const sx = x0 + B.w + G.H * 0.06, s = G.H * 0.06 * (1.3 - 0.3 * outBack(sp)); c.globalAlpha = e * sp * 0.88; c.translate(sx, y); c.rotate(-0.1); c.fillStyle = '#b3262e'; c.beginPath(); c.roundRect(-s / 2, -s / 2, s, s, s * 0.12); c.fill(); c.fillStyle = '#f7e6d8'; c.font = SS.font(700, s * 0.62, SS.SERIF); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('H', 0, s * 0.04); }
      c.restore();
    },
  });

  SS.idea({
    zone: 'felt', cat: 'sf', title: 'Mandala',
    desc: 'Rings of the five cards’ suits open round the board one by one, each ring sized by its card’s rank, turning slowly against its neighbours.',
    drives: 'The five cards’ suits and ranks.',
    felt(X) {
      const { c, G, H, L, t } = X, e = env(t, 0.4, 0.9, 5.6, 7.0); if (e <= 0) return;
      const b = L.boardBox;
      c.save(); c.globalCompositeOperation = 'lighter';
      H.up.forEach((cd, k) => {
        const p = sm(0.7 + k * 0.32, 1.4 + k * 0.32, t); if (p <= 0) return;
        const R = (b.w * 0.5 + k * G.H * 0.058) * (0.9 + 0.1 * p), n = 10 + k * 2, rot = (k % 2 ? -1 : 1) * t * 0.14 + k * 0.3, size = G.H * (0.028 + 0.012 * (cd.r - 2) / 12);
        c.strokeStyle = `rgba(255,246,230,${0.08 * e * p})`; c.lineWidth = 0.8; c.beginPath(); c.ellipse(b.cx, b.cy, R, R * 0.74, 0, 0, TAU); c.stroke();
        for (let j = 0; j < n; j++) { const a = rot + j * TAU / n; SS.suit(c, cd.s, b.cx + Math.cos(a) * R, b.cy + Math.sin(a) * R * 0.74, size, a + Math.PI / 2, SS.SUITCOL[cd.s], 0.34 * e * p); }
      });
      c.restore();
    },
  });

  SS.idea({
    zone: 'felt', cat: 'flush', title: 'Jacquard',
    desc: 'The cloth re-weaves itself row by row, like a loom, in the flush’s colour, and the pattern of over and under threads draws the suit across the whole felt.',
    drives: 'The flush suit.',
    felt(X) {
      const { c, G, H, t, S } = X, e = env(t, 0.4, 0.8, 5.8, 7.0); if (e <= 0) return;
      const key = H.suit + G.W;
      if (!S.jac || S.jac.key !== key) {
        const mw = Math.ceil(G.fw * 2 / 3), mh = Math.ceil(G.fh * 2 / 3), cv = document.createElement('canvas'); cv.width = mw; cv.height = mh; const x = cv.getContext('2d');
        const sz = Math.min(mw, mh) * 0.95; x.translate(mw / 2 - sz / 2, mh / 2 - sz / 2); x.scale(sz / 100, sz / 100); x.fill(SS.SUIT[H.suit]);
        S.jac = { key, mw, mh, data: x.getImageData(0, 0, mw, mh).data };
      }
      const J = S.jac, rows = J.mh, [R, Gc, B] = SS.SUITRGB[H.suit], done = sm(0.5, 3.4, t) * rows, x0 = G.cx - G.fw, y0 = G.cy - G.fh;
      c.save(); c.globalAlpha = e;
      for (let i = 0; i < rows && i < done; i++) {
        const frac = Math.min(1, done - i), xs = Math.floor(J.mw * frac);
        for (let j = 0; j < xs; j += 2) {
          const inG = J.data[(i * J.mw + j) * 4 + 3] > 128; let over = ((i + (j >> 1)) & 1) === 0; if (inG) over = !over;
          c.fillStyle = inG ? (over ? `rgba(${R},${Gc},${B},0.62)` : `rgba(${R},${Gc},${B},0.24)`) : (over ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.15)');
          c.fillRect(x0 + j * 3, y0 + i * 3 + 0.5, 5.4, 2);
        }
        if (frac < 1) { c.fillStyle = 'rgba(255,230,160,0.9)'; c.beginPath(); c.ellipse(x0 + xs * 3, y0 + i * 3 + 1.5, 6, 1.6, 0, 0, TAU); c.fill(); }
      }
      c.restore();
    },
  });
})();

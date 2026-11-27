/* The rail: 12 ideas on the padded rail around the cloth. They pass under the seats' plaques, as the rail does. */
(function () {
  const SS = window.SS, { TAU, clamp, lerp, sm, env, outCubic, inOut, outBack, spring } = SS;
  const gapS = (k) => (k + 0.5) / SS.SEATS;
  const onRail = (c, G, s, fn) => { const p = SS.railPt(G, s), a = SS.railAng(G, s); c.save(); c.translate(p.x, p.y); c.rotate(a); fn(); c.restore(); };
  /* An angle that keeps text upright along the rail. */
  const upright = (a) => { a = ((a + Math.PI) % TAU + TAU) % TAU - Math.PI; return a > Math.PI / 2 ? a - Math.PI : a < -Math.PI / 2 ? a + Math.PI : a; };
  const label = (c, G, s, text, font, col) => { const p = SS.railPt(G, s), a = upright(SS.railAng(G, s)); c.save(); c.translate(p.x, p.y); c.rotate(a); c.font = font; c.fillStyle = col; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, 0, 0.5); c.restore(); };
  function comet(c, G, head, len, width, rgb, a) {
    c.save(); c.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 30; k++) { const s = head - (k / 30) * len, q = SS.railPt(G, s); SS.glow(c, q.x, q.y, width * (1.4 - k / 30), rgb, a * (1 - k / 30)); }
    c.restore();
  }

  SS.idea({
    zone: 'rail', cat: 'straight', title: 'Marquetry',
    desc: 'A polishing light runs once round the rail and finds five wood-and-brass inlays set between the seats, one for each card of the straight, in rank order from the hero round.',
    drives: 'The straight’s five cards, by rank and suit.',
    rail(X) {
      const { c, G, H, t } = X, e = env(t, 0.3, 0.8, 5.8, 7.0); if (e <= 0) return;
      const head = sm(0.8, 3.4, t) * 1.05;
      H.up.forEach((cd, k) => {
        const s = gapS(k), p = sm(s - 0.02, s + 0.06, head); if (p <= 0) return;
        const rx = G.rw * 1.55, ry = G.rw * 0.4;
        onRail(c, G, s, () => {
          c.globalAlpha = e * p;
          c.beginPath(); c.ellipse(0, 0, rx, ry, 0, 0, TAU);
          const g = c.createLinearGradient(-rx, -ry, rx, ry); g.addColorStop(0, '#6e3f1b'); g.addColorStop(0.5, '#b97c43'); g.addColorStop(1, '#7c4a22'); c.fillStyle = g; c.fill();
          c.save(); c.clip(); c.strokeStyle = 'rgba(60,28,8,0.4)'; c.lineWidth = 0.6; for (let j = -3; j <= 3; j++) { c.beginPath(); for (let x = -rx; x <= rx; x += 2) { const y = j * ry * 0.3 + Math.sin(x * 0.25 + j) * ry * 0.12; if (x === -rx) c.moveTo(x, y); else c.lineTo(x, y); } c.stroke(); } c.restore();
          c.strokeStyle = '#e2bd62'; c.lineWidth = 1.1; c.stroke();
        });
        const a = upright(SS.railAng(G, s)), q = SS.railPt(G, s);
        c.save(); c.globalAlpha = e * p; c.translate(q.x, q.y); c.rotate(a); c.fillStyle = '#2b1606'; c.font = SS.font(700, G.rw * 0.62, SS.SERIF); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(SS.RLABEL[cd.r], -G.rw * 0.38, 0.5); c.restore();
        SS.suit(c, cd.s, q.x + Math.cos(a) * G.rw * 0.42, q.y + Math.sin(a) * G.rw * 0.42, G.rw * 0.55, a, SS.FACE[cd.s] === '#2a2c33' ? '#1d1409' : SS.FACE[cd.s], e * p);
      });
      if (head < 1.04) comet(c, G, head, 0.08, G.rw * 0.8, [255, 240, 210], 0.5 * e);
    },
  });

  SS.idea({
    zone: 'rail', cat: 'bigpot', title: 'Counter Ring',
    desc: 'The rail turns into a ring of mechanical counter drums. They spin together and settle one after another, outward from the hero, until the whole ring reads the pot in big blinds.',
    drives: 'The pot’s size in big blinds.',
    rail(X) {
      const { c, G, H, t } = X, e = env(t, 0.3, 0.8, 5.8, 7.0); if (e <= 0) return;
      const CH = ' 0123456789B·', text = (' ' + H.bbs + ' BB ·'), n = Math.floor(SS.railLen(G) / (G.rw * 0.78)), dw = G.rw * 0.62, dh = G.rw * 0.78;
      for (let i = 0; i < n; i++) {
        const s = i / n, ch = text[i % text.length], target = Math.max(0, CH.indexOf(ch)), d = SS.sdist(s, 0), delay = 0.8 + d * 4.5;
        const spin = (1 - clamp(spring(t - delay, 0.9, 0.55), 0, 1.2)) * 14, v = target + spin, i0 = Math.floor(v), f = v - i0;
        const appear = sm(0.3 + d, 0.7 + d, t);
        onRail(c, G, s, () => {
          c.globalAlpha = e * appear; c.fillStyle = '#121218'; c.fillRect(-dw / 2, -dh / 2, dw, dh);
          c.save(); c.beginPath(); c.rect(-dw / 2, -dh / 2, dw, dh); c.clip(); c.fillStyle = '#f4f1ea'; c.font = SS.font(700, dh * 0.78, '"Courier New", monospace'); c.textAlign = 'center'; c.textBaseline = 'middle';
          const a = Math.abs(SS.railAng(G, s)) > Math.PI / 2 ? -1 : 1;
          c.scale(a, a); c.fillText(CH[((i0 % CH.length) + CH.length) % CH.length], 0, (-f) * dh + 0.5); c.fillText(CH[(((i0 + 1) % CH.length) + CH.length) % CH.length], 0, (1 - f) * dh + 0.5);
          c.restore();
          const g = c.createLinearGradient(0, -dh / 2, 0, dh / 2); g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(0.3, 'rgba(0,0,0,0)'); g.addColorStop(0.7, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.55)'); c.fillStyle = g; c.fillRect(-dw / 2, -dh / 2, dw, dh);
        });
      }
    },
  });

  SS.idea({
    zone: 'rail', cat: 'cooler', title: 'Warm and Cold',
    desc: 'Gold light leaves the hero’s seat and ice-blue leaves the loser’s, both running round the rail. Where they meet the gold pushes the blue back, until only the loser’s place on the rail is left frosted.',
    drives: 'Where the hero and the loser sit.',
    rail(X) {
      const { c, G, H, t } = X, e = env(t, 0.3, 0.8, 5.8, 7.0); if (e <= 0) return;
      const sL = SS.seatS(H.loser), Rh = Math.max(0, (t - 0.8) * 0.16), between = SS.sdist(0, sL), Rl = Math.max(0, Math.min((t - 0.8) * 0.2, between * 0.55) - sm(2.6, 4.6, t) * between * 0.5);
      const N = 260;
      c.save(); c.lineCap = 'butt';
      for (let i = 0; i < N; i++) {
        const s = i / N, dh = SS.sdist(s, 0), dl = SS.sdist(s, sL);
        const hot = sm(Rh, Rh - 0.03, dh), cold = sm(Rl, Rl - 0.03, dl) * (dl < dh ? 1 : 0.15);
        if (hot <= 0.01 && cold <= 0.01) continue;
        const col = cold > hot ? `rgba(150,205,255,${0.55 * cold * e})` : `rgba(255,205,100,${0.55 * hot * e})`;
        SS.railStroke(c, G, s, s + 1 / N + 0.0005, G.rw * 0.7, col, 1);
      }
      const fr = sm(4.0, 4.8, t); if (fr > 0) { for (let k = -4; k <= 4; k++) { const s = sL + k * 0.009; onRail(c, G, s, () => { c.globalAlpha = e * fr * 0.8; c.strokeStyle = '#e2f2ff'; c.lineWidth = 0.8; for (let j = 0; j < 3; j++) { c.rotate(Math.PI / 3); c.beginPath(); c.moveTo(-G.rw * 0.32, 0); c.lineTo(G.rw * 0.32, 0); c.stroke(); } }); } }
      c.restore();
    },
  });

  SS.idea({
    zone: 'rail', cat: 'flush', title: 'Engraved Band',
    desc: 'The rail’s leather becomes a band of engraved gold. The flush suit runs all the way round it, a highlight travels one lap, and a cartouche on the far rail says how many of the suit the hero held.',
    drives: 'The flush suit and how many of it the hero saw.',
    rail(X) {
      const { c, G, H, t } = X, e = env(t, 0.3, 1.0, 5.8, 7.0); if (e <= 0) return;
      c.save(); SS.clipRing(c, G);
      const g = c.createLinearGradient(0, G.cy - G.th, 0, G.cy + G.th); g.addColorStop(0, '#f6e3a6'); g.addColorStop(0.45, '#a77d2c'); g.addColorStop(0.55, '#8a6418'); g.addColorStop(1, '#e8cf8a');
      c.globalAlpha = e * 0.92; c.fillStyle = g; c.fillRect(0, 0, G.W, G.H);
      const n = Math.floor(SS.railLen(G) / (G.rw * 1.5)), reveal = sm(0.8, 2.4, t);
      for (let i = 0; i < n; i++) { const s = i / n, a = sm(i / n - 0.05, i / n, reveal * 1.05); if (a <= 0) continue; const q = SS.railPt(G, s), ang = SS.railAng(G, s); SS.suit(c, H.suit, q.x + 0.7, q.y + 0.9, G.rw * 0.6, ang + Math.PI / 2, 'rgba(60,40,5,0.55)', e * a); SS.suit(c, H.suit, q.x - 0.4, q.y - 0.5, G.rw * 0.6, ang + Math.PI / 2, 'rgba(255,245,210,0.55)', e * a); SS.suit(c, H.suit, q.x, q.y, G.rw * 0.6, ang + Math.PI / 2, 'rgba(150,110,30,0.9)', e * a); }
      c.restore();
      const head = sm(2.6, 4.6, t) * 1.1; if (head > 0 && head < 1.1) comet(c, G, head, 0.12, G.rw * 0.9, [255, 250, 225], 0.55 * e);
      const cp = sm(3.0, 3.6, t); if (cp > 0) { const s = gapS(2); onRail(c, G, s, () => { c.globalAlpha = e * cp; c.fillStyle = '#3a2808'; c.beginPath(); c.roundRect(-G.rw * 1.9, -G.rw * 0.36, G.rw * 3.8, G.rw * 0.72, G.rw * 0.2); c.fill(); }); label(c, G, s, H.suitCount + ' ' + SS.SUITNAME[H.suit], SS.font(700, G.rw * 0.44, SS.SANS), `rgba(246,227,166,${e * cp})`); }
    },
  });

  SS.idea({
    zone: 'rail', cat: 'boat', title: 'Neon Rail',
    desc: 'The rail warms into a neon tube from the hero’s seat both ways, glass and glow, spilling light on the room and the cloth; then the hand’s name lights on the felt in the same neon, letter by letter.',
    drives: 'The hand’s name.',
    back(X) { const { c, G, t } = X, a = env(t, 1.6, 2.6, 5.8, 7.0); if (a <= 0) return; c.save(); c.shadowColor = 'rgba(255,80,170,0.75)'; c.shadowBlur = G.H * 0.08; c.strokeStyle = `rgba(255,80,170,${0.25 * a})`; c.lineWidth = G.rw; SS.pill(c, G.cx, G.cy, G.tw - G.rw / 2, G.th - G.rw / 2); c.stroke(); c.restore(); },
    rail(X) {
      const { c, G, t } = X, e = env(t, 0.3, 0.6, 5.8, 7.0); if (e <= 0) return;
      const N = 200, front = sm(0.6, 2.4, t) * 0.5;
      for (let i = 0; i < N; i++) {
        const s = i / N, d = SS.sdist(s, 0), on = sm(d, d + 0.06, front); if (on <= 0) continue;
        SS.railStroke(c, G, s, s + 1 / N + 0.001, G.rw * 0.62, `rgba(255,70,160,${0.35 * on * e})`, 1);
        SS.railStroke(c, G, s, s + 1 / N + 0.001, G.rw * 0.24, `rgba(255,200,235,${0.95 * on * e})`, 1);
      }
    },
    light(X) {
      const { c, G, H, L, t } = X, e = env(t, 2.4, 2.8, 5.8, 7.0); if (e <= 0) return;
      const txt = H.name, size = G.H * 0.085, y = L.boardBox.y - G.H * 0.08;
      c.save(); c.font = SS.font(600, size, SS.SCRIPT); const w = c.measureText(txt).width; let x = G.cx - w / 2;
      c.textBaseline = 'middle'; c.shadowColor = 'rgba(255,80,170,0.9)'; c.shadowBlur = size * 0.35;
      [...txt].forEach((ch, i) => { const on = sm(2.5 + i * 0.07, 2.75 + i * 0.07, t); c.globalAlpha = e * on; c.fillStyle = '#ffd9ee'; c.fillText(ch, x, y); x += c.measureText(ch).width; });
      c.restore();
    },
  });

  SS.idea({
    zone: 'rail', cat: 'straight', title: 'The Race',
    desc: 'The rail is a track and the straight’s five cards are the cars, numbered by rank and painted in their suits. They run one lap and cross the line at the hero’s seat in rank order, the top card first.',
    drives: 'The straight’s ranks and suits.',
    rail(X) {
      const { c, G, H, t } = X, e = env(t, 0.3, 0.7, 5.8, 7.0); if (e <= 0) return;
      const line = 0.045;
      onRail(c, G, line, () => { c.globalAlpha = e; for (let i = 0; i < 6; i++) for (let j = 0; j < 2; j++) { c.fillStyle = (i + j) % 2 ? '#111' : '#f4f1ea'; c.fillRect(-2 + j * 2, -G.rw / 2 + i * G.rw / 6, 2, G.rw / 6); } });
      H.up.forEach((cd, k) => {
        const start = line - 0.012 * (5 - k), fin = 1 + line + 0.014 * k, T = 3.7 - 0.22 * k, p = inOut(sm(0.7, T, t)), s = lerp(start, fin, p);
        const speed = (sm(0.7, T, t + 0.02) - sm(0.7, T, t)) * 50;
        for (let j = 5; j >= 0; j--) {
          const sj = s - j * 0.0045 * speed; const a = j ? 0.16 * (1 - j / 6) * speed : 1;
          onRail(c, G, sj, () => { c.globalAlpha = e * clamp(a, 0, 1); c.fillStyle = SS.FACE[cd.s] === '#2a2c33' ? '#55575f' : SS.FACE[cd.s]; c.beginPath(); c.roundRect(-G.rw * 0.75, -G.rw * 0.3, G.rw * 1.5, G.rw * 0.6, G.rw * 0.3); c.fill(); if (!j) { c.strokeStyle = 'rgba(255,255,255,0.6)'; c.lineWidth = 0.6; c.stroke(); c.fillStyle = '#fff'; c.font = SS.font(800, G.rw * 0.42, SS.SANS); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(SS.RLABEL[cd.r], 0, 0.5); } });
        }
      });
    },
  });

  SS.idea({
    zone: 'rail', cat: 'quads', title: 'Dot Matrix',
    desc: 'The rail becomes a band of amber dot-matrix lights, and the result scrolls round the table: the quads, by name, and the pot.',
    drives: 'The hand’s name and the pot.',
    rail(X) {
      const { c, G, H, t, S } = X, e = env(t, 0.3, 0.8, 5.8, 7.0); if (e <= 0) return;
      const text = ('  ' + H.name + '  +' + SS.fmt(H.pot) + '  ·').toUpperCase();
      if (!S.dm || S.dm.text !== text) { const cv = document.createElement('canvas'), x = cv.getContext('2d'); x.font = 'bold 7px "Courier New", monospace'; const w = Math.ceil(x.measureText(text).width); cv.width = w; cv.height = 7; x.font = 'bold 7px "Courier New", monospace'; x.fillStyle = '#fff'; x.textBaseline = 'top'; x.fillText(text, 0, 0); const d = x.getImageData(0, 0, w, 7).data; const bits = []; for (let col = 0; col < w; col++) { const colBits = []; for (let r = 0; r < 7; r++) colBits.push(d[(r * w + col) * 4 + 3] > 110); bits.push(colBits); } S.dm = { text, bits, w }; }
      const rows = 6, pitch = G.rw / (rows + 0.6), n = Math.floor(SS.railLen(G) / pitch), off = Math.floor(t * 22), on = sm(0.4, 1.2, t);
      c.save(); c.globalCompositeOperation = 'lighter';
      for (let i = 0; i < n; i++) {
        const s = i / n, q = SS.railPt(G, s), a = SS.railAng(G, s), nx = -Math.sin(a), ny = Math.cos(a), col = S.dm.bits[((i + off) % S.dm.w + S.dm.w) % S.dm.w];
        for (let r = 0; r < rows; r++) {
          const lit = col[r + 1] ? 1 : 0, y = (r - (rows - 1) / 2) * pitch, x = q.x + nx * y, yy = q.y + ny * y;
          c.fillStyle = lit ? `rgba(255,170,70,${0.9 * e * on})` : `rgba(255,170,70,${0.06 * e})`; c.fillRect(x - pitch * 0.32, yy - pitch * 0.32, pitch * 0.64, pitch * 0.64);
          if (lit) { c.fillStyle = `rgba(255,140,40,${0.18 * e * on})`; c.fillRect(x - pitch * 0.8, yy - pitch * 0.8, pitch * 1.6, pitch * 1.6); }
        }
      }
      c.restore();
    },
  });

  SS.idea({
    zone: 'rail', cat: 'royal', title: 'Gold Leaf',
    desc: 'Leaves of gold are laid on the rail from the hero’s seat outward, each settling with a slight crinkle, until the ring is gilt; then one burnishing pass runs round it.',
    drives: 'The royal’s suit tints the burnish.',
    rail(X) {
      const { c, G, H, t, S } = X, e = env(t, 0.3, 0.6, 5.8, 7.0); if (e <= 0) return;
      const n = Math.floor(SS.railLen(G) / (G.rw * 0.78));
      if (!S.leaf || S.leaf.n !== n) { const R = SS.rng(11); S.leaf = { n, v: Array.from({ length: n }, () => [R() - 0.5, R(), R()]) }; }
      c.save(); SS.clipRing(c, G);
      for (let i = 0; i < n; i++) {
        const s = i / n, d = SS.sdist(s, 0), tau = 0.7 + d * 5.2, p = sm(tau, tau + 0.35, t); if (p <= 0) continue;
        const [rot, shade, cr] = S.leaf.v[i], sc = 1.25 - 0.25 * outBack(p), size = G.rw * 0.95 * sc;
        onRail(c, G, s, () => { c.rotate(rot * 0.3); c.globalAlpha = e * p; const g = c.createLinearGradient(-size / 2, -size / 2, size / 2, size / 2); g.addColorStop(0, `hsl(44,${70 + shade * 15}%,${68 + shade * 10}%)`); g.addColorStop(1, `hsl(40,${65 + shade * 10}%,${42 + shade * 8}%)`); c.fillStyle = g; c.fillRect(-size / 2, -size / 2, size, size); c.strokeStyle = 'rgba(255,248,215,0.55)'; c.lineWidth = 0.6; c.beginPath(); c.moveTo(-size * 0.4, -size * 0.1 + cr * 3); c.lineTo(size * 0.1, size * 0.05); c.lineTo(size * 0.4, -size * 0.2); c.stroke(); });
      }
      c.restore();
      const head = sm(4.0, 5.4, t) * 1.12; if (head > 0 && head < 1.12) comet(c, G, head, 0.1, G.rw, H.suit === 'h' || H.suit === 'd' ? [255, 225, 210] : [240, 245, 255], 0.6 * e);
    },
  });

  SS.idea({
    zone: 'rail', cat: 'suckout', title: 'Deck Bezel',
    desc: 'The rail becomes a watch bezel with one tick for every card the hero could not see, the outs in gold. A hand sweeps round, slows, and stops on the card that came on the river.',
    drives: 'The unseen cards, the outs and the river card.',
    rail(X) {
      const { c, G, H, t } = X, e = env(t, 0.3, 0.8, 5.8, 7.0); if (e <= 0) return;
      const list = H.unseen.slice().sort((a, b) => ('shdc'.indexOf(a[1]) - 'shdc'.indexOf(b[1])) || ('23456789TJQKA'.indexOf(a[0]) - '23456789TJQKA'.indexOf(b[0]))), n = list.length, outs = new Set(H.outs);
      const ri = list.indexOf(H.river.k), sR = (ri + 0.5) / n, head = sR * outCubic(sm(1.2, 3.4, t) ** 0.9), app = sm(0.4, 1.0, t);
      list.forEach((k, i) => {
        const s = (i + 0.5) / n, isOut = outs.has(k), passed = head >= s ? 1 : 0, river = i === ri ? sm(3.3, 3.7, t) : 0;
        onRail(c, G, s, () => { c.globalAlpha = e * app; c.fillStyle = river ? '#ffffff' : isOut ? `rgba(255,205,90,${0.75 + 0.25 * passed})` : `rgba(230,230,240,${0.28 + 0.12 * passed})`; const len = G.rw * (isOut ? 0.72 : 0.5) * (1 + river * 0.3); c.fillRect(-0.9 - river * 0.5, -len / 2, 1.8 + river, len); });
      });
      if (t > 1.2) comet(c, G, head, 0.06, G.rw * 0.7, [255, 230, 170], 0.55 * e * (1 - sm(3.4, 4.2, t)));
    },
    light(X) {
      const { c, G, H, t } = X, e = env(t, 3.4, 3.9, 5.8, 7.0); if (e <= 0) return;
      const list = H.unseen.slice().sort((a, b) => ('shdc'.indexOf(a[1]) - 'shdc'.indexOf(b[1])) || ('23456789TJQKA'.indexOf(a[0]) - '23456789TJQKA'.indexOf(b[0])));
      const s = (list.indexOf(H.river.k) + 0.5) / list.length, q = SS.railPt(G, s), n = SS.inward(G, q.x, q.y), x = q.x + n.x * G.rw * 2.6, y = q.y + n.y * G.rw * 2.6;
      c.save(); c.globalAlpha = e; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#ffd76a'; c.font = SS.font('italic 400', G.H * 0.032, SS.SERIF); c.fillText(SS.cardWord(H.river), x, y); c.fillStyle = 'rgba(255,246,230,0.75)'; c.font = SS.font(600, G.H * 0.024, SS.SANS); c.fillText('1 of ' + H.outs.length + ' outs', x, y + G.H * 0.04); c.restore();
    },
  });

  SS.idea({
    zone: 'rail', cat: 'scoop', title: 'Two Currents',
    desc: 'A teal current for the high half and a violet one for the low leave the far rail in opposite directions and flow round to the hero, where they braid into one gold current that fills the ring.',
    drives: 'The two halves the hero won.',
    rail(X) {
      const { c, G, t } = X, e = env(t, 0.3, 0.7, 5.8, 7.0); if (e <= 0) return;
      const p = inOut(sm(0.8, 2.8, t)), gold = sm(2.8, 4.2, t), fade = 1 - sm(2.9, 3.8, t);
      c.save(); c.setLineDash([G.rw * 0.9, G.rw * 0.55]);
      c.lineDashOffset = -t * G.rw * 4; SS.railStroke(c, G, 0.5, 0.5 + 0.5 * p, G.rw * 0.5, `rgba(47,190,210,${0.8 * e * fade})`, 1);
      c.lineDashOffset = t * G.rw * 4; SS.railStroke(c, G, 0.5 - 0.5 * p, 0.5, G.rw * 0.5, `rgba(170,120,240,${0.8 * e * fade})`, 1);
      c.setLineDash([]);
      if (gold > 0) { SS.railStroke(c, G, 0, gold * 0.5, G.rw * 0.62, `rgba(255,205,90,${0.7 * e})`, 1); SS.railStroke(c, G, 1 - gold * 0.5, 1, G.rw * 0.62, `rgba(255,205,90,${0.7 * e})`, 1); }
      c.restore();
    },
  });

  SS.idea({
    zone: 'rail', cat: 'doubleup', title: 'Chip Rail',
    desc: 'The hero’s stack before the hand is built on the rail as clay chip stacks, denomination by denomination; then its double drops in on the other side of the hero’s seat, chip for chip.',
    drives: 'The hero’s stack before the all-in, broken into real denominations.',
    rail(X) {
      const { c, G, H, t } = X, e = env(t, 0.3, 0.6, 5.8, 7.0); if (e <= 0) return;
      const stacks = SS.chipsOf(H.before, 4), rx = G.rw * 0.36, ry = rx * 0.38, th = rx * 0.22;
      [[gapS(0), 0.6], [gapS(5), 2.4]].forEach(([s0, t0], side) => {
        stacks.forEach((st, k) => {
          const n = Math.min(st.n, 10), sOff = (k - (stacks.length - 1) / 2) * 0.022 * (side ? -1 : 1), q = SS.railPt(G, s0 + sOff);
          for (let j = 0; j < n; j++) {
            const tau = t0 + (k * 10 + j) * 0.035, p = sm(tau, tau + 0.18, t); if (p <= 0) continue;
            const y = q.y + G.rw * 0.25 - j * th - (1 - outCubic(p)) * G.rw * 0.9;
            c.save(); c.globalAlpha = e * p; c.fillStyle = 'rgba(0,0,0,0.35)'; c.beginPath(); c.ellipse(q.x, y + th, rx, ry, 0, 0, TAU); c.fill();
            c.fillStyle = st.col; c.beginPath(); c.ellipse(q.x, y, rx, ry, 0, 0, TAU); c.fill(); c.strokeStyle = 'rgba(255,255,255,0.75)'; c.lineWidth = 0.9; c.setLineDash([rx * 0.35, rx * 0.5]); c.beginPath(); c.ellipse(q.x, y, rx * 0.86, ry * 0.86, 0, 0, TAU); c.stroke(); c.restore();
          }
        });
      });
    },
    top(X) { const { c, G, H, t } = X, e = env(t, 3.4, 3.9, 5.8, 7.0); if (e <= 0) return; c.save(); c.globalAlpha = e; c.fillStyle = '#ffd76a'; c.font = SS.font(700, G.H * 0.042, SS.SERIF); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(SS.fmt(H.before) + '  × 2', G.cx, G.cy + G.th + (G.H - G.cy - G.th) * 0.55); c.restore(); },
  });

  SS.idea({
    zone: 'rail', cat: 'wheel', title: 'Bearing Race',
    desc: 'The rail opens into a ball race of polished steel bearings that roll a lap and slow to rest; five of them, engraved A to 5, come to rest in order beside the hero.',
    drives: 'The wheel’s five cards.',
    rail(X) {
      const { c, G, H, t } = X, e = env(t, 0.3, 0.6, 5.8, 7.0); if (e <= 0) return;
      const r = G.rw * 0.36, L = SS.railLen(G), step = (2.25 * r) / L, n = 16;
      for (let k = 0; k < n; k++) {
        const fin = k < 5 ? 0.05 + k * step : 0.05 + 5 * step + (k - 4) * ((1 - 0.1 - 6 * step) / (n - 5)), D = 1 + 0.012 * Math.sin(k * 2.3);
        const p = sm(0.6, 3.6 + k * 0.03, t), s = fin - D * Math.pow(1 - p, 3);
        const q = SS.railPt(G, s);
        c.save(); c.globalAlpha = e * sm(0.3, 0.7, t);
        c.fillStyle = 'rgba(0,0,0,0.35)'; c.beginPath(); c.arc(q.x + 1, q.y + 1.5, r, 0, TAU); c.fill();
        const g = c.createRadialGradient(q.x - r * 0.35, q.y - r * 0.4, r * 0.1, q.x, q.y, r); const gold = k < 5;
        g.addColorStop(0, gold ? '#fff4cf' : '#ffffff'); g.addColorStop(0.5, gold ? '#d9ae4a' : '#a8adba'); g.addColorStop(1, gold ? '#6a4a10' : '#3a3e48');
        c.fillStyle = g; c.beginPath(); c.arc(q.x, q.y, r, 0, TAU); c.fill();
        if (gold) { const cd = H.up[k]; c.fillStyle = '#3a2808'; c.font = SS.font(800, r * 1.05, SS.SANS); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(cd.r === 14 ? 'A' : SS.RLABEL[cd.r], q.x, q.y + 0.5); }
        c.restore();
      }
    },
  });
})();

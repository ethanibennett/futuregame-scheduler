/* Showdown Specials, the engine: maths, the hands (with a hold'em evaluator, so every effect reads the real
   cards), the replayer's table drawn as the app draws it, and the flush flood's own physics. */
(function () {
  const SS = (window.SS = {});
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const sm = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const env = (t, a, b, c, d) => sm(a, b, t) * (1 - sm(c, d, t));
  const outCubic = (p) => 1 - Math.pow(1 - clamp(p, 0, 1), 3);
  const inOut = (p) => { p = clamp(p, 0, 1); return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; };
  const outBack = (p) => { const s = 1.5; p = clamp(p, 0, 1) - 1; return p * p * ((s + 1) * p + s) + 1; };
  /* A damped spring from 0 to 1 (f: cycles a second, z: damping ratio). */
  const spring = (t, f = 1.4, z = 0.45) => { if (t <= 0) return 0; const w = TAU * f, wd = w * Math.sqrt(1 - z * z); return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + (z * w / wd) * Math.sin(wd * t)); };
  function rng(seed) { let a = seed >>> 0 || 1; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const hash = (x, y) => { let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  function noise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return lerp(lerp(hash(xi, yi), hash(xi + 1, yi), u), lerp(hash(xi, yi + 1), hash(xi + 1, yi + 1), u), v);
  }
  const fbm = (x, y) => noise(x, y) * 0.6 + noise(x * 2.1, y * 2.1) * 0.3 + noise(x * 4.3, y * 4.3) * 0.1;
  Object.assign(SS, { TAU, clamp, lerp, sm, env, outCubic, inOut, outBack, spring, rng, noise, fbm });

  /* ── type ── */
  SS.SERIF = '"Libre Baskerville", Baskerville, Georgia, serif';
  SS.SANS = 'Archivo, "Helvetica Neue", Arial, sans-serif';
  SS.SCRIPT = 'Caveat, "Segoe Script", cursive';
  SS.font = (w, px, fam) => `${w} ${Math.max(1, Math.round(px))}px ${fam}`;

  /* ── the suits ── */
  const C = (cx, cy, r) => `M${cx - r} ${cy} a${r} ${r} 0 1 0 ${2 * r} 0 a${r} ${r} 0 1 0 ${-2 * r} 0 Z`;
  SS.SUITD = {
    h: 'M50 90 C47 87 8 61 6 35 C4 19 15 8 29 8 C39 8 46 14 50 22 C54 14 61 8 71 8 C85 8 96 19 94 35 C92 61 53 87 50 90 Z',
    d: 'M50 4 L85 50 L50 96 L15 50 Z',
    s: 'M50 5 C56 16 92 38 94 60 C95 74 85 83 73 83 C64 83 57 79 54 72 C55 84 59 91 66 95 L34 95 C41 91 45 84 46 72 C43 79 36 83 27 83 C15 83 5 74 6 60 C8 38 44 16 50 5 Z',
    c: C(50, 27, 19) + C(27, 57, 19) + C(73, 57, 19) + C(50, 51, 11) + ' M46 56 L54 56 L56 74 C57 85 61 91 67 95 L33 95 C39 91 43 85 44 74 Z',
  };
  SS.SUIT = {}; for (const k in SS.SUITD) SS.SUIT[k] = new Path2D(SS.SUITD[k]);
  SS.SUITNAME = { h: 'hearts', d: 'diamonds', c: 'clubs', s: 'spades' };
  SS.SUITCOL = { h: '#ff5d68', d: '#4f9dff', c: '#3fcf7c', s: '#dfe3ee' };      // on the dark felt
  SS.SUITRGB = { h: [255, 93, 104], d: [79, 157, 255], c: [63, 207, 124], s: [223, 227, 238] };
  SS.FACE = { h: '#c3303c', d: '#2b69cf', c: '#22874b', s: '#2a2c33' };           // the four-colour deck's faces
  SS.GOLD = '#ffd700';
  SS.INK = '#fff6e6';
  SS.suit = function (c, s, x, y, size, rot, col, a) {
    if (a <= 0.003 || !SS.SUIT[s]) return;
    c.save(); c.globalAlpha *= a; c.translate(x, y); c.rotate(rot || 0); c.scale(size / 100, size / 100); c.translate(-50, -50);
    c.fillStyle = col; c.fill(SS.SUIT[s]); c.restore();
  };
  SS.glow = function (c, x, y, r, rgb, a) {
    if (a <= 0.003 || r <= 0) return;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`); g.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
    c.fillStyle = g; c.fillRect(x - r, y - r, 2 * r, 2 * r);
  };

  /* ── cards and the evaluator ── */
  const RV = { 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, T: 10, J: 11, Q: 12, K: 13, A: 14 };
  SS.RLABEL = { 14: 'A', 13: 'K', 12: 'Q', 11: 'J', 10: '10', 9: '9', 8: '8', 7: '7', 6: '6', 5: '5', 4: '4', 3: '3', 2: '2' };
  SS.RWORD = { 14: 'Ace', 13: 'King', 12: 'Queen', 11: 'Jack', 10: 'Ten', 9: 'Nine', 8: 'Eight', 7: 'Seven', 6: 'Six', 5: 'Five', 4: 'Four', 3: 'Three', 2: 'Two' };
  const plural = (v) => (v === 6 ? 'Sixes' : SS.RWORD[v] + 's');
  SS.plural = plural;
  SS.cards = (str) => (str.match(/../g) || []).map((t) => ({ r: RV[t[0]], s: t[1], k: t }));
  SS.DECK = []; for (const r of '23456789TJQKA') for (const s of 'shdc') SS.DECK.push(r + s);
  SS.cardWord = (cd) => SS.RWORD[cd.r] + ' of ' + SS.SUITNAME[cd.s];

  function eval5(cs) {
    const rs = cs.map((c) => c.r).sort((a, b) => b - a);
    const flush = cs.every((c) => c.s === cs[0].s);
    let hi = 0;
    if (new Set(rs).size === 5) { if (rs[0] - rs[4] === 4) hi = rs[0]; else if (rs[0] === 14 && rs[1] === 5) hi = 5; }
    const cnt = {}; rs.forEach((r) => { cnt[r] = (cnt[r] || 0) + 1; });
    const g = Object.entries(cnt).map(([r, n]) => [n, +r]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
    let cat, tb;
    if (hi && flush) { cat = 8; tb = [hi]; }
    else if (g[0][0] === 4) { cat = 7; tb = [g[0][1], g[1][1]]; }
    else if (g[0][0] === 3 && g[1][0] === 2) { cat = 6; tb = [g[0][1], g[1][1]]; }
    else if (flush) { cat = 5; tb = rs; }
    else if (hi) { cat = 4; tb = [hi]; }
    else if (g[0][0] === 3) { cat = 3; tb = g.map((x) => x[1]); }
    else if (g[0][0] === 2 && g[1][0] === 2) { cat = 2; tb = g.map((x) => x[1]); }
    else if (g[0][0] === 2) { cat = 1; tb = g.map((x) => x[1]); }
    else { cat = 0; tb = rs; }
    let score = cat; for (let i = 0; i < 5; i++) score = score * 15 + (tb[i] || 0);
    return { cat, tb, score, hi };
  }
  function nameOf(e) {
    switch (e.cat) {
      case 8: return e.hi === 14 ? 'Royal flush' : 'Straight flush, ' + SS.RWORD[e.hi] + '-high';
      case 7: return 'Four ' + plural(e.tb[0]);
      case 6: return plural(e.tb[0]) + ' full of ' + plural(e.tb[1]);
      case 5: return 'Flush, ' + SS.RWORD[e.tb[0]] + '-high';
      case 4: return e.hi === 5 ? 'Wheel' : 'Straight, ' + SS.RWORD[e.hi] + '-high';
      case 3: return 'Three ' + plural(e.tb[0]);
      case 2: return 'Two pair, ' + plural(e.tb[0]) + ' and ' + plural(e.tb[1]);
      case 1: return 'Pair of ' + plural(e.tb[0]);
      default: return SS.RWORD[e.tb[0]] + '-high';
    }
  }
  /* The best five of a hold'em hand: which cards play (from 'hole' or 'board', by index). */
  SS.best = function (hole, board) {
    const all = hole.map((c, i) => ({ c, from: 'hole', i })).concat(board.map((c, i) => ({ c, from: 'board', i })));
    let top = null, use = null; const n = all.length;
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let d = b + 1; d < n; d++) for (let e = d + 1; e < n; e++) for (let f = e + 1; f < n; f++) {
      const pick = [all[a], all[b], all[d], all[e], all[f]];
      const ev = eval5(pick.map((p) => p.c));
      if (!top || ev.score > top.score) { top = ev; use = pick; }
    }
    return { ...top, name: nameOf(top), use };
  };

  /* ── the hands: every idea reads its numbers from one of these ── */
  const HANDS = {
    royal: [
      { hero: 'JhTh', board: 'AhKhQh7c2d', opp: 'AsAd', loser: 2, pot: 186400, bb: 1200, stack: 214600, oppStack: 41800 },
      { hero: 'AsKs', board: 'QsJsTs4d4c', opp: 'TdTc', loser: 4, pot: 92800, bb: 800, stack: 151300, oppStack: 12600 },
    ],
    sf: [
      { hero: '6s5s', board: '9s8s7s2dKc', opp: 'TdJc', loser: 1, pot: 74200, bb: 1000, stack: 128900, oppStack: 20500 },
      { hero: '4d3d', board: '7d6d5dAcAs', opp: 'AhKd', loser: 5, pot: 133600, bb: 1600, stack: 201400, oppStack: 0 },
    ],
    quads: [
      { hero: '7h7s', board: '7c7dKs2h9c', opp: 'KhKd', loser: 3, pot: 48200, bb: 1200, stack: 96400, oppStack: 33800 },
      { hero: 'QcQd', board: 'QhQs5d5c2h', opp: '5h5s', loser: 2, pot: 241000, bb: 2000, stack: 302500, oppStack: 0 },
    ],
    boat: [
      { hero: 'Qh9d', board: 'QcQd5h5s2c', opp: 'AhAc', loser: 4, pot: 61600, bb: 800, stack: 117300, oppStack: 22900 },
      { hero: '8c8h', board: '8dKsKc3h2d', opp: 'AsKd', loser: 1, pot: 88800, bb: 1200, stack: 140200, oppStack: 15100 },
    ],
    flush: [
      { hero: 'Ah8h', board: 'Kh9h4h2cJd', opp: 'KdQc', loser: 2, pot: 48200, bb: 1200, stack: 103600, oppStack: 31400 },
      { hero: 'KcQc', board: 'Jc7c2cJsTd', opp: 'JhAd', loser: 4, pot: 57600, bb: 800, stack: 98400, oppStack: 40200 },
      { hero: '9d8d', board: 'Ad4d2dAsKh', opp: 'AcQs', loser: 1, pot: 70400, bb: 1600, stack: 122000, oppStack: 9600 },
      { hero: 'AsTs', board: 'Ks7s3s8c8d', opp: 'QhQd', loser: 5, pot: 39600, bb: 600, stack: 85100, oppStack: 27700 },
    ],
    straight: [
      { hero: 'JhQd', board: 'Ts9d8c2h3s', opp: 'TcTh', loser: 3, pot: 52400, bb: 1000, stack: 99800, oppStack: 18200 },
      { hero: '6c7d', board: '8h9sTd2cKs', opp: 'KdKh', loser: 2, pot: 66800, bb: 1200, stack: 120400, oppStack: 4400 },
      { hero: 'AdKc', board: 'QhJsTd4c3h', opp: 'JdJc', loser: 4, pot: 81000, bb: 1500, stack: 162300, oppStack: 25800 },
    ],
    wheel: [
      { hero: 'Ah2s', board: '5d4c3h9sKd', opp: 'KsKc', loser: 2, pot: 44800, bb: 800, stack: 90400, oppStack: 36100 },
      { hero: 'As4h', board: '2c3d5sJhJd', opp: 'JsQc', loser: 4, pot: 72000, bb: 1200, stack: 133700, oppStack: 11500 },
    ],
    scoop: [
      { game: 'PLO8', hero: 'Ad2d5c9h', board: 'Kd7d4d3s8c', opp: 'KsKhQcJc', loser: 3, pot: 64800, bb: 800, stack: 121500, oppStack: 30600,
        hi: 'Flush, Ace-high', lo: '7-4-3-2-A', hiUse: [['hole', 0], ['hole', 1], ['board', 0], ['board', 1], ['board', 2]], loUse: [['hole', 0], ['hole', 1], ['board', 3], ['board', 2], ['board', 1]], suit: 'd', oppName: 'Three Kings' },
      { game: 'PLO8', hero: 'As2s4h9c', board: '3d5c8sKs7s', opp: 'KhKdQcJh', loser: 2, pot: 38400, bb: 600, stack: 88200, oppStack: 14900,
        hi: 'Flush, Ace-high', lo: '7-5-3-2-A', hiUse: [['hole', 0], ['hole', 1], ['board', 2], ['board', 3], ['board', 4]], loUse: [['hole', 0], ['hole', 1], ['board', 0], ['board', 1], ['board', 4]], suit: 's', oppName: 'Three Kings' },
    ],
    cooler: [
      { hero: 'Jh9d', board: 'JcJd8h8s2c', opp: 'Ah8d', loser: 2, pot: 118400, bb: 1600, stack: 176200, oppStack: 0 },
      { hero: 'KcKd', board: 'Ks9h9d4c2s', opp: '9c4h', loser: 4, pot: 96600, bb: 1400, stack: 151900, oppStack: 8200 },
    ],
    suckout: [
      { hero: '9h7h', board: 'Kc8d3h6sTc', opp: 'KdKs', loser: 3, pot: 84600, bb: 1200, stack: 129300, oppStack: 0, turn: 1 },
      { hero: 'AsQs', board: 'Ks7s2d4c9s', opp: 'KdKh', loser: 1, pot: 61200, bb: 900, stack: 99800, oppStack: 0, turn: 1 },
    ],
    doubleup: [
      { hero: 'AsAc', board: 'Ad7c4s9hQd', opp: 'KhKd', loser: 2, pot: 48200, bb: 1200, stack: 48200, before: 24100, oppStack: 37700 },
      { hero: 'TdTs', board: '2c6hTh8sKd', opp: 'AhKs', loser: 4, pot: 36800, bb: 800, stack: 36800, before: 18400, oppStack: 51600 },
    ],
    bigpot: [
      { hero: 'KhQh', board: 'KdKs6c4h2s', opp: 'JcJd', loser: 3, pot: 170400, bb: 1200, stack: 251800, oppStack: 0 },
      { hero: 'AhAd', board: 'Ac9s9d5h2c', opp: '9h8h', loser: 1, pot: 96000, bb: 800, stack: 164500, oppStack: 6100 },
    ],
  };
  HANDS.any = [HANDS.boat[0], HANDS.flush[1], HANDS.straight[2]];
  SS.HAND_LABEL = { royal: 'Royal flush', sf: 'Straight flush', quads: 'Four of a kind', boat: 'Full house', flush: 'Flush', straight: 'Straight', wheel: 'Wheel', scoop: 'Scoop', cooler: 'Full house over full house', suckout: 'River suck-out', doubleup: 'All in, doubled up', bigpot: 'Pot over 100 big blinds', any: 'Any win' };
  SS.HAND_ORDER = ['royal', 'sf', 'quads', 'boat', 'flush', 'straight', 'wheel', 'scoop', 'cooler', 'suckout', 'doubleup', 'bigpot', 'any'];
  SS.handCount = (cat) => HANDS[cat].length;

  const DENOMS = [[100000, '#e65aa0'], [25000, '#2bb0a8'], [5000, '#e07b2c'], [1000, '#e8c547'], [500, '#8b4fc2'], [100, '#26262c'], [25, '#23874b'], [5, '#c3303c'], [1, '#f1ede4']];
  SS.chipsOf = (amount, max = 6) => { const out = []; let left = amount; for (const [v, col] of DENOMS) { const n = Math.floor(left / v); if (n > 0) { out.push({ v, col, n }); left -= n * v; } if (out.length >= max) break; } return out; };
  SS.fmt = (n) => Math.round(n).toLocaleString('en-US');

  SS.hand = function (cat, which) {
    const list = HANDS[cat], spec = list[((which % list.length) + list.length) % list.length];
    const hero = SS.cards(spec.hero), board = SS.cards(spec.board), opp = SS.cards(spec.opp);
    const H = { cat, spec, hero, board, opp, loser: spec.loser, pot: spec.pot, bb: spec.bb, stack: spec.stack, oppStack: spec.oppStack, game: spec.game || "NLH" };
    H.bbs = Math.round(spec.pot / spec.bb);
    H.before = spec.before || Math.max(0, spec.stack - spec.pot / 2);
    if (spec.hi) {
      const map = (u) => ({ from: u[0], i: u[1], c: (u[0] === 'hole' ? hero : board)[u[1]] });
      H.use = spec.hiUse.map(map); H.loUse = spec.loUse.map(map);
      H.name = spec.hi; H.hiName = spec.hi; H.loName = spec.lo; H.oppName = spec.oppName; H.suit = spec.suit;
      H.cat5 = 5;
    } else {
      const hb = SS.best(hero, board), ob = SS.best(opp, board);
      H.use = hb.use; H.name = hb.name; H.oppName = ob.name; H.cat5 = hb.cat; H.tb = hb.tb; H.hi = hb.hi;
      H.suit = hb.cat === 5 || hb.cat === 8 ? hb.use[0].c.s : null;
      H.oppTb = ob.tb;
    }
    H.five = H.use.map((u) => u.c);
    // The five in rank order, low to high (a wheel's ace low).
    H.up = H.five.slice().sort((a, b) => a.r - b.r);
    if (H.hi === 5) H.up = [H.up[4], ...H.up.slice(0, 4)];
    H.suitCount = H.suit ? hero.concat(board).filter((c) => c.s === H.suit).length : 0;
    if (spec.turn) {
      const turn = board.slice(0, 4), seen = new Set(hero.concat(opp, turn).map((c) => c.k));
      H.unseen = SS.DECK.filter((k) => !seen.has(k));
      H.outs = H.unseen.filter((k) => { const b = turn.concat(SS.cards(k)); return SS.best(hero, b).score > SS.best(opp, b).score; });
      H.eq = H.outs.length / H.unseen.length;
      H.river = board[4];
    }
    return H;
  };

  /* ── the table, as the replayer draws it (landscape, 6-max) ── */
  SS.SEATS = 6;
  SS.NAMES = ['Hero', 'Mia', 'Jon', 'Ava', 'Lee', 'Sam'];
  SS.geo = function (W, H) {
    const cx = W / 2, cy = H * 0.555, tw = W * 0.405, th = H * 0.33, rw = Math.max(8, H * 0.052);
    const ch = H * 0.145, cw = ch * 180 / 252;
    return { W, H, cx, cy, tw, th, rw, fw: tw - rw, fh: th - rw, ch, cw, gap: cw * 0.1, top: cy - th, bottom: cy + th };
  };
  SS.pill = function (c, cx, cy, hw, hh) { const r = Math.min(hw, hh); c.beginPath(); c.moveTo(cx - hw + r, cy - hh); c.lineTo(cx + hw - r, cy - hh); c.arc(cx + hw - r, cy, r, -Math.PI / 2, Math.PI / 2); c.lineTo(cx - hw + r, cy + hh); c.arc(cx - hw + r, cy, r, Math.PI / 2, Math.PI * 1.5); c.closePath(); };
  SS.feltPath = (c, G) => SS.pill(c, G.cx, G.cy, G.fw, G.fh);
  SS.clipRing = (c, G) => { const p = new Path2D(); const r1 = Math.min(G.tw, G.th), r2 = Math.min(G.fw, G.fh);
    const add = (hw, hh, r) => { p.moveTo(G.cx - hw + r, G.cy - hh); p.lineTo(G.cx + hw - r, G.cy - hh); p.arc(G.cx + hw - r, G.cy, r, -Math.PI / 2, Math.PI / 2); p.lineTo(G.cx - hw + r, G.cy + hh); p.arc(G.cx - hw + r, G.cy, r, Math.PI / 2, Math.PI * 1.5); p.closePath(); };
    add(G.tw, G.th, r1); add(G.fw, G.fh, r2); c.clip(p, 'evenodd'); };
  SS.clipFelt = (c, G) => { SS.feltPath(c, G); c.clip(); };
  /* A point on the rail's centre line, s in [0, 1) from the hero (bottom centre), going round to the right. */
  SS.railPt = function (G, s) {
    const a = G.tw - G.rw / 2, r = G.th - G.rw / 2, S = 2 * (a - r), L = 2 * S + TAU * r;
    let d = (((s % 1) + 1) % 1) * L;
    if (d < S / 2) return { x: G.cx + d, y: G.cy + r };
    d -= S / 2; if (d < Math.PI * r) { const t = Math.PI / 2 - d / r; return { x: G.cx + (a - r) + r * Math.cos(t), y: G.cy + r * Math.sin(t) }; }
    d -= Math.PI * r; if (d < S) return { x: G.cx + (a - r) - d, y: G.cy - r };
    d -= S; if (d < Math.PI * r) { const t = -Math.PI / 2 - d / r; return { x: G.cx - (a - r) + r * Math.cos(t), y: G.cy + r * Math.sin(t) }; }
    d -= Math.PI * r; return { x: G.cx - (a - r) + d, y: G.cy + r };
  };
  SS.railLen = (G) => { const a = G.tw - G.rw / 2, r = G.th - G.rw / 2; return 4 * (a - r) + TAU * r; };
  SS.railAng = (G, s) => { const p = SS.railPt(G, s - 0.0015), q = SS.railPt(G, s + 0.0015); return Math.atan2(q.y - p.y, q.x - p.x); };
  SS.inward = (G, x, y) => { const a = G.tw - G.th, px = clamp(x, G.cx - a, G.cx + a); const dx = px - x, dy = G.cy - y, d = Math.hypot(dx, dy) || 1; return { x: dx / d, y: dy / d }; };
  SS.seatS = (i) => i / SS.SEATS;
  SS.railStroke = function (c, G, s0, s1, width, style, a) {
    if (a <= 0.003 || s1 <= s0) return;
    c.save(); c.globalAlpha *= a; c.strokeStyle = style; c.lineWidth = width; c.lineCap = 'round'; c.lineJoin = 'round'; c.beginPath();
    const n = Math.max(2, Math.ceil((s1 - s0) * 220));
    for (let i = 0; i <= n; i++) { const p = SS.railPt(G, s0 + (s1 - s0) * i / n); if (i) c.lineTo(p.x, p.y); else c.moveTo(p.x, p.y); }
    c.stroke(); c.restore();
  };
  /* Circular distance between two rail positions. */
  SS.sdist = (a, b) => { const d = Math.abs((((a - b) % 1) + 1) % 1); return Math.min(d, 1 - d); };

  /* Where every piece sits. */
  SS.layout = function (G, H) {
    const L = { board: [], seats: [] };
    const bw = 5 * G.cw + 4 * G.gap, bx = G.cx - bw / 2, by = G.cy - G.ch * 0.62;
    for (let i = 0; i < 5; i++) L.board.push({ x: bx + i * (G.cw + G.gap), y: by, w: G.cw, h: G.ch });
    L.boardBox = { x: bx, y: by, w: bw, h: G.ch, cx: G.cx, cy: by + G.ch / 2 };
    for (let i = 0; i < SS.SEATS; i++) {
      const s = SS.seatS(i), p = SS.railPt(G, s), n = SS.inward(G, p.x, p.y);
      const pw = G.W * 0.118, ph = G.H * 0.07;
      const seat = { i, s, x: p.x, y: p.y, n, pw, ph, cards: [] };
      const holding = i === 0 ? H.hero : i === H.loser ? H.opp : null;
      if (holding) {
        const k = holding.length, sc = k > 2 ? 0.86 : 0.92, w = G.cw * sc, h = G.ch * sc, step = w * (k > 2 ? 0.52 : 0.72);
        const ccx = p.x + n.x * (ph * 0.5 + h * 0.5 + G.H * 0.006), ccy = p.y + n.y * (ph * 0.5 + h * 0.5 + G.H * 0.006);
        holding.forEach((cd, j) => seat.cards.push({ x: ccx - (step * (k - 1) + w) / 2 + j * step, y: ccy - h / 2, w, h, cd }));
      }
      seat.read = { x: p.x - n.x * (ph * 0.5 + G.H * 0.03), y: p.y - n.y * (ph * 0.5 + G.H * 0.03) };
      L.seats.push(seat);
    }
    L.hero = L.seats[0]; L.loser = L.seats[H.loser];
    const heroC = L.hero.cards, mid = (a) => ({ x: a.reduce((s, r) => s + r.x + r.w / 2, 0) / a.length, y: a.reduce((s, r) => s + r.y + r.h / 2, 0) / a.length });
    L.heroCards = mid(heroC);
    L.loserCards = L.loser.cards.length ? mid(L.loser.cards) : { x: L.loser.x, y: L.loser.y };
    // The five that play, as rectangles on the table.
    L.fiveRects = H.use.map((u) => (u.from === 'board' ? L.board[u.i] : L.hero.cards[u.i]));
    L.loRects = H.loUse ? H.loUse.map((u) => (u.from === 'board' ? L.board[u.i] : L.hero.cards[u.i])) : null;
    L.rectOf = (cd) => { const bi = H.board.indexOf(cd); if (bi >= 0) return L.board[bi]; const hi = H.hero.indexOf(cd); return hi >= 0 ? L.hero.cards[hi] : null; };
    return L;
  };
  SS.centre = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

  SS.card = function (c, x, y, w, h, cd, a = 1) {
    c.save(); c.globalAlpha *= a;
    c.shadowColor = 'rgba(0,0,0,0.45)'; c.shadowBlur = h * 0.08; c.shadowOffsetY = h * 0.025;
    c.fillStyle = SS.FACE[cd.s]; c.beginPath(); c.roundRect(x, y, w, h, w * 0.1); c.fill();
    c.shadowColor = 'transparent';
    const g = c.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, 'rgba(255,255,255,0.14)'); g.addColorStop(0.45, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,0.12)');
    c.fillStyle = g; c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.22)'; c.lineWidth = 0.8; c.stroke();
    c.fillStyle = '#fff'; c.font = SS.font(800, h * 0.4, SS.SANS); c.textBaseline = 'top'; c.textAlign = 'left';
    c.fillText(SS.RLABEL[cd.r], x + w * 0.1, y + h * 0.07);
    SS.suit(c, cd.s, x + w * 0.66, y + h * 0.72, w * 0.52, 0, 'rgba(255,255,255,0.92)', 1);
    c.restore();
  };

  /* The table's own layers, cached per size: under (shadow, rail, felt), the cloth's light (pool, vignette, weave,
     the light strip and the watermark), and the pieces. */
  function canvas(W, H, dpr) { const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(W * dpr)); cv.height = Math.max(1, Math.round(H * dpr)); const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); return { cv, c }; }
  SS.canvas = canvas;
  let weave = null;
  function weavePattern(c) {
    if (!weave) { const w = document.createElement('canvas'); w.width = w.height = 4; const x = w.getContext('2d'); x.fillStyle = 'rgba(255,255,255,0.035)'; x.fillRect(0, 0, 4, 1); x.fillRect(0, 2, 4, 1); x.fillStyle = 'rgba(0,0,0,0.05)'; x.fillRect(0, 0, 1, 4); x.fillRect(2, 0, 1, 4); weave = w; }
    return c.createPattern(weave, 'repeat');
  }
  SS.tableLayers = function (G, H, L, dpr) {
    const under = canvas(G.W, G.H, dpr), light = canvas(G.W, G.H, dpr), pieces = canvas(G.W, G.H, dpr);
    let c = under.c;
    // The table's weight on the room.
    c.save(); SS.pill(c, G.cx, G.cy + G.H * 0.025, G.tw, G.th); c.shadowColor = 'rgba(0,0,0,0.6)'; c.shadowBlur = G.H * 0.07; c.fillStyle = '#000'; c.fill(); c.restore();
    // The rail, lit from the upper left and the lower right.
    SS.pill(c, G.cx, G.cy, G.tw, G.th); c.fillStyle = '#6b5b8a'; c.fill();
    const ang = 155 * Math.PI / 180, dx = Math.sin(ang), dy = -Math.cos(ang), half = Math.abs(G.tw * dx) + Math.abs(G.th * dy);
    const rg = c.createLinearGradient(G.cx - dx * half, G.cy - dy * half, G.cx + dx * half, G.cy + dy * half);
    [[0, 'rgba(255,255,255,0.10)'], [0.15, 'rgba(255,255,255,0.13)'], [0.38, 'rgba(0,0,0,0.10)'], [0.55, 'rgba(0,0,0,0.16)'], [0.74, 'rgba(0,0,0,0.22)'], [0.9, 'rgba(255,255,255,0.12)'], [1, 'rgba(255,255,255,0.26)']].forEach(([o, col]) => rg.addColorStop(o, col));
    c.fillStyle = rg; c.fill();
    c.save(); SS.pill(c, G.cx, G.cy, G.tw, G.th); c.clip(); c.strokeStyle = 'rgba(255,255,255,0.14)'; c.lineWidth = 1.2; SS.pill(c, G.cx, G.cy + 1, G.tw - 0.5, G.th - 0.5); c.stroke(); c.restore();
    // The cloth: lit in the middle, held across, then dropping to the rim.
    c.save(); SS.feltPath(c, G); c.clip();
    c.translate(G.cx, G.cy - G.fh + 0.9 * G.fh); c.scale(1.6 * G.fw, 1.4 * G.fh);
    const fg = c.createRadialGradient(0, 0, 0, 0, 0, 1); fg.addColorStop(0, '#9478b4'); fg.addColorStop(0.6, '#635585'); fg.addColorStop(1, '#2c2e50');
    c.fillStyle = fg; c.fillRect(-2, -2, 4, 4); c.restore();
    // The cushion's contact shade on the cloth.
    c.save(); SS.feltPath(c, G); c.clip(); c.shadowColor = 'rgba(0,0,0,0.5)'; c.shadowBlur = G.H * 0.03; c.shadowOffsetY = G.H * 0.008; c.lineWidth = G.H * 0.04; c.strokeStyle = '#000'; SS.pill(c, G.cx, G.cy, G.fw + G.H * 0.02, G.fh + G.H * 0.02); c.stroke(); c.restore();
    c = light.c;
    c.save(); SS.feltPath(c, G); c.clip();
    c.save(); c.translate(G.cx, G.cy - G.fh + 0.88 * G.fh); c.scale(0.96 * G.fw, 0.68 * G.fh);
    let g = c.createRadialGradient(0, 0, 0, 0, 0, 1); g.addColorStop(0, 'rgba(255,238,200,0.13)'); g.addColorStop(0.7, 'rgba(255,238,200,0)'); c.fillStyle = g; c.fillRect(-2, -2, 4, 4); c.restore();
    c.save(); c.translate(G.cx, G.cy - G.fh + 0.8 * G.fh); c.scale(2 * G.fw, 2 * G.fh);
    g = c.createRadialGradient(0, 0, 0, 0, 0, 1); g.addColorStop(0.48, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.42)'); c.fillStyle = g; c.fillRect(-2, -2, 4, 4); c.restore();
    c.fillStyle = weavePattern(c); c.fillRect(G.cx - G.fw, G.cy - G.fh, 2 * G.fw, 2 * G.fh);
    c.fillStyle = 'rgba(255,246,230,0.2)'; c.font = SS.font(700, G.W * 0.03, SS.SERIF); c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('futurega.me', G.cx, G.cy + G.ch * 0.62);
    c.restore();
    const lg = c.createLinearGradient(0, G.cy - G.fh, 0, G.cy + G.fh); lg.addColorStop(0, 'rgba(255,255,255,0.13)'); lg.addColorStop(0.42, 'rgba(255,255,255,0.30)'); lg.addColorStop(1, 'rgba(255,255,255,0.62)');
    c.strokeStyle = lg; c.lineWidth = 1; SS.feltPath(c, G); c.stroke();
    // The pieces: the board and the hands (cards that do not play dimmed, as the replay does), the plaques.
    c = pieces.c;
    const plays = new Set(L.fiveRects.concat(L.loRects || []));
    L.board.forEach((r, i) => SS.card(c, r.x, r.y, r.w, r.h, H.board[i], plays.has(r) ? 1 : 0.42));
    L.seats.forEach((st) => {
      const folded = st.i !== 0 && st.i !== H.loser, win = st.i === 0;
      st.cards.forEach((r) => SS.card(c, r.x, r.y, r.w, r.h, r.cd, win ? (plays.has(r) ? 1 : 0.42) : 0.9));
      c.save(); c.globalAlpha = folded ? 0.55 : 1;
      c.fillStyle = 'rgba(17,17,25,0.93)'; c.beginPath(); c.roundRect(st.x - st.pw / 2, st.y - st.ph / 2, st.pw, st.ph, st.ph * 0.16);
      if (win) { c.shadowColor = 'rgba(255,215,0,0.4)'; c.shadowBlur = G.H * 0.02; }
      c.fill(); c.shadowColor = 'transparent';
      c.strokeStyle = win ? SS.GOLD : 'rgba(255,255,255,0.14)'; c.lineWidth = win ? 1.6 : 1; c.stroke();
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillStyle = 'rgba(236,229,214,0.72)'; c.font = SS.font(500, st.ph * 0.3, SS.SANS); c.fillText(SS.NAMES[st.i], st.x, st.y - st.ph * 0.2);
      c.fillStyle = '#fff'; c.font = SS.font(700, st.ph * 0.36, SS.SANS);
      c.fillText(win ? SS.fmt(H.stack) : st.i === H.loser ? (H.oppStack ? SS.fmt(H.oppStack) : 'OUT') : SS.fmt(20000 + st.i * 13700), st.x, st.y + st.ph * 0.2);
      c.restore();
    });
    // The readouts: the hero's hand in gold, the loser's in red.
    const readout = (st, text, col, border) => {
      c.save(); c.font = SS.font(600, G.H * 0.032, SS.SANS); const w = c.measureText(text).width + G.H * 0.04, h = G.H * 0.05;
      c.fillStyle = 'rgba(17,17,25,0.92)'; c.beginPath(); c.roundRect(st.read.x - w / 2, st.read.y - h / 2, w, h, h * 0.22); c.fill();
      c.strokeStyle = border; c.lineWidth = 1; c.stroke(); c.fillStyle = col; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, st.read.x, st.read.y + 0.5); c.restore();
    };
    readout(L.hero, H.name.length > 28 ? H.name.slice(0, 27) + '…' : H.name, SS.GOLD, 'rgba(255,215,0,0.45)');
    readout(L.loser, H.oppName, '#f87171', 'rgba(248,113,113,0.4)');
    // The dealer button.
    const db = L.seats[5]; c.save(); c.fillStyle = '#f4f1ea'; c.beginPath(); c.arc(db.x + db.n.x * db.ph * 0.2 + db.pw * 0.55, db.y + db.n.y * db.ph * 0.2 - db.ph * 0.3, G.H * 0.022, 0, TAU); c.fill();
    c.fillStyle = '#222'; c.font = SS.font(800, G.H * 0.024, SS.SANS); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('D', db.x + db.n.x * db.ph * 0.2 + db.pw * 0.55, db.y + db.n.y * db.ph * 0.2 - db.ph * 0.3 + 0.5); c.restore();
    return { under: under.cv, light: light.cv, pieces: pieces.cv };
  };
  SS.room = function (c, G) {
    const g = c.createRadialGradient(G.cx, G.cy, G.th * 0.6, G.cx, G.cy, G.W * 0.75);
    g.addColorStop(0, '#1c1c28'); g.addColorStop(1, '#09090e'); c.fillStyle = g; c.fillRect(0, 0, G.W, G.H);
  };

  /* ── the flush flood's physics, as the replayer runs it (utils/showdown-specials.js simulateFlood) ── */
  function roundedBox(px, py, hx, hy, r) {
    const qx = Math.abs(px) - (hx - r), qy = Math.abs(py) - (hy - r);
    const ox = Math.max(qx, 0), oy = Math.max(qy, 0), outside = Math.hypot(ox, oy);
    const d = outside + Math.min(Math.max(qx, qy), 0) - r;
    let nx, ny; if (outside > 0) { nx = ox / outside; ny = oy / outside; } else if (qx > qy) { nx = 1; ny = 0; } else { nx = 0; ny = 1; }
    return { d, nx: nx * Math.sign(px || 1), ny: ny * Math.sign(py || 1) };
  }
  SS.simulateFlood = function ({ w, h, radius, size, seed = 'flood', pourMs = 1100, holdMs = 3400, fadeMs = 700, hz = 120 }) {
    let s0 = 2166136261 >>> 0; for (const ch of String(seed)) { s0 ^= ch.charCodeAt(0); s0 = Math.imul(s0, 16777619) >>> 0; }
    const rnd = rng(s0);
    const R = Math.max(0, Math.min(radius == null ? Math.min(w, h) / 2 : radius, w / 2, h / 2));
    const n = Math.max(12, Math.min(72, Math.round(0.28 * w * h / (size * size))));
    const hx = w / 2, hy = h / 2, G = 1.6 * h, vMax = Math.min(1000, 1.9 * h), vRest = 0.025 * h;
    const E_BODY = 0.32, E_WALL = 0.38, MU = 0.28, SPIN = 0.35, W_MAX = 3, PASSES = 6, dt = 1 / hz, end = holdMs + fadeMs;
    const frames = Math.ceil(end * hz / 1000) + 1, bodies = [];
    for (let i = 0; i < n; i++) { const u = (i + rnd() * 0.6) / n; const born = Math.round(pourMs * (1 - Math.sqrt(1 - Math.min(0.999, u)))); const d = size * (0.85 + 0.3 * rnd()); bodies.push({ d, r: d * 0.46, born, x: 0, y: 0, vx: 0, vy: 0, a: 0, w: 0, live: false, sleep: false, still: 0, touch: false, at: -1, tx: new Float32Array(frames), ty: new Float32Array(frames), ta: new Float32Array(frames) }); }
    bodies.sort((p, q) => p.born - q.born);
    const inside = (b) => roundedBox(b.x - hx, b.y - hy, hx - b.r, hy - b.r, Math.max(0, R - b.r));
    const live = [];
    const spawn = (b) => { for (let k = 0; k < 8; k++) { const x = b.r + (w - 2 * b.r) * (0.08 + 0.84 * rnd()), y = b.r + Math.min(h * 0.12, h - 2 * b.r); const c2 = roundedBox(x - hx, y - hy, hx - b.r, hy - b.r, Math.max(0, R - b.r)); let px = x, py = y; if (c2.d > 0) { px -= c2.nx * c2.d; py -= c2.ny * c2.d; } if (live.some((o) => Math.hypot(o.x - px, o.y - py) < o.r + b.r + 1)) continue; b.x = px; b.y = py; b.vx = (rnd() - 0.5) * 0.3 * vMax; b.vy = 0.22 * vMax; b.a = (rnd() - 0.5) * 50; b.w = (rnd() - 0.5) * 2 * W_MAX; b.live = true; live.push(b); return true; } return false; };
    let f = 0;
    for (; f < frames; f++) {
      const tMs = f * 1000 / hz;
      for (const b of bodies) if (!b.live && b.born <= tMs && !spawn(b)) b.born = tMs + 1000 / hz;
      for (const b of live) { if (b.sleep) continue; b.vy += G * dt; const sp = Math.hypot(b.vx, b.vy); if (sp > vMax) { b.vx *= vMax / sp; b.vy *= vMax / sp; } b.x += b.vx * dt; b.y += b.vy * dt; b.a += b.w * dt * 180 / Math.PI; b.w *= Math.exp(-(b.touch ? 7 : 1.2) * dt); b.touch = false; }
      for (let it = 0; it < PASSES; it++) {
        for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
          const p = live[i], q = live[j]; if (p.sleep && q.sleep) continue;
          const dx = q.x - p.x, dy = q.y - p.y, rr = p.r + q.r, d2 = dx * dx + dy * dy; if (d2 >= rr * rr) continue;
          const dist = Math.sqrt(d2) || 1e-6, nx = dx / dist, ny = dy / dist, rvx = q.vx - p.vx, rvy = q.vy - p.vy, vn = rvx * nx + rvy * ny;
          if (vn < -40) { if (p.sleep) { p.sleep = false; p.still = 0; } if (q.sleep) { q.sleep = false; q.still = 0; } }
          const ip = p.sleep ? 0 : 1, iq = q.sleep ? 0 : 1; if (!ip && !iq) continue; p.touch = q.touch = true;
          if (vn < 0) { const e = it === 0 && vn < -60 ? E_BODY : 0, jn = -(1 + e) * vn / (ip + iq); p.vx -= jn * nx * ip; p.vy -= jn * ny * ip; q.vx += jn * nx * iq; q.vy += jn * ny * iq; const tx = -ny, ty = nx, vt = rvx * tx + rvy * ty, jt = Math.max(-MU * jn, Math.min(MU * jn, -vt / (ip + iq))); p.vx -= jt * tx * ip; p.vy -= jt * ty * ip; q.vx += jt * tx * iq; q.vy += jt * ty * iq; if (e) { p.w -= ip * vt / p.r * SPIN; q.w += iq * vt / q.r * SPIN; } }
          const over = rr - dist - 0.2; if (over > 0) { const k = 0.5 * over / (ip + iq); p.x -= nx * k * ip; p.y -= ny * k * ip; q.x += nx * k * iq; q.y += ny * k * iq; }
        }
        for (const b of live) { if (b.sleep) continue; const c2 = inside(b); if (c2.d <= 0) continue; b.x -= c2.nx * c2.d; b.y -= c2.ny * c2.d; b.touch = true; const vn = b.vx * c2.nx + b.vy * c2.ny; if (vn > 0) { const e = it === 0 && vn > 60 ? E_WALL : 0; b.vx -= (1 + e) * vn * c2.nx; b.vy -= (1 + e) * vn * c2.ny; const tx = -c2.ny, ty = c2.nx, vt = b.vx * tx + b.vy * ty, jt = Math.max(-MU * vn, Math.min(MU * vn, -vt)); b.vx += jt * tx; b.vy += jt * ty; if (e) b.w += vt / b.r * SPIN; } }
      }
      for (const b of live) { if (b.sleep) continue; if (Math.abs(b.w) > W_MAX) b.w = W_MAX * Math.sign(b.w); if (Math.hypot(b.vx, b.vy) < vRest && Math.abs(b.w) < 0.8) { if (++b.still > hz / 4) { b.sleep = true; b.vx = b.vy = b.w = 0; } } else b.still = 0; }
      for (const b of live) { if (b.at < 0) b.at = f; b.tx[f] = b.x; b.ty[f] = b.y; b.ta[f] = b.a; }
      if (tMs > pourMs && live.length === bodies.length && live.every((b) => b.sleep)) { f++; break; }
    }
    for (; f < frames; f++) for (const b of live) { b.tx[f] = b.x; b.ty[f] = b.y; b.ta[f] = b.a; }
    return { hz, end, fadeAt: holdMs, fadeMs, bodies: bodies.filter((b) => b.at >= 0).map((b) => ({ d: b.d, born: b.at * 1000 / hz, x: b.tx.subarray(b.at), y: b.ty.subarray(b.at), a: b.ta.subarray(b.at) })) };
  };
  SS.floodAt = (sim, b, ms) => { const f = Math.max(0, (ms - b.born) * sim.hz / 1000), n = b.x.length, i = Math.min(n - 1, Math.floor(f)), j = Math.min(n - 1, i + 1), u = Math.min(1, f - i); return { x: b.x[i] + (b.x[j] - b.x[i]) * u, y: b.y[i] + (b.y[j] - b.y[i]) * u, a: b.a[i] + (b.a[j] - b.a[i]) * u }; };

  SS.IDEAS = [];
  SS.idea = (o) => SS.IDEAS.push(o);
})();

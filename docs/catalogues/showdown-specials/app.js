/* The page: the cards, the filters, the picks, and one loop that draws the cards on screen. */
(function () {
  const SS = window.SS, PERIOD = 8000;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ZONES = [['all', 'All'], ['felt', 'The felt'], ['rail', 'The rail'], ['out', 'Around the table']];
  const ZONE_INFO = { felt: ['The felt', 'On the cloth inside the rail, under every card, chip and seat.'], rail: ['The rail', 'On the padded rail, passing under the seats’ plaques.'], out: ['Around the table', 'In the room behind and around the table.'] };
  const ORDER = ['felt', 'rail', 'out'];
  const ideas = ORDER.flatMap((z) => SS.IDEAS.filter((i) => i.zone === z)).map((idea, k) => ({ ...idea, n: k + 1 }));
  let fz = 'all', fh = 'all';
  const KEY = 'showdown-picks-v2';
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (_) { return []; } };
  const save = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (_) { /* private window */ } };
  let picks = new Set(load());
  const cards = [];
  const list = document.getElementById('list');
  const failed = new Set();

  function size(cv) {
    const r = cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1), w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (w && (cv.width !== w || cv.height !== h)) { cv.width = w; cv.height = h; cv.__dpr = dpr; return true; }
    return false;
  }
  function hook(card, name, X) {
    const fn = card.idea[name]; if (!fn) return;
    X.c.save();
    try { fn.call(card.idea, X); } catch (err) { if (!failed.has(card.idea.title)) { failed.add(card.idea.title); console.error(card.idea.title, err); } }
    X.c.restore();
  }
  function draw(card, t) {
    const cv = card.cv, dpr = cv.__dpr || 1, W = cv.width / dpr, Hh = cv.height / dpr; if (!W) return;
    if (!card.G || card.G.W !== W || card.G.H !== Hh) { card.G = SS.geo(W, Hh); card.layers = null; card.S = {}; }
    if (!card.H || card.hw !== card.which) { card.H = SS.hand(card.idea.cat, card.which); card.hw = card.which; card.L = SS.layout(card.G, card.H); card.layers = null; card.S = {}; }
    if (!card.layers) { card.L = SS.layout(card.G, card.H); card.layers = SS.tableLayers(card.G, card.H, card.L, dpr); }
    const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    const G = card.G, X = { c, G, H: card.H, L: card.L, t, S: card.S, dpr };
    SS.room(c, G);
    hook(card, 'back', X);
    c.drawImage(card.layers.under, 0, 0, W, Hh);
    if (card.idea.rail) { c.save(); SS.clipRing(c, G); hook(card, 'rail', X); c.restore(); }
    if (card.idea.felt) { c.save(); SS.clipFelt(c, G); hook(card, 'felt', X); c.restore(); }
    c.drawImage(card.layers.light, 0, 0, W, Hh);
    if (card.idea.light) { c.save(); SS.clipFelt(c, G); hook(card, 'light', X); c.restore(); }
    c.drawImage(card.layers.pieces, 0, 0, W, Hh);
    hook(card, 'top', X);
  }

  /* The built one: the replayer's own flood physics on this table. */
  const built = {
    idea: { cat: 'flush', title: 'Flush flood', felt(X) {
      const { c, G, H, t, S } = X, ms = (t - 0.6) * 1000; if (ms < 0) return;
      if (!S.sim || S.sim.key !== G.W) { const sim = SS.simulateFlood({ w: 2 * G.fw, h: 2 * G.fh, radius: G.fh, size: G.H * 0.07, seed: 'hand' + H.spec.hero }); sim.key = G.W; S.sim = sim; }
      const sim = S.sim; if (ms > sim.end) return;
      const fade = 1 - SS.clamp((ms - sim.fadeAt) / sim.fadeMs, 0, 1), x0 = G.cx - G.fw, y0 = G.cy - G.fh;
      for (const b of sim.bodies) { if (ms < b.born) continue; const p = SS.floodAt(sim, b, ms), age = ms - b.born, a = age >= 200 ? 1 : SS.sm(0, 1, age / 200); SS.suit(c, H.suit, x0 + p.x, y0 + p.y, b.d, p.a * Math.PI / 180, SS.INK, 0.2 * a * fade); }
    } },
    which: 0, S: {},
  };

  function chip(label, n, on, fn) { const b = document.createElement('button'); b.className = 'chip'; b.type = 'button'; b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.innerHTML = label + (n != null ? `<span class="n">${n}</span>` : ''); b.addEventListener('click', fn); return b; }
  function renderFilters() {
    const zr = document.getElementById('zones'); zr.innerHTML = '';
    ZONES.forEach(([k, l]) => zr.appendChild(chip(l, ideas.filter((i) => k === 'all' || i.zone === k).length, fz === k, () => { fz = k; renderFilters(); renderList(); })));
    const pk = document.createElement('div'); pk.className = 'picks'; pk.innerHTML = `Picked <strong id="pc">${picks.size}</strong>`;
    const cp = document.createElement('button'); cp.className = 'copy'; cp.type = 'button'; cp.textContent = 'Copy picks'; cp.disabled = !picks.size; cp.id = 'copy';
    cp.addEventListener('click', () => {
      const text = 'Showdown picks: ' + [...picks].sort((a, b) => a - b).join(', ');
      const done = () => { cp.textContent = 'Copied'; setTimeout(() => { cp.textContent = 'Copy picks'; }, 1600); };
      const fallback = () => { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); done(); } catch (_) { /* nothing */ } ta.remove(); };
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
    });
    pk.appendChild(cp); zr.appendChild(pk);
    const hr = document.getElementById('hands'); hr.innerHTML = '';
    hr.appendChild(chip('Every hand', null, fh === 'all', () => { fh = 'all'; renderFilters(); renderList(); }));
    SS.HAND_ORDER.forEach((k) => { const n = ideas.filter((i) => i.cat === k).length; if (n) hr.appendChild(chip(SS.HAND_LABEL[k], n, fh === k, () => { fh = k; renderFilters(); renderList(); })); });
  }
  function updatePicks() { const pc = document.getElementById('pc'); if (pc) pc.textContent = picks.size; const cp = document.getElementById('copy'); if (cp) cp.disabled = !picks.size; save([...picks]); }

  const io = new IntersectionObserver((es) => es.forEach((en) => { en.target.__vis = en.isIntersecting; if (en.isIntersecting) size(en.target); }), { rootMargin: '160px' });
  function renderList() {
    cards.forEach((x) => io.unobserve(x.cv)); cards.length = 0; list.innerHTML = '';
    const shown = ideas.filter((i) => (fz === 'all' || i.zone === fz) && (fh === 'all' || i.cat === fh));
    if (!shown.length) { list.innerHTML = '<p class="empty">No ideas for that hand in this part of the table. Pick another hand or area.</p>'; return; }
    for (const z of ORDER) {
      const these = shown.filter((i) => i.zone === z); if (!these.length) continue;
      const head = document.createElement('div'); head.className = 'zone-head'; head.innerHTML = `<h2>${ZONE_INFO[z][0]}</h2><p>${ZONE_INFO[z][1]}</p>`; list.appendChild(head);
      const grid = document.createElement('div'); grid.className = 'grid'; list.appendChild(grid);
      for (const idea of these) {
        const n = idea.n, el = document.createElement('article'); el.className = 'card' + (picks.has(n) ? ' on' : '');
        const many = SS.handCount(idea.cat) > 1;
        el.innerHTML = `<canvas aria-label="Demo: ${idea.title}"></canvas><div class="body"><div class="top"><span class="num">${String(n).padStart(2, '0')}</span><h3>${idea.title}</h3></div><p>${idea.desc}</p><p class="drives"><b>Built from</b> ${idea.drives}</p><div class="meta"><span class="z ${idea.zone}">${idea.zone === 'out' ? 'Room' : idea.zone === 'felt' ? 'Felt' : 'Rail'}</span><span class="fits">Fits <b>${SS.HAND_LABEL[idea.cat]}</b></span>${many ? '<button class="deal" type="button">Another hand</button>' : ''}<button class="pick" type="button" aria-pressed="${picks.has(n)}">${picks.has(n) ? 'Picked' : 'Pick'}</button></div></div>`;
        const card = { idea, n, cv: el.querySelector('canvas'), which: 0, off: (n * 1337) % PERIOD, start: 0 };
        el.querySelector('.pick').addEventListener('click', (ev) => { const pb = ev.currentTarget; if (picks.has(n)) picks.delete(n); else picks.add(n); const on = picks.has(n); el.classList.toggle('on', on); pb.setAttribute('aria-pressed', on); pb.textContent = on ? 'Picked' : 'Pick'; updatePicks(); });
        const deal = el.querySelector('.deal'); if (deal) deal.addEventListener('click', () => { card.which++; card.restart = true; if (reduce) { size(card.cv); draw(card, 3.8); } });
        grid.appendChild(el); cards.push(card); io.observe(card.cv);
        if (reduce) requestAnimationFrame(() => { size(card.cv); draw(card, 3.8); });
      }
    }
  }

  const bcv = document.getElementById('built'); built.cv = bcv; bcv.__vis = true;
  new ResizeObserver(() => { size(bcv); if (reduce) draw(built, 3.0); }).observe(bcv);
  renderFilters(); renderList();
  window.addEventListener('resize', () => cards.forEach((x) => x.cv.__vis && size(x.cv)));
  SS.freeze = null;
  if (reduce) return;
  function frame(now) {
    const T = (card) => { if (card.restart) { card.off = (PERIOD - (now % PERIOD)) % PERIOD; card.restart = false; } return SS.freeze != null ? SS.freeze : ((now + card.off) % PERIOD) / 1000; };
    if (bcv.width) draw(built, T(built));
    for (const card of cards) if (card.cv.__vis && card.cv.width) draw(card, T(card));
    requestAnimationFrame(frame);
  }
  built.off = 0;
  requestAnimationFrame(frame);
})();

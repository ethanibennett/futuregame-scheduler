/* The special showdowns' moments on the felt (utils/showdown-specials.js decides which hand earns which and works the
   motion out). Everything rides the table's spring registry as ONE entry, the flood's own fade, with each symbol's
   flight as that entry's extra animation: Back and a jump finish it (the flood leaves with the entry), and an export
   seeks every symbol with it. Under Reduce Motion the registry runs nothing and nothing is added. */
import '../showdown-specials.css';
import { simulateFlood } from './showdown-specials.js';

/* The four suits, drawn (a text suit is an emoji on some phones), each centred in a 100 x 100 box. */
const CIRCLE = (cx, cy, r) => `M${cx - r} ${cy} a${r} ${r} 0 1 0 ${2 * r} 0 a${r} ${r} 0 1 0 ${-2 * r} 0 Z`;
export const SUIT_PATHS = {
  h: 'M50 90 C47 87 8 61 6 35 C4 19 15 8 29 8 C39 8 46 14 50 22 C54 14 61 8 71 8 C85 8 96 19 94 35 C92 61 53 87 50 90 Z',
  d: 'M50 4 L85 50 L50 96 L15 50 Z',
  s: 'M50 5 C56 16 92 38 94 60 C95 74 85 83 73 83 C64 83 57 79 54 72 C55 84 59 91 66 95 L34 95 C41 91 45 84 46 72 C43 79 36 83 27 83 C15 83 5 74 6 60 C8 38 44 16 50 5 Z',
  c: CIRCLE(50, 27, 19) + ' ' + CIRCLE(27, 57, 19) + ' ' + CIRCLE(73, 57, 19) + ' ' + CIRCLE(50, 51, 11)
    + ' M46 56 L54 56 L56 74 C57 85 61 91 67 95 L33 95 C39 91 43 85 44 74 Z',
};

/* A symbol's diameter, in g (the table's: --gu on the felt). */
const SIZE_G = 2.75;
/* Each symbol fades in over this as it is born (flood ms). */
const BORN_FADE = 200;

/* The last few floods worked out, by their box and seed: a hand stepped back and forward again, or exported, pours the
   same flood without working it out again. */
const cache = new Map();
function floodFor(args) {
  const key = [args.w, args.h, args.radius, args.size].map((v) => Math.round(v * 10)).join('x') + '|' + args.seed;
  let sim = cache.get(key);
  if (!sim) {
    sim = simulateFlood(args);
    if (cache.size >= 4) cache.delete(cache.keys().next().value);
    cache.set(key, sim);
  }
  return sim;
}

/* The flood's first run is the engine compiling it (100ms and more where the next is 20): run a small one once, when
   the page is idle, so the showdown's frame never pays for it. */
let warmed = false;
export function warmSuitFlood() {
  if (warmed || typeof window === 'undefined') return;
  warmed = true;
  const go = () => { try { simulateFlood({ w: 320, h: 520, size: 30, count: 40, holdMs: 2200, fadeMs: 200, seed: 'warm' }); } catch (e) { /* never break the replay */ } };
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(go, { timeout: 4000 }); else setTimeout(go, 1500);
}

/* The felt's corner radius in px (a pill's is half its short side; a percentage is of the box). */
function cornerOf(felt, w, h) {
  const raw = getComputedStyle(felt).borderTopLeftRadius || '';
  const parts = raw.split(/\s+/).filter(Boolean).map((v, i) => (v.endsWith('%') ? parseFloat(v) / 100 * (i ? h : w) : parseFloat(v)));
  const r = parts.length ? Math.min(...parts.filter(Number.isFinite)) : Math.min(w, h) / 2;
  return Math.min(Number.isFinite(r) ? r : Math.min(w, h) / 2, w / 2, h / 2);
}

const smooth = (p) => p * p * (3 - 2 * p);
const n2 = (v) => Math.round(v * 100) / 100;

/**
 * The flush flood: the suit pours onto the cloth inside the rail at the watermark's strength, the symbols bounce off
 * each other and the rail and pile up, then the flood fades.
 *   motion     the table's MotionRegistry
 *   table      the .replayer-table
 *   suit       's' | 'h' | 'd' | 'c'
 *   seed       text that names the hand (the same hand pours the same way)
 *   delay      ms on the moment's clock before the first symbol is born
 *   timeScale  flood ms per moment ms (the replay's rate over its pace: 1 on screen)
 */
export function playSuitFlood(motion, { table, suit, seed, delay = 0, timeScale = 1 }) {
  const felt = table && table.querySelector('.replayer-table-felt');
  if (!motion || !felt || !SUIT_PATHS[suit]) return null;
  return motion.defer((late) => {
    const w = felt.clientWidth, h = felt.clientHeight;
    if (!(w > 0 && h > 0)) return;
    const layer = document.createElement('div');
    layer.className = 'replayer-flood';
    layer.setAttribute('aria-hidden', 'true');
    const ink = document.createElement('div');
    ink.className = 'replayer-flood-ink';
    layer.appendChild(ink);
    felt.appendChild(layer);
    const make = (k) => {
      const el = document.createElement('span');
      el.className = 'replayer-flood-suit';
      el.style.width = `calc(var(--gu) * ${n2(SIZE_G * k)})`;
      el.innerHTML = `<svg viewBox="0 0 100 100" focusable="false"><path d="${SUIT_PATHS[suit]}"/></svg>`;
      return el;
    };
    const probe = make(1);
    ink.appendChild(probe);
    const size = probe.getBoundingClientRect().width;
    probe.remove();
    if (!(size > 0)) { layer.remove(); return; }
    const sim = floodFor({ w, h, radius: cornerOf(felt, w, h), size, seed: String(seed || '') + '|' + suit });
    const ts = Math.max(0.05, timeScale);
    const start = delay - late;
    const extras = [];
    for (const b of sim.bodies) {
      const el = make(b.d / size);
      ink.appendChild(el);
      // A keyframe a frame at 60 fps while it moves; once it lies still, one last keyframe holds it.
      const frames = [];
      const step = sim.hz / 60;
      const life = sim.end - b.born;
      // A run of equal frames keeps its first and its last, so a symbol knocked loose from rest leaves from where it lay.
      let last = null, held = null;
      for (let k = 0; k < b.x.length; k += step) {
        const t = k * 1000 / sim.hz;
        const x = b.x[k] - b.d / 2, y = b.y[k] - b.d / 2, a = b.a[k];
        const o = t >= BORN_FADE ? 1 : smooth(t / BORN_FADE);
        const key = n2(x) + ',' + n2(y) + ',' + n2(a) + ',' + o;
        const frame = { offset: Math.min(1, t / life), transform: `translate(${n2(x)}px, ${n2(y)}px) rotate(${n2(a)}deg)`, opacity: o };
        if (key === last) { held = frame; continue; }
        if (held) { frames.push(held); held = null; }
        last = key;
        frames.push(frame);
      }
      if (held) frames.push(held);
      if (frames[frames.length - 1].offset < 1) frames.push({ ...frames[frames.length - 1], offset: 1 });
      extras.push({ el, frames, options: { duration: life / ts, delay: start + b.born / ts, easing: 'linear', fill: 'both' } });
    }
    const end = start + sim.end / ts;
    const entry = motion.run(layer, {
      transient: true, size: { w, h }, end: Math.max(1, end), extras,
      channels: [{ prop: 'opacity', ramp: { from: 1, to: 0, delay: Math.max(0, start + sim.fadeAt / ts), duration: sim.fadeMs / ts } }],
    });
    if (!entry) layer.remove();
  });
}

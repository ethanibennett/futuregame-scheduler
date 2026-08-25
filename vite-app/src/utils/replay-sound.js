// ── Replay sound ──
//
// 99: the settings panel shipped a "Sound (Coming Soon)" group with four
// disabled rows — card deal, chips, fold, all-in — for long enough that it had
// accumulated its own accessibility treatment. A permanently disabled feature
// group is a promise the interface keeps making and never keeps.
//
// These are synthesised rather than sampled, which means no asset to fetch, no
// licence to track, nothing to add to the bundle, and no cold-start delay on
// the first card of a hand. Each one is a short shaped noise or tone burst
// through the Web Audio API — a poker table's sounds are all impulses, so this
// is the medium that suits them.
//
// The context is created on the first *user-initiated* play and never before:
// browsers suspend an AudioContext created outside a gesture, and a suspended
// context that silently swallows every sound is worse than no sound at all.

let ctx = null;
let master = null;

function audio() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.35;
  master.connect(ctx.destination);
  return ctx;
}

/** A short burst of filtered noise — the body of every card and chip sound. */
function noise(c, { dur, type, freq, q, gain, attack = 0.002, curve = 3 }) {
  const frames = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, frames, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    // A decaying envelope baked into the buffer: cheaper than a second gain
    // node per hit, and these fire several times a second during a deal.
    const t = i / frames;
    d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, curve);
  }
  const src = c.createBufferSource();
  src.buffer = buf;
  const filt = c.createBiquadFilter();
  filt.type = type;
  filt.frequency.value = freq;
  if (q) filt.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, c.currentTime);
  g.gain.exponentialRampToValueAtTime(gain, c.currentTime + attack);
  src.connect(filt).connect(g).connect(master);
  src.start();
  return src;
}

/** A pitched blip — used only where a real table has metal or a voice. */
function tone(c, { freq, to, dur, gain, type = 'sine', at = 0 }) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, c.currentTime + at);
  if (to) o.frequency.exponentialRampToValueAtTime(to, c.currentTime + at + dur);
  g.gain.setValueAtTime(0.0001, c.currentTime + at);
  g.gain.exponentialRampToValueAtTime(gain, c.currentTime + at + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + at + dur);
  o.connect(g).connect(master);
  o.start(c.currentTime + at);
  o.stop(c.currentTime + at + dur + 0.02);
}

const VOICES = {
  // A card sliding off the deck and onto cloth: a bright, very short hiss.
  deal(c) {
    noise(c, { dur: 0.085, type: 'bandpass', freq: 2600, q: 0.8, gain: 0.5, curve: 4 });
  },
  // Clay on clay. Two close hits, because chips never arrive alone, plus a
  // narrow resonance where the ceramic rings.
  chips(c) {
    noise(c, { dur: 0.07, type: 'bandpass', freq: 1750, q: 4, gain: 0.42, curve: 5 });
    setTimeout(() => { const a = audio(); if (a) noise(a, { dur: 0.06, type: 'bandpass', freq: 2100, q: 5, gain: 0.3, curve: 6 }); }, 42);
  },
  // Cards pushed away: lower, softer, longer, with no attack to speak of.
  fold(c) {
    noise(c, { dur: 0.22, type: 'lowpass', freq: 900, gain: 0.3, attack: 0.02, curve: 2 });
  },
  // The one moment that earns a pitch: a rising pair under a chip push.
  allIn(c) {
    noise(c, { dur: 0.14, type: 'bandpass', freq: 1600, q: 3, gain: 0.34, curve: 4 });
    tone(c, { freq: 330, to: 495, dur: 0.34, gain: 0.16, type: 'triangle' });
    tone(c, { freq: 660, to: 990, dur: 0.30, gain: 0.07, type: 'sine', at: 0.05 });
  },
};

/**
 * Play one of the four table sounds.
 *
 * @param {'deal'|'chips'|'fold'|'allIn'} name
 * @param {object} settings - the replayer's settings object
 */
export function playTableSound(name, settings) {
  const on = {
    deal: settings?.soundDeal,
    chips: settings?.soundChips,
    fold: settings?.soundFold,
    allIn: settings?.soundAllIn,
  }[name];
  if (!on) return;
  // Someone who has asked for less motion has usually asked for less of this
  // too; there is no separate media query for it, and it is the closest signal.
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const c = audio();
  if (!c) return;
  if (c.state === 'suspended') c.resume();
  try { VOICES[name]?.(c); } catch { /* an audio failure is never worth a crash */ }
}

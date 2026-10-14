// Side-by-side before | after videos of the replayer's motion, from two capture-replayer-motion.mjs
// runs of the SAME build (localStorage.replayerSprings '0' and '1', or any two flags).
//
//   node scripts/compare-replayer-motion.mjs --before <dir> --after <dir> --out <dir>
//        [--before-label "Before · today"] [--after-label "After · springs, Set A"]
//        [--seats 6,8,9] [--moments flop,turn,river,bet,call,push] [--sizes 402x874,1440x900]
//        [--reel-size 402x874]
//
// For every moment and size present in both directories:
//   <moment>-<n>max-<w>x<h>.mp4        real time, 60 fps
//   <moment>-<n>max-<w>x<h>-0.5x.mp4   half speed (each frame held twice), for reading the curves
// and one reel per --reel-size: every moment at every seat count, back to back (reel-<w>x<h>.mp4).
//
// Both clips start the same number of frames before the press (the harness's lead-in), so they are
// aligned at the press; the shorter is held on its last frame until the longer ends, plus half a
// second. A counter shows the time from the press in ms of REAL time (also on the slow version).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const BEFORE = path.resolve(opt('--before', 'replayer-motion-before'));
const AFTER = path.resolve(opt('--after', 'replayer-motion-after'));
const OUT = path.resolve(opt('--out', 'replayer-motion-compare'));
const LB = opt('--before-label', 'Before · today');
const LA = opt('--after-label', 'After · springs, Set A');
const SEATS = String(opt('--seats', '6,8,9')).split(',');
const MOMENTS = String(opt('--moments', 'flop,turn,river,bet,call,push')).split(',');
const SIZES = String(opt('--sizes', '402x874,1440x900')).split(',');
const REELS = String(opt('--reel-size', '402x874')).split(',').filter(Boolean);
const FFMPEG = fs.existsSync('C:/ffmpeg/bin/ffmpeg.exe') ? 'C:/ffmpeg/bin/ffmpeg.exe' : 'ffmpeg';
const FFPROBE = FFMPEG.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1');
const FPS = 60, LEAD = 12, HOLD = 30;
// Fonts: the app's display face for the labels where it is on disk, a system sans for the rest.
const font = (cands) => cands.find(f => fs.existsSync(f)) || '';
const DISPLAY = font(['D:/projects/scheduler/vite-app/public/fonts/baskerville-regular.otf', 'C:/Windows/Fonts/georgia.ttf']);
const SANS = font(['C:/Windows/Fonts/bahnschrift.ttf', 'C:/Windows/Fonts/arial.ttf']);
const ff = (p) => p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1\\:');
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\u2019").replace(/%/g, '\\%');
const AQUA = '0x3CC8E0';

const MOMENT_NAME = {
  flop: 'The flop: dealt, squared, spread', turn: 'The turn: the row makes room, the card lands',
  river: 'The river', bet: 'A bet: pushed out from the seat', call: 'A call, from another seat',
  push: 'The pot shipped to the winner',
};
fs.mkdirSync(OUT, { recursive: true });

const probe = (file) => {
  const s = String(execFileSync(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-count_packets',
    '-show_entries', 'stream=width,height,nb_read_packets', '-of', 'csv=p=0', file])).trim().split(',');
  return { w: +s[0], h: +s[1], n: +s[2] };
};

/* One comparison: both clips scaled to `colW` wide, a label bar over each, a title bar over both,
   a counter in the corner of each. `slow` doubles every frame. */
function compare(beforeFile, afterFile, outFile, title, { slow = false, colW } = {}) {
  const a = probe(beforeFile), b = probe(afterFile);
  const n = Math.max(a.n, b.n) + HOLD;
  const cw = colW || Math.min(a.w, 1920);
  const ch = Math.round(a.h * cw / a.w / 2) * 2;
  const bar = Math.round(cw * 0.085 / 2) * 2, titleH = Math.round(cw * 0.11 / 2) * 2;
  const fsLabel = Math.round(bar * 0.48), fsTitle = Math.round(titleH * 0.36), fsSub = Math.round(titleH * 0.2), fsCount = Math.round(bar * 0.36);
  // In the label bar, right-aligned: over the felt it covered the replayer's own settings button.
  const counter = `drawtext=fontfile='${ff(SANS)}':text='%{eif\\:max(0\\,(n-${LEAD})*1000/${FPS})\\:d} ms':x=w-tw-${Math.round(bar * 0.4)}:y=(${bar}-th)/2:fontsize=${fsCount}:fontcolor=white@0.75`;
  const col = (i, src, label, accent) =>
    `[${i}:v]tpad=stop_mode=clone:stop=${n - src.n},scale=${cw}:${ch}:flags=lanczos,setsar=1,`
    + `pad=${cw}:${ch + bar}:0:${bar}:color=0x0E0C13,`
    + `drawbox=x=0:y=${bar - Math.max(4, Math.round(bar * 0.06))}:w=${cw}:h=${Math.max(4, Math.round(bar * 0.06))}:color=${accent}:t=fill,`
    + `drawtext=fontfile='${ff(DISPLAY)}':text='${esc(label)}':x=(w-tw)/2:y=(${bar}-th)/2-${Math.round(bar * 0.04)}:fontsize=${fsLabel}:fontcolor=white,`
    + `${counter}[c${i}]`;
  const sub = slow ? 'Half speed (0.5x): every frame held twice. The counter is real time from the press.' : 'Real time, 60 fps, frame-accurate capture (Playwright WebKit, virtual time). The counter is ms from the press.';
  const graph = [
    col(0, a, LB, '0x55505F'),
    col(1, b, LA, AQUA),
    `[c0][c1]hstack=inputs=2,pad=iw:ih+${titleH}:0:${titleH}:color=0x0E0C13,`
    + `drawtext=fontfile='${ff(DISPLAY)}':text='${esc(title)}':x=${Math.round(titleH * 0.3)}:y=${Math.round(titleH * 0.16)}:fontsize=${fsTitle}:fontcolor=white,`
    + `drawtext=fontfile='${ff(SANS)}':text='${esc(sub)}':x=${Math.round(titleH * 0.3)}:y=${Math.round(titleH * 0.62)}:fontsize=${fsSub}:fontcolor=white@0.7`
    + (slow ? `,setpts=2*PTS,fps=${FPS}` : '') + ',format=yuv420p[v]',
  ].join(';');
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', beforeFile, '-i', afterFile, '-filter_complex', graph, '-map', '[v]',
    '-r', String(FPS), '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-threads', '4', '-movflags', '+faststart', '-an', outFile]);
  const got = probe(outFile).n, want = slow ? n * 2 : n;
  if (Math.abs(got - want) > 2) throw new Error(`${path.basename(outFile)}: ${got} frames, expected ${want}`);
  return outFile;
}

const done = [];
const pairs = [];
for (const size of SIZES) for (const seats of SEATS) for (const m of MOMENTS) {
  const name = `${m}-${seats}max-${size}`;
  const bf = path.join(BEFORE, name + '.mp4'), af = path.join(AFTER, name + '.mp4');
  if (!fs.existsSync(bf) || !fs.existsSync(af)) continue;
  pairs.push({ size, seats, m, name, bf, af });
}
for (const p of pairs) {
  const [w, h] = p.size.split('x');
  const title = `${MOMENT_NAME[p.m] || p.m}  ·  ${p.seats}-max  ·  ${w}×${h}`;
  const colW = Number(w) >= 1000 ? 1600 : 1206;
  for (const slow of [false, true]) {
    const out = path.join(OUT, p.name + (slow ? '-0.5x' : '') + '.mp4');
    try { compare(p.bf, p.af, out, title, { slow, colW }); done.push(out); console.log('wrote', out); }
    catch (e) { console.log('FAILED', out, String(e.stderr || e.message).split(/\r?\n/)[0]); }
  }
}
// Reels: every moment at every seat count at one size, real time, back to back.
for (const size of REELS) {
  const parts = SEATS.flatMap(seats => MOMENTS.map(m => path.join(OUT, `${m}-${seats}max-${size}.mp4`))).filter(f => fs.existsSync(f));
  if (!parts.length) continue;
  const list = path.join(OUT, `reel-${size}.txt`);
  fs.writeFileSync(list, parts.map(f => `file '${f.replace(/\\/g, '/')}'`).join('\n'));
  const out = path.join(OUT, `reel-${SEATS.join('-')}max-${size}.mp4`);
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', out]);
  fs.unlinkSync(list);
  console.log('wrote', out, '(' + parts.length + ' clips)');
}
console.log(done.length + ' comparisons');

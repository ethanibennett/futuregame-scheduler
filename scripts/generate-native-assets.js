/**
 * Items 85, 87, 88 — regenerate the native icon and splash assets.
 *
 * All three exist because the app shipped @capacitor/assets' defaults or
 * full-bleed art where a mask was expected. Everything here is derived from
 * vite-app/public/favicon.svg so there is one source for the mark.
 */
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage, registerFont } = require('canvas');

const ROOT = 'D:/projects/scheduler/';
const BG = '#111111';          // the app's own ground
const NAVY = '#0d1525';        // the launcher ground (matches favicon.svg's rect)

function markSvg() {
  let svg = fs.readFileSync(ROOT + 'vite-app/public/favicon.svg', 'utf8');
  return Buffer.from(svg.replace('<svg version="1.1"', '<svg width="1024" height="1024" version="1.1"'));
}
function splashIconSvg() {
  let svg = fs.readFileSync(ROOT + 'vite-app/public/splash-icon.svg', 'utf8');
  if (!/width="/.test(svg.slice(0, 400))) {
    svg = svg.replace(/<svg /, '<svg width="1024" height="1024" ');
  }
  return Buffer.from(svg);
}
const write = (p, canvas) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, canvas.toBuffer('image/png'));
  return `${path.relative(ROOT, p).replace(/\\/g, '/')}  ${(fs.statSync(p).size / 1024).toFixed(1)}KB`;
};

(async () => {
  const mark = await loadImage(markSvg());
  let splashMark;
  try { splashMark = await loadImage(splashIconSvg()); } catch { splashMark = mark; }
  const out = [];

  // ---- 85: the native splash was the stock Capacitor placeholder ---------
  // A blue-gradient "X" on PURE WHITE — vendor boilerplate on the wrong
  // background, cutting hard to a #111111 app. Three real densities rather
  // than one square copied three times.
  const splash = (size, ground) => {
    const c = createCanvas(size, size);
    const g = c.getContext('2d');
    g.fillStyle = ground;
    g.fillRect(0, 0, size, size);
    const m = Math.round(size * 0.22);          // mark at ~22% of the short edge
    g.drawImage(splashMark, (size - m) / 2, (size - m) / 2 - Math.round(size * 0.02), m, m);
    return c;
  };
  for (const [name, px] of [['splash-2732x2732.png', 2732],
                            ['splash-2732x2732-1.png', 2732],
                            ['splash-2732x2732-2.png', 2732]]) {
    out.push(write(ROOT + 'ios/App/App/Assets.xcassets/Splash.imageset/' + name, splash(px, BG)));
  }
  // light-appearance variant, so light-mode devices do not get a black flash
  out.push(write(ROOT + 'ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-light.png',
                 splash(2732, '#f5f5f5')));
  for (const d of ['drawable', 'drawable-land-hdpi', 'drawable-land-mdpi', 'drawable-land-xhdpi',
                   'drawable-land-xxhdpi', 'drawable-land-xxxhdpi', 'drawable-port-hdpi',
                   'drawable-port-mdpi', 'drawable-port-xhdpi', 'drawable-port-xxhdpi',
                   'drawable-port-xxxhdpi']) {
    const p = ROOT + 'android/app/src/main/res/' + d + '/splash.png';
    if (fs.existsSync(p)) out.push(write(p, splash(1920, BG)));
  }

  // ---- 87: the maskable safe zone ---------------------------------------
  // The Android foreground layer was byte-identical to the 192px web icon —
  // the whole navy square used as a FOREGROUND over a white background layer,
  // and upscaled into a 432px slot. A maskable icon needs its content inside
  // the central 80%; every circle/squircle mask was shaving the ring off.
  const foreground = (size) => {
    const c = createCanvas(size, size);
    const g = c.getContext('2d');
    const m = Math.round(size * 0.66);          // 66% keeps it clear of every mask
    g.drawImage(mark, (size - m) / 2, (size - m) / 2, m, m);
    return c;                                    // transparent ground on purpose
  };
  for (const [dir, px] of [['mipmap-xxxhdpi', 432], ['mipmap-xxhdpi', 324],
                           ['mipmap-xhdpi', 216], ['mipmap-hdpi', 162], ['mipmap-mdpi', 108]]) {
    out.push(write(ROOT + 'android/app/src/main/res/' + dir + '/ic_launcher_foreground.png', foreground(px)));
  }
  // a properly inset maskable icon for the web manifest
  const maskable = (size) => {
    const c = createCanvas(size, size);
    const g = c.getContext('2d');
    g.fillStyle = NAVY;
    g.fillRect(0, 0, size, size);               // navy bleeds to the edge
    const m = Math.round(size * 0.66);
    g.drawImage(mark, (size - m) / 2, (size - m) / 2, m, m);
    return c;
  };
  out.push(write(ROOT + 'vite-app/public/icon-512-maskable.png', maskable(512)));

  // ---- 88: iOS dark and tinted app icons ---------------------------------
  // One universal entry with no appearances array, so on iOS 18 dark and
  // tinted home screens the navy square sat as a bright block among
  // neighbours that had all gone dark or monochrome.
  const appicon = (variant) => {
    const size = 1024;
    const c = createCanvas(size, size);
    const g = c.getContext('2d');
    if (variant === 'dark') g.fillStyle = BG;
    else g.fillStyle = NAVY;
    if (variant !== 'tinted') { g.fillStyle = variant === 'dark' ? BG : NAVY; g.fillRect(0, 0, size, size); }
    const m = Math.round(size * 0.62);
    g.drawImage(mark, (size - m) / 2, (size - m) / 2, m, m);
    if (variant === 'dark') {
      g.globalCompositeOperation = 'multiply';
      g.fillStyle = 'rgba(232,232,232,0.85)';
      g.globalCompositeOperation = 'source-over';
    }
    if (variant === 'tinted') {
      // Single channel: the tinted pipeline flattens gradients to mud, so this
      // is a grayscale silhouette on transparent, not a recoloured icon.
      const d = g.getImageData(0, 0, size, size);
      for (let i = 0; i < d.data.length; i += 4) {
        const l = 0.2126 * d.data[i] + 0.7152 * d.data[i + 1] + 0.0722 * d.data[i + 2];
        d.data[i] = d.data[i + 1] = d.data[i + 2] = l;
      }
      g.putImageData(d, 0, 0);
    }
    return c;
  };
  const AI = ROOT + 'ios/App/App/Assets.xcassets/AppIcon.appiconset/';
  out.push(write(AI + 'AppIcon-512@2x-dark.png', appicon('dark')));
  out.push(write(AI + 'AppIcon-512@2x-tinted.png', appicon('tinted')));

  console.log(out.join('\n'));
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });

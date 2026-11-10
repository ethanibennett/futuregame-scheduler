#!/usr/bin/env node
// The square PNG icons (web 192/512, the iOS 1024, Android's launcher mipmaps), rendered from the app's
// mark, vite-app/public/favicon.svg (the one source; there is no second copy). Mac only (rsvg-convert, or
// qlmanage + sips). The maskable, adaptive, dark/tinted and splash assets are
// scripts/generate-native-assets.js, which owns Android's ic_launcher_foreground.png.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const publicDir = path.join(__dirname, 'vite-app', 'public');
const SVG_PATH = path.join(publicDir, 'favicon.svg');
const iosDir = path.join(__dirname, 'ios/App/App/Assets.xcassets/AppIcon.appiconset');
const androidBase = path.join(__dirname, 'android/app/src/main/res');

// Try rsvg-convert first (best SVG rendering), fall back to sips
function convertSvg(inputPath, outputPath, size) {
  try {
    execSync(`rsvg-convert -w ${size} -h ${size} "${inputPath}" -o "${outputPath}"`, { stdio: 'ignore' });
    return true;
  } catch {
    // Fall back to using qlmanage + sips
    try {
      const tmpPng = `/tmp/icon_tmp_${size}.png`;
      execSync(`qlmanage -t -s ${size} -o /tmp "${inputPath}" 2>/dev/null`, { stdio: 'ignore' });
      const qlOut = inputPath.replace(/.*\//, '/tmp/') + '.png';
      if (fs.existsSync(qlOut)) {
        execSync(`sips -z ${size} ${size} "${qlOut}" --out "${outputPath}" 2>/dev/null`, { stdio: 'ignore' });
        fs.unlinkSync(qlOut);
        return true;
      }
    } catch {}
    return false;
  }
}

// Check if rsvg-convert is available, install if not
try {
  execSync('which rsvg-convert', { stdio: 'ignore' });
} catch {
  console.log('Installing librsvg for SVG→PNG conversion...');
  try {
    execSync('brew install librsvg', { stdio: 'inherit' });
  } catch {
    console.error('Could not install librsvg. Please install: brew install librsvg');
    process.exit(1);
  }
}

// Generate all sizes
const targets = [
  { path: path.join(publicDir, 'icon-192.png'), size: 192 },
  { path: path.join(publicDir, 'icon-512.png'), size: 512 },
];

if (fs.existsSync(iosDir)) {
  targets.push({ path: path.join(iosDir, 'AppIcon-512@2x.png'), size: 1024 });
}

const androidSizes = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
for (const [density, size] of Object.entries(androidSizes)) {
  const dir = path.join(androidBase, `mipmap-${density}`);
  if (fs.existsSync(dir)) {
    targets.push({ path: path.join(dir, 'ic_launcher.png'), size });
    targets.push({ path: path.join(dir, 'ic_launcher_round.png'), size });
  }
}

let success = 0;
for (const t of targets) {
  if (convertSvg(SVG_PATH, t.path, t.size)) {
    success++;
  } else {
    console.error(`Failed: ${t.path}`);
  }
}

console.log(`Generated ${success}/${targets.length} PNG icons from vite-app/public/favicon.svg`);

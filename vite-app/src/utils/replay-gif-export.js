// ── Replay GIF Export ──
// Drives HandReplayerReplayView through all steps, capturing pixel-perfect
// screenshots via modern-screenshot (SVG foreignObject + inlined styles)
// and encoding as a dithered GIF with transparency for Instagram Stories.

/**
 * Floyd-Steinberg dithering — distributes quantization error to neighboring
 * pixels so the eye perceives smooth gradients even with only 256 colors.
 */
function ditherFrame(rgba, w, h, palette, transparentMask, tIdx) {
  const n = w * h;
  const rf = new Float32Array(n);
  const gf = new Float32Array(n);
  const bf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    rf[i] = rgba[i * 4];
    gf[i] = rgba[i * 4 + 1];
    bf[i] = rgba[i * 4 + 2];
  }

  const indices = new Uint8Array(n);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (transparentMask[i]) { indices[i] = tIdx; continue; }

      const or = rf[i], og = gf[i], ob = bf[i];

      // Find nearest palette color (skip transparent slot)
      let best = 0, bestD = Infinity;
      for (let p = 0; p < palette.length; p++) {
        if (p === tIdx) continue;
        const c = palette[p];
        const dr = c[0] - or, dg = c[1] - og, db = c[2] - ob;
        const d = dr * dr + dg * dg + db * db;
        if (d < bestD) { bestD = d; best = p; }
      }
      indices[i] = best;

      const c = palette[best];
      const er = or - c[0], eg = og - c[1], eb = ob - c[2];

      // Distribute error: right 7/16, bottom-left 3/16, bottom 5/16, bottom-right 1/16
      if (x + 1 < w && !transparentMask[i + 1]) {
        rf[i + 1] += er * 0.4375; gf[i + 1] += eg * 0.4375; bf[i + 1] += eb * 0.4375;
      }
      if (y + 1 < h) {
        if (x > 0 && !transparentMask[i + w - 1]) {
          rf[i+w-1] += er * 0.1875; gf[i+w-1] += eg * 0.1875; bf[i+w-1] += eb * 0.1875;
        }
        if (!transparentMask[i + w]) {
          rf[i+w] += er * 0.3125; gf[i+w] += eg * 0.3125; bf[i+w] += eb * 0.3125;
        }
        if (x + 1 < w && !transparentMask[i + w + 1]) {
          rf[i+w+1] += er * 0.0625; gf[i+w+1] += eg * 0.0625; bf[i+w+1] += eb * 0.0625;
        }
      }
    }
  }
  return indices;
}

/**
 * Export the current replay hand as a GIF with transparent background.
 * Uses modern-screenshot for pixel-perfect DOM capture and gifenc for
 * encoding with Floyd-Steinberg dithering for smooth gradients.
 */
export async function exportReplayGif({
  hand,
  tableEl,
  stepForward,
  canGoForwardRef,
  frameDelay = 900,
  scale,
  onProgress,
  onDone,
  onError,
}) {
  const origPadTop = tableEl.style.paddingTop;
  const origMarginTop = tableEl.style.marginTop;
  try {
    const [{ domToCanvas }, gifenc] = await Promise.all([
      import('modern-screenshot'),
      import('gifenc'),
    ]);
    const { GIFEncoder, quantize } = gifenc;

    const totalSteps = hand.streets.reduce(
      (sum, s) => sum + 1 + (s.actions?.length || 0), 0
    ) + 1;

    // Add padding so overflowing cards at the top seat aren't clipped
    tableEl.style.paddingTop = '50px';
    tableEl.style.marginTop = '0px';
    await new Promise(r => setTimeout(r, 30));

    const elW = tableEl.offsetWidth;
    const elH = tableEl.offsetHeight;
    const dpr = window.devicePixelRatio || 2;
    // Cap the captured longest edge at 1620px. Instagram Stories renders at
    // 1080×1920; encoding our 2:3 felt at longest-edge 1620 yields 1080×1620
    // — which IG drops into Story at exact horizontal resolution with the
    // transparent margin showing above/below. No upscaling = no pixelation.
    // (We previously capped at 720 for the URL-scheme pasteboard's ~8MB
    // limit; the share-sheet path tolerates tens of MB, so we can go big.)
    const MAX_EDGE = 1620;
    const longest = Math.max(elW, elH);
    const cappedScale = Math.min(scale || dpr, MAX_EDGE / longest);
    const s = Math.max(cappedScale, 0.5);

    // Capture all frames first
    const frames = [];
    const delays = [];
    let frameW = 0, frameH = 0, step = 0;

    const captureFrame = async (isLast) => {
      const canvas = await domToCanvas(tableEl, {
        backgroundColor: null,
        width: elW,
        height: elH,
        scale: s,
      });
      const cw = canvas.width, ch = canvas.height;
      if (!frameW) { frameW = cw; frameH = ch; }
      const ctx = canvas.getContext('2d');
      frames.push(ctx.getImageData(0, 0, cw, ch).data);
      delays.push(isLast ? 2000 : frameDelay);
      step++;
      onProgress(Math.round((step / totalSteps) * 100), step, totalSteps);
    };

    await captureFrame(false);
    while (canGoForwardRef.current) {
      stepForward();
      await new Promise(r => setTimeout(r, 80));
      await captureFrame(!canGoForwardRef.current);
    }

    // Restore table styles
    tableEl.style.paddingTop = origPadTop;
    tableEl.style.marginTop = origMarginTop;

    // Encode GIF with per-frame dithering
    const encoder = GIFEncoder();

    for (let f = 0; f < frames.length; f++) {
      const rgba = frames[f];
      const pixelCount = frameW * frameH;

      // Mark transparent pixels with magenta sentinel
      const transparentMask = new Uint8Array(pixelCount);
      for (let i = 0; i < pixelCount; i++) {
        if (rgba[i * 4 + 3] < 128) {
          transparentMask[i] = 1;
          rgba[i * 4]     = 255;
          rgba[i * 4 + 1] = 0;
          rgba[i * 4 + 2] = 255;
          rgba[i * 4 + 3] = 255;
        }
      }

      // rgb565 quantization — uses RGBA input, ignores alpha for color
      // matching. 5/6/5-bit precision = much better gradients than rgba4444.
      const palette = quantize(rgba, 256, { format: 'rgb565' });

      // Find magenta sentinel in palette for transparency
      let tIdx = 0, bestDist = Infinity;
      for (let p = 0; p < palette.length; p++) {
        const c = palette[p];
        const dr = c[0] - 255, dg = c[1], db = c[2] - 255;
        const d = dr * dr + dg * dg + db * db;
        if (d < bestDist) { bestDist = d; tIdx = p; }
      }

      // Floyd-Steinberg dithering for smooth gradients
      const indices = ditherFrame(rgba, frameW, frameH, palette, transparentMask, tIdx);

      encoder.writeFrame(indices, frameW, frameH, {
        palette,
        delay: delays[f],
        transparent: true,
        transparentIndex: tIdx,
      });
    }

    encoder.finish();

    const filename =
      (hand.gameType || 'hand').toLowerCase().replace(/\s+/g, '-') +
      '-replay.gif';
    const blob = new Blob([encoder.bytes()], { type: 'image/gif' });
    const file = new File([blob], filename, { type: 'image/gif' });

    // Encode-only — no auto-share. The caller shows Share / Save buttons in
    // the post-encode overlay so the user's tap on either is a fresh user
    // gesture (navigator.share requires that — without it iOS throws
    // NotAllowedError, as we saw in earlier auto-share attempts).
    const debug = [
      'gif=' + Math.round(blob.size / 1024) + 'KB ' + frameW + 'x' + frameH + ' ' + frames.length + 'fr',
    ];

    onDone({ blob, file, filename, debug });
  } catch (err) {
    tableEl.style.paddingTop = origPadTop;
    tableEl.style.marginTop = origMarginTop;
    console.error('GIF export error:', err);
    onError(err);
  }
}

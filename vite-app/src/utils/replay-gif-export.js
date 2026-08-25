import { beginCapture, exportScale, feltBackdrop, stepDelay } from './replay-capture.js';

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
  speed,
  feltColor,
  scale,
  onProgress,
  onDone,
  onError,
}) {
  // 89: frameDelay was hardcoded at 900ms by the caller while the replayer's
  // own speed control offers 0.5x to 4x and affected neither exporter.
  const frameDelay = stepDelay(speed);
  let restore = () => {};
  try {
    const [{ domToCanvas }, gifenc] = await Promise.all([
      import('modern-screenshot'),
      import('gifenc'),
    ]);
    const { GIFEncoder, quantize } = gifenc;

    const totalSteps = hand.streets.reduce(
      (sum, s) => sum + 1 + (s.actions?.length || 0), 0
    ) + 1;

    // 83 / 88 / 90 / 91: padding for the top seat's overflowing cards, plus
    // the paused animations, pinned theme and raised watermark the video path
    // now shares.
    restore = beginCapture(tableEl);
    await new Promise(r => setTimeout(r, 60));

    const elW = tableEl.offsetWidth;
    const elH = tableEl.offsetHeight;
    // 82: this was `scale || devicePixelRatio`, so the same ~380px table came
    // out at about 380px from a desktop monitor and about 1100px from an
    // iPhone — one hand, three resolutions, decided by the capturing device.
    const s = scale || exportScale(tableEl);

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
      onProgress(Math.round((step / totalSteps) * 60), step, totalSteps);
    };

    await captureFrame(false);
    while (canGoForwardRef.current) {
      stepForward();
      // The animations are frozen for the export's duration, so this only has
      // to cover React's commit, not an in-flight chip.
      await new Promise(r => setTimeout(r, 120));
      await captureFrame(!canGoForwardRef.current);
    }

    restore();
    restore = () => {};

    const pixelCount = frameW * frameH;
    const bg = feltBackdrop(feltColor);
    const bgRGB = (() => {
      const m = bg.bottom.match(/#(..)(..)(..)/);
      return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [12, 9, 18];
    })();

    /* 87: every pixel below half alpha became fully transparent and everything
       above it stayed fully OPAQUE carrying its straight-alpha colour — so
       every feathered shadow, plaque glow and winner ring kept a hard dark
       rind exactly where it was supposed to fade out. Semi-transparent pixels
       are composited over the backdrop first, and only the near-invisible ones
       are cut, which is what the alpha was describing in the first place. */
    const masks = [];
    for (let f = 0; f < frames.length; f++) {
      const rgba = frames[f];
      const mask = new Uint8Array(pixelCount);
      for (let i = 0; i < pixelCount; i++) {
        const a = rgba[i * 4 + 3];
        if (a < 16) {
          mask[i] = 1;
          rgba[i * 4] = 255; rgba[i * 4 + 1] = 0; rgba[i * 4 + 2] = 255; rgba[i * 4 + 3] = 255;
        } else if (a < 255) {
          const k = a / 255, inv = 1 - k;
          rgba[i * 4]     = Math.round(rgba[i * 4]     * k + bgRGB[0] * inv);
          rgba[i * 4 + 1] = Math.round(rgba[i * 4 + 1] * k + bgRGB[1] * inv);
          rgba[i * 4 + 2] = Math.round(rgba[i * 4 + 2] * k + bgRGB[2] * inv);
          rgba[i * 4 + 3] = 255;
        }
      }
      masks.push(mask);
      // 86: progress used to reach 100% at the end of CAPTURE and then sit
      // there while the encode ran, so the overlay read "done" through the
      // part that actually takes the time. Capture is the first 60%.
      onProgress(60 + Math.round((f / frames.length) * 10), totalSteps, totalSteps);
      if (f % 4 === 3) await new Promise(r => setTimeout(r, 0));
    }

    /* 85: quantisation ran INSIDE the per-frame loop, so pixels that never
       changed — the felt gradient, the rail, every plaque — were re-dithered
       against a slightly different 256-colour palette on every frame, and the
       whole sticker sparkled between frames on areas that were literally
       identical. One palette, built from a sample across all frames, and only
       the dither stays per-frame. */
    const sampleStride = Math.max(1, Math.floor(frames.length / 6));
    const sampleFrames = frames.filter((_, i) => i % sampleStride === 0);
    const union = new Uint8ClampedArray(sampleFrames.length * pixelCount * 4);
    sampleFrames.forEach((fr, i) => union.set(fr, i * pixelCount * 4));
    const palette = quantize(union, 256, { format: 'rgb565' });

    // The magenta sentinel's slot in that one palette.
    let tIdx = 0, bestDist = Infinity;
    for (let p = 0; p < palette.length; p++) {
      const c = palette[p];
      const dr = c[0] - 255, dg = c[1], db = c[2] - 255;
      const d = dr * dr + dg * dg + db * db;
      if (d < bestDist) { bestDist = d; tIdx = p; }
    }

    const encoder = GIFEncoder();
    for (let f = 0; f < frames.length; f++) {
      const indices = ditherFrame(frames[f], frameW, frameH, palette, masks[f], tIdx);
      encoder.writeFrame(indices, frameW, frameH, {
        palette,
        delay: delays[f],
        transparent: true,
        transparentIndex: tIdx,
      });
      // 86: yield between frames so the overlay can actually repaint instead
      // of freezing at 100% for what reads as a hang.
      onProgress(70 + Math.round(((f + 1) / frames.length) * 30), totalSteps, totalSteps);
      await new Promise(r => setTimeout(r, 0));
    }

    encoder.finish();

    const filename =
      (hand.gameType || 'hand').toLowerCase().replace(/\s+/g, '-') +
      '-replay.gif';
    const blob = new Blob([encoder.bytes()], { type: 'image/gif' });
    const file = new File([blob], filename, { type: 'image/gif' });

    // shareMethod tells the caller which path the GIF took so the UI can
    // show context-appropriate feedback ("Opened Instagram", "Saved to
    // Files", etc.). The auto-share order: iOS native IG → Web Share API
    // (share sheet) → direct download.
    let shareMethod = 'download';
    let shareError = null;

    const { canShareToInstagram, shareGifToInstagramStories } = await import('./instagram-stories.js');
    if (canShareToInstagram()) {
      try {
        // 95: this was a slate gradient that appears nowhere in this app,
        // sitting behind a table that is purple. It comes from the felt now.
        await shareGifToInstagramStories(blob, {
          backgroundTopColor: bg.top,
          backgroundBottomColor: bg.bottom,
        });
        shareMethod = 'instagram';
      } catch (e) {
        shareError = e;
        console.warn('Instagram direct share failed, falling back:', e);
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          try {
            await navigator.share({ files: [file], title: 'Hand Replay' });
            shareMethod = 'share-sheet';
          } catch (e2) { shareError = e2; }
        }
      }
    } else if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Hand Replay' });
        shareMethod = 'share-sheet';
      } catch (e) {
        shareError = e;
      }
    }

    // If no share method succeeded, save to the user's downloads.
    if (shareMethod === 'download') {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }

    onDone({ shareMethod, shareError, blob });
  } catch (err) {
    restore();
    console.error('GIF export error:', err);
    onError(err);
  }
}

// JS bridge for the native VideoComposer plugin (iOS only).
//
// Fast path (recommended): startStoryRecord → addSnapshot ×N →
//   finishStoryRecord. Captures each frame directly from the WKWebView via
//   `takeSnapshot`, composites onto the chosen background natively, encodes
//   straight into MP4 via AVAssetWriter. ~10× faster than the legacy path
//   because we skip modern-screenshot + base64 PNG round-trips.
//
// Legacy path: composeMP4 / shareStoryVideo with a JS-supplied frames array.
import { Capacitor, registerPlugin } from '@capacitor/core';

const VideoComposer = registerPlugin('VideoComposer');

export function canComposeVideo() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
}

// ── Fast path ──
export function startStoryRecord(opts) {
  if (!canComposeVideo()) throw new Error('VideoComposer is iOS-only');
  return VideoComposer.startStoryRecord({
    width: opts.width ?? 1080,
    height: opts.height ?? 1920,
    frameDelayMs: opts.frameDelayMs ?? 900,
    backgroundColor: opts.backgroundColor ?? null,
    backgroundImageBase64: opts.backgroundImageBase64 ?? null,
    feltX: opts.feltX ?? 0,
    feltY: opts.feltY ?? 0,
    feltW: opts.feltW ?? (opts.width ?? 1080),
    feltH: opts.feltH ?? (opts.height ?? 1920),
    // Magenta default — virtually never appears in poker content.
    chromaKey: !!opts.chromaKey,
    chromaR: opts.chromaR ?? 255,
    chromaG: opts.chromaG ?? 0,
    chromaB: opts.chromaB ?? 255,
    chromaTolerance: opts.chromaTolerance ?? 60,
    // Rail rect within the captured snapshot (0–1 ratios) — used to build
    // the native capsule clip mask. Buffer is an outward fraction.
    railRelX: opts.railRelX ?? 0.10,
    railRelY: opts.railRelY ?? 0.10,
    railRelW: opts.railRelW ?? 0.80,
    railRelH: opts.railRelH ?? 0.80,
    railBuffer: opts.railBuffer ?? 0.05,
  });
}

export function addSnapshot(rect) {
  if (!canComposeVideo()) throw new Error('VideoComposer is iOS-only');
  return VideoComposer.addSnapshot({
    rectX: rect.x,
    rectY: rect.y,
    rectW: rect.width,
    rectH: rect.height,
  });
}

export function finishStoryRecord(opts = {}) {
  if (!canComposeVideo()) throw new Error('VideoComposer is iOS-only');
  return VideoComposer.finishStoryRecord({
    share: !!opts.share,
    saveToPhotos: !!opts.saveToPhotos,
  });
}

export function shareFile(path) {
  if (!canComposeVideo()) throw new Error('VideoComposer is iOS-only');
  return VideoComposer.shareFile({ path });
}

// ── Legacy path (kept for OFC / non-record use) ──
export async function composeMP4(opts) {
  if (!canComposeVideo()) throw new Error('VideoComposer is iOS-only');
  return VideoComposer.composeMP4({
    frames: opts.frames,
    frameDelayMs: opts.frameDelayMs ?? 900,
    width: opts.width ?? 1080,
    height: opts.height ?? 1920,
    returnBase64: opts.returnBase64 ?? true,
  });
}

export async function shareStoryVideo(opts) {
  if (!canComposeVideo()) throw new Error('VideoComposer is iOS-only');
  return VideoComposer.shareStoryVideo({
    frames: opts.frames,
    frameDelayMs: opts.frameDelayMs ?? 900,
    width: opts.width ?? 1080,
    height: opts.height ?? 1920,
  });
}

// ── Replay Story Composer (fast path) ──
// Drives the replay forward and asks the native VideoComposer plugin to
// snapshot the WKWebView directly after each step. Frames never leave
// native memory; compositing + MP4 encoding happen entirely in Swift.
//
// Replaces the old domToCanvas pipeline (~300ms/frame on iPhone) with
// WKWebView.takeSnapshot (~30ms/frame). Net 5–10× faster.

import {
  startStoryRecord,
  addSnapshot,
  finishStoryRecord,
  canComposeVideo,
} from './video-composer.js';

const STORY_W = 1080;
const STORY_H = 1920;

// Magenta chroma color — extremely unlikely to appear in actual poker content
// (felts are purple/green/blue, cards are red/black/white, chips are
// red/green/black/blue). Used only as residual cleanup; the precise capsule
// mask does the heavy lifting.
const CHROMA_HEX = '#ff00ff';

/** Wait two animation frames so the DOM has fully painted. */
function waitForPaint() {
  return new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
}

/**
 * Strip the "data:image/png;base64," prefix from a data URL.
 */
function stripDataPrefix(dataUrl) {
  if (!dataUrl) return null;
  const comma = dataUrl.indexOf(',');
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

/**
 * Convert a chosen background (HTMLImageElement or null) to base64 PNG.
 */
async function backgroundToBase64(img) {
  if (!img) return null;
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  c.getContext('2d').drawImage(img, 0, 0);
  return stripDataPrefix(c.toDataURL('image/png'));
}

/**
 * Compute the felt rect (in DOM CSS pixel space) of the .replayer-table
 * element. The native plugin needs this in webview point space, which on
 * iOS is the same as CSS pixels for a Capacitor app.
 */
function feltRectFromElement(tableEl) {
  const r = tableEl.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
}

/**
 * Default placement — centered in the Story canvas. The user can override
 * this via the composer's drag/pinch UI; the override is passed in via
 * `opts.placement`.
 */
export function defaultFeltPlacement(feltAspect) {
  let w = STORY_W * 0.92;
  let h = w / feltAspect;
  if (h > STORY_H * 0.85) {
    h = STORY_H * 0.85;
    w = h * feltAspect;
  }
  return {
    x: (STORY_W - w) / 2,
    y: (STORY_H - h) / 2,
    width: w,
    height: h,
  };
}

/**
 * Measure the .replayer-table-rail's bounding rect relative to the
 * .replayer-table (returns ratios 0–1). Used to build the native capsule
 * mask that clips each captured frame to the rail's exact silhouette.
 */
export function measureRailRelative(tableEl) {
  const railEl = tableEl.querySelector('.replayer-table-rail');
  if (!railEl) return { x: 0.10, y: 0.10, width: 0.80, height: 0.80 };
  const tableR = tableEl.getBoundingClientRect();
  const railR  = railEl.getBoundingClientRect();
  return {
    x: (railR.left - tableR.left) / tableR.width,
    y: (railR.top  - tableR.top)  / tableR.height,
    width:  railR.width  / tableR.width,
    height: railR.height / tableR.height,
  };
}

export { STORY_W, STORY_H, CHROMA_HEX };

/**
 * Record a story MP4 using the native snapshot pipeline.
 *
 * Fast mode: one frame per replay action, played back as a slideshow at
 * `frameDelayMs` per frame. This is the version that ships — multi-frame
 * mid-transition capture was tried and reverted (too slow per export).
 *
 * @param {object} opts
 * @param {object} opts.hand              The hand (used only for step count UX)
 * @param {HTMLElement} opts.tableEl      The .replayer-table element
 * @param {Function} opts.stepForward     Advance one action
 * @param {{current:boolean}} opts.canGoForwardRef
 * @param {string|HTMLImageElement|null} opts.background
 * @param {number} [opts.frameDelayMs=900]
 * @param {Function} [opts.onProgress]
 * @param {'share'|'save'|'both'} [opts.outputMode='save']
 * @returns {Promise<{path:string, sizeBytes:number, saved:boolean, shared?:boolean}>}
 */
export async function recordStoryReplay({
  hand,
  tableEl,
  stepForward,
  canGoForwardRef,
  background = '#0f172a',
  // Optional override of where the felt sits inside the 1080×1920 canvas.
  // Coming from the composer's drag/pinch UI. Falls back to centered default.
  placement: placementOverride = null,
  frameDelayMs = 900,
  onProgress,
  outputMode = 'save',
}) {
  if (!canComposeVideo()) throw new Error('Native video composer is iOS-only');

  const totalSteps =
    hand.streets.reduce((sum, s) => sum + 1 + (s.actions?.length || 0), 0) + 1;

  const feltRect = feltRectFromElement(tableEl);
  const feltAspect = feltRect.width / feltRect.height;
  const placement = placementOverride || defaultFeltPlacement(feltAspect);
  const railRel = measureRailRelative(tableEl);

  let bgColor = null, bgImageBase64 = null;
  if (typeof background === 'string') {
    bgColor = background;
  } else if (background instanceof HTMLImageElement) {
    bgImageBase64 = await backgroundToBase64(background);
    bgColor = '#000000';
  } else {
    bgColor = '#000000';
  }

  // For photo backgrounds: capsule mask + residual magenta chroma key clean
  // up any leftover flushed pixels. Solid colors don't need keying.
  const usePhotoChroma = !!bgImageBase64;
  const flushColor = usePhotoChroma ? CHROMA_HEX : (bgColor || '#000000');

  const startResult = await startStoryRecord({
    width: STORY_W,
    height: STORY_H,
    frameDelayMs,
    backgroundColor: bgColor,
    backgroundImageBase64: bgImageBase64,
    feltX: placement.x,
    feltY: placement.y,
    feltW: placement.width,
    feltH: placement.height,
    chromaKey: usePhotoChroma,
    chromaR: 255, chromaG: 0, chromaB: 255,
    chromaTolerance: 80,
    railRelX: railRel.x,
    railRelY: railRel.y,
    railRelW: railRel.width,
    railRelH: railRel.height,
    railBuffer: 0.06,
  });
  console.log('[story] startStoryRecord result:', startResult,
              'usePhotoChroma=', usePhotoChroma,
              'flushColor=', flushColor,
              'railRel=', railRel,
              'placement=', placement);

  const replayContainer = tableEl.closest('.replayer-replay') || tableEl.parentElement;
  const savedContainerBg = replayContainer ? replayContainer.style.backgroundColor : null;
  const savedTableBg = tableEl.style.backgroundColor;
  if (replayContainer) replayContainer.style.backgroundColor = flushColor;
  tableEl.style.backgroundColor = 'transparent';

  let step = 0;
  const captureFrame = async () => {
    await waitForPaint();
    const r = feltRectFromElement(tableEl);
    await addSnapshot(r);
    step++;
    onProgress?.(Math.round((step / totalSteps) * 100), step, totalSteps);
  };

  try {
    await captureFrame();
    while (canGoForwardRef.current) {
      stepForward();
      await waitForPaint();
      await captureFrame();
    }
    const share = outputMode === 'share' || outputMode === 'both';
    const saveToPhotos = outputMode === 'save' || outputMode === 'both';
    return await finishStoryRecord({ share, saveToPhotos });
  } finally {
    if (replayContainer) replayContainer.style.backgroundColor = savedContainerBg || '';
    tableEl.style.backgroundColor = savedTableBg || '';
  }
}

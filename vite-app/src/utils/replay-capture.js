// ── Shared setup for the replay exporters ──
//
// The GIF path and the video path each solved some of the same problems and
// each missed the ones the other had solved: the GIF added top padding so the
// top seat's cards were not sheared off and the video did not; neither froze
// animations, so both sampled the neon theme's infinite pulse at a random
// phase and caught chips mid-arc; both inherited whatever app theme the
// viewer happened to be on, so the same hand exported four different ways;
// and both captured a 10%-opacity watermark that dithering largely dissolves.
//
// One preparation, used by both, so a fix lands in one place.

/**
 * Put the table into capture condition and return a function that undoes it.
 *
 * @param {HTMLElement} tableEl - the .replayer-table element
 * @returns {() => void} restore
 */
export function beginCapture(tableEl) {
  const prev = {
    padTop: tableEl.style.paddingTop,
    marginTop: tableEl.style.marginTop,
  };
  // 83: the top seat's cards overflow the table box. The GIF path knew this
  // and padded for it; the video path captured the same element unpadded and
  // sheared the opponent's hole cards off the top of every clip.
  tableEl.style.paddingTop = '50px';
  tableEl.style.marginTop = '0px';
  // 88 / 90 / 91 — see the [data-capturing] rules in styles.css.
  tableEl.setAttribute('data-capturing', '1');

  return () => {
    tableEl.style.paddingTop = prev.padTop;
    tableEl.style.marginTop = prev.marginTop;
    tableEl.removeAttribute('data-capturing');
  };
}

/**
 * 82: the GIF scaled by devicePixelRatio, so the same ~380px table captured at
 * about 380px from a desktop monitor and about 1100px from an iPhone, while
 * the video was a flat 540 regardless. One hand had three export resolutions
 * depending on which screen happened to trigger it. Both target this now.
 */
export const EXPORT_WIDTH = 720;

/** The scale factor that renders `el` at EXPORT_WIDTH. */
export function exportScale(el) {
  return EXPORT_WIDTH / (el.offsetWidth || EXPORT_WIDTH);
}

/**
 * 95: the sticker was composed onto a slate gradient (#0f172a → #1e293b) that
 * appears nowhere in this app, behind a table that is purple. The felt already
 * derives its own light and dark stops inline from the chosen colour; the
 * background derives from the same place, so the frame is one palette.
 */
export function feltBackdrop(feltColor) {
  const m = String(feltColor || '').match(/#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  if (!m) return { top: '#1b1526', bottom: '#0c0912' };
  const [r, g, b] = [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
  const dark = (f) => '#' + [r, g, b].map(v => Math.round(v * f).toString(16).padStart(2, '0')).join('');
  return { top: dark(0.52), bottom: dark(0.22) };
}

/**
 * 96: the chroma fill was pure #00ff00 — and the table renders green raise
 * text, green winner names and a four-colour deck whose clubs are green, so a
 * normal key tolerance punches holes in exactly the things you want kept.
 * Broadcast green sits far enough from every green the UI uses.
 */
export const CHROMA_GREEN = '#00b140';

/**
 * 89: both exporters were hardcoded at 900ms per step while the replayer's own
 * speed control offers 0.5x through 4x and affected neither, so a thirty-step
 * hand always came out as a 27-second clip. `speed` is the replayer's own ms
 * per step; the export uses it directly.
 */
export function stepDelay(speed) {
  const ms = Number(speed);
  return Number.isFinite(ms) && ms > 0 ? Math.min(2000, Math.max(150, ms)) : 900;
}

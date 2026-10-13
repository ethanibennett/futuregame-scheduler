// ── Replay Video Export ──
// Drives HandReplayerReplayView through all steps, capturing frames and
// encoding them as a transparent-background WebM (VP9+alpha) for use as a
// streaming overlay, a chroma-key MP4 for editing, or a 9:16 story clip.

import {
  beginCapture, captureStepFrames, EXPORT_WIDTH, exportScale, feltBackdrop, CHROMA_GREEN, stepDelay,
} from './replay-capture.js';

const STORY_W = 1080, STORY_H = 1920;

/* The spring moments in a video (24 fps): the flop is about 16 frames, a turn or river 8, the ship 12
   — about 44 a hand, whatever its length, since only street presses and the result are seeked (a
   push-out is finished: four frames on every bet and call, a third of the captures, for 150ms of
   motion). The budget only binds on an unusual hand; past it the moments are finished and each step
   is one settled still, as before the springs. */
const VIDEO_MOTION_BUDGET = 64;
const VIDEO_FPS = 24;
/* Motion frames are kept decoded (an ImageBitmap, its canvas released) up to this many bytes of
   pixels, about 30 frames of a phone table at the export width: most hands' whole motion. Past it a
   frame is kept as a PNG blob (about a quarter of the size) and decoded DECODE_AHEAD frames ahead of
   playback, so a long hand's motion never sits in memory decoded all at once. The PNG round trip
   cost more than the capture itself in WebKit (6.3s a motion frame against 3.5s a still), which put
   the springs' export at 3.4x the time of one without them; under the budget there is none. */
const MOTION_BITMAP_BYTES = 128 * 1024 * 1024;
const DECODE_AHEAD = 16;

const canvasToBlob = (c) => new Promise((resolve) => {
  try { c.toBlob(b => resolve(b), 'image/png'); } catch { resolve(null); }
});
async function decodeBlob(blob) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(blob); } catch { /* fall through to an <img> */ }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/**
 * Export the current replay hand as a video.
 *
 * @param {object} opts
 * @param {object}   opts.hand           - The hand object
 * @param {object}   opts.tableEl        - DOM element for the felt table (.replayer-table)
 * @param {Function} opts.stepForward    - Callback to advance the replay one step
 * @param {object}   opts.canGoForwardRef- { current: boolean } reflecting live replay state
 * @param {string}   [opts.mode]         - 'transparent' (default), 'greenscreen' or 'story'
 * @param {number}   [opts.speed]        - ms per step, from the replayer's speed control
 * @param {string}   [opts.feltColor]    - drives the story backdrop
 * @param {Function} opts.onProgress     - (pct: 0-100, step, total) => void
 * @param {Function} opts.onDone         - ({ shareMethod }) => void
 * @param {Function} opts.onError        - (err) => void
 */
export async function exportReplayVideo({
  hand, tableEl, stepForward, canGoForwardRef,
  mode = 'transparent', speed, feltColor,
  backgroundImage = null, igShare = false, tableScale = 0.92, tableCenter = null,
  onFrame, onProgress, onDone, onError,
}) {
  let restore = () => {};
  try {
    /* 84: this path used html2canvas while the GIF path used
       modern-screenshot — and html2canvas renders neither box-shadow nor
       backdrop-filter, which between them are the rail bevel, the felt dish,
       every plaque bevel, the card edge-light and the pot plaque's blur. The
       video was therefore a flatter, lighting-free version of the same hand
       the GIF exported correctly. One renderer, the one that works. */
    const { domToCanvas } = await import('modern-screenshot');

    const totalSteps = hand.streets.reduce((sum, s) => sum + 1 + (s.actions?.length || 0), 0) + 1;

    const isGreenScreen = mode === 'greenscreen';
    const isStory = mode === 'story';

    // Codec + container. Green screen and story prefer MP4 (Safari/iOS play it
    // and CapCut imports it); transparent needs VP9 WebM for the alpha channel.
    let mimeType, fileExt;
    if (isGreenScreen || isStory) {
      if (MediaRecorder.isTypeSupported('video/mp4;codecs=avc1')) {
        mimeType = 'video/mp4;codecs=avc1'; fileExt = 'mp4';
      } else if (MediaRecorder.isTypeSupported('video/mp4')) {
        mimeType = 'video/mp4'; fileExt = 'mp4';
      } else {
        mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
        fileExt = 'webm';
      }
    } else {
      mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
      fileExt = 'webm';
    }

    restore = beginCapture(tableEl, { speed, fps: VIDEO_FPS });
    // Let the padding and the paused-animation rules settle before measuring.
    await new Promise(r => setTimeout(r, 60));

    const elW = tableEl.offsetWidth;
    const elH = tableEl.offsetHeight;
    const scale = exportScale(tableEl);

    /* 98: the GIF ships a transparent sticker built for Stories and the video
       exported only the bare table at its 3:4.5 aspect — so posting a clip to
       a story meant letting the platform letterbox or crop it, and the
       greenscreen variant especially exists to be dropped into a vertical
       edit. Story mode composes into 1080x1920 over the felt's own gradient. */
    const OUT_W = isStory ? STORY_W : EXPORT_WIDTH;
    const OUT_H = isStory ? STORY_H : (Math.round(EXPORT_WIDTH * (elH / elW)) || EXPORT_WIDTH);

    const canvas = document.createElement('canvas');
    canvas.width = OUT_W;
    canvas.height = OUT_H;
    const ctx = canvas.getContext('2d');

    // Where the table sits inside a story frame: centred, with room above for
    // the watermark and below for a caption the poster adds themselves.
    // How wide the replay sits inside the 9:16 frame, as a fraction of the
    // story width. The Instagram-story flow lets the poster set this over their
    // photo; other story exports keep the full-bleed 0.92 default.
    const tableW = Math.round(STORY_W * (tableScale > 0 ? Math.min(1, tableScale) : 0.92));
    const tableH = Math.round(tableW * (elH / elW));
    // Where the replay's CENTRE sits, as a fraction of the 9:16 frame. The
    // Instagram-story flow lets the poster drag it; everything else centres it.
    const cx = tableCenter && tableCenter.x != null ? tableCenter.x : 0.5;
    const cy = tableCenter && tableCenter.y != null ? tableCenter.y : 0.5;
    const tableX = Math.round(STORY_W * cx - tableW / 2);
    const tableY = Math.round(STORY_H * cy - tableH / 2);

    let storyBg = null;
    if (isStory) {
      const { top, bottom } = feltBackdrop(feltColor);
      storyBg = ctx.createLinearGradient(0, 0, 0, STORY_H);
      storyBg.addColorStop(0, top);
      storyBg.addColorStop(1, bottom);
    }

    /* The Story background can be a photo the poster picked or shot in-app
       (Instagram has no transparent-overlay slot, so we bake their chosen
       image behind the replay and send the whole 9:16 frame as backgroundVideo).
       Draw it COVER-fit — fill 1080x1920, cropping the overflow — so there is
       never a letterbox; the replay still floats centred on top. */
    let bgCover = null;
    if (isStory && backgroundImage) {
      const iw = backgroundImage.naturalWidth || backgroundImage.width;
      const ih = backgroundImage.naturalHeight || backgroundImage.height;
      if (iw && ih) {
        const cover = Math.max(STORY_W / iw, STORY_H / ih);
        const dw = iw * cover, dh = ih * cover;
        bgCover = { dx: (STORY_W - dw) / 2, dy: (STORY_H - dh) / 2, dw, dh };
      }
    }

    /* 97: this recorded a LIVE canvas stream with a real setTimeout per step,
       so a thirty-step hand took thirty wall-clock seconds behind a blocking
       overlay — and because the wait was wall-clock, the variable capture time
       was recorded too and the step durations wobbled in the output. Driving
       the track frame by frame collapses the export to capture speed and makes
       every step exactly the same length. */
    const FPS = VIDEO_FPS;
    const perStepMs = stepDelay(speed);
    const framesPerStep = Math.max(1, Math.round((perStepMs / 1000) * FPS));
    const finalHoldFrames = FPS * 2;

    /* 99: two phases, because iOS is the common case and iOS has no
       CanvasCaptureMediaStreamTrack.requestFrame — so MediaRecorder can only
       record in REAL TIME. The old single pass captured a frame (domToCanvas,
       200-500ms on a phone) WHILE the recorder was running, so that capture
       time was baked into the clip: every step lasted as long as it took to
       draw, and the speed control (which only sets how long to HOLD a frame)
       barely moved the result — "4x" was still agonisingly slow. Now the slow
       part — capturing every frame of the hand — happens first with nothing
       recording, and playback holds each pre-drawn frame for exactly the chosen
       duration. Capture cost stops touching the output pace. */
    /* Each entry is one captured image and how many output frames it is held for. A step is its
       settled still held for the step's length — and, with the spring moments on, the moment
       itself first: the springs are seeked one output frame at a time (captureStepFrames), so the
       flop deals, the turn lands and the chips fly in the clip exactly as on screen, and the
       settled still takes the rest of the step. A motion frame is kept as an ImageBitmap with its
       canvas released, up to MOTION_BITMAP_BYTES, then as a PNG blob (decoded again just ahead of
       playback, below), so a hand's worth of them is neither a few hundred MB of pixels nor counted
       against iOS's canvas memory cap. */
    const framesArr = [];
    let lastGood = null;
    let stepsDone = 0;
    let bitmapBytes = 0;
    const grab = async (hold, settled) => {
      let entry = null;
      try {
        const c = await domToCanvas(tableEl, { backgroundColor: null, width: elW, height: elH, scale });
        entry = { img: c, hold };
        if (!settled) {
          const bytes = c.width * c.height * 4;
          let kept = false;
          if (bitmapBytes + bytes <= MOTION_BITMAP_BYTES && typeof createImageBitmap === 'function') {
            try { entry = { img: await createImageBitmap(c), hold, bitmap: true }; bitmapBytes += bytes; kept = true; } catch { kept = false; }
          }
          if (!kept) {
            const blob = await canvasToBlob(c);
            if (blob) entry = { blob, hold };
          }
          if (entry.img !== c) { c.width = 0; c.height = 0; }
        }
        if (entry.img) lastGood = entry.img;
      } catch {
        // 84: on a capture failure hold the LAST GOOD frame rather than a blank.
        entry = lastGood ? { img: lastGood, hold } : null;
      }
      if (entry) framesArr.push(entry);
      if (!settled) return;
      const img = entry && entry.img;
      stepsDone++;
      if (onFrame && img && img.toDataURL) { try { onFrame(img.toDataURL('image/png')); } catch { /* tainted */ } }
      // Capture is the first 70% of the bar; the encode is the rest.
      onProgress(Math.round((stepsDone / totalSteps) * 70), stepsDone, totalSteps);
    };

    let motionLeft = VIDEO_MOTION_BUDGET;
    const captureStep = async (stepFrames) => {
      motionLeft -= await captureStepFrames(tableEl, {
        fps: FPS, maxFrames: motionLeft > 0 ? Math.min(stepFrames, motionLeft + 1) : 1,
        skipKinds: ['action'], grab,
      });
      // The still is held for the rest of the step, whatever the budget allowed.
      const last = framesArr[framesArr.length - 1];
      const shown = framesArr.slice(stepStart).reduce((n, f) => n + f.hold, 0);
      if (last && shown < stepFrames) last.hold += stepFrames - shown;
    };
    let stepStart = 0;
    await captureStep(framesPerStep);
    while (canGoForwardRef.current) {
      stepForward();
      // Let React commit before capturing. CSS animations are paused for the export; the springs
      // are created paused and seeked.
      await new Promise(r => setTimeout(r, 120));
      const isLast = !canGoForwardRef.current;
      stepStart = framesArr.length;
      await captureStep(isLast ? finalHoldFrames : framesPerStep);
    }

    // Frames are captured — undo the padding/pinned-theme now, before the encode.
    restore();
    restore = () => {};

    // ── Phase 2: play the captured frames into the recorder at exact timing.
    const stream = canvas.captureStream(0);
    const track = stream.getVideoTracks()[0];
    const canRequestFrame = typeof track.requestFrame === 'function';
    const fallbackStream = canRequestFrame ? null : canvas.captureStream(FPS);
    const recStream = canRequestFrame ? stream : fallbackStream;

    const recorder = new MediaRecorder(recStream, { mimeType, videoBitsPerSecond: 6_000_000 });
    const chunks = [];
    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    const stopped = new Promise(resolve => { recorder.onstop = resolve; });

    const paint = (captured) => {
      if (isStory) {
        if (bgCover) {
          ctx.drawImage(backgroundImage, bgCover.dx, bgCover.dy, bgCover.dw, bgCover.dh);
        } else {
          ctx.fillStyle = storyBg;
          ctx.fillRect(0, 0, OUT_W, OUT_H);
        }
        ctx.drawImage(captured, tableX, tableY, tableW, tableH);
      } else if (isGreenScreen) {
        ctx.fillStyle = CHROMA_GREEN;
        ctx.fillRect(0, 0, OUT_W, OUT_H);
        ctx.drawImage(captured, 0, 0, OUT_W, OUT_H);
      } else {
        ctx.clearRect(0, 0, OUT_W, OUT_H);
        ctx.drawImage(captured, 0, 0, OUT_W, OUT_H);
      }
    };

    const emit = async (frames) => {
      for (let i = 0; i < frames; i++) {
        if (canRequestFrame) track.requestFrame();
        // One tick per frame so the recorder's encoder can drain.
        await new Promise(r => setTimeout(r, canRequestFrame ? 0 : 1000 / FPS));
      }
    };

    /* A motion frame is decoded from its blob a little ahead of its turn — while the still before
       it is being held — and released once it has been painted. */
    const decoded = (f) => {
      if (f.img) return Promise.resolve(f.img);
      if (!f.pending) f.pending = decodeBlob(f.blob).then(img => (f.img = img), () => lastGood);
      return f.pending;
    };
    const ahead = (i) => { for (let j = i + 1; j < Math.min(framesArr.length, i + 1 + DECODE_AHEAD); j++) if (framesArr[j].blob) decoded(framesArr[j]); };
    ahead(-1);
    recorder.start();
    // Latch the first frame before the timed playback begins.
    if (framesArr.length) { paint(await decoded(framesArr[0])); await new Promise(r => setTimeout(r, 80)); }
    for (let i = 0; i < framesArr.length; i++) {
      const f = framesArr[i];
      const img = await decoded(f);
      if (img) paint(img);
      ahead(i);
      await emit(f.hold);
      if (f.blob && f.img) { try { if (f.img.close) f.img.close(); } catch { /* gone */ } f.img = null; f.blob = null; }
      onProgress(70 + Math.round(((i + 1) / framesArr.length) * 30), totalSteps, totalSteps);
    }

    recorder.stop();
    await stopped;
    for (const f of framesArr) { try { if (f.img && f.img.close) f.img.close(); } catch { /* already gone */ } }
    framesArr.length = 0;

    const blob = new Blob(chunks, { type: mimeType });
    const baseName = (hand.gameType || 'hand').toLowerCase().replace(/\s+/g, '-');
    const filename = baseName + '-replay.' + fileExt;
    const file = new File([blob], filename, { type: mimeType.split(';')[0] });

    /* 93: this always resolved through a download anchor, while the GIF path
       tries the share sheet first — and inside a WKWebView an anchor download
       of a video blob fails quietly, so the button completed and produced
       nothing at all. iOS cannot play WebM either, which is why greenscreen
       and story now emit MP4. */
    let shareMethod = 'download';
    let igError = null;
    // A story clip headed for Instagram goes to the backgroundVideo slot on
    // iOS first — one tap, animated, and IG opens its editor on top for text
    // and stickers. Everything else (and any IG failure) falls to the share
    // sheet, then a download.
    if (igShare && isStory) {
      const { canShareToInstagram, shareVideoToInstagramStories } = await import('./instagram-stories.js');
      if (canShareToInstagram()) {
        try {
          const { top, bottom } = feltBackdrop(feltColor);
          await shareVideoToInstagramStories(blob, {
            backgroundTopColor: top,
            backgroundBottomColor: bottom,
          });
          shareMethod = 'instagram';
        } catch (e) {
          igError = e;
          console.warn('Instagram video share failed, falling back:', e);
        }
      }
    }
    if (shareMethod === 'download' && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Hand Replay' });
        shareMethod = 'share-sheet';
      } catch { /* the user dismissed the sheet, or it is unavailable */ }
    }
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

    onDone({ shareMethod, blob, fileExt, igError });
  } catch (err) {
    restore();
    onError(err);
  }
}

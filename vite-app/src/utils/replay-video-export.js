// ── Replay Video Export ──
// Drives HandReplayerReplayView through all steps, capturing frames and
// encoding them as a transparent-background WebM (VP9+alpha) for use as a
// streaming overlay, a chroma-key MP4 for editing, or a 9:16 story clip.

import {
  beginCapture, EXPORT_WIDTH, exportScale, feltBackdrop, CHROMA_GREEN, stepDelay,
} from './replay-capture.js';

const STORY_W = 1080, STORY_H = 1920;

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

    restore = beginCapture(tableEl);
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
    const tableW = Math.round(STORY_W * 0.92);
    const tableH = Math.round(tableW * (elH / elW));
    const tableX = Math.round((STORY_W - tableW) / 2);
    const tableY = Math.round((STORY_H - tableH) / 2);

    let storyBg = null;
    if (isStory) {
      const { top, bottom } = feltBackdrop(feltColor);
      storyBg = ctx.createLinearGradient(0, 0, 0, STORY_H);
      storyBg.addColorStop(0, top);
      storyBg.addColorStop(1, bottom);
    }

    /* 97: this recorded a LIVE canvas stream with a real setTimeout per step,
       so a thirty-step hand took thirty wall-clock seconds behind a blocking
       overlay — and because the wait was wall-clock, the variable capture time
       was recorded too and the step durations wobbled in the output. Driving
       the track frame by frame collapses the export to capture speed and makes
       every step exactly the same length. */
    const stream = canvas.captureStream(0);
    const track = stream.getVideoTracks()[0];
    const canRequestFrame = typeof track.requestFrame === 'function';
    const fallbackStream = canRequestFrame ? null : canvas.captureStream(24);
    const recStream = canRequestFrame ? stream : fallbackStream;

    const recorder = new MediaRecorder(recStream, { mimeType, videoBitsPerSecond: 6_000_000 });
    const chunks = [];
    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    const stopped = new Promise(resolve => { recorder.onstop = resolve; });

    const FPS = 24;
    const perStepMs = stepDelay(speed);
    const framesPerStep = Math.max(1, Math.round((perStepMs / 1000) * FPS));
    const finalHoldFrames = FPS * 2;

    recorder.start();

    let step = 0;
    // 84: on a capture failure, hold the LAST GOOD frame. Clearing wrote a
    // fully blank frame into the middle of the recording.
    let lastGood = null;

    const paint = (captured) => {
      if (isStory) {
        ctx.fillStyle = storyBg;
        ctx.fillRect(0, 0, OUT_W, OUT_H);
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

    const captureFrame = async (holdFrames) => {
      try {
        const captured = await domToCanvas(tableEl, {
          backgroundColor: null,
          width: elW,
          height: elH,
          scale,
        });
        lastGood = captured;
        paint(captured);
      } catch {
        if (lastGood) paint(lastGood);
      }
      await emit(holdFrames);
      step++;
      // 85: the same frame the recorder just took, for the overlay.
      if (onFrame) { try { onFrame(canvas.toDataURL('image/png')); } catch { /* tainted canvas */ } }
      onProgress(Math.round((step / totalSteps) * 100), step, totalSteps);
    };

    await captureFrame(framesPerStep);
    while (canGoForwardRef.current) {
      stepForward();
      // Let React commit before capturing. The animations are paused for the
      // duration of the export, so this only has to cover the render.
      await new Promise(r => setTimeout(r, 120));
      await captureFrame(framesPerStep);
    }
    // Hold the result.
    await emit(finalHoldFrames);

    recorder.stop();
    await stopped;
    restore();

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
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
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

    onDone({ shareMethod, blob, fileExt });
  } catch (err) {
    restore();
    onError(err);
  }
}

// ── Replay Video Export ──
// Drives HandReplayerReplayView through all steps, capturing canvas frames
// and encoding them as a transparent-background WebM (VP9+alpha) for use
// as a streaming overlay.

/**
 * Export the current replay hand as a WebM video with transparent background.
 *
 * @param {object} opts
 * @param {object}   opts.hand           - The hand object
 * @param {object}   opts.tableEl        - DOM element for the felt table (.replayer-table)
 * @param {Function} opts.stepForward    - Callback to advance the replay one step
 * @param {boolean}  opts.canGoForward   - Whether there are more steps to advance
 * @param {string}   [opts.mode]         - 'transparent' (default) or 'greenscreen'
 * @param {Function} opts.onProgress     - (pct: 0-100, step, total) => void
 * @param {Function} opts.onDone         - () => void — called after download
 * @param {Function} opts.onError        - (err) => void
 */
export async function exportReplayVideo({ hand, tableEl, stepForward, canGoForwardRef, mode = 'transparent', onProgress, onDone, onError }) {
  try {
    // Dynamically import html2canvas to avoid bloating initial bundle
    const { default: html2canvas } = await import('html2canvas');

    // Calculate total steps: for each street, one step per action + one for street start
    const totalSteps = hand.streets.reduce((sum, s) => sum + 1 + (s.actions?.length || 0), 0) + 1; // +1 for showdown

    const isGreenScreen = mode === 'greenscreen';

    // Codec + container selection
    // Green screen: prefer MP4 (Safari/iOS supports it, good for CapCut import)
    // Transparent: VP9 WebM (alpha channel support)
    let mimeType, fileExt;
    if (isGreenScreen) {
      if (MediaRecorder.isTypeSupported('video/mp4;codecs=avc1')) {
        mimeType = 'video/mp4;codecs=avc1'; fileExt = 'mp4';
      } else if (MediaRecorder.isTypeSupported('video/mp4')) {
        mimeType = 'video/mp4'; fileExt = 'mp4';
      } else {
        // Chrome fallback: WebM with green background still works in desktop CapCut
        mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
        fileExt = 'webm';
      }
    } else {
      mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
      fileExt = 'webm';
    }

    // Off-screen recording canvas.
    //
    // This was a fixed 540x540 SQUARE while .replayer-table is aspect-ratio
    // 3/4.5, so html2canvas produced a 540x810 capture that was then drawn into
    // 540x540: every exported clip was the table vertically compressed to 67%.
    // Cards became lozenges, the oval became a circle, the dealer button became
    // an ellipse. The GIF path derives its height from the element's own
    // aspect and always got this right, so the two exports of one replay
    // disagreed.
    const SIZE = 540;
    const OUT_W = SIZE;
    const OUT_H = Math.round(SIZE * (tableEl.offsetHeight / tableEl.offsetWidth)) || SIZE;
    const canvas = document.createElement('canvas');
    canvas.width = OUT_W;
    canvas.height = OUT_H;
    const ctx = canvas.getContext('2d');

    // Set up MediaRecorder on canvas stream
    const stream = canvas.captureStream(24); // 24 fps
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_000_000 });
    const chunks = [];
    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

    const downloadPromise = new Promise(resolve => {
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const baseName = (hand.gameType || 'hand').toLowerCase().replace(/\s+/g, '-');
        a.download = baseName + '-replay.' + fileExt;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        resolve();
      };
    });

    recorder.start();

    let step = 0;

    /**
     * Capture the current state of the table element onto our recording canvas.
     * html2canvas renders the DOM with backgroundColor:null for transparency.
     * We hold each frame for ~1 second (24 frames at 24fps).
     */
    const captureFrame = async () => {
      try {
        // Capture the felt table — transparent or chroma-key green background
        const captured = await html2canvas(tableEl, {
          backgroundColor: isGreenScreen ? '#00ff00' : null,
          scale: SIZE / tableEl.offsetWidth,
          width: tableEl.offsetWidth,
          height: tableEl.offsetHeight,
          useCORS: true,
          logging: false,
          allowTaint: false,
          foreignObjectRendering: false,
        });

        if (isGreenScreen) {
          ctx.fillStyle = '#00ff00';
          ctx.fillRect(0, 0, OUT_W, OUT_H);
        } else {
          ctx.clearRect(0, 0, OUT_W, OUT_H);
        }
        ctx.drawImage(captured, 0, 0, OUT_W, OUT_H);

        // Pause on each frame for ~900ms (≈ 21-22 frames at 24fps = ~1s per action)
        await new Promise(r => setTimeout(r, 900));
      } catch (captureErr) {
        // If html2canvas fails on this frame, draw a blank transparent frame and continue
        ctx.clearRect(0, 0, OUT_W, OUT_H);
        await new Promise(r => setTimeout(r, 100));
      }

      step++;
      onProgress(Math.round((step / totalSteps) * 100), step, totalSteps);
    };

    // Capture the initial state (start of hand)
    await captureFrame();

    // Step forward through every action / street transition
    // canGoForwardRef is a { current: boolean } ref that reflects live replay state
    while (canGoForwardRef.current) {
      stepForward();
      // Wait for React to commit the state update before capturing
      await new Promise(r => setTimeout(r, 80));
      await captureFrame();
    }

    // Hold the final frame (showdown / result) a bit longer — 2s
    await new Promise(r => setTimeout(r, 1100)); // extra 1.1s on top of captureFrame's 900ms

    recorder.stop();
    await downloadPromise;
    onDone();
  } catch (err) {
    onError(err);
  }
}

// ── Instagram Stories Sharing ──
// Bridges to the native InstagramStories Capacitor plugin to share
// a GIF sticker directly to Instagram Stories via the pasteboard API.

import { Capacitor, registerPlugin } from '@capacitor/core';

const InstagramStories = registerPlugin('InstagramStories');

/**
 * Check if we're running in a native iOS context with the plugin available.
 */
export function canShareToInstagram() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
}

/**
 * Share a GIF blob as a sticker to Instagram Stories.
 * Opens Instagram with the sticker pre-loaded — user just adds
 * their background and posts.
 *
 * @param {Blob} gifBlob - The GIF file blob
 * @param {object} opts - Optional background colors / image
 * @param {string} opts.backgroundTopColor - Hex color for gradient top
 * @param {string} opts.backgroundBottomColor - Hex color for gradient bottom
 * @param {Blob} opts.backgroundImage - Optional background image blob
 */
export async function shareGifToInstagramStories(gifBlob, opts = {}) {
  if (!canShareToInstagram()) {
    throw new Error('Instagram Stories sharing is only available on iOS');
  }

  // Convert blob to base64
  const stickerBase64 = await blobToBase64(gifBlob);

  const args = {
    stickerBase64,
    backgroundTopColor: opts.backgroundTopColor || '#1a1a2e',
    backgroundBottomColor: opts.backgroundBottomColor || '#0a0a15',
  };

  if (opts.backgroundImage) {
    args.backgroundImageBase64 = await blobToBase64(opts.backgroundImage);
  }

  return InstagramStories.shareSticker(args);
}

/**
 * Share a full-frame 9:16 VIDEO as the Instagram Story background.
 * Instagram's only animated slot is `backgroundVideo` — the sticker slot is
 * still-image only — so an ANIMATED replay has to go here. The replay is
 * composited over the chosen photo at 1080x1920 before this is called, so it
 * fills the whole Story; Instagram then opens its editor on top, where the
 * poster adds text, stickers and music.
 *
 * @param {Blob} videoBlob - The MP4 (H.264) story clip
 * @param {object} opts
 * @param {string} opts.backgroundTopColor    - Hex, fallback fill only
 * @param {string} opts.backgroundBottomColor - Hex, fallback fill only
 */
export async function shareVideoToInstagramStories(videoBlob, opts = {}) {
  if (!canShareToInstagram()) {
    throw new Error('Instagram Stories sharing is only available on iOS');
  }

  const videoBase64 = await blobToBase64(videoBlob);

  return InstagramStories.shareVideo({
    videoBase64,
    backgroundTopColor: opts.backgroundTopColor || '#1a1a2e',
    backgroundBottomColor: opts.backgroundBottomColor || '#0a0a15',
  });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      // Strip the data:...;base64, prefix
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

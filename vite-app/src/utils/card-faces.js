/**
 * Every card face, shipped inside the app's code (owner, 2026-11-15: "4d not rendering, this is really bad").
 *
 * A face was a request per card (/cards/cards_gui_<card>.svg, 21 places across the replayer, the solver views, the
 * camera overlay and the exports). All 52 files are sound (each decodes in WebKit, the live site serves each), yet on
 * a device a load can fail (a dropped request, one cancelled when the card's element was redrawn mid-load) and the
 * browser never retries it: the card showed as a broken image with its name beside it. From the bundle the face is
 * a data URI, which has nothing to fetch and so cannot fail. The files stay in public/cards, which
 * scripts/make-card-faces.mjs reads whenever Vite starts (the font all faces share is written once there).
 *
 * cardFaceSrc('Ah') -> the face; an unknown name falls back to its old URL.
 */
import { FACES, FONT, FONT_MARK } from '../card-faces.generated.js';

const built = new Map();

export function cardFaceSrc(key) {
  let uri = built.get(key);
  if (uri) return uri;
  const svg = FACES[key];
  if (!svg) return '/cards/cards_gui_' + key + '.svg';
  uri = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg.replace(FONT_MARK, FONT));
  built.set(key, uri);
  return uri;
}

/** How many faces the bundle carries (52 when the generator found them all). */
export const CARD_FACE_COUNT = Object.keys(FACES).length;

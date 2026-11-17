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

/* A card whose rank was recorded and its suit not ("Kx": quick add writes one when a suit was not said; owner,
   2026-11-16: "the river is face down"). It was drawn as a back, which hid the rank the hand does have. Drawn instead
   as a face of the deck's own make (the same card, rank and font as cards_gui_*.svg) in slate, the colour of no
   suit, with a question mark where the suit's pip would be. */
const RANK_TEXT = { T: '10' };
export function rankOnlyFaceSrc(rank) {
  const r = String(rank || '').toUpperCase();
  const key = 'rank-only:' + r;
  let uri = built.get(key);
  if (uri) return uri;
  const text = RANK_TEXT[r] || r;
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 252"><defs><style>'
    + "@font-face{font-family:'Univers Condensed';src:url('data:font/truetype;base64," + FONT_MARK + "') format('truetype');font-weight:700}"
    + ".r,.q{font-family:'Univers Condensed','Univers-Condensed-Bold',sans-serif;font-weight:700}"
    + '.r{fill:#fff;font-size:78px}.q{fill:#3a414d;font-size:150px}</style></defs>'
    + '<rect width="180" height="252" rx="18" ry="18" fill="#59616e"/>'
    + '<text class="r" transform="translate(' + (text.length > 1 ? '-1.4' : '17.3') + ' 72)">' + text + '</text>'   // as the deck sets 10
    + '<text class="q" x="128" y="236" text-anchor="middle">?</text></svg>';
  uri = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg.replace(FONT_MARK, FONT));
  built.set(key, uri);
  return uri;
}

/** How many faces the bundle carries (52 when the generator found them all). */
export const CARD_FACE_COUNT = Object.keys(FACES).length;

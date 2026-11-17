/**
 * The card back (owner, 2026-11-16: "add the BTG logo as a card back design"). Two designs: the standard back
 * (the navy weave with the fg mark) and BTG's (the logo on white). The choice is a viewer preference stored with the
 * replayer's settings (localStorage 'replayerCardBack') and painted everywhere a card lies face down, the replayer, the
 * saved hands' rows and the trainers, through one attribute on the root: <html data-card-back="btg">. The design
 * itself is CSS (styles.css, "The BTG back"); it is a background, so the replayer's turn-over, which copies the back's
 * background onto a card as it turns, carries it too.
 */
export const CARD_BACKS = [
  { id: 'standard', label: 'Standard' },
  { id: 'btg', label: 'BTG' },
];

export const CARD_BACK_KEY = 'replayerCardBack';

/** Any stored or seeded value to a design this build has ('standard' for anything else). */
export function normalizeCardBack(v) {
  return CARD_BACKS.some(b => b.id === v) ? v : 'standard';
}

/** Paint every face-down card with this design (the standard back carries no attribute). */
export function applyCardBack(v, root = typeof document !== 'undefined' ? document.documentElement : null) {
  if (!root) return;
  const id = normalizeCardBack(v);
  if (id === 'standard') delete root.dataset.cardBack;
  else root.dataset.cardBack = id;
}

/** At boot, before the first face-down card is drawn: the stored choice. */
export function applyStoredCardBack() {
  try { applyCardBack(localStorage.getItem(CARD_BACK_KEY)); } catch (e) { /* storage blocked: the standard back */ }
}

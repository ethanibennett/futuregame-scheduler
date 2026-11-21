/**
 * The card back (owner, 2026-11-16: "add the BTG logo as a card back design"). Two designs: the standard back
 * (the navy weave with the fg mark) and BTG's (the logo on white). The choice is a viewer preference stored with the
 * replayer's settings (localStorage 'replayerCardBack') and painted everywhere a card lies face down, the replayer, the
 * saved hands' rows and the trainers, through one attribute on the root: <html data-card-back="btg">. The design
 * itself is CSS (styles.css, "The BTG back"); it is a background, so the replayer's turn-over, which copies the back's
 * background onto a card as it turns, carries it too.
 */
/* BTG's back is only for accounts made with the registration code BTG (owner, 2026-11-21: "only include the BTG card
   back option for users that register with code BTG"). The server says which backs an account has (`cardBacks` on
   register and sign-in, lib/registration-codes.js); the app keeps that list with the session (CARD_BACKS_UNLOCKED_KEY,
   cleared at sign-out). A back with `code` is offered, and painted, only when the list holds it: a device that chose
   BTG under another account shows the standard back. */
export const CARD_BACKS = [
  { id: 'standard', label: 'Standard' },
  { id: 'btg', label: 'BTG', code: 'BTG' },
];

export const CARD_BACK_KEY = 'replayerCardBack';
export const CARD_BACKS_UNLOCKED_KEY = 'cardBacks';

/** The backs this session's account has unlocked (ids), from local or session storage. */
export function unlockedCardBacks() {
  for (const store of [() => localStorage, () => sessionStorage]) {
    try {
      const raw = store().getItem(CARD_BACKS_UNLOCKED_KEY);
      if (raw) { const v = JSON.parse(raw); if (Array.isArray(v)) return v.map(String); }
    } catch (e) { /* storage blocked or bad JSON: none */ }
  }
  return [];
}

/** The designs this viewer may choose: every open one, and the unlocked ones. */
export function availableCardBacks(unlocked = unlockedCardBacks()) {
  return CARD_BACKS.filter(b => !b.code || unlocked.includes(b.id));
}

/** Any stored or seeded value to a design this viewer has ('standard' for anything else). */
export function normalizeCardBack(v, unlocked = unlockedCardBacks()) {
  return availableCardBacks(unlocked).some(b => b.id === v) ? v : 'standard';
}

/** Paint every face-down card with this design (the standard back carries no attribute). */
export function applyCardBack(v, root = typeof document !== 'undefined' ? document.documentElement : null, unlocked = unlockedCardBacks()) {
  if (!root) return;
  const id = normalizeCardBack(v, unlocked);
  if (id === 'standard') delete root.dataset.cardBack;
  else root.dataset.cardBack = id;
}

/** At boot, before the first face-down card is drawn: the stored choice. */
export function applyStoredCardBack() {
  try { applyCardBack(localStorage.getItem(CARD_BACK_KEY)); } catch (e) { /* storage blocked: the standard back */ }
}

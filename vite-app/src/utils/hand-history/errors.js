// ── Hand history: why a hand cannot be written ──────────────────────────────
// One error type for every refusal, with a code the UI can switch on, a long
// message for the export sheet's "Not exported" list and a short one (two lines
// at most in a 17g Share tile).

const COPY = {
  // A hand that arrived by someone else's share link. The export names the hero as the user and dates the
  // hand now, so it would put a hand the user never played into their tracker as theirs.
  'not-yours':            { short: 'Only hands you saved can be exported', message: () => "A hand shared with you isn't one of yours to export" },
  // v.why and v.short come from ps-format.js NOT_WRITTEN: a game the app plays that the writer says so about.
  'unsupported-game':     { short: 'No PokerStars format for this game', message: (v) => v.why || ('PokerStars format has no ' + (v.game || 'such game')) },
  'unsupported-currency': { short: 'Its currency has no PokerStars form', message: (v) => 'PokerStars format has no ' + (v.currency || '') + ' cash games' },
  'seating':              { short: "The seats can't be placed", message: (v) => "The players' positions don't fit a " + (v.n || '') + '-handed table' },
  'stack-missing':        { short: 'A stack is missing', message: (v) => (v.name || 'A player') + "'s stack isn't recorded" },
  // Stud has no blinds, and a hand saved with none (the old sample stud hands) reads the same: "stakes".
  'blinds-missing':       { short: "The stakes aren't recorded", message: (v) => (v.stud ? "The stakes aren't recorded" : "The blinds aren't recorded") },
  'hero-cards-unknown':   { short: "Your cards aren't recorded", message: () => "Your hole cards aren't recorded" },
  'cards-missing':        { short: 'A card is missing', message: (v) => (v.name || 'A player') + "'s " + (v.street || '') + " card isn't recorded" },
  'duplicate-cards':      { short: 'A card appears twice', message: (v) => (v.card || 'A card') + ' appears twice in the hand' },
  'board-missing':        { short: 'A board card is missing', message: (v) => 'The ' + (v.street || 'board') + " isn't recorded" },
  'out-of-turn':          { short: "The betting doesn't add up", message: (v) => (v.name || 'A player') + ' acts out of turn on the ' + (v.street || 'street') },
  'bad-action':           { short: "The betting doesn't add up", message: (v) => (v.name || 'A player') + "'s " + (v.action || 'action') + ' on the ' + (v.street || 'street') + " doesn't add up" },
  'bad-amount':           { short: "The betting doesn't add up", message: (v) => (v.name || 'A player') + "'s " + (v.action || 'action') + ' on the ' + (v.street || 'street') + " doesn't add up" },
  'unfinished':           { short: "The hand isn't finished", message: (v) => 'The hand stops on the ' + (v.street || 'street') + " before it's decided" },
  'no-winner':            { short: "The winner isn't recorded", message: () => "Who won at showdown isn't recorded" },
  'draw-cards-unknown':   { short: "Your drawn cards aren't recorded", message: (v) => (v.nobody ? "Nobody's draw is recorded" : "The cards you drew aren't recorded") },
};

export class HandExportError extends Error {
  constructor(code, vars = {}) {
    const c = COPY[code] || { short: "This hand can't be exported", message: () => "This hand can't be exported" };
    super(c.message(vars));
    this.name = 'HandExportError';
    this.code = code;
    this.short = vars.short || c.short;   // a caller may word the tile line itself (the vars it passes are the message's too)
    this.vars = vars;
  }
}

export const ERROR_CODES = Object.keys(COPY);

/**
 * The solver's words, said for a player (App improvements 301). The owner's rule: no "blueprint", "CFR",
 * "oracle" or "infoset" reaches a Study screen. Server notes arrive in the engine's terms and are kept as they
 * are for logs and the admin eval; every one shown goes through plainStudy(), and the client's own labels use
 * the same words: the trained strategy, an exact solve, solver steps.
 */
const RULES = [
  // The draw study's notes, whole, first: their claims kept (sampled, not certified; the opponent is the
  // trained strategy), the internals left out.
  [/^\s*blueprint, not equilibrium[^]*$/i, 'From here on the opponent plays the trained strategy: right for grading your play against it, not a claim about perfect play'],
  [/^[^]*blueprint POLICY cannot see them[^]*$/i, 'Your dead cards are left out of the figures (worth under half a chip)'],
  [/^\s*MONTE-CARLO FORWARD[^]*$/i, 'Each figure comes from dealing the rest of the hand many times, so it carries a margin.'],
  [/Certified against the exact post-last-draw oracle/gi, 'Checked against an exact solve of the last draw'],
  [/\s*\((?:the )?blueprint too large for this instance\)/gi, ''],
  [/\bthe blueprint (?:bot|POLICY|policy)\b/gi, 'the trained strategy'],
  [/\bblueprints?\b/gi, 'trained strategy'],
  [/\b(?:the )?true-GTO oracle\b/gi, 'an exact solve'],
  [/\boracle's\b/gi, "exact solve's"],
  [/\boracle\b/gi, 'exact solve'],
  [/\brange-form CFR\+? over the [\w -]+? tree\b/gi, 'the spot'],
  [/\bCFR\+? iters?\b/gi, 'solver steps'],
  [/\bMCCFR\b\s*/g, ''],
  [/\bCFR\+?\b/g, 'solver'],
  [/\binfosets?\b/gi, 'decision points'],
  [/\bvillain\b/gi, 'opponent'],
];
export function plainStudy(text) {
  if (text == null) return text;
  let s = String(text);
  for (const [re, to] of RULES) s = s.replace(re, to);
  return s.replace(/\s{2,}/g, ' ').trim();
}
/** True when a text still holds one of the banned words (for tests). */
export function hasSolverWords(text) { return /\b(blueprint|CFR|oracle|infoset)/i.test(String(text || '')); }

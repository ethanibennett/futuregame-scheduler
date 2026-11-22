// The play-money dealer's deck (docs/play-money-platform.md §1). A fresh 52-card deck per hand, shuffled by
// Fisher-Yates over crypto.randomInt (the OS's CSPRNG): no seed, nothing derived from the clock, and the deck
// never leaves the server. Each deck is kept with a salted SHA-256 so a hand can later be shown to have been
// dealt before it was played (owner, 2026-11-22, decision 9: kept, not shown).
import crypto from 'node:crypto';

const RANKS = '23456789TJQKA';
const SUITS = 'hdcs';
export const DECK = [...RANKS].flatMap((r) => [...SUITS].map((s) => r + s));

export function shuffledDeck() {
  const d = DECK.slice();
  for (let i = d.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    const t = d[i]; d[i] = d[j]; d[j] = t;
  }
  return d;
}

export function deckCommitment(deck) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.createHash('sha256').update(salt + ':' + deck.join('')).digest('hex');
  return { salt, hash };
}

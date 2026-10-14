# Quick-add — the contract between the parts (step 1: text)

Design and decisions: `docs/quick-add-hands.md`. This file is what the four parts build TO, so
they fit together without seeing each other's code. Change it only deliberately.

## The hand

The replayer's existing hand object — the same shape `HandReplayerView.jsx` saves, replays and
encodes (`vite-app/src/utils/hand-shorthand.js` is the canonical serialisation; read the entry
form in `HandReplayerView.jsx` for field meanings). Key facts:

- `gameType` — one of the replayer's game names (`HAND_CONFIG` in `vite-app/src/utils/utils.js`:
  NLH, PLO, LHE, O8, Stud Hi, Stud 8, Razz, 2-7 TD, A-5 TD, Badugi, NL 2-7 SD, …).
- `gameMode` `'mtt'|'cash'`, `currency` (cash only).
- `blinds` `{ sb, bb, ante, … }` (+ straddles, bring-in / big bet for stud and limit).
- `players[]` `{ name, position, startingStack }`; `heroIdx` is the hero's index.
- `streets[]` `{ name, cards: { hero, opponents[], board }, actions[], draws[] }`.
  - `actions[]` `{ player, action, amount }` — `amount` is the chips ADDED by that action.
  - draws: a draw is recorded on the betting round BEFORE it (first draw on street 0);
    `{ player, discarded, discardedCards, newCards }`; unknown drawn cards may be omitted.
  - an opponent's stored cards are their showdown hand; stud opponents' strings are up cards.
- `result` `{ winners: [{ playerIdx, split }] }` (optional).
- Card notation `AhKs`, suits h/d/c/s, ranks 2-9 T J Q K A; `x` = face-down/unknown.

A PARTIAL hand is the same object with fields missing (null/absent), never guessed.

### `hand.quickAdd` — what the parse leaves for the engine (2026-10-14)

A partial hand may also carry one extra key, `quickAdd`, written by the server's normaliser
(`lib/quick-add/normalize.js`) and read by the gaps engine. It is the flow's own state, not the
replayer's: `toReplayable` (QuickAddView) deletes it before the hand is opened or saved.

```ts
quickAdd?: {
  // Waiting for the table to be seated or the blinds to be known:
  positions?: 'narrator';      // only the players mentioned are listed; the table size is not known
  tableSize?: number;          // said, not yet applied
  othersFolded?: boolean;      // "folds to me": unnamed seats fold preflop once the table is seated
  antePerPlayer?: number;      // an ante said as every player's; becomes the big blind ante when seated
  straddles?: { type, player? }[];
  groups?: { street, at, action, count? }[];   // "whole table calls", "4 callers", "all others fold"
  // What only the parse could tell (rules over the hand cannot see these):
  observer?: boolean;          // the narrator was not in the hand
  notRecordable?: true | string;   // not one recordable hand (a rules question, a story, a montage)
  otherHands?: string[];       // hands the post also told, not recorded
  otherHandsBlocking?: boolean;    // the player must say which one (owner decision F)
  unsupported?: string[];      // a format the replayer cannot store (bomb pot, double board, PLO5 …)
  anteUnclear?: number;        // an ante said with no type and no pot to settle it
  questions?: Gap[];           // ready-made questions: a card or size said two ways, a four-card
                               // flop in a transcript, a stated pot the actions miss, a texture
                               // the cards break, seats a group action was given to
};
```

## Gaps — `vite-app/src/utils/quick-add/gaps.js` (part A)

```js
findGaps(hand) -> Gap[]        // ordered: ask the first one first
applyAnswer(hand, gap, value) -> hand   // merges a STRUCTURED answer (an option's value)
```

```ts
type Gap = {
  id: string;              // stable for the same problem, e.g. 'stack:2', 'button', 'action:1:3'
  kind: string;            // 'missing' | 'ambiguous' | 'impossible'
  field: string;           // dotted path it concerns, e.g. 'players.2.startingStack'
  question: string;        // plain-English question, short ("How deep was Opp 2?")
  options?: { label: string; value: any }[];   // one-tap answers; first = best guess
  allowFree?: boolean;     // accept free text (part B interprets it)
  blocking: boolean;       // must be resolved before the hand can be replayed
};
```

Rules, not model judgement, decide what a gap is: missing game/blinds/hero/positions/button,
missing or zero stacks, cards that collide or have the wrong count for the game, an action out of
turn, a bet/call/raise that does not add up (pot, stack, limit sizes), a betting round that never
closes, a draw count with no matching street, a showdown with no winner, etc.

One exception, added 2026-10-14: a few gaps come from the PARSE, because only the text says them.
They arrive in `hand.quickAdd` (above) and the engine turns them into gaps without judging them:
`scope` (blocking: not one hand that can be recorded), `hand-choice` (the post told other hands),
`unsupported` (a format the replayer cannot store), `hero`'s "I wasn't in this hand" option
(`quickAdd.observer`), and every entry of `quickAdd.questions` under its own id (`choice:*`,
`board-count:1`, `pot-mismatch:*`, `texture-conflict:*`, `group-seats:*`). A question's options
carry `{ op: 'answerQuestion', id, sets: [{ path, value }] }` (apply the reading, drop the
question) or `{ op: 'dismiss' }`. The rules still decide everything about the hand itself.

## Server — part B

All under `authenticateToken` + admin gate (`APP_ADMIN_USERNAMES` in `server.js`), with a
per-user rate limit. Model `claude-sonnet-5` for parsing; the existing `@anthropic-ai/sdk` and
`ANTHROPIC_API_KEY` (set on Render, NOT locally — tests stub the client).

```
POST /api/quick-add/parse   { text, source: 'text'|'speech', hints?: { gameType?, heroName? } }
  -> { hand, notes: string[] }          // partial hand; notes = things the model was unsure of

POST /api/quick-add/answer  { hand, gap, answer: string }   // free-text answer to one gap
  -> { hand }                           // the hand with that answer applied
```

The parse uses a TOOL whose input schema is the hand object (structured output). The prompt
says: never invent cards, stacks or actions that the text does not state; leave them empty.
`source: 'speech'` tells it the text is a transcript (expect "three bet", "kay queue suited").

## UI — part C

`vite-app/src/components/QuickAddView.jsx`, reached from the Hands tab (admins only). Chat
style: the user types/pastes a description → parse → then ONE gap at a time from `findGaps`, with
its options as one-tap chips and a free-text box (free text → `/answer`). Every answer re-runs
`findGaps`. When no blocking gaps remain: "Open in replayer" (and Save). Grid rules apply (whole g
widths, whole r heights, no px literals, baselines on r lines — see `docs/design-tokens.md` and
the existing replayer styles).

## Test corpus — part D

`test/quick-add/corpus/*.json`: `{ id, source, text, expect: { …key facts… } }` — realistic
descriptions as players actually type and dictate them, every game family, incomplete ones on
purpose. `test/quick-add/eval.js` runs a corpus through `/parse` + `findGaps` and scores the
facts it recovered and the gaps it raised.

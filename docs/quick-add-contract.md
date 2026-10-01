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

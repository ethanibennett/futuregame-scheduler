# Quick-add hand histories (design, 2026-10-01)

The next big non-visual effort: add a hand to the replayer by describing it, in text or by
voice, and let the app ask for whatever the description left out.

## Decisions (Ethan, 2026-10-01)

| | |
|---|---|
| Audio → text | **The phone's own speech recognition** — Apple's on-device recognizer in the app, the browser's Web Speech API on the web. No cloud transcription vendor. Poker jargon it mangles ("three bet", "kay queue suited") is cleaned up by the parse step, which is told the text came from speech. |
| Follow-up questions | **One at a time, chat-style** — one question per turn, one-tap suggested answers, free text or voice for anything else. Answers can change what is asked next. |
| Access | **Admins only to start** — the same gate as the other admin tools while it is tuned; every parse is a paid API call. |

## Shape

1. **Capture** — a Quick Add entry on the Hands tab: type/paste, or record.
2. **Transcribe** (voice only) — on-device recognizer → plain text. Nothing is uploaded but text.
3. **Parse** — a server endpoint sends the text to Claude with a tool whose input schema IS the
   replayer's hand format (game, blinds/ante/straddle, seats with positions and stacks, hero,
   hole/up cards, board, actions per street, draws with discarded/new cards, showdown,
   gameMode/currency). Structured output, so the result is always well-formed. Fields the text
   does not state are left empty, never guessed silently.
4. **Validate (deterministic)** — the replayer's own engine checks the parsed hand and lists the
   GAPS: missing button/positions, missing stacks, action out of turn, a bet that doesn't add up
   to the pot/stack math, duplicate or impossible cards, a street that never closes, a draw
   count with no matching cards. The gap list comes from rules, not from the model.
5. **Ask** — one gap at a time, phrased with a best-guess default as a one-tap answer
   ("Effective stacks 100 BB?" · Yes / Edit). Each answer is merged and step 4 re-runs, so a
   fix that exposes a new gap is asked about next. The model may phrase questions and read
   free-text answers back into fields; the rules decide what is still missing.
6. **Review** — the finished hand opens in the replayer (entry form available) to save.

## Building blocks already in the repo

- `server.js` already uses `@anthropic-ai/sdk` with `ANTHROPIC_API_KEY` (set on Render) for
  schedule parsing (`/api/parse-schedule`). Use the current models — Claude Sonnet 5
  (`claude-sonnet-5`) for the parse; Haiku 4.5 is fine for phrasing questions.
- `vite-app/src/utils/hand-text-parser.js` (`parseHandText`) — the deterministic shorthand
  parser behind the (now hidden) Text tab; useful as a fast path for structured input and as a
  source of the format's rules.
- `vite-app/src/utils/hand-shorthand.js` — the canonical serialised hand format (links).
- Draw conventions to respect (traps that already bit): a draw is recorded on the betting
  round BEFORE it (first draw on street 0); an opponent's stored cards are their showdown hand;
  unrecorded drawn cards are face-down `Ax`.

## Open questions for the build

- Speech in the iOS app needs a Capacitor speech-recognition plugin (Apple's SFSpeechRecognizer;
  microphone + speech-recognition permission strings in Info.plist). The web path uses
  `webkitSpeechRecognition` where available (Safari supports it; Chrome needs network).
- Where the validator lives: client-side (it already has the engine) or shared with the server.
  Client-side keeps one source of truth; the server only parses and phrases.
- Rate limit per admin even while gated.

## Corpus round: what the collected hands changed (2026-10-14)

236 real descriptions were collected (100 forum posts, 136 video transcripts) and read against the
parser. The collections stay outside the repo; `test/quick-add/corpus/forum-text.json` (100) and
`spoken.json` (78) are paraphrases with a `sourceUrl` each (see `test/quick-add/README.md`). The
hand format (`docs/quick-add-contract.md`) is unchanged; everything new is either in the parse
tool's input, in `hand.quickAdd`, or a new gap.

**Deterministic fixes** (`lib/quick-add/cards.js`, `games.js`, `normalize.js`; client
`betting.js`, `rules-setup.js`), each covered by `test/quick-add/normalisers.test.js` or
`gaps-round2.test.mjs`:

- Card text: emoji suits with variation selectors (`Q♣️`), the heavy heart `❤`, texture suffixes
  (`873r`, `T5Ttt`, `Q72 mono`), standalone `x` cards (`Q 10 x`), stud's `(xx)` / `[xx xx]` /
  `xx…` face-down cards, mixed `KdJ97`, and `AA92hh` no longer giving both aces the heart.
- Amounts: `t2090`, `400 000`, `1,2` (decimal comma), `35 grand`, `1.2 mil`, and estimates
  (`~450`, `like 7500`, `300kish`). Stakes as written go in `blinds.stakes` and are re-read in code:
  `6/12k` is 6,000/12,000 (it came back as 6 and 12,000), `8-16`, `5/T`, `1224` in a transcript.
- Positions: `+2`, `U+1`, `UTG +1`, `OTB`, `STRD`/`Strdl`, "first to act", "under the gun one",
  "the plus one player", "Button (hero)", "eight seat".
- Suits that were described but not placed are kept: a board's `texture` / `suitCounts` ("two
  clubs and a spade", "rainbow") and a holding's `suitPattern` / `suitCounts` ("double suited",
  "three diamonds to my king"). `pickSuits` now fills unknown suits so the description holds —
  it used to erase exactly the flush draw the story had — and asks (`texture-conflict:*`) when the
  given cards break it.
- Boards: one read twice ("Jh3s2h Jh3s2h") is kept once; later streets written with the earlier
  cards ("Turn: KsJc4h 7s") keep only the new card; in a transcript, a four-card "flop" ending in
  an unsuited deuce ("queen 982 diamonds") keeps three cards and asks (`board-count:1`).
- Actions: group actions (`group: "rest"`, `count`) for "whole table calls", "4 callers",
  "checks around", "all others fold", expanded per seat once the table is seated (server
  `expandGroups`, client `pending.js` when the table size is answered; an ambiguous count asks
  `group-seats:*`). Multiway checks before the first player named on a street are inserted
  (`insertImpliedChecks`; the client treats such fills as automatic); heads-up "he bets, I call"
  with the bettor in position gets the check first instead of swapping who bet. An action said
  twice in a row is one.
- Stacks said as "behind" (`actions[j].behind`) become the starting stack (in plus behind).
- Stated pots (`streets[i].potBefore`, also before any action) settle what they prove — whether an
  ante was every player's (web-022: 5,000 at 20k/40k, pot 95,000) and which reading of a two-way
  size was meant ("b61" in a hand sized in chips) — and ask (`pot-mismatch:*`) when the actions
  cannot reach them. 10% or a big blind is allowed for rake.
- An ante below the big blind with no type said is kept as a big blind ante and asked about
  (`ante-type`, per player first when it is a quarter of the big blind or less), unless a stated
  pot settles it. An ante the size of the big blind is a big blind ante.
- Fixed-limit stakes come from the sizes when none are said ("raised to 8,000" → 4k/8k).
- A pasted hand history's seat numbers and button seat give the positions (`seatNumber`,
  `buttonSeat`).
- The gaps engine said "called 0.3, but the price was 0.3" at cent stakes (binary floating point);
  its running totals are cleaned.
- `lib/quick-add/speech.js` reads number words ("two hundred and ten", "fifty three hundred"),
  spoken cards ("ace of spades king of hearts") and fused rank runs ("1087" → T87). It answers
  spoken free-text gap answers without the model, and gives the parse a list of number-word
  conversions as a reading aid; the transcript itself is sent unchanged.

**Prompt** (`lib/quick-add/prompt.js`): hero words (we/us/our, H, Hero, second-person "you"),
observers, names that look like cards ("KK raises"), collective and relative actions, the
straddle-vs-UTG rule (two players who both act cannot be one seat), stakes with a trailing k,
"behind" stacks, noise that is not this hand's stacks (tournament starting stack, average,
winnings), suit descriptions in their own fields, completing a short holding from later words,
what is never cards (ranges, made-hand spellings, table talk), two-way values in `boardChoices` /
`choices` / `sizeChoices`, verbless sizes, blind lines, implied 3-bets, telegraphic pairs, scope
(one hand, `otherHands`, `recordable`, no hypotheticals), stated pots, hi-lo and split-game rules,
formats and variants. Two glossaries: typed shorthand (text) and recogniser spellings plus
dialogue rules (speech), and a second worked example.

**New gaps** (client): `blinds.scale` (6 with a 12,000 big blind), a real small-blind ladder
(0.02 for 0.05, 10 for 25, never 0, always sb = bb too), "Record it in big blinds (0.5/1)" when
every size is in big blinds, `ante-type`, the hero question's "I wasn't in this hand" (then
"whose seat should the replay follow?"), `scope` (not a hand), `hand-choice` (other hands),
`unsupported` (bomb pot, double board, run it twice, button blind, PLO5/6, short deck, NLO8), and
the server's own questions from `hand.quickAdd.questions` (`rules-quick.js`; option op
`answerQuestion`).

**Still the owner's to decide** (the code takes the cautious side meanwhile): A) "UTG" with a UTG
straddle on — the prompt only separates them when both act; B) estimates are recorded with a
note, not asked; C) observer hands follow a chosen seat as the hero; D) bomb pots, double boards,
run-it-twice and button blinds are approximated with a note; E) PLO5/PLO6 are recorded as PLO
(extra hole cards not kept), short deck as NLH; F) posts with several hands record the most
detailed one and list the rest; G) per-pot winners are not stored; H) no deterministic
hand-history fast path yet (seat arithmetic only); I) number words are a reading aid, not a
rewrite. The collector's item-level questions (OTTNH, "A10h", "1/2/4/800", ".8bb deep", "we 3x",
"635", and others) are in the corpus notes of the cases they come from.

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
hand format (`docs/quick-add-contract.md`) is unchanged except for the optional `hand.quickAdd`
key (documented there, and stripped before a hand is opened or saved); everything new is either in
the parse tool's input, in `hand.quickAdd`, or a new gap.

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
  spoken free-text gap answers without the model (a pair of numbers for the blinds is read as stakes:
  "ten twenty" is 10/20, never 1,020), and runs the pre-pass on a transcript (decision I): the number
  words that are certainly numbers are rewritten as digits, listed beside the transcript and logged;
  rank words are never touched, and two numbers said in a row ("five hundred one thousand") stay two.
- `lib/quick-add/hh.js` (decision H) reads a pasted PokerStars / GG / Full Tilt history, or a
  converter's "Stacks: … / Flop ($1.20) 7c 8d 2h: BB checks, Hero bets $0.60" layout, in code: seats, button
  seat (positions come from it), stacks, blinds, antes (per player or a big blind ante), actions,
  boards, showdown cards and the winner of each pot. A line it cannot read is read by the model on its
  own (`read_lines`, names already replaced); a converter layout with one unreadable clause goes to
  the model whole. Whichever way the switch is set, a detected history is anonymised first.

**Prompt** (`lib/quick-add/prompt.js`): hero words (we/us/our, H, Hero, second-person "you"),
observers, names that look like cards ("KK raises"), collective and relative actions, the
straddle rule (decision A: the opener called UTG is the seat after the straddler), stakes with a trailing k,
"behind" stacks, noise that is not this hand's stacks (tournament starting stack, average,
winnings), suit descriptions in their own fields, completing a short holding from later words,
what is never cards (ranges, made-hand spellings, table talk), two-way values in `boardChoices` /
`choices` / `sizeChoices`, verbless sizes, blind lines, implied 3-bets, telegraphic pairs, scope
(one hand, `otherHands`, `recordable`, no hypotheticals), stated pots, hi-lo and split-game rules,
formats and variants. Two glossaries: typed shorthand (text) and recogniser spellings plus
dialogue rules (speech), and a second worked example.

**New gaps** (client): `blinds.scale` (6 with a 12,000 big blind), a real small-blind ladder
(0.02 for 0.05, 10 for 25, never 0, always sb = bb too), "Record it in big blinds (0.5/1)" when
every size is in big blinds, `ante-type`, the hero question's "I wasn't in this hand" (the hand is
stored hero-less and nothing more is asked about a hero), `scope` (not a hand), `hand-choice` (other
hands: always asked, blocking), `unsupported` (bomb pot, double board, run it twice, button blind), and
the server's own questions from `hand.quickAdd.questions` (`rules-quick.js`; option op
`answerQuestion`).

**The owner's answers (2026-10-14)** — each is a named value in `lib/quick-add/decisions.js`, so a
change of mind is a one-line change there:
A) with a UTG straddle on, the opener ("UTG", "under the gun") is the seat AFTER the straddler
(`UTG_WITH_STRADDLE: 'next-seat'`); B) hedged values are recorded with a note, "A or B" is a question;
C) observer hands are stored HERO-LESS (`hand.heroless`); D) bomb pots, double boards, run it twice,
button blinds and rock straddles: **deferred by the owner on 2026-10-14 ("mark this as something to
come back to")**, current behaviour kept; E) PLO5, PLO6, PLO6 8/b, Short Deck and NLO8 are each their own
game, and E2) "Big Easy" is PLO6 8/b everywhere in quick add; F) a post with several hands ALWAYS asks
which (blocking `hand-choice`, options re-parse with `hints.handIndex`); G) a winner PER POT
(`result.pots`); H) a deterministic hand-history fast path (`lib/quick-add/hh.js`: PokerStars, GG,
Full Tilt, and a converter's compact layout) that reads the lines it can and has the model read the
rest line by line, screen names replaced before anything is sent; I) a logged number-word pre-pass for
speech that never touches rank words.

**Follow-ups for the replayer** (not built here, written down so the next job can start):
1. *Hero-less hands* — the replayer reads `heroIdx ?? 0` everywhere. For `hand.heroless` it needs: no
   hero highlight or hero-relative copy; `cards.hero` read as seat 0's cards and every known card
   drawn face up from the start; hand-shorthand encode/decode and the saved-hand schema carrying the
   flag; the hands list and stats skipping such a hand. Until then `toReplayable` opens it with
   `heroIdx` 0 and the flag.
2. *Per-pot winners* — `result.pots` is parsed, normalised and kept; the replayer shows and edits only
   `result.winners`.
3. *Own game configs* — DONE (2026-10-14, `feat/replayer-games`). PLO5, PLO6, PLO6 8/b, Short Deck and
   NLO8 each have a `HAND_CONFIG` entry (`vite-app/src/utils/utils.js`, copied exactly into
   `vite-app/src/utils/quick-add/game.js`), a `GAME_EVAL` entry and its own rows in the replayer's game
   picker, and "Big Easy" is now "PLO6 8/b" everywhere a user sees it (hands saved as "Big Easy", links
   with the code `BE` and a header that spells the old name all still open as PLO6 8/b:
   `canonicalGameType` in `utils.js`, `decodeHand` in `hand-shorthand.js`). `REPLAYER_FALLBACK` and
   `replayerGame` are gone, so quick add opens these games natively. Short Deck is a 36-card deck
   (`poker-engine.js` `SHORT_DECK_RULES`: a flush beats a full house, A-6-7-8-9 is the lowest straight,
   a straight beats three of a kind unless `SHORT_DECK_TRIPS_BEAT_STRAIGHT` is flipped); its button blind
   stays with the deferred formats (D).
4. *Deferred (D)* — bomb pots, double boards, run it twice, button blinds, rock straddles.

The switches, in `lib/quick-add/decisions.js`: `UTG_WITH_STRADDLE` (`'next-seat'`; `'both-act'` is the
analysis' first proposal, `'ask'` never decides), `HEDGED_VALUES` (`'note'`; `'ask'` also raises a
question), `OBSERVER_HANDS` (`'heroless'`; `'refuse'`), `UNSUPPORTED_FORMATS` (`'approximate'`, the
deferred D; `'refuse'`), `OWN_GAMES` and `VARIANT_GAMES` (what a variant with no game of its own is
recorded as), `SEVERAL_HANDS` (`'ask'`; `'most-detailed'` and `'last-asked'` make the gap a note),
`PER_POT_WINNERS` (`true`), `HAND_HISTORY_FAST_PATH` (`true`) and `NUMBER_WORDS` (`'rewrite'`; `'aid'`
sends the transcript as said).

**The owner's readings of the collector's item-level questions** (in the prompt's glossaries and in
the corpus notes of the cases they come from): OTTNH is "on to the next hand"; one suit letter after
a two-card holding means both cards ("AKh", "A10h", "J 10d" = JdTd); a parenthesised amount after a
player ("BB cold calls ($430)", "SB c (386)") is that player's starting stack; "1/2/4/800 PLO" is
100/200 blinds with a 400 straddle and an 800 double straddle; "$5/T" is 5/10; "we 3x" is a raise to
3x the open, not a 3-bet; "click" is a min-raise; pink is bink; "pull" is call; "base" in badugi is
an ace; WHAP is a sound effect; unclear positions are estimated with the seat order kept (hero LJ,
V2 UTG+2/MP1 in the nine-handed web-014); and the user is asked about "10/10/10/20/20 Stud 8",
"BB limps", ".8bb deep", the 3-6 / 6-6 hand, the 635 shove, the doubled "goose deuce", "norris" and
"nori", the order of "I raise in lamps I raise", and "from the hijack in the button".

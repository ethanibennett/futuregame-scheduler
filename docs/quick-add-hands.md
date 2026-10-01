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

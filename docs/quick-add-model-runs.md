# Quick add: measuring models before switching (2026-11-21)

The owner asked: *"How do we improve the quality of the type a hand / say a hand functions?"* The answer
starts with a measurement. The model behind quick add has **never been scored**: there is no
`ANTHROPIC_API_KEY` on the Windows box, and (found while doing this work) the Admin screen's live eval
could not run at all. This branch makes the newer models usable, lets Admin measure each one, and logs
real use so the corpus can grow from it. **Production does not change until the env is flipped.**

## What changed

**1. The parse can run on the current models, with thinking.** `lib/quick-add/prompt.js` has two request
shapes (`requestShape`):

| Shape | Sent when | What it is |
|---|---|---|
| `forced` | the default: Claude Sonnet 5, no effort set | today's request, unchanged: `tool_choice` names the tool, no thinking |
| `thinking` | Claude Opus 5.5, Sonnet 5.5 or Fable 5.1/5.2 (they 400 on a forced tool), or any adaptive-thinking model once an effort is set | `thinking: {type: "adaptive"}`, `output_config.effort` (medium unless set), `tool_choice: auto` with at most one call, a system line "answer only by calling the tool" inside the cached system block, `max_tokens` 16,000, a 150 s timeout, and a server-side refusal fallback on Opus 5.5 / Sonnet 5.5 (beta `server-side-fallback-2026-07-01`, `fallbacks: "default"`) |

`callTool` (`lib/quick-add.js`) handles what `auto` allows: a reply with no tool call is asked once more as
a continuation (its thinking blocks passed back unchanged), then the existing 502; a refusal is a 422
(with fallbacks on, every model in the chain declined); a reply cut off at `max_tokens` is retried once at
effort low, then a 422. Usage is added up over every request, and each parse reports the model that
answered, the requests made and its cost at list price (`lib/quick-add/pricing.js`).

**Why `record_hand` is not `strict: true`.** Strict tools and structured outputs compile the schema into a
grammar with published limits: at most 24 optional and 16 nullable parameters across a request's strict
schemas. `record_hand` has 94 properties, **79 optional and 57 nullable**, and every null is the "leave it
empty, the player is asked" the prompt depends on; filling them in would turn questions into guesses.
`apply_answer`'s `value` is any JSON, which the grammar cannot express. Both stay unstrict and are checked
in code, as they always were (`normalize.js`, `patch.js`; a forced `tool_choice` never validated them
either). `read_lines` fits (0 optional, 5 nullable) and is strict in the thinking shape. The test
`strict: read_lines is strict…` in `test/quick-add/server.test.js` holds those numbers.

**2. The switches** (read once at boot; the boot log says what is in force):

```
[QuickAdd] parse: claude-sonnet-5, forced tool (no thinking) · answer: claude-haiku-4-5-20251001, forced tool (no thinking)
```

| Env | Default | Meaning |
|---|---|---|
| `QUICK_ADD_PARSE_MODEL` | `claude-sonnet-5` | the parse model |
| `QUICK_ADD_EFFORT` | unset | `low` `medium` `high` `xhigh` `max`: the parse thinks at that effort. Unset: the model's own request (forced on Sonnet 5, medium on Opus 5.5 / Sonnet 5.5) |
| `QUICK_ADD_ANSWER_MODEL` | `claude-haiku-4-5-20251001` | the free-text answer model. `claude-haiku-5-5` works in the forced shape (it accepts a forced tool) |
| `QUICK_ADD_ANSWER_EFFORT` | unset | as `QUICK_ADD_EFFORT`, for answers |
| `QUICK_ADD_FALLBACKS` | on | `0` turns off the refusal fallback |
| `QUICK_ADD_LOG` | on | `0` turns off the parse log |

**3. The eval measures cost and can pick its model.** `test/quick-add/eval.js` takes `--model`, `--effort`
(`off` = the model's own request) and `--sample n` (n cases spread evenly over the selection, a cheap
pilot). The report gains a cost line (total, per hand, output tokens per parse, thinking included) and the
JSON report an `aggregate.cost`.

**4. Fixed: the Admin live eval had never scored anything.** Loading the replayer's game table stubs
`window` and `document`, the Anthropic SDK then believes it is in a browser and refuses to build a client,
the eval found "no parser", fell back to a dry run and exited 0 with no report, and the Admin screen showed
the section as if never run. The client is now built with the stubs out of sight (`withoutBrowserStubs`),
and `test/quick-add/eval-options.test.js` runs the default mode end to end on a stub parser. The server
itself never stubs those globals, so production parses were not affected.

**5. Admin compares runs.** Admin › Hand parser, live eval: pick the model, the thinking effort, the hands
(the 266-hand corpus or the 1,000 shorthand hands) and the size (every hand, a 40-hand pilot, 100 hands).
The confirm step gives the cost: measured, once a run of that model and effort exists, else a rough
estimate. Every finished run is kept (`quick_add_eval_runs`, the newest 40) and read side by side: recall,
precision, perfect parses, hallucinated cards, cost per hand, p90 latency; a select opens any run's figures
and full report.

**6. The parse log** (`lib/quick-add/learn.js`, table `quick_add_parses`, the newest 5,000). Every
`POST /api/quick-add/parse` is kept: the text, the model and effort, the time, the cost, the parsed hand or
the error. The hand carries its row's id (`quickAddParseId`, a top-level key the answers, the client and the
replayer all keep), and the save routes (`POST`/`PUT /api/replayer/hands`) pair the saved hand with its parse
when it is the saver's own, with a fact-level diff: what the player **fixed** (changed or removed) and
**added** (filled in, usually an answer to a question). Admin › Quick add log lists them, opens one in full,
and **Export as eval cases** downloads the saved hands as draft corpus cases, `expect` built from the saved
hand (`caseFromLog`; `test/quick-add/learn.test.js` round-trips 103 corpus hands through it at 100%).
The raw text stays in the database: a case is paraphrased before it goes in the public corpus (the
corpus README's rule), and its notes say which facts the parse got wrong. The log is cleared with the
account. Parses from the Apple Watch (`lib/watch.js`) are not logged yet; they do follow the switches below
(`parseHand` and `answerGap` take their defaults from the same env, which the Watch's parse did not before).

## The runs to make from Admin

All on the server's key. Costs are **estimates** (list price; the cached prompt of ~11,700 tokens read from
the cache, ~400 tokens of description, and a guess at the output with thinking): run the pilots first, and
the confirm step then shows the measured figure. Each full run of 266 hands takes roughly 15 to 45 minutes
(three at a time).

| # | Model | Effort | Hands | Rough cost | Why |
|---|---|---|---|---:|---|
| 1 | Sonnet 5 | None (today's request) | The corpus, every hand | $4 | **The baseline: production as it is.** Nothing else means anything without it |
| 2 | Opus 5.5 | low | 40-hand pilot | $2 | measures thinking's real token use and latency |
| 3 | Sonnet 5.5 | medium | 40-hand pilot | $2 | the same, on Sonnet |
| 4 | Haiku 5.5 | low | 40-hand pilot | $0.06 | whether the cheapest model is anywhere near |
| 5 | the best of 2 to 4 | as piloted | The corpus, every hand | $7 to $23 | the candidate, scored like the baseline |
| 6 | the next best | as piloted | The corpus, every hand | $7 to $23 | a second candidate (Opus 5.5 low ≈ $14, medium ≈ $23; Sonnet 5.5 low ≈ $7, medium ≈ $12) |
| 7 | the winner of 5 / 6 | as run | Shorthand, 100 hands | $3 to $9 | typed shorthand, the hardest text |
| 8 | Sonnet 5 | None | Shorthand, 100 hands | $1.50 | the shorthand baseline for 7 |

About **$25 to $65** for all eight. A higher effort (high ≈ $41 a full Opus 5.5 run, $21 on Sonnet 5.5) is
worth a pilot only if low/medium still miss facts that thinking should catch. The whole 1,000-hand shorthand
corpus costs about ten times a 100-hand run; run it once, on the final choice.

### Reading the table

- **Hallucinated cards** must not rise above the baseline: an invented card is the worst error (the contract
  says never). Then **recall** (facts recovered) and **perfect parses**, then **precision**.
- **p90 latency** has a hard ceiling: the app gives up on a parse after 60 s (`REQUEST_TIMEOUT_MS` in
  `QuickAddView.jsx`; today's parses take ~7 s). A candidate whose p90 nears 45 s needs that raised before it
  ships.
- **Cost per hand** times the expected volume: the launch plan caps quick adds per user per day; a parse at
  $0.05 with a cap of 20 is at most $1 a user a day.
- The free-text **answers** (`QUICK_ADD_ANSWER_MODEL`) have no eval. Haiku 5.5 is a safe swap in the forced
  shape (the same request, a newer model); watch the log's answers after switching.

### Switching, and back

On Render (futurega.me), set `QUICK_ADD_PARSE_MODEL` and, if the winner ran with one, `QUICK_ADD_EFFORT`;
the service restarts and the boot log names the new shape. Watch Admin › Quick add log for a day: failures,
"saved as parsed", what players fix. To go back, delete the variables.

Running the eval by hand needs a key, which only Render has; with one (**Mac**):

```bash
ANTHROPIC_API_KEY=sk-ant-... node test/quick-add/eval.js --model claude-opus-5-5 --effort low --sample 40
```

**PC (PowerShell):**

```bash
$env:ANTHROPIC_API_KEY = 'sk-ant-...'; node test/quick-add/eval.js --model claude-opus-5-5 --effort low --sample 40
```

Checking exported cases (no key; **Mac or PC**):

```bash
node test/quick-add/eval.js --dry-run --corpus quick-add-live-cases-2026-11-21.json
```

## Tests

`npm run test:quick-add` (now with `learn.test.js` and `eval-options.test.js`) and `npm run test:admin-eval`.
The new cases in `server.test.js` cover the forced shape unchanged byte for byte, the thinking shape, the
strict limits, the no-tool-call continuation, the refusal, the max_tokens retry, the fallback beta's route,
cost, the env switches and the parse log end to end. No test calls the API.

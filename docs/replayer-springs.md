# Replayer springs

The hand replayer's moving moments run on one physically based spring family, the same numbers the
launch ads use in Remotion. This page covers what moves, how it is built, the flag that turns it on,
and how to capture before/after video.

## The flag

`localStorage.replayerSprings`, read at mount and on the `storage` event:

| Value | What runs |
|---|---|
| unset or `'1'` | Set A, "house" (the default on this branch) |
| `'2'` or `'snappy'` | Set B, "snappy" |
| `'0'` | Today's code paths, unchanged, so a before and after come from the same build |

`prefers-reduced-motion: reduce` turns every spring off whatever the flag says. The replayer keeps
its 140ms `rmFade`, the pot figure changes on the press frame, and no ghost or shipped chip is drawn.

## One spring, five tiers

Every object has stiffness k and damping ratio zeta; only its mass changes, so the whole table reads
as one physical system. The configs paste into Remotion's `spring({ fps, config })` unchanged.

| Tier | Set A (k 380, zeta 0.80, 1.5% overshoot) | Set B (k 640, zeta 0.86, 0.5%) | Used for |
|---|---|---|---|
| flick | damping 23.1, mass 0.55, settles 323ms | 32.3, 0.55, 257ms | a wager pushed out, the landing squash |
| hand | 31.2, 1.0, 435ms | 43.5, 1.0, 347ms | the flop placed and spread, turn/river placed, the sweep |
| arm | 39.5, 1.6, 551ms | 55.0, 1.6, 439ms | the pot shipped to the winner |
| inertia | 48.3, 2.4, 674ms | 67.4, 2.4, 537ms | a card squaring up (rotation trails translation) |
| yield | 28.9, 0.55, critically damped, 351ms | 37.5, 0.55, 271ms | the row making room: never bounces |

Settle times are to 0.1%. `utils/spring.js` holds these as `SPRING_SETS`, with the staging (staggers,
beats, rotation signs) beside each set.

## The moments

| Moment | What happens (Set A, phone) | Ends |
|---|---|---|
| Flop | The last street's wagers are swept in first. At 60ms the three cards are placed as one stack in slot 0, window card on top: they drop 0.15 card heights, scale 1.08 to 1 and square up from -3 degrees. At 280ms the window card spreads, and the middle card follows 40ms behind it. | about 650ms |
| Turn / river | Sweep, then at 40ms the row yields: every card moves from where it was seen on one critically damped spring, and the new card's x rides the same spring a pitch to the right. At 70ms the new card is placed: it drops, scales and squares up (+2.5 degrees on the turn, -2 on the river). | about 250ms for the board, 313ms with the sweep |
| Bet, call, raise | The wager is fully legible on the press frame ("a wager is a fact, not an event"). It is pushed out from 0.55 board-card widths back toward its seat, shortened if the start would touch that seat's cards or badge. A raise over chips already out pushes again from 0.3 widths, from wherever the stack is. | about 150ms |
| Sweep (street press) | Each wager on the felt becomes a ghost, a copy of the same stack, made in the commit that removes the wagers. Ghosts leave in action order, 40ms apart (all gone within 160ms). The amount and its pill fade as the chips leave, the chips fly to the pot chips lifted over the board, and at arrival the pot figure ticks up by that wager and the ghost squashes once as it fades. | arrivals at 193ms and 233ms |
| Ship (result) | Five gold chips per winner (ten in all at most) go from the pot chips to the winner's stack figure on the arm spring, 35ms apart, fully opaque, lifted and set down a little smaller. The stack ticks up a fifth of the award at each arrival, and the plaque's gold arrives with the first chip. | last chip gone at about 465ms |

Nothing else moves. Seat plaques (except the winner's digits), the dealer button, hole cards,
badges, the pot pill, the board container and the table geometry are untouched.

## How it is built

- **`utils/spring.js`** (pure, node-tested) solves the damped harmonic oscillator in closed form,
  under-, critically and over-damped, with a starting velocity for retargets. `keyframes()` samples
  the channels of one element at 120Hz into a single composed transform (plus opacity) per sample,
  RDP-simplified to 0.25px. x, y and rotation add; scale and opacity multiply. `toLinear()` gives
  the CSS `linear()` easing.
- **`utils/replayer-motion.js`** has the registry, `Map<element, entry>`, and the moments.
  - Every spring is a Web Animation on transform and opacity only, so it is compositor-friendly.
  - Fills are never `forwards`: the element's own style is the end state, and delayed starts fill
    `backwards`.
  - A single-channel spring rides two keyframes and a `linear()` easing where
    `CSS.supports('animation-timing-function', 'linear(0, 1)')`. Elsewhere it uses the sampled form
    of the same curve, so an iPhone without `linear()` gets the identical motion.
    `localStorage.replayerSpringsLinear = '0'` forces the sampled form for testing.
- **HandReplayerView** decides in render whether this commit is a single step forward from the last
  one (`motionKind`) and starts the moment in a layout effect, before the browser paints the press.
  - A jump, a step back, End/Start, or a hand change finishes everything instead: ghosts and chips
    leave, the pot and stacks land, and nothing plays backwards.
  - A new spring on an element that is still moving takes over its position and velocity.
- **The pot and stack figures** in render are the model's value minus what is still in flight.
  - Each arrival writes its digits straight into the text node, with no re-render mid-moment.
  - One render follows the last arrival.
  - Every commit after a direct write first puts the rendered figures back, because React skips a
    text node it thinks is unchanged.
- **Removed on the spring path**: the street-change effect's three re-renders (+0, +450, +500ms);
  this is what cancelled the turn card after one frame. Also removed: `turnRiverSlide` (flag `'0'`
  keeps it), `markPotLanding`'s re-renders, the blanket 700ms flying-chip clear, and the dead
  `--chip-start-dx/dy` and `flopCardSlide`.

## Exports

The springs are Web Animations, so the `[data-capturing]` freeze, which pauses only CSS animations,
does not touch them. Under capture the registry creates them paused and holds their arrivals.
`captureStepFrames()` in `replay-capture.js` then does one of two things:

- **Seeks** the moment one output frame at a time and holds the settled still for the rest of the
  step. The video does this at 24 fps (the flop is about 16 frames, a turn 8, a push-out 4, the ship
  12). The GIF does it at 12.5 fps, only for moments of 3 frames or more, and spends at most 32
  motion frames in one GIF.
- **Finishes** the moment, when it does not fit the step, and captures one settled still. A still is
  never a frame frozen at a 0% keyframe.

Exports run the springs at the autoplay rate for the export speed.

Checked in Playwright WebKit on the 8-max hand (2026-10-12): every seeked frame of the turn in the
GIF (0, 80, 160, 240ms) and the video (every 41.7ms to 292ms) put the board cards, the swept
wagers' ghosts and the pot figure exactly where the live replayer has them at the same instant
(within 0.01px; the live side pinned through `document.getAnimations()`, not the registry), and
the frames look the same (`node scripts/check-replay-export-motion.mjs <scratch url> --out <dir>`
re-runs it and exits non-zero on any difference over 0.5px). The video spends 16 frames on the flop, 8 on a turn or river, 4 on a
push-out and 12 on the ship; the GIF 8, 4, 4 and 6. When reproducing this, press and pin in ONE
`page.evaluate`: Playwright's clock does not drive the document timeline, so a second round trip
lets the springs run in real time (a 90ms label fade is over before it lands).

**The cost, measured** (same 8-max hand, 22 steps, Playwright WebKit on the Windows box, springs
off vs on): the video export took 95s vs 460s (22 captures vs 102: the flop 16, turn and river 8
each, ship 12, and 36 for nine push-outs of 4), the GIF 223s vs 288s (its encode dominates). Every
capture is one modern-screenshot pass, so expect the same ratio on a phone. If that is too slow, the
cheapest cut is to finish push-outs instead of seeking them in the video (66 captures, about 3x),
then a motion-frame budget like the GIF's.

## Autoplay

Each spring's time is divided by `rate = clamp(sqrt(1000 / speed), 1, 2)`. That gives 1 at 0.5x and
1x, 1.41 at 2x and 2 at 4x. The shape is identical, motion never slows below 1x, and no autoplay
delay changed. A step never waits for motion.

## Capturing before and after

From a scratch server running the worktree (never the pm2 app on 3001):

```
node scripts/capture-replayer-motion.mjs http://127.0.0.1:<port> --springs 0 --out <before> --parallel 4
node scripts/capture-replayer-motion.mjs http://127.0.0.1:<port> --springs 1 --out <after> --parallel 4
node scripts/capture-replayer-motion.mjs --report --out <after> --against <before>
node scripts/compare-replayer-motion.mjs --before <before> --after <after> --out <compare>
```

Add `--width 1440 --height 900 --seats 8` for desktop. `--springs 2` captures Set B.

Tests: `npm run test:springs`.

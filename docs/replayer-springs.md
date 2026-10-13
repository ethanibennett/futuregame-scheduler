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

Set A stays the default on this branch: choosing between A and B is the owner's call, which is what
the flag is for. A review of round 2 preferred B's tempo for the moments that repeat every street;
A now has B's two strongest points folded in (the flop spread on the near-critical slide spring, a
150ms flop beat, and a turn/river card that waits at most 90ms for crossing chips).

## One spring, six tiers

Every object has stiffness k and damping ratio zeta; only its mass changes, so the whole table reads
as one physical system. The configs paste into Remotion's `spring({ fps, config })` unchanged.

| Tier | Set A (k 380, zeta 0.80, 1.5% overshoot) | Set B (k 640, zeta 0.86, 0.5%) | Used for |
|---|---|---|---|
| flick | damping 23.1, mass 0.55, settles 323ms | 32.3, 0.55, 257ms | a wager pushed out, the landing squash |
| hand | 31.2, 1.0, 435ms | 43.5, 1.0, 347ms | the flop and turn/river placed, the sweep |
| arm | 39.5, 1.6, 551ms | 55.0, 1.6, 439ms | the pot shipped to the winner (armLight 1.45 and armHeavy 1.75 vary the mass per chip) |
| inertia | 48.3, 2.4, 674ms | 67.4, 2.4, 537ms | a card squaring up (rotation trails translation) |
| yield | 28.9, 0.55, critically damped, 351ms | 37.5, 0.55, 271ms | the row making room: never bounces |
| slide | 35.9, 1.0, zeta 0.92, 339ms | 46.4, 1.0, zeta 0.92, 256ms | the flop spreading: friction stops it |

Settle times are to 0.1%. Two tiers keep the stiffness and the mass and change only the damping
ratio, on purpose: yield is critically damped (something pushed aside never bounces), and slide is
damped to 0.92 (a card sliding on felt is stopped by friction). On the hand spring the flop's window
card ran 1.1px past its slot and crept back for 120ms, the sharpest edge on the table never quite
still; on slide it overshoots 0.04px. `utils/spring.js` holds these as `SPRING_SETS`, with the
staging (staggers, beats, rotation signs) beside each set.

## The moments

| Moment | What happens (Set A, phone) | Ends |
|---|---|---|
| Flop | The last street's wagers are swept in first. At 60ms the three cards are placed as one stack in slot 0, window card on top: they drop 0.15 card heights, scale 1.08 to 1 and square up from -3 degrees. At 210ms (a 150ms beat: the stack is read as the last swept chip lands) the window card slides to its slot on the slide spring, and the middle card follows 40ms behind it. | about 520ms |
| Turn / river | Sweep, then the row yields: every card moves from where it was seen on one critically damped spring, and the new card's x rides the same spring a pitch to the right. The row has ONE start. It waits for a chip whose path crosses the board to clear it (those are collected first), at most 90ms; if any card is still moving (a fast tap over a running spread) every card starts at once, each with its own velocity. 30ms after the row the new card is placed: it drops, scales and squares up (+2.5 degrees on the turn, -2 on the river). | about 250ms for the board, 313ms with the sweep |
| Bet, call, raise | The wager is fully legible on the press frame ("a wager is a fact, not an event"). It is pushed out from 0.55 board-card widths back toward its seat, shortened if the start would touch that seat's cards or badge. A raise over chips already out pushes again from 0.3 widths, from wherever the stack is. | about 150ms |
| Sweep (street press) | Each wager on the felt becomes a ghost, a copy of the same stack, made in the commit that removes the wagers. Ghosts leave 40ms apart (all gone within 160ms), in action order except that a wager whose path crosses the board goes first. The amount and its pill fade as the chips leave, the chips fly to their own colour's stack of the pile under the pot's figure, lifted over the board, and at arrival the pot figure ticks up by that wager and the ghost squashes once as it fades. | arrivals at 193ms and 233ms |
| Result: collect, then ship | The river's wagers are swept in first, as on a street press. Once they have landed and faded (283ms), the pot leaves the pile: five gold chips per winner (ten in all at most), 22ms apart, on the arm spring with the mass varied per chip. Each comes out from under the pile as its stack fades, so the pile empties. They fan out and close up again, fly under the pot figure, the wagers and the button, and land on the edge of the winner's plaque nearest the pile, tucking under it. The stack ticks up a fifth of the award at each arrival (527-626ms), the plaque takes its gold with the first, and the won pill in front of the winner appears with the last. | last chip gone at 676ms; 393ms when the river went in without wagers |

The pot pill and its figure stay where they are at the result (no collect fade, per the standing
ruling); the figure is the hand's pot, which the closing bookend reads too.

### Where the pot lands

Owner, 2026-10-12: the shipped chips never cross the winner's name; they land on the edge of the
name plaque nearest the table's centre, and the stack figure updates on landing, at every seat, 6-,
8- and 9-max, phone and desktop. `seatLanding()` picks the point. Of the plaque's edges that face
the pile, every point a chip can touch without touching a hole card or the dealer button (and come
to rest without touching the name) is a candidate. The nearest to the pile wins, unless the straight
path to it runs under the cards, the button or the hand's name (heavily penalised) or would arrive
at a grazing angle. Aimed at the plaque's centre, as before, a chip met the hole cards first
wherever they hang between the pot and the plaque, and vanished into them 10-80px short of it: the
hero, the usual winner, every time. The flight layer has the plaques, the hands' names, the hole
cards and the button cut out of it, so a chip that reaches the seat tucks under the plaque.

Measured over all 31 seats (6, 8 and 9-max at 402x874, 8-max at 1440x900, each seat the winner, 60fps
frames): no chip box ever overlaps the winner's name text (0px²), every chip comes to rest inside
the plaque 6.6-10.2px from the edge it entered, and the stack ticks at each landing to the exact
award. The hero lands on the top edge's free shoulder right of the cards on a phone, and between the
button and the cards on desktop. Side seats land on the corner of the plaque nearest the pile,
beside the cards; top seats on the bottom edge, beside the hand's name.

Nothing else moves. Seat plaques (except the winner's digits), the dealer button, hole cards,
badges, the pot pill and its figure, the board container and the table geometry are untouched.

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
  - Each moment starts its own clock (`beginMoment()`). Arrivals are timed on their flight's
    animation; a spring an arrival starts (the pile's stacks making room, the pile emptying) is born
    at that arrival.
- **HandReplayerView** decides in render whether this commit is a single step forward from the last
  one (`motionKind`) and starts the moment in a layout effect, before the browser paints the press.
  - It reads every rect the moment needs first, then creates elements and starts springs; nothing
    in the write half reads the DOM back.
  - A jump, a step back, End/Start, or a hand change finishes everything instead: ghosts and chips
    leave, the pot and stacks land, and nothing plays backwards.
  - A new spring on an element that is still moving takes over its position and velocity.
- **The pot and stack figures** in render are the model's value minus what is still in flight.
  - Each arrival writes its digits straight into the text node, with no re-render mid-moment.
  - One render follows, once nothing is moving at all (re-rendering the whole replayer is the most
    expensive thing a frame can do, and the last arrival is usually mid-moment).
  - Every commit after a direct write first puts the rendered figures back, because React skips a
    text node it thinks is unchanged.
  - A winner's stack counts up by what its plaque gains (the model's final figure less what it showed
    before the press, never below 0: a shorthand can commit more than a stack holds).
- **Removed on the spring path**: the street-change effect's three re-renders (+0, +450, +500ms);
  this is what cancelled the turn card after one frame. Also removed: `turnRiverSlide` (flag `'0'`
  keeps it), `markPotLanding`'s re-renders, the blanket 700ms flying-chip clear, the dead
  `--chip-start-dx/dy` and `flopCardSlide`, and the re-render after every street press that only
  replaced an empty set of folding seats with another empty one.
- **Nothing changes on the table root mid-moment.** The plaque's gold delay
  (`--spring-ship-arrive`) was a custom property on `.replayer-table`, recomputed every render. The
  showdown's own render, about 150ms after a result press, changed it, so every element on the
  table had its style recomputed in the middle of the sweep: an 80-106ms frame at a 4x CPU
  throttle, at every result. It is decided once per result now and lives on the winning seats only.

## Exports

Owner, 2026-10-12: the exports keep the motion except the bet/call/raise push-outs. The flop, the
turn and river, the wagers into the pot and the pot shipped to the winner animate in the video and
the GIF; a push-out exports as its settled frame.

The springs are Web Animations, so the `[data-capturing]` freeze, which pauses only CSS animations,
does not touch them. Under capture the registry creates them paused and holds their arrivals.
`captureStepFrames()` in `replay-capture.js` then does one of two things:

- **Seeks** the moment one output frame at a time and holds the settled still for the rest of the
  step. While it seeks, the table carries `[data-capture-motion]`, so the closing bookend (which
  covers the table at the result) waits for the settled still and the pot is seen going to the
  winner; the result's last seeked frame is held 0.4s before the bookend takes over. The video seeks
  at 24 fps and the GIF at 12.5 fps (only moments of 3 frames or more, at most 32 motion frames a
  GIF). A shipped chip's stretch is sized to the distance it covers between two output frames (half
  of it, at most three diameters), so the pot reads as chips in flight, not dots strobing across the
  table.
- **Finishes** the moment, when it does not fit the step or is a push-out, and captures one settled
  still. A still is never a frame frozen at a 0% keyframe, and arrivals start no paused springs.

Exports run the springs at the autoplay rate for the export speed. On the 8-max hand at 1x the video
seeks the flop for 13 frames, the turn and the river 8 each and the result 17 (46 in all); the GIF 7,
4, 4 and 9 (24).

Checked in Playwright WebKit on that hand (`node scripts/check-replay-export-motion.mjs <scratch url>
--out <dir>`): every seeked frame of the turn and the river, and every other one of the result, is
compared with the live replayer pinned at the same instant through `document.getAnimations()` (not
the registry): board cards, swept wagers' ghosts, shipped chips and the pot figure, to 0.5px and
0.005 of opacity. It also writes the frames side by side (`<moment>-gif-vs-live.png`,
`<moment>-video-vs-live.png`) and exits non-zero on any difference. When reproducing this, press and
pin in ONE `page.evaluate`, and pin at 0 until every animation has its start before running the
clock: Playwright's clock does not drive the document timeline, and the registry times an arrival
from its animation's real start.

**The cost, measured** (the same 8-max hand, 22 steps, Playwright WebKit on the Windows box, springs
off vs on, `check-replay-export-motion.mjs --time-only`, runs interleaved, 2026-10-13):

| Export | Springs off (today) | Springs on, before the motion-frame fix | Springs on, now | Captures |
|---|---|---|---|---|
| Video | 90-112s | 329-357s (3.6-3.9x) | 175-181s (1.6-2.0x) | 22 vs 68 |
| GIF | 100-113s | 249-282s (2.5-2.7x) | 163-166s (1.5-1.7x) | 22 vs 46 |

Owner's target, 2026-10-12: about 3x today's export time (round 1 was 4.8x, with every push-out
seeked and 102 captures).

Where a capture's time goes. A WebKit capture took 4.1-4.7s, and 0.6-0.9s of it was the capture
itself (the same pixels). The rest was modern-screenshot's workaround for a Safari/Firefox bug, in
which the images nested in the captured SVG (the card faces are svg+xml) are not decoded on the
first draw. The library redraws the SVG once per embedded image, 100ms + i apart. It counts every
non-`none` CSS background as an image, gradients included, and the table has 19-23 of them, so a
capture scheduled 27-30 redraws and slept about 3s for 4-11 real images. iOS takes the same path.

`captureMotionCanvas()` (in `replay-capture.js`) captures every motion frame. It keeps one redraw per
image that can need decoding (`<img>`, SVG `<image>`, CSS `url()`), at the library's own interval
and never fewer than four, and drops the redraws counted for gradients, which paint with the SVG.
This uses the library's public hook (`onCreateForeignObjectSvg` sets `context.drawImageCount`). The
settled stills, which every step is held on, keep the library's behaviour untouched, so an export
with the springs off is byte for byte today's.

To confirm on an iPhone before merging: export a hand and check that no seeked frame of the flop or
the result is missing a card face. A miss would be one 1/24s frame.

Motion frames are kept as ImageBitmaps up to 128MB (`MOTION_BITMAP_BYTES`) and past that as PNG
blobs. The PNG round trip had cost more than the capture itself.

## Autoplay

Each spring's time is divided by `rate = clamp(sqrt(1000 / speed), 1, 2)`. That gives 1 at 0.5x and
1x, 1.41 at 2x and 2 at 4x. The shape is identical, motion never slows below 1x, and no autoplay
delay changed. A step never waits for motion.

## Frame cost

Measured in Edge at a 4x CPU throttle, the stand-in for an old iPhone. The setup: 402x874 at dpr 3,
the 8-max, 8-max multiway and 9-max hands, three reps each, flags interleaved, 2026-10-13. Each moment
was pressed with a real click. A long frame is a long-animation-frame entry, 50ms or more.

| Press | Springs off: press frame, median / max | Springs on | Long frames after the press, springs on |
|---|---|---|---|
| Flop | 52 / 74ms | 94 / 125ms | none |
| Turn | under 50ms | 61 / 78ms | none |
| River | under 50ms | under 50 (max 63ms) | none |
| Bet, call, raise over chips | under 50ms | under 50ms | none |
| Result | 55 / 71ms | 126 / 142ms | none (was 80-106ms at every result, see "Nothing changes on the table root") |

Across 57 presses with the springs on, no main-thread frame after the press frame reached 50ms. The
moments are Web Animations, so they run on the compositor whatever the main thread does.

The press frame costs more than today's because the moment is built in it, before the press paints.
That covers reading the rects, creating the ghosts and shipped chips, sampling their keyframes, and
the style and layout of the new elements. At the result that is the river's sweep and the five
shipped chips, about 35-50ms at 4x, which is 9-12ms on this machine unthrottled. Today's flop and
result press frames are already over 50ms at 4x, mostly the forced layout of React's commit.

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

# Replayer springs

The hand replayer's moving moments run on one physically based spring family, the same numbers the
launch ads use in Remotion. This page covers what moves, how it is built, the flag that turns it on,
and how to capture before/after video.

## The flag

`localStorage.replayerSprings`, read at mount and on the `storage` event:

| Value | What runs |
|---|---|
| unset (or anything unrecognised), `'2'` or `'snappy'` | Set B, "snappy", the default |
| `'1'` (or `'a'`, `'house'`) | Set A, "house", kept for an A/B |
| `'0'` | Today's code paths, unchanged, so a before and after come from the same build |

`prefers-reduced-motion: reduce` turns every spring off whatever the flag says. The replayer keeps
its 140ms `rmFade`, the pot figure changes on the press frame, and no ghost or shipped chip is drawn.

Owner, 2026-10-13: Set B is the default. Round 2's review preferred B's tempo for the moments that
repeat every street (the board is still 100-130ms sooner than A's on every street), and A's heavier
arm is the only thing it gives up.

## One spring, six tiers

Every object has stiffness k and damping ratio zeta; only its mass changes, so the whole table reads
as one physical system. The configs paste into Remotion's `spring({ fps, config })` unchanged.

| Tier | Set A (k 380, zeta 0.80, 1.5% overshoot) | Set B (k 640, zeta 0.86, 0.5%) | Used for |
|---|---|---|---|
| flick | damping 23.1, mass 0.55, settles 323ms | 32.3, 0.55, 257ms | a wager pushed out, the landing squash |
| hand | 31.2, 1.0, 435ms | 43.5, 1.0, 347ms | the flop and turn/river placed, the sweep |
| arm | 39.5, 1.6, 551ms | 55.0, 1.6, 439ms | the pot shipped to the winner (armLight 1.55 and armHeavy 1.65 vary the mass per chip) |
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

| Moment | What happens (Set B, the default; Set A in brackets) | Ends |
|---|---|---|
| Flop | The last street's wagers are swept in first. At 40ms [60], or once a chip crossing the board has cleared it (at most 60ms [90]), the three cards are placed as one stack in slot 0, window card on top: they drop 0.10 [0.15] card heights, scale 1.05 [1.08] to 1 and square up from -2 [-3] degrees. 140ms [150] later (a beat: the stack is read as the last swept chip lands) the window card slides to its slot on the slide spring, and the middle card follows 25ms [40] behind it. | about 470ms [520] |
| Turn / river | Sweep, then the row yields: every card moves from where it was seen on one critically damped spring, and the new card's x rides the same spring a pitch to the right. The row has ONE start. It waits for a chip whose path crosses the board to clear it (those are collected first), at most 60ms [90]; if any card is still moving (a fast tap over a running spread) every card starts at once, each with its own velocity. 20ms [30] after the row the new card is placed: it drops, scales and squares up (+1.5 [+2.5] degrees on the turn, -1.5 [-2] on the river). | about 250ms with the sweep [313] |
| Bet, call, raise | The wager is fully legible on the press frame ("a wager is a fact, not an event"). It is pushed out from 0.4 [0.55] board-card widths back toward its seat, shortened if the start would touch that seat's cards or badge. A raise over chips already out pushes again from 0.22 [0.3] widths, from wherever the stack is. | about 130ms [150] |
| Sweep (street press) | Each wager on the felt becomes a ghost, a copy of the same stack, made in the commit that removes the wagers. Ghosts leave 25ms [40] apart (all gone within 120ms [160]), in action order except that a wager whose path crosses the board goes first. The amount and its pill fade as the chips leave, the chips fly to their own colour's stack of the pile under the pot's figure, lifted over the board, and at arrival the pot figure ticks up by that wager and the ghost squashes once as it fades. The pile changes once (see "The pile" below). | arrivals at 169ms and 194ms [193, 233] |
| Result: collect, then ship | The river's wagers are swept in first, as on a street press, each less whatever the showdown hands its seat back (see "The pot's figure"). Once they have landed and faded (234ms [283]), the pot leaves the pile as the pile itself: each chip of the pile (five at most) is shown where it sits as the pile goes, in a frame, and flies from there, 5ms [6] apart, a handful rather than a file, on the arm spring with the mass varied a little per chip. They fan out sideways and have closed up by three quarters of the way, fly under the pot figure, the wagers and the button, and land within about 25ms of each other on the edge of the winner's plaque nearest the pile, tucking under it. The stack counts up at the first, third and last landing (to the exact award). The plaque reacts to the first landing (see "The winner's gold"). Nothing is pushed in front of the seat as well (see below). | last chip gone at about 512ms [605] |

The pot pill and its figure stay where they are at the result (no collect fade, per the standing
ruling); the figure is the hand's pot, which the closing bookend reads too.

### The pot's figure

The figure is the model's pot less what is still in flight, and it never reads below what the table
showed before the press (`potShown()`, the press's figure kept as `motion.potFloor` until the last
landing), unless the model's pot is itself lower (an uncalled over-shove handed back at the result
reads the pot at once, as flag `'0'` does).

At the result each river wager is swept in less what the showdown hands that seat back
(`collectAtResult()`, the model's own uncalled figure over the whole hand). On the 8-max hand the
raiser is 5,000 over the caller from preflop: the river's ghosts carried 80,000 into a pot that
gains 75,000, so the figure read 122K, 117K, 157K, 197K, the pot going down at the payoff. Now Opp
3's ghost carries 35,000 and the figure reads 122K, 157K, 197K. A river bet nobody called carries
nothing in. Where the excess is more than that seat's wager on the river, the floor holds the
figure rather than letting it dip. Unit tests: "the result press: an over-call's excess …".

### The ship is the pile

Owner's critic, round 3: the pot changed identity on its departure frame, the 5-chip teal stack
replaced by five flat gold coins. Each shipped chip is now a copy of one chip of the pile (the same
`.replayer-pot-chip-disc`, its colour, its edge pattern and its paint order), shown where it sits in
its stack at the moment the pile goes (every stack at once, in a frame), and it flies from there.
One winner takes one flight per chip of the pile (five at most); a split pot sends each winner a
handful of copies. Two unseen probes size it: one of these discs, and the gold coin the pot used to
ship as. The landing is chosen for the smaller of the two, and the chip is set down to that size
(less the usual 0.85) on the way: on a phone the pile's chip is the smaller (11px against the coin's
14), at 1440 the larger (24px against 14), and chosen for 24px the hero's landing found no room
between the button and the cards (2.7px) and the 9-max hero's went to the far end of the plaque
with the chips passing 26px under the hole cards.

### The winner's gold

The plaque's own gold (its border and rings) starts a frame before the first chip lands and takes
the emphatic curve over 120ms, so it is about 90% there two frames after the hit (it was a 200 and
320ms ease from the landing, a third of the way 100ms after it, still ramping after the chips were
gone). Over it a gold glow, a `::after` that animates its opacity only (the compositor's), at full
33ms after the first landing and fading over the next 450ms. Both only when this result ships the
pot (the seat's `ship-hit` class); a jump to the result takes its gold at once, with no glow.
"Winner Effects" off in the settings drops the glow.

### The pile

The pile under the pot's figure is a centred row of one stack per chip colour, capped at five chips
in all, so its colours change as the pot grows: 38,000 is teal, orange and gold, 50,000 is teal alone
and 62,000 is the three again. A sweep never shows the compositions in between (following the
running total made stacks vanish while chips were being added to them). It goes straight to the
pile as it will be once every swept wager is in, in two beats:

- **As the chips leave the seats** (25ms in [40]), the row becomes the final row, every stack at the
  height it has now. A stack that stays makes room on the critically damped yield spring; a stack
  that leaves fades out where it is (40ms [50]); a stack new to the pile holds its place unseen.
  The new row is built in the frame after the press, its delay shortened by how late it is.
- **At the first landing** the heights change, once, and the pot's digits tick. A new stack fades
  in, in two frames, under the ghost that lands on it.

Each ghost lands on its own top chip's colour in the final row. A new colour that no ghost's own
colour brings is brought by a ghost that shares a stack with another (the later to leave): a
colour-up, its chips landing in the new stack's place as the stack fades in under them. Only when
there are fewer ghosts than new stacks does one appear with the first landing, under none.

On the 8-max hand: at the flop the gold stack slides aside as the two orange wagers fly in; the
first lands on the orange stack, the second colours up into teal. At the turn nothing moves, only
the heights change. At the river the gold stack fades while teal and orange close up.

### Nothing is pushed in front of the winner

On the spring path the pot goes INTO the winner's plaque, so the won pill that flag `'0'` pushes in
front of the seat at a result is not drawn. It was the pot on the felt a second time, appearing
from nowhere 130px from where the pot landed; sent out of the plaque instead, it read as the pot
leaving the winner. The stack counting up and the plaque's gold carry the award, and the pot pill
keeps the hand's pot. With chip animation off in the settings the pill stays, since nothing else
carries the award then.

### Where the pot lands

Owner, 2026-10-12: the shipped chips never cross the winner's name; they land on the edge of the
name plaque nearest the table's centre, and the stack figure updates on landing, at every seat, 6-,
8- and 9-max, phone and desktop. `seatLanding()` picks the point. Of the plaque's edges that face
the pile, every point a chip can touch without touching a hole card or the dealer button (and come
to rest without touching the name) is a candidate. The nearest to the pile wins, unless the straight
path to it runs under the cards, the button or the hand's name (heavily penalised) or would arrive
at a grazing angle. A landing keeps half a chip of room from the cards and the button where it
rests, and from the button all the way in, wherever any landing on that plaque can; then a pixel;
and a way in that would hide the pot under the hole cards comes after any that does not. Within a
tier, a landing with less than a chip of room pays for it, so a roomy spot beats a slightly nearer
crevice. Aimed at the plaque's centre, as before, a chip met the hole cards first
wherever they hang between the pot and the plaque, and vanished into them 10-80px short of it: the
hero, the usual winner, every time. The flight layer has the plaques, the hands' names, the hole
cards and the button cut out of it, so a chip that reaches the seat tucks under the plaque. It is
one box the size of the flights' bounding box with one clip (the holes merged into rects that do
not overlap, `disjointUnion()`: an evenodd clip fills two overlapping holes' overlap back in); it
was three nested boxes, one per kind of hole, each its own mask layer.

Round 2 measured over all 46 seats (6, 8 and 9-max at 402x874 and at 1440x900, each seat the winner,
every 4ms of the flight, with the gold coin): no chip box ever overlaps the winner's name text (0px²), every chip comes to rest
inside the plaque, and the stack ticks to the exact award. 42 seats land with 8px or more of room
from the cards and the button. The hero on a phone lands on the top edge's shoulder right of the
cards (4.2px from them; the 18px shoulder allows no more), the chips tucking 3px under the last
card's edge on the way in. The hero at 1440 lands between the button and the cards with 8px each
side on 6 and 8-max (it was 1px: the chips grazed the button), and 4px on 9-max, where the way in
comes past the button's corner; the only roomier landing there is the far end of the plaque,
behind the hole cards from the pile. Side seats land on the corner of the plaque nearest the pile,
beside the cards; top seats on the bottom edge, beside the hand's name.

Measured again with round 3's chip (the pile's own disc, landing at the smaller of its size and the
coin's; Set B; WebKit; all 46 seats, every 4ms of the flight, `landprobe.mjs` in the round's
scratch folder), 2026-10-13: name overlap 0px² at every seat, every chip at rest inside the plaque,
every stack the exact award. The phone hero now lands with 6.3px of room (it was 4.2), the chips
tucking 0.7px under the last card on the way in (was 3.3); the hero at 1440 with 7.9px on 6 and
8-max and 3.9px on 9-max, near the button and not under the cards; the closest any chip comes to
the button is 0.6px under its corner (round 2: 0.5px).

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
  - Each moment has a generation (`gen`, bumped by `beginMoment()` and by `finishAll()`). The parts
    of a moment that start after its first frame are built in the frame after the press with
    `defer()` (in that frame's callbacks, told how late they are so they keep their place on the
    moment's clock), and they run only while their generation is current. Back then Forward inside
    the wait comes back to the same step with the same step key; checked by the key, the first
    press's ship was built as well as the second's (ten chips). A press that comes before the last
    moment has finished building builds it first (`flushDeferred()`, from the board's layout
    effect, before anything is measured), so the new moment takes it over from where it is; a step
    back or a jump drops it.
  - `keyframesCached()` keeps the keyframes of each set of channels (by curve, rate and travel, to a
    thousandth of a pixel, a few hundred at most), and each curve's `linear()` easing: a row that
    yields as one, the pile's stacks making the same room and a hand stepped through again build
    them once.
- **HandReplayerView** decides in render whether this commit is a single step forward from the last
  one (`motionKind`) and starts the moment in a layout effect, before the browser paints the press.
  - It reads every rect the moment needs first, then creates elements and starts springs; nothing
    in the write half reads the DOM back.
  - The press frame carries only what its own frame shows: the ghosts (the wagers they copy are gone
    from that commit) and a push-out. The board's springs (the flop placed at 40-60ms, a row that
    yields at 25-60ms) and the pile's new row (25-40ms) are built in the frame after it; until then
    the board is held as it was seen by two writes to the cards' own style (a new card unseen, a card
    that stayed at its old place), let go in the same callback that starts their springs. Not when
    a board card is still moving (a fast tap over a running spread): that is taken over in the press,
    with its velocity. The ship is built in the two frames after that (where it lands, then the
    chips). All of it waits for real frames: Playwright's WebKit on Windows, which paints a frame
    every ~300ms during a moment on this box, holds a flop's cards unseen for that long before they
    are placed; at 60fps the frame after the press comes well before the 40ms placement.
  - A jump, a step back, End/Start, or a hand change finishes everything instead: ghosts and chips
    leave, the pot and stacks land, and nothing plays backwards.
  - A new spring on an element that is still moving takes over its position and velocity.
- **The pot and stack figures** in render are the model's value minus what is still in flight, the
  pot never below the figure shown before the press ("The pot's figure" above).
  - Each arrival writes its digits straight into the text node, with no re-render mid-moment.
  - One render follows, once nothing is moving at all (re-rendering the whole replayer is the most
    expensive thing a frame can do, and the last arrival is usually mid-moment).
  - Every commit after a direct write first puts the rendered figures back, because React skips a
    text node it thinks is unchanged.
  - A winner's stack counts up by what its plaque gains, and never reads below what it showed before
    the press (nor below 0: a shorthand can commit more than a stack holds). Render counts what is
    in flight as it saw it, not live, and a moment runs once per step however many layout passes
    the commit gets: read live, the award was counted twice when the result was pressed while the
    river's chips were still landing, and the hero's plaque read 0 for half a second.
- **Removed on the spring path**: the street-change effect's three re-renders (+0, +450, +500ms);
  this is what cancelled the turn card after one frame. Also removed: `turnRiverSlide` (flag `'0'`
  keeps it), `markPotLanding`'s re-renders, the blanket 700ms flying-chip clear, the dead
  `--chip-start-dx/dy` and `flopCardSlide`, the re-render after every street press that only
  replaced an empty set of folding seats with another empty one, the showdown effect's re-render
  (the reveal is decided in the press render, see "Frame cost"), and the won pill at a result
  (see "Nothing is pushed in front of the winner").
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
  of it, at most 2.2:1: at three diameters the handful fused into one opaque gold bar in a 24fps
  frame), so the pot reads as chips in flight, not dots strobing across the table.
- **Finishes** the moment, when it does not fit the step or is a push-out, and captures one settled
  still. A still is never a frame frozen at a 0% keyframe, and arrivals start no paused springs.

Exports run the springs at the autoplay rate for the export speed. On the 8-max hand at 1x, Set B,
the video seeks the flop for 11 frames, the turn and the river 6 each and the result 13 (36 in all);
the GIF 6, 3, 3 and 7 (19). (Set A: 14, 8, 8, 15 and 7, 4, 4, 8.)

The showdown's reveal of the other hands (a CSS animation) is not played under an export: the
capture pauses CSS animations, which would hold it at its first, transparent frame, so the cards are
shown as they rest.

Checked in Playwright WebKit on that hand (`node scripts/check-replay-export-motion.mjs <scratch url>
--out <dir>`): every seeked frame of the turn and the river, and every other one of the result, is
compared with the live replayer pinned at the same instant through `document.getAnimations()` (not
the registry): board cards, swept wagers' ghosts, shipped chips and the pot figure, to 0.5px and
0.005 of opacity. It also writes the frames side by side (`<moment>-gif-vs-live.png`,
`<moment>-video-vs-live.png`) and exits non-zero on any difference. When reproducing this, press and
pin in ONE `page.evaluate`, and pin at 0 until every animation has its start before running the
clock: Playwright's clock does not drive the document timeline, and the registry times an arrival
from its animation's real start. For the same reason the check waits in real time after every
press until nothing on the table is running: on a loaded machine a bet's push-out was still running
when the street was pressed, and the GIF's t=0 frames failed by exactly the push's start offset.
It checks Set B, the default; `--springs 1` checks Set A. A card both sides draw unseen is compared
by its opacity alone: live, a new turn or river card waits out the press frame unseen at its slot
(the board's springs are made in the frame after), while an export builds them at once, so at t=0
the two put an invisible card in different places. Round 3, Set B: PASS, every seeked instant of the
turn, the river and the result within 0.12px, the pot figure equal at each (29 instants).

**The cost, measured** (the same 8-max hand, 22 steps, Playwright WebKit on the Windows box, springs
off vs on, `check-replay-export-motion.mjs --time-only`, runs interleaved, 2026-10-13):

| Export | Springs off (today) | Springs on, before the motion-frame fix | Springs on, now | Captures |
|---|---|---|---|---|
| Video | 91-92s | 329-357s (3.6-3.9x) | 170s (1.9x) | 22 vs 67 |
| GIF | 99s | 249-282s (2.5-2.7x) | 156-160s (1.6x) | 22 vs 45 |

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

Round 3, 2026-10-13, Set B against flag `'0'` on the merged build, Edge, 402x874 at dpr 3, the 8-max,
8-max multiway and 9-max hands, three presses each per flag, flags interleaved, every moment pressed
with a real click.

**Main-thread CPU of the press frame** (traced thread time, which another process cannot inflate;
unthrottled, so x4 is the estimate at a 4x CPU throttle), median / max, and the dearest task after
it:

| Press | Springs off | Set B | x4, off / on | Dearest later task, Set B |
|---|---|---|---|---|
| Flop | 9.6 / 10.6ms | 16.2 / 22.3ms | 38 / 65ms | 9.1 / 11.5ms (the board and the pile, the frame after) |
| Turn | 7.4 / 8.3 | 8.7 / 12.1 | 30 / 35 | 6.2 / 8.3 |
| River | 6.2 / 7.6 | 7.9 / 9.9 | 25 / 32 | 4.6 / 8.1 |
| Bet, call | 4.9-5.8 | 5.5-5.8 | 20-23 / 22-23 | 1.5-1.7 |
| Result | 16.1 / 18.1 | 19.1 / 24.4 | 64 / 76 | 10.8 / 14.8 (the ship) |

Round 2's build, by the same measure in its regression review: flop 11.0 to 25.5ms (+14.5), turn 8.8
to 14.1 (+5.3), river 8.1 to 12.7 (+4.6), result 14.9 to 21.9 (+7.0). Round 3: +6.6, +1.3, +1.7,
+3.0. What is left of the flop's is mostly the ghosts' style (UpdateLayoutTree 2.3-7.3ms against
0.9-1.6, the multiway hand's three ghosts the dearest): the ghosts have to be in the press frame,
because the wagers they copy are gone from that commit.

**At a 4x CPU throttle, long-animation-frame entries**, with the machine at 85-100% CPU from the
round's video captures and other sessions, so the wall times are inflated for both flags (a long
frame is 50ms or more):

| Press | Springs off: press frame, median / max | Set B | Long frames after the press, off / Set B |
|---|---|---|---|
| Flop | 81 / 122ms | 160 / 238ms | 9 of 9 (max 100ms) / 9 of 9 (max 200ms) |
| Turn | 71 / 103 | 98 / 156 | 6 of 9 / 3 of 9 |
| River | 56 / 83 | 78 / 132 | 3 of 9 / 4 of 9 |
| Bet, call | 0-60 / 90-104 | 0-50 / 58-65 | 1 of 18 / 1 of 18 |
| Result | 165 / 255 | 189 / 255 | 9 of 9 / 9 of 9 (max 275ms) |

The frame after the flop's press is where the board's springs and the pile's new row are built now
(FrameRequestCallback, 10-41ms at 4x); flag `'0'` has a long frame there too, React's own render.
The moments are Web Animations on transform and opacity, so once started they run on the compositor
whatever the main thread does; a long frame after the press delays only what starts in it.

What round 3 took out of the press frame:
- **The board and the pile** start 25-60ms after the press, so they are built in the frame after it
  (see "How it is built"): the flop's placement and spread, a row that yields and its new card, the
  pile's new row and the stacks leaving it.
- **Keyframes** are cached per curve, rate and travel, and each curve's `linear()` easing is built
  once: a row that yields as one, the pile's stacks and a re-stepped hand cost one build each.
- **The ship** is one clip box (holes merged so they do not overlap) instead of three nested masks.

Round 2 had already taken out the showdown's second render in the result's press task, built the
ship after the press, sampled keyframes channel-major into typed arrays and dropped the empty
table-sized flight layer.

**Layers** (Edge's layer tree at 1440 @2x, 8-max, mid-moment): the springs add 0.04% drawn area at
the flop (6,897,971 against 6,895,424 px²) and 15% at the result (8.24M against 7.15M; round 2 measured
+17%, round 1 +62%). What remains at the result is `.replayer-board-area` (1382x790, the table's
size) composited while the ship's clip is on the felt, so that what is drawn over the ship's path
(the pot's figure) stays above it.

## Capturing before and after

From a scratch server running the worktree (never the pm2 app on 3001):

```
node scripts/capture-replayer-motion.mjs http://127.0.0.1:<port> --springs 0 --out <before> --parallel 4 --moments flop,turn,river,bet,call,push
node scripts/capture-replayer-motion.mjs http://127.0.0.1:<port> --out <after> --parallel 4 --moments flop,turn,river,bet,call,push
node scripts/capture-replayer-motion.mjs --report --out <after> --against <before>
node scripts/compare-replayer-motion.mjs --before <before> --after <after> --out <compare>
```

Add `--width 1440 --height 900 --seats 8` for desktop. Without `--springs` the harness leaves the
flag unset, which is Set B, the default; `--springs 1` captures Set A. Keep `--parallel` low on a
busy machine (each is a browser; the box ran out of commit charge at 4). Without
`--moments` the harness captures flop, turn, river, bet and push, not call, which the comparison
expects.

Tests: `npm run test:springs`. One ship per result press: `node scripts/check-replayer-ship-once.mjs
<scratch url>` (Edge at a 4x CPU throttle; `--engine webkit` for WebKit).

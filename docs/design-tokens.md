# Design tokens

The token layer lives at the top of `vite-app/src/styles.css`, immediately after
the venue colour block. It exists so that the ~3,900 hardcoded literals in that
file have somewhere to go; every value below was derived from what the
stylesheet actually used, not from a generic scale.

**Rule: never write a bare literal for anything covered here.** If a value
doesn't fit a step, the step is wrong — widen the scale deliberately rather than
adding a one-off.

## Type

Nine steps covering the 25 distinct sizes that were in use. This is a dense
schedule UI whose type clusters between 10px and 14px; a stock 16px-base ramp
would inflate every row in the calendar.

| Token | Value | Replaces |
|---|---|---|
| `--fs-3xs` | 9px | `0.42` `0.48` `0.5` `0.55` `0.58` rem |
| `--fs-2xs` | 10px | `0.6` `0.62` rem |
| `--fs-xs` | 11px | `0.65` `0.68` `0.7` rem |
| `--fs-sm` | 12px | `0.72` `0.75` `0.78` rem, `12px` |
| `--fs-md` | 13px | `0.8` `0.82` `0.85` rem, `13px` |
| `--fs-lg` | 15px | `0.88` `0.9` `0.95` rem |
| `--fs-xl` | 17px | `1rem` `1.1rem`, `16px` |
| `--fs-2xl` | 22px | display figures |
| `--fs-3xl` | 28px | `1.7rem` date numerals |

`0.42rem` is 6.7px and `0.48rem` is 7.7px — both below legible at any viewing
distance. They have no step and snap **up** to `--fs-3xs` on migration. That is
a deliberate visual change, not a rounding error.

Line height: `--lh-tight` 1.15 for display figures, `--lh-snug` 1.35 for UI
rows, `--lh-base` 1.5 for prose.

## Spacing

2px base, not 4px. A 4px grid would round away the 6px gap, which appears 38
times and is load-bearing in the dense rows.

`--space-2xs` 2 · `--space-xs` 4 · `--space-sm` 6 · `--space-md` 8 ·
`--space-lg` 12 · `--space-xl` 16 · `--space-2xl` 24 · `--space-3xl` 32

`--space-md` (8px) is the default gap — it was already the most common value in
the file by a wide margin.

## Radius

`--radius-sm` (8px) and `--radius` (12px) keep their existing values so nothing
shifts. The new steps absorb the loose literals.

`--radius-xs` 4 · `--radius-sm` 8 · `--radius` 12 · `--radius-lg` 16 ·
`--radius-pill` 999

The stray `1.5px` `2px` `3px` values all snap to `--radius-xs`; `20px` snaps to
`--radius-lg`. Two fallbacks in the old file disagreed with the token they fell
back to (`var(--radius-sm, 6px)` and `var(--radius-sm, 8px)`) — write
`var(--radius-sm)` with no fallback.

## Elevation

Three steps, two layers each: a tight contact shadow plus a soft cast. A single
flat blur at one opacity is the thing that reads as unconsidered.

`--elev-1` resting cards · `--elev-2` dropdowns and panels · `--elev-3` modals

Light and cloudy themes override all three with shallower, lower-alpha values —
a shadow tuned for `#111111` is a smear on `#f5f5f5`.

## Brand

The app had no focal colour: `--accent` and `--accent2` are `#a0a0a0` and
`#888888`. Nothing claimed priority, while 30 saturated venue colours competed
freely.

`--brand` `--brand-hover` `--brand-quiet` `--brand-line` `--on-brand`
`--brand-on-dark` `--on-brand-on-dark` `--brand-line-on-dark` `--brand-ink`

The brand is a cool aqua. It was an orange-gold (`#f2a63b`) until 2026-10-11,
when black + orange was pointed out to read as a certain adult site's palette.

| Theme | `--brand` | `--brand-hover` | `--on-brand` | Contrast |
|---|---|---|---|---|
| dark, dusk | `#3cc8e0` | `#6fd8ea` | `#04191d` | 9.47:1 on `#111111` |
| light | `#0e7490` | `#155e75` | `#ffffff` | 5.36:1 on `#ffffff` |
| cloudy | `#0a4f62` | `#083f4e` | `#ffffff` | 5.44:1 on `#c8c8c8`, 6.26:1 on `#d6d6d6` |
| high contrast, dark | `#7ae6f5` | `#b0f1fa` | `#000000` | 13.0:1 on `#111111` |
| high contrast, light/cloudy | `#0b4a5c` | `#08394a` | `#ffffff` | 9.78:1 on `#ffffff` |

`--brand-quiet` and `--brand-line` are the brand at 14% / 45% (dark) and
12% / 40% (light, cloudy); high contrast inherits them from its ground.

Cloudy has its own deeper brand because its grounds are mid-grey (`#c8c8c8` to
`#d6d6d6`, the nav and rail down to `#bfbfbf`), where the light theme's
`#0e7490` is only 3.2 to 3.7:1. `#0a4f62` is 4.95:1 on `#bfbfbf` and 4.57:1 on
its own 12% tint, and the calendar's `#c8c8c8` day-number knockout is 5.44:1 on
it.

`--brand-ink` is the brand as small text on its own `--brand-quiet` tint (the
Beta pills, the active Reports chip's count, the bankroll dashboard's active
tab). Only the light theme sets it (`#155e75`, 5.69:1 on the tint over
`#f5f5f5`, where `#0e7490` is 4.20:1) and high contrast light/cloudy
(`#0b4a5c`); consumers read `var(--brand-ink, var(--brand))`, so every other
theme keeps the plain brand.

`--brand-on-dark` is the brand on a surface that is dark in every theme: the
replayer's seat plaques, commentary bar, capture bookends and seat lines. It is
`#3cc8e0` in light and cloudy too (the deep light aqua is 3.63:1 on a `#0e0c13`
plaque; this is 9.74:1), and `#7ae6f5` under high contrast.

Two companions travel with it. `--on-brand-on-dark` is the ink on a
`--brand-on-dark` fill (`#04191d`, 9.06:1; `#000000` under high contrast),
because `--on-brand` is white in light and cloudy and white on `#3cc8e0` is
1.99:1. `--brand-line-on-dark` is the hairline on a dark surface
(`rgba(60,200,224,0.45)`), because the light and cloudy `--brand-line` is a deep
teal that all but vanishes there. The replayer transport capsule (dark in every
theme) uses all three: its play fill was 3.07:1 against the capsule in light and
1.81:1 in cloudy, and is 8.25:1 now.

On the dark grounds the aqua is safe against the venue palette because every
venue teal and blue (Hard Rock `#178383`, WSOP Online `#186e86`, the `#2064b6`
blues) is dark — lightness 42% at most against the brand's 56% — so a bright
aqua can't be misread as a venue stripe. Light grounds get `#0e7490` instead,
because `#3cc8e0` is 1.99:1 on white. That deeper aqua does sit close to the
Hard Rock and WSOP Online teals (the old light gold `#a8700c` sat as close to
the venue golds), so on light grounds the brand is set apart by where it is
used, never by hue alone. On the light `--surface2` (`#ebebeb`) it is 4.49:1, a
hair under 4.5:1, so keep brand-coloured small text off `--surface2`.

The replayer's active-turn rings and hero hairline need an alpha, so they are
`--brand-on-dark`'s aqua as rgba literals (no `color-mix()`, which html2canvas
cannot parse); the active-turn border itself is `var(--brand-on-dark)`.

`--accent` stays grey. Primary actions move to `--brand` deliberately, one
surface at a time — not with a find-and-replace.

## Typography roles

`--font-sans` Univers · `--font-condensed` Univers Condensed ·
`--font-display` the display face

`--font-display` resolves through `--serif`, so the `data-serif` theme switching
keeps working while callers migrate off the old name. `--serif` is the
deprecated spelling; don't add new uses.

The family was written eight different ways across the file (varying comma
spacing and fallback tails). Use the tokens.

## Motion

`--dur-fast` 120ms · `--dur-snap` 200ms · `--dur-base` 320ms
`--ease-out` for entrances and hovers · `--ease-standard` for everything else

Always name the property being transitioned. `transition: all` animates
properties you didn't intend and is the reason hover states feel loose. All
three durations collapse to `0ms` under `prefers-reduced-motion`, so a
transition written with these tokens is automatically compliant.

## Focus

`--focus-ring` and `--focus-offset`, applied via `:focus-visible`.
`--focus-ring-on-dark` is the same ring in `--brand-on-dark`, for controls on a
surface that is dark in every theme (the replayer transport and the tappable
seat stack), where cloudy's `#0a4f62` ring is about 2.1:1.

Never `outline: none` without putting the ring in its place — keyboard
operability is a legal requirement in most of the jurisdictions this app
operates in.

## Migration status

Two buckets. **Exact** means the literal equals the token's computed value, so
the change cannot alter rendering and lands without review. **Reviewed** means
the snap is a judgment call with a visible result, and wants eyes on it first.

- [x] Tokens defined
- [x] Radius, exact snaps — 43 sites (`4px` `8px` `12px` `999px`, plus two
      contradictory fallbacks)
- [x] Font stacks, exact snaps — 149 sites onto `--font-condensed`
- [ ] **Reviewed:** radius judgment snaps — 61 sites (`3px` `6px` `2px` `10px`
      `20px` `1.5px`), each a real 1–2px change
- [ ] **Reviewed:** type scale — every size moves; `0.42rem`/`0.48rem` snap up
- [ ] **Reviewed:** spacing — every gap and pad moves
- [ ] **Reviewed:** shadows onto `--elev-*` — 59 sites, all inexact by nature
- [ ] **Reviewed:** primary actions onto `--brand`
- [ ] `!important` sweep — 55 sites, each its own specificity question
- [ ] Stylesheet split into modules
- [x] Motion: the five `transition: all` declarations are gone (checked 2026-10-15; only comments mention them)
- [ ] `:focus-visible` ring audit

Three font spellings are deliberately still literal. `'Univers'` and
`'Univers Condensed'` carry no fallback, and `'Univers', sans-serif` lacks the
`--font-sans` fallback tail, so none is an exact swap. The three
`'Libre Baskerville', Georgia, serif !important` sites are a bigger catch:
`--font-display` resolves through `--serif`, which *varies by `data-serif`
theme*. Moving them onto the token would make them start following the display
font picker — arguably right, but a behaviour change, so it belongs with the
`!important` sweep rather than a no-op pass.

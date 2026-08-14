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

`--brand` `--brand-hover` `--brand-quiet` `--on-brand`

Gold is safe against the venue palette specifically because every venue gold
(`#a87c0a`, `#bf7d08`, `#a8863f`, `#9c7d20`) is dark and desaturated — a bright
gold can never be misread as a venue stripe. Light grounds get `#a8700c`
instead; `#f2a63b` fails contrast on white.

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
- [ ] Motion: the five `transition: all` declarations onto `--dur-*`/`--ease-*`
- [ ] `:focus-visible` ring audit

Three font spellings are deliberately still literal. `'Univers'` and
`'Univers Condensed'` carry no fallback, and `'Univers', sans-serif` lacks the
`--font-sans` fallback tail, so none is an exact swap. The three
`'Libre Baskerville', Georgia, serif !important` sites are a bigger catch:
`--font-display` resolves through `--serif`, which *varies by `data-serif`
theme*. Moving them onto the token would make them start following the display
font picker — arguably right, but a behaviour change, so it belongs with the
`!important` sweep rather than a no-op pass.

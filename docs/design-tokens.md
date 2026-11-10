# Design tokens

The token layer is the second `:root` block at the top of `vite-app/src/styles.css` (after the
venue colours and the theme basics). This page describes that block as it stands; when the two
disagree, the stylesheet is right and this page is stale.

**Rule: never write a bare literal for anything covered here.** If a value doesn't fit a step, the
step is wrong: widen the scale deliberately rather than adding a one-off.

**Every length is g or r, never px.** `g` is the column unit and `r` the row unit (below); type,
spacing, radius, stroke and icon sizes are all multiples of one or the other, so the whole app
scales with the grid. The few px left in the stylesheet are the replayer's `clamp()` bounds, which
cap felt text sized in container units.

## The grid

| Token | Value | What it is |
|---|---|---|
| `--gu` | `min(100vw, 430px) / 37` | g: the gutter, the outer margin, half a subcolumn. Frozen above 430px so desktop keeps phone proportions |
| `--subcol` | 2g | one subcolumn |
| `--col` | 8g | one column (four subcolumns) |
| `--subrow` | 0.71g | r, the vertical unit, rounded to a whole 1/64 px where `round()` is supported (WebKit lays out in 1/64 px) |
| `--nudge-1` | 0.125r | the one sub-r optical correction |

The layout rules built on these are in `docs/desktop-layout.md` and the memory notes on the grid.

## Type

Sizes are fractions of g, chosen so each equals its old px value at a 402pt-wide phone.

| Token | Value | Use |
|---|---|---|
| `--fs-2xs` | 0.9204g | caps micro-labels only, never lowercase |
| `--fs-xs` | 1.0585g | dense row secondary |
| `--fs-sm` | 1.1965g | dense row primary, the app's real base |
| `--fs-md` | 1.3806g | |
| `--fs-lg` | 1.6107g | |
| `--fs-xl` | 1.9328g | |
| `--fs-2xl` | 2.3010g | display figures |
| `--fs-3xl` | 2.7612g | date numerals |
| `--fs-hero` | 4.4179g | the empty-state glyph only |

`--fs-3xs` is retired: the sizes below 9px snapped up to `--fs-2xs`.

Line height: `--lh-tight` 1.15 (display figures), `--lh-snug` 1.35 (UI rows), `--lh-base` 1.5 (prose).

Weight: `--fw-light` 300, `--fw-regular` 400, `--fw-bold` 700. Univers Condensed has only those
three; Univers adds 800 and 900, and no width has a 500 or 600, so never write 500 or 600 (they
render as 400 and 700). The missing middle tier is `--emph-track` (0.02em) plus full-strength colour.

Tracking (em only): `--track-caps-lg` 0.14em, `--track-caps` 0.08em, `--track-tight` 0.01em,
`--track-display` -0.02em, `--track-wordmark` -0.05em. Figures that change or stack take
`--num-tabular` (`tabular-nums lining-nums`).

## Spacing

All multiples of r: `--space-2xs` 0.25r · `--space-xs` 0.5r · `--space-sm` 0.75r · `--space-md` 1r ·
`--space-ml` 1.25r · `--space-lg` 1.5r · `--space-xl` 2r · `--space-2xl` 2.5r · `--space-3xl` 3r ·
`--space-4xl` 4r · `--space-5xl` 6r. Most new layout is written straight in whole r and g
(`calc(var(--subrow) * N)`), which is the same thing.

## Radius and strokes

`--radius-xs` 0.5r · `--radius-sm` 1r · `--radius` 1.5r · `--radius-lg` 2r · `--radius-pill` 128r
(a sentinel for a full capsule) · `--radius-circle` 50% · `--radius-nest` (`--radius` less
`--space-xs`: an inner corner is the outer corner minus the padding between them). Write
`var(--radius-sm)` with no fallback.

Stroke widths: `--bw-fine` 0.065r (half a hairline) · `--bw-hair` 0.13r · `--bw-1` 0.195r · `--bw-2` 0.39r.

## Overlays, elevation, state

Overlays: `--ov-black-1..6` (6, 12, 24, 40, 60, 80% black) and `--ov-white-1..6` (5, 10, 18, 32, 55,
85% white). They are the same in every theme, so a literal of one of those values is always an
exact swap. `--scrim` is the modal dimming (`--ov-black-4`; 28% black on light grounds).

Elevation, two layers each (a contact shadow plus a soft cast): `--elev-1` resting cards, `--elev-2`
dropdowns and panels, `--elev-3` modals; `--elev-0` a hairline inset, `--elev-inset` a sunken well,
`--edge-hi` / `--edge-lo` the light and contact edges. Light and cloudy override all of them with
shallower values.

State: `--state-hover`, `--state-press` (`scale(0.97)`), `--state-disabled` 0.38, `--state-past`
0.45 (past content, never confused with disabled).

## Colour

**Brand** (a cool aqua since 2026-10-11): `--brand`, `--brand-hover`, `--brand-quiet` (tint),
`--brand-line` (hairline), `--on-brand` (ink on a brand fill), `--brand-ink` (brand as small text
on its own tint; only light and high-contrast light/cloudy set it, so read it as
`var(--brand-ink, var(--brand))`).

| Theme | `--brand` | `--brand-hover` | `--on-brand` | Contrast |
|---|---|---|---|---|
| dark, dusk | `#3cc8e0` | `#6fd8ea` | `#04191d` | 9.47:1 on `#111111` |
| light | `#0e7490` | `#155e75` | `#ffffff` | 5.36:1 on `#ffffff` |
| cloudy | `#0a4f62` | `#083f4e` | `#ffffff` | 5.44:1 on `#c8c8c8`, 6.26:1 on `#d6d6d6` |
| high contrast, dark | `#7ae6f5` | `#b0f1fa` | `#000000` | 13.0:1 on `#111111` |
| high contrast, light/cloudy | `#0b4a5c` | `#08394a` | `#ffffff` | 9.78:1 on `#ffffff` |

On a surface that is dark in every theme (the replayer's plaques, transport and seat lines) use
`--brand-on-dark`, `--on-brand-on-dark` and `--brand-line-on-dark`, which stay the dark aqua in light
and cloudy. Keep brand-coloured small text off the light `--surface2` (4.49:1).

`--action`, `--action-hover`, `--action-quiet`, `--on-action` alias the brand for primary
affordances (at most one filled per screen region). `--accent` stays a grey; `--line-strong` is its
honest name, the "engaged" hairline.

**Status**, three stops each: `--ok`, `--warn`, `--danger`, `--info`, with `-bg` (the 12% tint),
`-line` (the 25% border) and `--on-*` (ink on a fill). Light and cloudy carry their own darker ramp
(`--ok` is `#22c55e` on dark, `#15803d` on light), and Swiss changes them again, so a status literal
is never an exact swap for its token. `--accolade` is trophy gold, deliberately not the brand.

**Neutrals and surfaces:** the ramp `--n-0..8` inverts as a set on light grounds.
`--surface-sunken`, `--surface-raised`, `--surface-overlay`, `--border-quiet`, `--border-strong`,
`--scrollbar-thumb`, `--scrollbar-track` alias onto it. A surface sits at most one step above its parent.

## Typography roles

`--font-sans` Univers · `--font-condensed` Univers Condensed · `--font-expanded` and `--font-narrow`
(the extra widths, reserved: nothing uses them yet) · `--font-display` the display face ·
`--font-title` screen titles, always Baskerville.

`--font-display` resolves through `--serif`, which the `data-serif` preference swaps to Univers;
`--serif` is the deprecated spelling and no rule reads it directly any more. The two literal
`'Libre Baskerville', Georgia, serif` sites (the Casino Royale seat name, `!important`, and one at
`styles.css` ~12899) stay literal on purpose: moving them onto `--font-display` would make them
follow the display-font picker.

## Motion

Durations: `--dur-instant` 60ms · `--dur-fast` 120ms · `--dur-snap` 200ms · `--dur-base` 320ms ·
`--dur-slow` 480ms · `--dur-amble` 800ms. All collapse to 0ms under `prefers-reduced-motion`, so a
transition written with them is automatically compliant.

Curves: `--ease-out` (entrances and hovers), `--ease-standard` (everything else), `--ease-emphatic`,
`--ease-spring`, `--ease-linear`. The bezier tokens must hold literals: a sweep that matched the
bezier strings once rewrote each definition to point at itself, which silently turned 24
animations off. Always name the property being transitioned, never `transition: all`. The
replayer's own motion is springs (`docs/replayer-springs.md`).

## Layers, icons, focus

Layers: `--z-base` 0 · `--z-raised` 10 · `--z-sticky` 100 · `--z-fab` 200 · `--z-scrim` 300 ·
`--z-panel` 400 · `--z-modal` 500 · `--z-toast` 600 (outranks a modal) · `--z-splash` 700. A scrim and
its panel are always a pair. The replayer table keeps its own local stack (`--z-bet`, `--z-dealer`,
`--z-flight` and so on, inside `.replayer-table`).

Icons: `--icon-xs` 1.5r · `--icon-sm` 1.75r · `--icon-md` 2r · `--icon-lg` 2.5r · `--icon-xl` 3r ·
`--icon-2xl` 5r · `--icon-hero` 6r; `--icon-stroke` 1.75 (a unitless stroke-width).

Focus: `--focus-ring`, `--focus-ring-inset` (inside an `overflow: hidden` ancestor),
`--focus-offset`, and `--focus-ring-on-dark` for controls on an always-dark surface. Never
`outline: none` without putting a ring in its place.

## Themes that redefine tokens

Light and cloudy (`[data-theme]`) override elevation, brand, status, the neutral ramp and the scrim;
high contrast (`[data-contrast="high"]`) the brand. The Swiss themes (`theme-swiss.css`, admins only)
redefine much more, including `--fw-light`/`--fw-bold`, every radius (`--radius-circle` is 0 there),
the font roles and the brand. So a literal is an exact swap only for a token no theme redefines:
check `theme-swiss.css` before calling a swap "no visual change".

## Migration status

- [x] Tokens defined, and moved onto g and r (2026-09/10).
- [x] Font stacks: no literal stack is left outside the token block.
- [x] Durations and the named beziers: no literals left.
- [x] Overlay literals (`rgba(0,0,0,a)` / `rgba(255,255,255,a)` at a token's alpha) moved onto `--ov-*` (2026-11-10).
- [x] `var(--serif)` call sites moved onto `var(--font-display)` (2026-11-10).
- [x] Motion: no `transition: all` (checked 2026-10-15).
- [x] `:focus-visible` ring audit (2026-10-15).
- [ ] Status literals (`#22c55e`, `#ef4444`, `#eab308`, `#3b82f6`; about 60 sites): each is a reviewed change, because the tokens differ by theme.
- [ ] Off-scale z-indexes (`9997`, `9999`, `10000`).
- [ ] `!important` sweep: 279 sites, each its own specificity question.

# Desktop layout

The website answers the browser's proportions: a wide, landscape window gets a
real desktop layout (side rail plus two or three panes); every other window, and
the iOS app on a phone, gets the phone layout exactly as it was. Phase 1 (this
change) ships the shell and the Schedule tab. The other tabs render in one
capped pane until their own phase.

Code: `vite-app/src/hooks/useDesktopLayout.js` (the decision and the counts),
`components/DesktopRail.jsx`, `components/DesktopEventDetail.jsx`, the
`Desktop layout` block at the foot of `styles.css`, and the shell branch in
`App.jsx`.

## 1. The breakpoint

```
desktop  ⇔  (min-width: 1024px) and (min-aspect-ratio: 1/1)
```

- **1024** is the narrowest window that holds the rail and two phone canvases
  side by side: 10g + 37g + 37g = 84g = 976px at g = 11.62px, leaving room for
  scrollbars and window chrome.
- **Landscape-ish** (at least as wide as tall), so a portrait tablet or a tall
  narrow browser window stays on the phone column, which is the better use of a
  tall canvas.
- Anything that fails the query renders the phone layout. An iPhone can never
  match it (932 CSS px is the widest landscape iPhone). An iPad in landscape and
  the Mac Catalyst app with a wide window **will** match it. That is intended:
  both are desktop-shaped.
- The query is in px because media queries cannot read custom properties. It is
  the only px value the change adds, and it is a breakpoint, not a dimension.

Inside the desktop range there are two tiers. Both are counted in whole g (see
§2), from W = floor(window width / g):

| Tier | Condition | Arrangement |
|---|---|---|
| two | W < 121g (window < 1406px) | rail 10 · list 37 · right pane 9N+1, switchable between **Event** and **My schedule** |
| three | W ≥ 121g | rail 10 · list 37 · event 9N+1 · my schedule 37 |

## 2. The grid on desktop: g stays the phone's g

**Decision: g and r do not change on desktop. g stays frozen at 430px/37 =
11.62px (r = 8.25px), and the desktop is a wider sheet made of the same units.
Panes are a whole number of columns.**

`--gu` is already `min(100vw, 430px) / 37`, so above phone width it is
constant. On desktop that means:

- **Every pane is a phone canvas, unchanged.** A 37g pane is the exact canvas
  every component was gridded on: same g, same r, same type sizes, same seated
  baselines. Nothing is forked or re-tuned. The measurement in §8 shows the list
  pane's sticky filters, date block and cards land on the same r lines as on the
  phone.
- **Type stays sane.** `--fs-sm` is 13.9px at every desktop width. Scaling g
  with the window was the alternative, and it fails both ways. With g =
  window/37, a 1440 window gives a 38.9px g and 46px body text. With g =
  window/123 (fit the three panes), a 1024 window gives an 8.3px g and 10px
  text.
- **Pane-local g was rejected.** Re-deriving `--gu` per pane (g = pane width /
  37) would also keep each pane self-consistent, but two adjacent panes of
  different widths would get different r, so their r lines would drift out of
  phase, and the same text would print at two sizes side by side. One g across
  the shell keeps one horizontal rhythm across every pane, so a baseline in the
  list lines up with a baseline in the detail pane.

### The desktop sheet

The shell is a whole number of g, centred in the window. The sub-g remainder of
the window is split as outside margin.

```
rail  = 10g            one 8g column inside 1g margins: the wordmark's column
pane  = 9N + 1 g       N columns of 8g, 1g gutters between them, 1g margins
                       N = 4 → 37g: the phone canvas
```

`9N+1` extends the phone's own formula (37 = 1 + 4·8 + 3·1 + 1) to N columns.
Adjacent panes each carry their own 1g margins, so content in neighbouring panes
is 2g apart (one subcolumn), with a hairline divider drawn over the boundary.
The divider is a pseudo-element, so it adds no width.

The flexible pane takes as many whole columns as fit, with **N clamped to 4…7**.
Seven columns (64g, about 744px) is the widest measure a single event card still
reads well at. Wider windows get outside margin instead of a stretched card.

| Window | W | Tier | Shell | Panes |
|---|---|---|---|---|
| 1024×768 | 88g | two | 84g | 10 · 37 · 37 |
| 1440×900 | 123g | three | 121g | 10 · 37 · 37 · 37 |
| 1920×1080 | 165g | three | 148g | 10 · 37 · 64 · 37 |

JS computes only integers (W, tier, N) from a **measured** g, using a probe
styled `width: calc(var(--gu) * 100)`. It hands them to CSS as unitless custom
properties (`--dk-shell-n`, `--dk-detail-n`, `--dk-wide-n`), and CSS multiplies
them by `var(--gu)`. No px is written anywhere.

Vertically nothing new is needed. The header is 8r on both layouts, and every
pane starts at the header's foot, so the r origin (the `.top-bar` top) is shared
by all panes. A pane's height runs to the window's foot like `.content-area`
does on the phone; it is the one dimension the window, not the grid, sets.

## 3. Navigation: the rail replaces the bottom nav

```
┌──────────┐
│ ▣ Schedule│  primary: same ids and admin gating as BottomNav
│ ◎ Social  │  each item one Row (4r): 2g×2r icon cell · 1g · label
│ ⌂ Dashboard│  label baseline and icon foot on the item's 3r line
│ ▥ Hands   │  active: --brand text + 0.39r brand bar on the rail edge
│ $ Cash    │
│───────────│  2r · hairline · 2r
│ ∿ Results │  secondary: what the phone hides in the avatar menu
│ ⚙ Settings│
│ ⊡ Admin   │
│───────────│
│ [#][D][i] │  admin dev keys, 2g×3r each (2+1+2+1+2 = 8g)
└──────────┘
```

- The bottom nav and the Hands-tool footer row's phone placement are not
  rendered on desktop. The Hands tool row still renders, at the foot of the main
  pane, because it belongs to the Hands content and not to the nav.
- Labels are `--fs-xs`. That was measured, not chosen: "Dashboard" is 4.64g at
  `--fs-xs` and 5.25g at `--fs-sm`, and the label column is 5g.
- "My Schedule" is not a rail item. On desktop it is a pane of the Schedule tab,
  so the avatar menu's "My Schedule" routes to Schedule. In the two-pane tier it
  also flips the right pane to My schedule.

## 4. The header

One `.top-bar` across the whole shell, 8r, unchanged from the phone in height
and origin. The wordmark keeps its 8g column at 1g, which is the rail's column
directly beneath it. The three action icons and the user chip leave their
phone positions (centred under the Dynamic Island, and absolute at the right
rail) and sit in flow at the right, each centred on the 4r line by the same
`top: 4r; translateY(-50%)` the phone uses. The 2g gap between them is one
subcolumn.

## 5. Modals, sheets, popovers, floating buttons

- **Portalled panels** (filter panel, location dropdown, online-room menu, share
  menu, travel picker, export modal) stay portalled to `<body>` and keep working.
  The Schedule filter panel spans the viewport's 8px rails on the phone. On
  desktop it spans the **list pane's** 1g rails instead: measured at x = 1g,
  w = 35g of the pane. `<html data-layout="desktop">` exists so CSS can reach
  these portalled nodes.
- **Centred modals** (notifications, onboarding, real-name prompt, milestone) stay
  centred on the window with a full-window scrim. Phase 2 caps their width at the
  phone canvas (37g), since several of them stretch on a wide window today.
- **The Today/Next button** is `position: fixed` in its view. Each Schedule pane
  is its containing block (`.dk-fab-scope`), so each list centres its own button
  at its own foot (4r up, with no nav to clear). This is applied only to panes
  whose views have nothing else fixed and unportalled. The full-bleed replayer is
  fixed too, and must not be confined by accident.
- **Admin dev keys** (#, D, i) move from the window corner into the foot of the
  rail.
- **Grid overlay**: horizontals are unchanged (r lines from the bar top). The
  column layer is drawn per pane: N columns for a 9N+1 pane, and one for the
  rail.

## 6. Mouse and keyboard

- **One click selects.** In the list (and in My schedule), clicking a card puts
  it in the Event pane. It does not expand inline. The selected card carries a
  brand outline (an outline, so the list's r rhythm does not move). The detail
  card is the same `CalendarEventRow`, held open (`detail`): no chevron, no
  collapse-on-click.
- **Hover** states already exist for cards (`(hover: hover) and (pointer: fine)`).
  The rail, the pane switch and the close key add the same `--hover-overlay`
  vocabulary.
- **Focus**: the rail items, pane-switch keys and close key are real buttons with
  `:focus-visible` rings on the `--focus-ring` token. Cards were already
  `role="button"` + `tabIndex` with Enter/Space; on desktop, Enter selects.
- **Esc** clears the selected event (ignored while typing in an input).
- **Scroll is per pane.** Each pane is its own scroller with
  `overscroll-behavior: contain`, so scrolling the list never moves My schedule.
  Views find their scroller from their own root
  (`closest('.content-area, .dk-scroll')`) rather than the first `.content-area`
  in the document.
- Phase 2 keyboard: `j`/`k` to move the selection through the list, `Enter` to
  add or remove the selected event, `g s` / `g d` style tab jumps. These are not
  built yet.

## 7. Every tab

### Schedule — three-pane tier (built)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ futurega.me                                          [bell] ((·)) [moon] (H) Ham │ 8r
├──────────┬───────────────────────┬────────────────────────┬─────────────────┤
│ Schedule │ [⌖ All locations ][⫧][▦] │ Event               ✕ │ My Schedule ·18 │
│ Social   │ SATELLITES RESTARTS …  │ ┌──────────────────────┐ │ [Travel][Export]│
│ Dashboard│ (08 Oct)  82 EVENTS Th │ │ 11:00 AM EDT  $1,700 │ │ (04 Apr)     Sa │
│ Hands    │ ┌───────────────────┐  │ │ NLH Main Event       │ │ ┌─────────────┐ │
│ Cash     │ │10:15 AM    $170   │  │ │ #10 NLH  10.9% rake  │ │ │ PLO Mystery │ │
│──────────│ │NLH Oktober Open   │  │ │ STARTING CHIPS …     │ │ └─────────────┘ │
│ Results  │ └───────────────────┘  │ │ LATE REG …           │ │ (05 Apr)     Su │
│ Settings │ ┏━━━━━━━━━━━━━━━━━━━┓  │ │ [+ ADD]    [✎ EDIT]  │ │ ┌─────────────┐ │
│ Admin    │ ┃ selected card     ┃  │ └──────────────────────┘ │ │             │ │
│ [#][D]   │ ┗━━━━━━━━━━━━━━━━━━━┛  │                          │ └─────────────┘ │
│   10g    │         37g            │       9N+1 g (37–64)     │       37g       │
└──────────┴───────────────────────┴────────────────────────┴─────────────────┘
```

### Schedule — two-pane tier (built)

```
┌───────────────────────────────────────────────────────────────┐
│ futurega.me                              [bell] ((·)) [moon] (H) Ham │
├──────────┬───────────────────────┬────────────────────────────┤
│ rail     │ list (TournamentsView)│ [ Event ][ My schedule ]   │ 6r: 2r · 3r keys · 1r
│          │                       │ ────────────────────────── │
│          │                       │ the selected event,        │
│          │                       │ or My Schedule (ScheduleView)
│   10g    │         37g           │           37g              │
└──────────┴───────────────────────┴────────────────────────────┘
```

Selecting an event anywhere flips the right pane to Event.

### Calendar view (phase 2)

```
│ rail │ month grid 9N+1 (N=5–7)                │ day list 37g (selected day) │
```

The month grid gets the wide pane, because a calendar is the one Schedule
surface that wants width. Clicking a day fills the day list, and clicking an
event there opens the same Event pane in place of the day list, with a back key.

### Dashboard (phase 2; today: one capped pane)

```
│ rail │ Up Next (playing/next card) 37g │ Friends live · Connections 37g │ Results curve 37g │
```

The Up Next hero, live-update composer and late-reg card stay in a phone
canvas, since they were gridded there. Friends and Connections get a second
canvas. The results curve and ROI stats get a third in the three-pane tier, or
stack under Friends in the two-pane tier.

### Social (phase 2; today: one capped pane)

```
│ rail │ groups + buddies list 37g │ selected group feed 9N+1 │ group schedule 37g │
```

This is the same list | detail | context shape as Schedule. The feed is the
reading pane.

### Hands, incl. the replayer (phase 2; today: one capped pane)

```
│ rail │ saved hands + tool switcher 37g │ replayer table 9N+1 (N=5–7) │ action log / hand text 37g │
```

- The table is the reason for the wide middle pane. The replayer's own 16×32
  grid (`docs`: 2026-08-30 handoff) scales with the pane, not the window.
- The full-bleed / landscape replay modes become "fill the middle pane" on
  desktop. Their `position: fixed` gets `.dk-fab-scope`-style containment on that
  pane only, after their own portalled sheets are audited.
- The solver and trainers take the middle pane. The tool switcher (now the
  footer row) moves to the top of the left pane.

### Cash (phase 2; today: one capped pane)

```
│ rail │ live games list 37g │ heatmap 9N+1 (N=5–7) │
```

### Settings (phase 2; today: one capped pane)

```
│ rail │ section index 37g (Account, Sharing, Appearance, …) │ section body 9N+1 (≤ 55g) │
```

Settings is a document, so it gets two panes at most, never three.

### Admin (phase 2; today: one capped pane)

```
│ rail │ admin sections 37g │ table / editor 9N+1, N up to 9 (82g) │
```

Admin is the one tab allowed past seven columns, because its tables are dense
by nature.

### Results & Tracking (phase 2; today: one capped pane)

```
│ rail │ entries list 37g │ entry detail / editor 37g │ stats + curve 37g │
```

## 8. Verification (phase 1)

Run in Playwright WebKit against a scratch server (a copy of the DB, its own
port, solver stubbed, frozen clock, live-clock requests blocked). Box positions
are in g from the pane's left edge and in r from the top-bar top. Baselines are
read from **pixel ink** of the first glyph.

- **Phone unchanged.** Screenshots at 402×874 of Schedule, My Schedule,
  Dashboard, Social, Hands, Cash and Settings, overlay off and on, were compared
  pixel for pixel against master's build: all identical. The one exception is
  Settings, which differs only by the scratch servers' port number printed in
  the share link. Expanding and collapsing a card in Schedule and My Schedule
  was also identical. The same holds for 800×900 and 1024×1366 (portrait), which
  stay on the phone column.
- **Desktop on grid** at 1024×768, 1440×900 and 1920×1080 (all three
  `ALL ON GRID` apart from the inherited item below):
  - rail and panes at whole g: 10 / 37 / 37 / 37, and 64 at 1920
  - every rail item a 4r Row starting on whole r, with icon cells 2g×2r and label
    baselines on whole r (ink 0.02–0.03r, i.e. anti-aliasing)
  - pane-switch keys 8g×3r, label baselines on 12r
  - Event head 6r, title baseline on 12r, close key 3g×3r
  - detail card 35g × 35r
  - list sticky filters 8→20r, date block 20→25r, cards whole r: the phone values
- **Inherited, not introduced:** the My Schedule sticky header measures y 6.50r
  and h 7.15r. That is identical on the phone (measured 6.50r / 7.15r), because
  My Schedule has not had its grid pass yet. The pane reproduces the phone
  faithfully.
- `text-box-trim` seats the rail, pane-switch and title labels. It is live on
  grid and block items in Safari 18.2+ and Chrome 133+. Firefox ignores it, and
  those labels then sit a descent above their line. iOS 15 is not involved
  (iPhones never reach the breakpoint).

# Desktop layout

The website answers the browser's proportions: a wide, landscape window gets a
real desktop layout (side rail plus two or three panes); every other window, and
the iOS app on a phone, gets the phone layout exactly as it was. Phase 1 (this
change) ships the shell and the Schedule tab. The Dashboard has had its two
panes since 2026-10-12. The other tabs render in one capped pane until their own
phase.

Code: `vite-app/src/hooks/useDesktopLayout.js` (the decision and the counts),
`components/DesktopRail.jsx`, `components/DesktopEventDetail.jsx`, the
`Desktop layout` block at the foot of `styles.css`, and the shell branch in
`App.jsx`.

## 1. The breakpoint

```
desktop  ⇔  (min-width: 1024px)
```

- **1024** is the narrowest window that holds the rail and two phone canvases
  side by side: 10g + 37g + 37g = 84g = 976px at g = 11.62px, leaving room for
  scrollbars and window chrome.
- **Any shape.** Width alone decides (owner decision 2026-10-08: the iPad and
  Mac apps get the desktop layout). The first cut also required landscape, so a
  portrait tablet stayed on the phone column; that clause is gone.
- Anything narrower renders the phone layout. An iPhone can never match it
  (932 CSS px is the widest landscape iPhone). Every iPad in landscape matches
  (1133 mini … 1376 13-inch), and so does a 13-inch iPad in portrait (1024); the
  smaller iPads in portrait (744–834) do not, because two 37g panes and the rail
  need 976px at the frozen g. The iPad app allows landscape for exactly this
  (`UISupportedInterfaceOrientations~ipad` in `ios/App/App/Info.plist`; iPhone
  stays portrait-only). The Mac Catalyst app matches whenever its window is
  wider than 1024 CSS px, which is about 790 screen points at the 0.77 scale.
- The query is in px because media queries cannot read custom properties. It is
  the only px value the change adds, and it is a breakpoint, not a dimension.

One arrangement at every desktop width (since 2026-10-10; the two-tier/three-tier split is gone):

| Layout | Arrangement |
|---|---|
| desktop | rail 10 · list 37 · 2g of background · right pane 9N+1 (owner, 2026-10-13: the 2g replaces the hairline between panes; 4r of background, the details' own foot, separates the event from My Schedule) — the selected event on top, My Schedule below it in the same scroll; with nothing selected, My Schedule is the whole pane |

The owner asked for My Schedule under the event details rather than in a third column. Each pane is
also widened by a classic scrollbar's width where one is drawn (`--dk-sb-g`), so its content keeps the
whole 9N+1 g.

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
└──────────┘
```

- The bottom nav and the Hands-tool footer row's phone placement are not
  rendered on desktop. The Hands tool row still renders, at the foot of the main
  pane, because it belongs to the Hands content and not to the nav.
- Labels are `--fs-xs`. That was measured, not chosen: "Dashboard" is 4.64g at
  `--fs-xs` and 5.25g at `--fs-sm`, and the label column is 5g.
- The admin dev keys (#, D, i) are not in the rail either: they float over the
  main column as on the phone (§5).
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
  The Schedule filter panel spans the viewport's 1g rails on the phone. On
  desktop it spans the **list pane's** 1g rails instead: x = 1g, w = 35g of the
  pane, set in g, so a classic scrollbar (which widens the pane, not the canvas)
  does not widen the panel (measured 2026-10-12, with and without one). `<html data-layout="desktop">` exists so CSS can reach
  these portalled nodes.
- **Centred modals** (notifications, onboarding, real-name prompt, milestone) stay
  centred on the window with a full-window scrim. Phase 2 caps their width at the
  phone canvas (37g), since several of them stretch on a wide window today.
- **The Today/Next button** is `position: fixed` in its view. Each Schedule pane
  is its containing block (`.dk-fab-scope`), so each list centres its own button
  at its own foot. In the list pane that is the phone's own rule: the pane keeps
  the nav band and ends at the window's foot, so the button stands 2r above the
  band, or 2r above the live cash bar when that shows. My Schedule's, in the
  right pane, has no band under it and stands 4r up. Each is centred on its
  pane's content, not counting a classic scrollbar (`--dk-sb-g`), on a g line
  from the pane's edge. This is applied only to panes
  whose views have nothing else fixed and unportalled. The full-bleed replayer is
  fixed too, and must not be confined by accident.
- **Admin dev keys** (#, D, i) are rendered in the main column on both layouts
  (App.jsx `devToggles`). Over the Schedule list the list pane is their
  containing block and keeps the nav band, so they stand where the phone's do:
  4g×5r at 32g, 7r, 13r and 19r above the band (measured 2026-10-12, identical to
  430×900). 1g off the content's right edge, so a classic scrollbar does not sit
  under them (`--dk-sb-g`). A wide pane cannot be their containing block (the
  full-bleed replayer must stay fixed to the window), and at the window's corner
  they fell off the shell's g lines (112.46g, `check:controls`), so there they
  hang `position: absolute` from the pane: the same corner, on the grid. One
  difference is left over the list: in the list pane's stacking context they sit
  under the grid overlay's faint lines when it is on, where the phone's sit over
  it.
- **Grid overlay**: horizontals are unchanged (r lines from the bar top). The
  column layer is drawn per pane: N columns for a 9N+1 pane, and one for the
  rail, each 9N+1 g wide (not the pane's measured width, which a classic
  scrollbar widens) from the pane's origin snapped to a device pixel, so the
  list pane's columns are the phone's 8g at the phone's 1g, 10g, 19g and 28g. The
  readout measures the main scroller's own view (its r capped at 430 wide like
  `--gu`), so on the list pane it prints the phone's numbers.

## 6. Mouse and keyboard

- **One click selects.** In the list (and in My schedule), clicking a card puts
  it in the Event pane. It does not expand inline. The selected card carries a
  brand outline (an outline, so the list's r rhythm does not move). The list
  then moves as the phone's does when a row opens (`landRow`, CalendarEventRow):
  the card's top lands under the filters and its date break. The phone's landing
  depends only on the row's top, which opening does not move, so the scroll is
  the same: row 1195 at 43.09r goes from scrollTop 2136 to 2351 and sits at
  17.03r on both (measured 2026-10-12). A click on the card already selected
  closes its details, as tapping an open card shuts it on the phone, and like
  that moves the list nothing. The detail card is the same `CalendarEventRow`,
  held open (`detail`): no chevron, no collapse-on-click.
- **Opening and closing the details** is one move, both ways (App.jsx, utils/
  detail-motion.js): the details block's height runs between 0 and its own
  natural height (measured as the move starts, so never toward the 55% cap) and
  its opacity between 0 and 1, on `--ease-out` over `--dur-base`, pushing My
  Schedule down and drawing it back up with its scroll position untouched. Open
  and close mirror each other: 16 ms into an open of a 33r block it is 7.10r tall,
  16 ms into the close 25.90r, and the two sum to 33r at every sample. A move that
  interrupts another (Esc while opening, another event while closing) starts from
  the block's current height and opacity and takes the share of the duration it
  has left to travel. The block's 2r foot is the details' own padding, so it
  closes to 0, not 2r. Leaving the tab ends a close in progress; coming back with
  an event still selected shows it as it was, without growing open again. Under
  `prefers-reduced-motion` it opens and closes at once.
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
- **The list pane scrolls exactly like the phone** (owner, 2026-10-11: "just copy
  it"). It runs the phone's CSS and JS rather than desktop scroll logic of its own:
  - **the nav band is kept**, empty, at the foot of the list pane
    (`.dk-pane-list::after`, the bottom nav's own height with `--nav-snap`). The
    rail does the nav's job, but without the band the list's scroller was 5r taller
    than the phone's, and everything else followed from that: rows came into view
    sooner and left their 13r `content-visibility` placeholders at other times, so
    rows below the window and the last stop drifted by 2r, and the tail, the
    scroller's padding, the cash bar and the Today button each needed a desktop
    value to make up for it. With the band the phone's values apply as they are
    and those desktop rules are gone;
  - the window-width rules for the list, its scroller and its sticky rows are
    gone everywhere, not just on desktop: the phone layout's shell is 37g at any
    window width, so between 640 and 1023 they only wrapped the filter row (17r
    instead of 12r). The filter panel's >=640 rule stays for the phone layout,
    where the portalled panel spans the window;
  - the pane clips (`.dk-pane { overflow: hidden }`) as `.app-shell` does round the
    phone's scroller. Without it WebKit anchored the list while rows grew from their
    13r placeholders: scrollTop 2343 settled at 2269, wheel steps came back 7–9r
    short, the Today button landed short, and every venue strip laid out 0 tall;
  - the rail and the bottom nav run one `onChange`, so Schedule pressed again
    scrolls back to today on both, landing where the list's first landing does
    (today's group top on the filters' bottom, re-landed once the smooth scroll
    rests, as rows leaving their placeholders can move today under it). It used
    to nudge the first card 2px below the sticky stack, about 0.3r short;
  - My Schedule (the user menu, the Dashboard's Up Next card) is the right pane on
    desktop, so `setCurrentView('schedule')` goes to the Schedule tab by the
    phone's own tab-change path: the list keeps its place, or gets back the place
    it was left at, as the phone's does on its way back from My Schedule. My
    Schedule lands on today in its own scroller (`landMySchedule`), never the
    list's;
  - the phone and desktop render one element tree (`.layout-contents`, display:
    contents, stands in for `.dk-body` / `.dk-pane` on the phone), so resizing
    across 1024 never remounts the list and its scroll position is kept;
  - a click on a card moves the list as a tap does on the phone (§6, One click
    selects); only where the details open differs, the right pane, which the
    phone has no counterpart for.
  What stays desktop-only is what the phone has no counterpart for: pane widths
  and `--dk-sb-g`; `scrollbar-gutter: stable` (a classic scrollbar takes width
  only here; overlay scrollbars reserve nothing); the Today button's centring
  without the scrollbar and on a g line in an even-width right pane; My
  Schedule's button 4r up in the right pane, which has no band; and, in the wide
  panes (Dashboard, Cash, …), which keep no band, the scroller's 2r bottom
  padding and the cash bar taking the fraction of an r. Also left, by design or
  by the input device: the selected card's outline and its details in the right
  pane rather than inline; the pane as the Today button's containing block (its
  box is the phone's, but its computed top is counted from the pane, 8r below
  the window's top); the divider hairline over the pane's left edge; card hover
  elevation, which follows a fine pointer on either layout, not the pane; and
  sub-pixel text antialiasing, since the pane starts at a fractional x in the
  window. Compare at the same window height (430×900 against 1440×900).
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

### Dashboard — two panes (built 2026-10-12, home redesign steps 2 to 6)

```
│ rail │ NOW 37g                          │ NUMBERS 37g                          │
│ 10g  │ Up Next (the carousel; a running │ Bankroll line (admins)               │
│      │   cash session is its first card)│                                      │
│      │ To log (only when non-empty)     │ This month / trip / series: its card,│
│      │ Last result (the receipt)        │   the signal-or-noise line (admins), │
│      │                                  │   then its goals (admins)            │
│      │                                  │ Trend, last 3 months (section 7; a   │
│      │                                  │   marked slot until BankrollChart    │
│      │                                  │   lands)                             │
```

The home's design is the panel verdict of 2026-10-11 (two halves: NOW, then the
NUMBERS). On the phone they are one scrolling column, NOW first. On desktop:

- **NOW** is the main pane (`dk-pane-main dk-pane-list`, 37g), since the Up Next
  card and its live controls were gridded on the phone canvas.
- **NUMBERS** is a second 37g pane (`dk-pane-mine` > `.dk-scroll.dk-home-right`).
  `DashboardView` portals its numbers column into it (the `homeRight` prop). App
  keeps the pane mounted for the whole desktop session and only hides it off the
  Dashboard, so the portal's content keeps its state across tabs.
- Each pane is its own scroller and both start 1r under the bar. The NOW pane
  ends on its 2r column gap (no nav on desktop); the NUMBERS pane on the
  `.dk-scroll`'s own 2r foot.
- The two-pane tier and the three-pane tier both show the same two panes: there
  is no third Dashboard pane.
- Up Next (step 5) is the same carousel in NOW on both layouts. Its plans resolve
  themselves (utils/home-upnext.js `resolveConditions`): each condition is a tag
  on the card ('If bust #12' waiting, 'On: busted #12', 'Off: busted #12'), and a
  card whose plan is off dims, all but its tags, and moves to the end. An
  admin's running cash session is the first card (`HomeCashCard.jsx`: clock, in
  play, last stack; Update stack in place, Cash out opens Results > Cash on the
  live screen's cash-out panel), and the bar over the nav (`LiveCashBar`) is off
  on the Dashboard. With nothing scheduled the carousel is one 35g x 5r prompt
  (`HomeNothingNext.jsx`: the week's events near you; it opens the Schedule).
  Every slide sits in the track's one grid cell and is moved by its own multiple
  of its width, so the card shown is on the grid at any index on both layouts
  (the flex row drifted 0.115px a card at 1440, 0.057px at 402). The track is as
  tall as the card ON SHOW, in whole r (fix round 1, 2026-10-12), so the dots or
  the counter sit right under it: the tallest-of-all rule left up to 16r of hole
  under a short card (a 12r upcoming card in a 28r track). It eases to each
  card's height on the page turn's curve; a drag grows it to a taller neighbour
  as that comes in; and while a mouse is over the dots or the counter the height
  holds still (a taller card is cut at it meanwhile), so the ‹ › under the
  pointer does not move between two clicks. check:controls reports the track
  against the card on show ('fit') on every card (`dashboard-carousel`).
- To log and the Last result (step 3) sit under Up Next in NOW, so what is next,
  what is unlogged and what just happened read down one pane. Their Log menu is
  portalled to the body and anchored to the Log pill (right edges together, 1r
  above or below it), so it is not clipped by the pane's scroller. A choice in it,
  To log's Cashed and a tap on the receipt open Results in this same main pane.
- The NUMBERS pane (step 4, `HomeNumbers.jsx`) opens with the bankroll line
  (admins: the balance of every roll, the tournament cap a bullet and the rule's
  move signal as a pill, a 35g x 5r card under its own 3r header, BANKROLL with
  the scope on the right, so its card starts on 13r, level with the Up Next card
  beside it; the period block's header leaves the scope out when it is the
  same), then the period block: the window's
  name and scope in a 3r header, a 7r lead (the net and its sample; the
  like-for-like comparison, or the trip's or series' dates, on the right), a 4r
  row for each figure that exists, then the goals card (admins; 6r a goal with
  its pace bar). The window is a trip covering today (admins), else a series
  detected with confidence, else the month. Taps open the deep views: the
  bankroll line the Bankroll dashboard's Rules, the goals its Goals and the block
  its Overview (all on All bankrolls, in the dashboard's sheet over the home); a
  trip's block that trip's page in Results; a non-admin's block Results.
- Under the period block's card (step 6, `HomeNoiseLine.jsx`; admins) is one
  plain sentence about the same window: the window in buy-ins over its bullets
  (or per hour over its hours, when cash moved its net more), how often the
  player's long-run rate does no better (or as well) over a stretch that long,
  and that rate's 95% interval against break-even, each figure with its sample
  ('−4 buy-ins over 11 bullets: about 2 in 5 stretches this long do as well at
  your long-run rate. Its interval over 195 entries, −54% to +87%, includes
  break-even.'). Under 30 entries (30 sessions for cash) it is progress instead:
  '18 of 30 entries before this can separate skill from luck'. It is xs on 3r
  lines across the column's 35g, two lines typically, its first baseline 3r
  under the card's foot, so the block is 3n + 1 r. It loads after the first
  paint (GET /api/analytics?from=&to=, cached per results version; for cash, the
  whole ledger's per-hour spread) and appears when it has something to say.
  Tapping it opens the Analytics sheet over the home (a cash sentence opens the
  bankroll dashboard's Overview instead).
- The NUMBERS pane is the same on the phone, under the Last result: there it is
  below the fold, as the verdict expected.
- Width (decided 2026-10-12, fix round 1): the Dashboard keeps rail 10g + 37g +
  37g = 84g. At 1024 that is the whole shell; at 1440 the shell is 111g (sized
  for Schedule's list and its 64g right pane) and 27g of page stays to the right
  of the NUMBERS. That is the band every single-pane tab already leaves (Social,
  Hands, Cash and Settings leave 37g at 1440: "the shell to the right of a capped
  single pane reads as page"), and the alternatives were worse: re-centring an
  84g shell on the Dashboard moves the rail and the bar 13.5g sideways at every
  tab change, and widening the NUMBERS to the 64g slot only moves the same empty
  band inside the pane, since each block is a 35g phone canvas. When Trend
  (section 7) lands, the NUMBERS can take the 9N+1 slot and set Trend or the
  goals in its second column.
- Friends Playing and Connections, which the old plan gave a pane, left the home
  (they live in Social). The Table Scanner left it as well: it is the Playing
  card's Scan action and a tool in Hands.

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
  was also identical. The same holds for 800×900, which stays on the
  phone column. (1024×1366 portrait was also measured on the phone column; since
  2026-10-08 it gets the desktop layout.)
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

# App Store listing (DRAFT, launch plan action 8)

Drafted 2026-10-15 from the launch plan (artifact 5k5qVK6Y8cPmzdMXjJEDgW, sections 11 and 12) and the
owner's answers of the same day: no data agreement, so no provider is named anywhere; ACR stays in the
build; the Mac app launches later, so nothing says "Mac"; prices as planned, paywall from 1 March.
Everything here is paste-ready for App Store Connect except the items under "Owner to supply".
Submission target: Fri 11 Dec 2026, manual release, for Tue 5 Jan 2027.

## Owner to supply before submission

- **Privacy policy URL.** `docs/privacy/privacy-policy-draft.md` is written but has CHECK items only the
  owner can answer (operator name, contact email, retention, response time). Once answered it gets
  published at `futurega.me/privacy`.
- **Support URL and email.** A contact address for `futurega.me/support`.
- **Demo account for review.** A fresh account with a few saved events, one bag/bust plan and one
  logged result, made after the store build is final. Credentials go in the review notes field only.
- **Feature set (plan action 2).** Whether Hands (the replayer) opens to everyone decides keywords,
  screenshot 9 and the third preview.
- **Right before submitting** (not earlier: TestFlight builds are the same binary):
  `webContentsDebuggingEnabled: false` in `capacitor.config.json`, and the display name
  `futurega.me β` becomes `futurega.me`. The bundle id stays `app.futurega.me.beta`.

## Fields

| Field | Value | Limit |
|---|---|---|
| App name | futurega.me: Poker Tournaments | 30 of 30 |
| Subtitle | Live series, plans & results | 28 of 30 |
| Primary category | Reference | |
| Secondary category | Sports | |
| Age rating | 18+ (answer "None" for real-money gambling; answer simulated gambling as it is, then raise to 18+) | |
| Marketing URL | https://futurega.me/live | |
| Copyright | 2027 Ethan Bennett [CHECK: or the business entity] | |

**Keywords, English (US)** (99 of 100; no word from the name or subtitle, no trademarks):

```
schedule,calendar,tracker,bankroll,planner,mtt,late,reg,circuit,festival,flight,replayer,hand,horse
```

If Hands stays closed at launch, swap `replayer,hand` for `deepstack,stud` (98 of 100).

**Keywords, Spanish (Mexico)** (98 of 100):

```
deepstack,bounty,freezeout,satellite,razz,badugi,mixed,omaha,holdem,plo,stud,chip,count,buyin,trip
```

## Promotional text (170 max; editable without review)

Launch (142):

```
Every live poker series near you, in one schedule. Plan each flight, see the clash before you register, and keep your results beside the plan.
```

During the BWPO, once its schedule is in the app (from the plan):

```
The Borgata Winter Poker Open is in. Every event and flight in Atlantic City time, with late reg counted down.
```

## Description

Written to the plan's guardrails: no outcome promises, no "win", no profit or ROI, no "cash" as money,
no online room named, no clock provider named.

```
futurega.me is the poker calendar for live tournament players.

EVERY LIVE SERIES, ONE SCHEDULE
• Every event and every flight of the live series near you, each in its room's own time
• Filter by distance from home, by the games you play and by buy-in
• Mixed games are first class: HORSE, stud, draw, PLO hi-lo and more

PLAN FOR BAGGING. PLAN FOR BUSTING.
• See the clash before you register for two events that overlap
• Keep an if-bag plan and an if-bust plan for every Day 1
• Put every flight side by side and pick the day that fits your week

LATE REG, COUNTED DOWN
• How long late registration has left, on every running event
• The live level and clock wherever the room publishes one

BRING THE CREW
• See where your friends are playing
• Send your week to anyone in one link

RECORD EVERY RESULT
• Log every event and finish as you play
• Your season at a glance: events, finishes, your best run

Free to start.

futurega.me is a schedule, planner and record-keeping app. It takes no bets and offers no real-money play. Not affiliated with any casino or poker room. 21+. If gambling is a problem for you, call 1-800-MY-RESET (national) or 1-800-GAMBLER (New Jersey).
```

Before 1 March, "Free to start." reads "Free." (the plan's price rule).

## What's New (first version)

```
The first App Store release of futurega.me: every live series near you, your plan for every flight, and your results beside it.
```

## Review notes

ACR stays in the build (owner, 2026-10-15), so the notes describe what the app actually does with
online rooms instead of the plan's "shown only where the operator says they are available":

```
futurega.me is a schedule, planner and record-keeping app for live poker tournaments. It offers no real-money gaming, wagering, prizes or in-app currency, and nothing in it can be played for money.

Online events are listings only (dates, times and buy-ins, like a TV guide). They are off until the user turns them on, either in first-run setup or in the Online menu, and the "available in my state" filter is on by default, which hides any room that names the user's state as excluded.

Demo account: [username] / [password]. It has saved events, a bag and bust plan and a logged result, so every screen has content.
```

Guideline 5.3 warns apps near gambling to expect longer review; 11 Dec leaves room for one rejection.
The plan's own risk note stands: no US state licenses ACR, and a reviewer who finds its listings may
read the app as pointing players at unlicensed real-money poker. If review objects, the fix is to drop
ACR from the store build (the web keeps it).

## Screenshots, in order

iPhone 6.9-inch (1320 x 2868), iPad 13-inch (2064 x 2752, the two-pane desktop layout). No Mac set
(the Mac app launches later). The first three carry the page in search results. Every figure on screen
is sample data and says so; no dollar figure leads any shot.

| # | Caption | Screen to capture |
|---|---|---|
| 1 | Every live series. One schedule. | Schedule list near Philadelphia, venue strips showing, live only |
| 2 | Plan for bagging. Plan for busting. | A saved Day 1 open with its if-bag / if-bust plans and the clash banner |
| 3 | Late reg, counted down. | A running event's card with the late-reg bar (use a room's live clock only if one comes through on capture day) |
| 4 | Nine flights. Pick the one that fits. | A multi-flight event's flights side by side |
| 5 | Only what's within driving range. | The location sheet at 100 miles |
| 6 | See where your friends are playing. | Social tab with demo friends |
| 7 | Filter by the games you play. | The game filter with mixed games chosen |
| 8 | Record every result. | Results tab: events, finishes, best finish (counts, no dollar hero) |
| 9 | Type the hand. Watch it play. | Replayer, only if Hands opens |

Preview videos (886 x 1920, 30 fps, 15 to 30 s, app footage only, overlays allowed): "Your whole poker
calendar" 25 s, "Late reg" 15 s, "Replayer" 15 s if Hands opens. Cut from the ads once ad work resumes
(paused 2026-10-14).

## After approval

- Set `APP_STORE_ID` and `APP_STORE_PT` (App Store Connect campaign provider token) on the Render
  service: futurega.me/live then shows the App Store button with each ad's `?ct=` campaign.
- Replace the landing page's text button with Apple's official badge artwork.
- Custom product pages (Schedule, Clocks, Planner, Mixed games; Tracker at Gate 1) and In-App Events
  (BWPO, WSOP 2027) per the plan's section 12.
- Ratings prompt: after the third saved event or after logging a bag, never after a bust.

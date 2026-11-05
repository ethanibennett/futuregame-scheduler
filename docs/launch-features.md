# What we tout at launch

Written 2026-11-04 for the 5 January 2027 launch (App Store submission Fri 11 Dec). Built from the launch plan
(artifact 5k5qVK6Y8cPmzdMXjJEDgW, sections 3 and 11), `docs/app-store-listing.md`, `MONETIZATION-PLAN.md` and what the
code does today. The lines are drafts in the plan's approved language. **Status** says what a person can do today: a
feature admins can see is not yet a feature we can advertise.

## The rules every line follows

From the plan's section 11 and the listing:

- Sell planning, not outcomes: no "win", "crush", "beat the field", no profit or ROI, no "cash" meaning money.
- No online room named, in anything an ad links to. No casino logos, no "official" or "partner".
- Never name where the listings or the clocks come from (PokerAtlas, Bravo, WSOP+).
- Any figure on screen is sample data and says so; friends and hands are demo accounts with made-up names.
- Every paid post carries "For live tournament players 21+. No real-money gambling in the app. Not affiliated with any
  casino or poker room."

## 1. Lead with these: open to everyone today

What PokerAtlas does not offer comes first (plan, section 3): the clash, the plans, the crew, results beside the plan.

| # | Feature | The line | Status |
|---|---|---|---|
| 1 | Every live series in one schedule | "Every live series near you, each in its room's own time." | Live. /live counted 1,655 events in 76 series at 63 rooms over 30 days on 2026-11-04; use the count on the day |
| 2 | The clash, flagged first | "See the clash before you register for both." | Live: My Schedule's conflict banner. **Paywall conflict, below** |
| 3 | If-bag and if-bust plans | "Plan for bagging. Plan for busting." | Live: If I Bag / If I Bust on a saved event |
| 4 | Every flight, compared | "Pick the flight that fits your week." | **Check first:** flights list by date and the plans find the closest one; I found no side-by-side view, which is what /live and the listing say today |
| 5 | Late reg, counted down | "Never miss late reg." | Live: the bar on each running card |
| 6 | The room's live clock | "The live level and clock, wherever the room publishes one." | Live for some rooms, so always with that qualifier. Check the Mid-Atlantic rooms on capture day (plan, open question 3) |
| 7 | Only what you can drive to | "Filter by distance from home." | Live |
| 8 | Mixed games first class | "HORSE, stud, draw, PLO hi-lo: filter by the games you play." | Live |
| 9 | Bring the crew | "See where your friends are playing. Send your week in one link." | Live: Social and the share link. Social's empty state is what a new user sees, so seed the screenshot |
| 10 | Every result recorded | "Every event. Every finish. Your season at a glance." | Live, as counts and finishes. Keep it below the planning features |
| 11 | Built by a player | "A working pro built the app he wanted." | True today. This is Ad 12, launch-day anchor |
| 12 | Free | "Free." until 1 March, then "Free to start." | Live |

## 2. The hand replayer: needs one decision by you

The plan's action 2, still open, and the listing's "Feature set" item. Open the Hands tab to everyone and these join the
list as a fourth-week story (Ad 3, screenshot 9, the third preview, the keywords `replayer,hand`). Keep it closed and the
keywords swap to `deepstack,stud`.

| Feature | The line | Status |
|---|---|---|
| Hand replayer | "Type the hand. Watch it play." | Admins only. Our most shareable feature |
| Every game | "Hold'em, Omaha, stud, draw, mixed." | Admins only |
| Quick add, typed or spoken | "Say the hand. It builds the replay." | Admins only. The plan opens it only if the parser eval passes against the real model, with a daily cap per user |
| Export to PokerTracker | "Your saved hands, in PokerTracker and Hold'em Manager." | Admins only. Hold'em and four-card Omaha only |

## 3. Play against the solver: not at launch

Play a hand, Hand trainer, Quick spots, Watch the solver, Solve a spot and Price a draw (Hands > Study) are now one thing
and read well, but keep them out of launch copy:

- They are admins only, and the solver routes are admin-only on the server.
- Render is missing the A-5 and Stud 8 blueprints, and three-way Razz's, so Study offers Razz, 2-7 and Badugi.
- Nobody has played them at scale. Grades need people who will read a caveat, and "graded by the solver" reads as a
  promise of better results.

A strong later story for serious players, and the plan's mixed-game audience (segment 4) is the place to start.

## 4. Do not tout yet

| Feature | Why |
|---|---|
| Bankroll, reports, analytics, expenses, tax | Betas for admins. Apple Ads treats gambling statistics as real-money gambling, and the plan keeps product pages to record-keeping |
| Cash games | Admins only; "cash" is a word the plan avoids; Ad 11 drops its cash card unless this ships |
| Staking, backer pages, settlement | Admins only (segment 5, "held until staking ships"). Backer pages already work for the owner's own backers |
| Online rooms | Never in ads or on linked pages. Off until a user turns them on |
| The Mac app | The listing says it launches later, but the plan's sign-off still says "iPhone, iPad and Mac" |
| Calendar sync | Not built as far as I can find, and PokerAtlas PRO sells it; `MONETIZATION-PLAN.md` lists it for Pro |
| The Swiss theme, the MCP connector, session bridge | Owner tools |

## 5. Decisions and gaps this list turned up

1. **Open Hands to everyone?** This decides section 2 and three store assets. Plan date passed (27 Oct).
2. **Conflict detection is on the paid side of `MONETIZATION-PLAN.md`,** and it is our lead feature. From 1 March, "see the
   clash" would be a paid claim beside "Free to start", and Pro is also where the plan puts more than 5 saved events and
   more than 5 results a month. Worth deciding before the screenshots are made.
3. **"Every flight side by side" needs to be true or reworded.** Either build the comparison (screenshot 4 says "Nine
   flights. Pick the one that fits.") or change the line on /live, the listing and Ad 9.
4. **Mac in the sign-off.** Pick one: the listing says no, the plan's ads say yes (open question 5, due 4 Dec).
5. **Live clocks in the Mid-Atlantic.** The first ads pin those rooms. WSOP+ was added on 2026-10-23, so re-check Parx,
   Live!, Borgata and Maryland Live! on a running event before Ad 2 runs there.

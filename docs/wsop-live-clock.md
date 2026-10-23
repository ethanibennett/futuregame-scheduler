# WSOP+ (WSOP Live) tournament clocks

The third live-clock provider (`lib/wsop-live-clocks.js`, behind `lib/live-clocks.js` and
`POST /api/live-clocks`). A WSOP-run series — a Circuit stop, the summer WSOP, Paradise, Europe —
runs its clocks in GGPoker's WSOP+ system, which neither Bravo nor PokerAtlas carries: on
2026-10-21 Turning Stone's Circuit events had no clock anywhere our server looked while the WSOP
LIVE app showed them running. Reverse-engineered on 2026-10-22 from the iOS app (4.11.0, a Flutter
client) over a WireGuard tunnel to this box with mitmproxy. The capture was deleted afterwards: it
held the owner's login token, which nothing here uses.

## What the server calls

Everything below is **anonymous**: one header, `x-api-key`, carrying the app's public constant (the
same value for every user; `WSOP_API_KEY` overrides it). No login, no cookie except the hub's
load-balancer cookie. Bodies are MessagePack (`accept: application/x-msgpack`); the module carries
its own small codec, no dependency.

| Call | Gives | Cached |
|---|---|---|
| `GET papi.wsopplus.com/Series?hasActiveTicketOnly=false` | `seriesList[]`: id, name, venueName, city, timeZone, beginAt, endAt | 6 h |
| `GET papi.wsopplus.com/EventFlights?seriesId=<id>` | `eventFlightList[]`: eventFlightId, eventId, eventNo (0 for a daily), fullName, startTime (UTC), status, buyIn, isSideEvent, entries, playersLeftCount, completedAt, lateRegClosedAt | 5 min |
| `GET papi.wsopplus.com/EventFlights/<flightId>` | the flight in full: flightStack, flightPrize/totalPrize, clockEntries, option.{isHideClock, isHideChipsPrize}, startingChip, lateRegLevel | 60 s |
| `GET papi.wsopplus.com/EventFlights/<flightId>/BlindStructure` | `blindStructureDetailList[]`: level, type (0 level, 1 break), duration (min), blindJson | 1 h |
| `POST psignal.wsopplus.com/AnonPlayerHub/negotiate?compressionType=gzip&negotiateVersion=1` | SignalR negotiate: connectionToken, and the `AWSALB` cookie the socket MUST send back | per connection |
| `wss://psignal.wsopplus.com/AnonPlayerHub?compressionType=gzip&id=<token>` | the hub | 10 s per series |

`blindJson` is a JSON string whose keys are prefixed by the game — `nlHoldemSmallBlind`,
`ploBigBlind`, `ploAnte` — so the module reads them by suffix (`blindsOf`).

## The hub

Standard SignalR over WebSocket with the MessagePack protocol:

1. Client sends the text handshake `{"protocol":"messagepack","version":1}\x1e`; the server
   answers `{}\x1e`, then an `OnConnected` invocation with the connection id.
2. Client sends `Subscribe` with ONE string argument, a JSON document. Two shapes seen:
   - `{"events":["AllTournament"],"seriesId":76}` — the series' event list screen. Answered at once
     with one `Clock` message per flight that has a clock, running or preset (a Day 2 preset to
     level 10, a Day 1B at level 1 not started), and again with every change.
   - `{"events":["PayoutStructure","BlindStructure","PrizePool","Clock","ClockDetail","TournamentStatus","EventFlightSummary"],"eventId":4036,"eventFlightIds":[6147]}`
     — one flight's clock screen. Adds `ClockDetail` (theme, message, displayEventName).
   The module uses the first: one connection per series per 10 s, closed 700 ms after the last
   message of the burst (it takes about 1.4 s all in from this box).
3. Pings are `[6]` both ways.

**Framing.** Client frames are plain SignalR binary framing: a varint byte length, then the
MessagePack invocation `[1, {}, null, "Subscribe", [argsJson]]`. Server frames are WRAPPED
(`compressionType=gzip`): byte 0 is a flag (1 = the rest is gzipped), then a uint32 **little-endian**
length, then standard SignalR framing (one or more varint-prefixed MessagePack messages). Every
message seen was flag 0; the gzip path is implemented and tested on a synthetic frame.

**Clock data**, verified against two running flights (23:24Z on 2026-10-22, 35 s apart):

```
{ eventFlightId: 6147, isStarted: true, levelIndex: 13, level: 11, type: 0, levelDuration: 40,
  duration: 1559, pauseStartTime: null, pauseDuration: null,
  serverTime: "2026-10-22T23:24:07.4326482Z",
  lateRegEndTime: "2026-10-23T00:45:06.7134439Z", lateRegEndDuration: 4859 }
```

- `duration` is the seconds left in the current level at `serverTime` (1559 then 1524, 35 s later);
  `levelDuration` is minutes. The module ages `duration` from `serverTime` while running.
- `levelIndex` indexes the blind structure list WITH breaks (index 13 = level 11 after two breaks);
  `level` is the printed level; `type` 1 is a break (the break row at the same level number).
  The blinds are the structure row at `levelIndex`, checked against level and type, else the first
  row with that level and type.
- `pauseStartTime` set = paused (not yet seen live; read as `state: 'paused'`, time held).
- `lateRegEndDuration` goes negative once registration has closed.
- The Clock carries no field or money: entries, players left, average stack
  (`flightStack / playersLeftCount`) and the prize pool come from the flight detail, which is why
  it is fetched alongside. `option.isHideClock` hides the clock from the app, so the module returns
  no clock; `isHideChipsPrize` hides the money.
- A flight with `completedAt` set is `state: 'ended'`. A flight with no Clock message and no
  `completedAt` (a Day 2 not yet preset) is an answered "no clock", and the dashboard estimates.

## Matching our feed to WSOP+

The feed's Turning Stone rows (2026-10-23) and what they match, `matchWsopFlight`:

| Feed | WSOP+ |
|---|---|
| `9-293160-20261023` "WSOPC Main Event - Flight B", 12:00 PM | 6148 "#9: … Main Event … - Day1B" |
| `9-293160-20261025` "… - Day 2" | 6150 "… - Day2" |
| `9-293160-20261026` "… - Day 3" | 6151 "… - Final Day" |
| `10-293161-20261023` "NLH-PLO Mix - Day 2" | 6153 "#10: … Mixed … - Final Day" |
| `PA-293171-20261022` "NLH Cash Survivor" $100, 2 PM | 6192 "$100 No-Limit Hold'em Cash Survivor" 18:00Z |
| `PA-293173-20261022` "NLH Side Event - Nightly Deep Stack" $140, 7 PM | 6177 "$140 No-Limit Hold'em Nightly" |
| `PA-293180-20261024` "NLH Landmark Mega" $270, Oct 24 9 PM | none (WSOP+ has no such flight) |

- **The series** (`pickWsopSeries`): the feed row's `property` (the PokerAtlas room name, "Turning
  Stone Casino") must share its distinctive words with a listed series' `venueName` ("Turning Stone
  Resort Casino"), with the event's start inside the series window (36 h slack); the feed `venue`
  (series title) is a second chance. "Caesars" alone never matches: several Caesars run stops.
- **A numbered event** matches by its leading number against `eventNo` (or the `#N:` in the name),
  then the flight by suffix — Flight A/B/C ↔ Day1A/B/C, Day 2 ↔ Day2, a Day N ≥ 2 ↔ Final Day — or,
  failing that, the nearest `startTime` within 3 h of the event's own start (the client sends it;
  WSOP+ lists the Main Event flights at 11 AM ET where PokerAtlas says noon).
- **An unnumbered daily** (`PA-…`) is taken only when exactly one flight starting within 90 min at an
  agreeing buy-in (±10%) shares the most name words with it, after both names are put in one
  spelling (`canon`: "No-Limit Hold'em" → nlh, "Pot-Limit Omaha 8 or Better" → plo8).

A WSOP+ match is **final**: `clockForEvent` does not fall through to Bravo when the hub fails,
because Bravo would answer "no clock" for a WSOP event and five minutes of that ends the event
(`clock_ended_at`). A room with no WSOP+ series, or an event WSOP+ does not list, goes on to Bravo
as before.

## Checking it

- `npm run test:clocks` — the codec, the captured frame, the series and flight matching, the
  normaliser.
- `GET /api/admin/live-clocks/probe?series=76` (x-sync-token) — adds `wsop: { series, ms, hub:
  { seriesId, ok, clocks, ms } }`: whether this host can read the series list and reach the hub.
- Live, from any Node 22: `require('./lib/wsop-live-clocks').fetchSeriesClocks(76)` returns the
  Map of Clock data for every flight with a clock.

Node's WebSocket (undici) must accept `headers` (Node ≥ 22.4): the hub refuses the upgrade without
the api key AND the negotiate cookie (verified: non-101 without either).

# Las Vegas Tournament Structure Audit

**Date range:** 2026-05-15 through 2026-07-13 (day before WSOPC Horseshoe Las Vegas, which starts 2026-07-14)

**Las Vegas venues included:**
- Horseshoe / Paris Las Vegas (WSOP)
- Venetian DeepStack Extravaganza (VDX)
- Venetian
- Aria
- MGM Grand
- Golden Nugget
- Orleans
- South Point

**Methodology:**
- Each row is one logical event (flights are grouped under the earliest flight date).
- `Days` = 1 + number of distinct Day 2/restart dates linked to that event.
- `Flights` = number of Flight rows (e.g., Flight A, Flight B, etc.).
- `Restarts/Day2s` = Yes if any restart row exists for this event.
- South Point 300K Multiday: each week runs 2 Day 1 sessions (Mon-Thu) + 1 Day 2 Restart (Thu/Fri). Listed individually as 1-day rows since `parent_event` is NULL in DB — **flagged in Notes**.

| Date | Venue | # | Event Name | Buy-in | Flights | Days | Restart? | Notes |
|------|-------|---|------------|--------|---------|------|----------|-------|
| 2026-05-15 | VDX | 70 | NLH Seniors | $400 | 2 | 2 | Yes | 2 flights |
| 2026-05-15 | VDX | 72 | NLH Bounty | $200 |  | 1 | No |  |
| 2026-05-16 | VDX | 73 | NLH Bounty | $200 |  | 1 | No |  |
| 2026-05-17 | VDX | 74 | NLH | $400 |  | 1 | No |  |
| 2026-05-17 | VDX | 75 | NLH Bounty | $200 |  | 1 | No |  |
| 2026-05-18 | Venetian | 1 | NLH | $600 | 3 | 2 | Yes | 3 flights |
| 2026-05-18 | Venetian | 2 | NLH Bounty | $200 |  | 1 | No |  |
| 2026-05-19 | Venetian | 3 | NLH Bounty | $200 |  | 1 | No |  |
| 2026-05-20 | Venetian | 4 | NLH Bounty | $200 |  | 1 | No |  |
| 2026-05-21 | Venetian | 5 | NLH | $600 |  | 1 | No |  |
| 2026-05-21 | Venetian | 6 | NLH Bounty | $200 |  | 1 | No |  |
| 2026-05-22 | Orleans | — | NLH Friday Special Monster Stack | $200 |  | 1 | No |  |
| 2026-05-22 | Orleans | — | NLH Super Stack | $200 |  | 1 | No |  |
| 2026-05-22 | Orleans | — | Triple Triple Draw | $240 |  | 1 | No |  |
| 2026-05-22 | Venetian | 7 | NLH | $600 |  | 1 | No |  |
| 2026-05-22 | Venetian | 8 | PLO Bounty | $600 | 2 | 2 | Yes | 2 flights |
| 2026-05-22 | Venetian | 9 | NLH Bounty | $200 |  | 1 | No |  |
| 2026-05-23 | Orleans | — | NLH Mega Stack | $400 |  | 1 | No |  |
| 2026-05-23 | Orleans | — | NLH Nightly Monster Stack | $200 |  | 1 | No |  |
| 2026-05-23 | Orleans | — | PLO8 Championship | $600 |  | 1 | No |  |
| 2026-05-23 | Orleans | — | TORSE | $240 |  | 1 | No |  |
| 2026-05-23 | Venetian | 10 | NLH Seniors | $600 | 3 | 2 | Yes | 3 flights |
| 2026-05-23 | Venetian | 11 | NLH Bounty | $250 |  | 1 | No |  |
| 2026-05-24 | Orleans | — | Big O | $240 |  | 1 | No |  |
| 2026-05-24 | Orleans | — | NLH Sunday Special | $300 |  | 1 | No |  |
| 2026-05-24 | Venetian | 12 | NLH Bounty | $250 |  | 1 | No |  |
| 2026-05-25 | Orleans | — | HORSE | $240 |  | 1 | No |  |
| 2026-05-25 | Orleans | — | NLH Nightly Monster Stack | $200 |  | 1 | No |  |
| 2026-05-25 | Orleans | — | NLH Seniors 50+ | $400 |  | 1 | No |  |
| 2026-05-25 | S. Point | — | NLH 300K Multiday Day 1 | $300 |  | 1 | No | ⚠ Part of weekly 2-day series; Day 2 Restart unlinked in DB |
| 2026-05-25 | S. Point | — | NLH 300K Multiday Day 1 | $300 |  | 1 | No | ⚠ Part of weekly 2-day series; Day 2 Restart unlinked in DB |
| 2026-05-25 | S. Point | — | NLH Chip Chop Survivor | $120 |  | 1 | No |  |
| 2026-05-25 | S. Point | — | NLH Turbo Bounty ($25) | $120 |  | 1 | No |  |
| 2026-05-25 | Venetian | 13 | O8 | $600 |  | 2 | Yes |  |
| 2026-05-25 | Venetian | 14 | NLH Bounty | $250 |  | 1 | No |  |
| 2026-05-26 | WSOP | 1 | NLH Mini Mystery Millions | $550 | 6 | 3 | Yes | 6 flights |
| 2026-05-26 | WSOP | 2 | NLH 8-Max | $5,000 |  | 4 | Yes |  |
| 2026-05-26 | Orleans | — | 2k Bankroll Builder | $230 |  | 1 | No |  |
| 2026-05-26 | Orleans | — | 8-Game Mix Championship | $600 |  | 1 | No |  |
| 2026-05-26 | Orleans | — | NLH Nightly Monster Stack | $200 |  | 1 | No |  |
| 2026-05-26 | Orleans | — | NLH Super Stack | $200 |  | 1 | No |  |
| 2026-05-26 | S. Point | — | NLH 300K Multiday Day 1 | $300 |  | 1 | No | ⚠ Part of weekly 2-day series; Day 2 Restart unlinked in DB |
| 2026-05-26 | S. Point | — | NLH 300K Multiday Day 1 | $300 |  | 1 | No | ⚠ Part of weekly 2-day series; Day 2 Restart unlinked in DB |
| 2026-05-26 | S. Point | — | NLH Turbo Bounty ($25) | $120 |  | 1 | No |  |
| 2026-05-26 | S. Point | — | O8 | $120 |  | 1 | No |  |
| 2026-05-26 | Venetian | 15 | NLH | $600 |  | 1 | No |  |
| 2026-05-26 | Venetian | 16 | NLH Bounty | $250 |  | 1 | No |  |
| 2026-05-27 | Aria | — | NLH | $300 |  | 1 | No |  |
| 2026-05-27 | Aria | — | NLH Mystery Bounty | $1,100 |  | 2 | Yes |  |
| 2026-05-27 | Aria | — | NLH Turbo Satellite | $160 |  | 1 | No |  |
| 2026-05-27 | WSOP | 3 | NLH Employees Event | $500 |  | 2 | Yes |  |
| 2026-05-27 | WSOP | 4 | O8 | $1,500 |  | 3 | Yes |  |
| 2026-05-27 | Orleans | — | 1k Bankroll Builder | $125 |  | 1 | No |  |
| 2026-05-27 | Orleans | — | NLH Nightly Monster Stack | $200 |  | 1 | No |  |
| 2026-05-27 | Orleans | — | NLH Super Stack | $200 |  | 1 | No |  |
| 2026-05-27 | Orleans | — | PLO Championship | $600 |  | 1 | No |  |
| 2026-05-27 | S. Point | — | NLH 300K Multiday Day 1 | $300 |  | 1 | No | ⚠ Part of weekly 2-day series; Day 2 Restart unlinked in DB |
| 2026-05-27 | S. Point | — | NLH 300K Multiday Day 1 | $300 |  | 1 | No | ⚠ Part of weekly 2-day series; Day 2 Restart unlinked in DB |
| 2026-05-27 | Venetian | 17 | NLH Bounty | $600 |  | 1 | No |  |
| 2026-05-27 | Venetian | 18 | NLH Bounty | $250 |  | 1 | No |  |
| 2026-05-28 | Aria | — | Badugi | $600 |  | 1 | No |  |
| 2026-05-28 | Aria | — | NLH | $800 |  | 1 | No |  |
| 2026-05-28 | Aria | — | NLH | $300 |  | 1 | No |  |
| 2026-05-28 | WSOP | 5 | PLO | $5,000 |  | 3 | Yes |  |
| 2026-05-28 | WSOP | 6 | 7-Card Stud | $1,500 |  | 3 | Yes |  |
| 2026-05-28 | Orleans | — | Mixed O8 Championship | $600 |  | 1 | No |  |
| 2026-05-28 | Orleans | — | NLH Monster Stack | $300 |  | 1 | No |  |
| 2026-05-28 | Orleans | — | NLH Nightly Monster Stack | $200 |  | 1 | No |  |
| 2026-05-28 | Orleans | — | Triple Triple Draw | $240 |  | 1 | No |  |
| 2026-05-28 | S. Point | — | NLH $15K GTD | $120 |  | 1 | No |  |
| 2026-05-28 | S. Point | — | NLH Deepstack $20K GTD | $200 |  | 1 | No |  |
| 2026-05-28 | S. Point | — | NLH Turbo Bounty ($25) | $120 |  | 1 | No |  |
| 2026-05-28 | Venetian | 19 | NLH | $600 |  | 1 | No |  |
| 2026-05-28 | Venetian | 20 | PLO Bounty | $800 |  | 1 | No |  |
| 2026-05-28 | Venetian | 21 | NLH Bounty | $400 |  | 1 | No |  |
| 2026-05-29 | Aria | — | NLH | $800 |  | 1 | No |  |
| 2026-05-29 | Aria | — | NLH | $300 |  | 1 | No |  |
| 2026-05-29 | Aria | — | O8 | $600 |  | 1 | No |  |
| 2026-05-29 | WSOP | 7 | NLH Heads Up Championship | $25,000 | 2 | 3 | Yes | 2 flights |
| 2026-05-29 | WSOP | 8 | Badugi | $1,500 |  | 3 | Yes |  |
| 2026-05-29 | Orleans | — | Mixed Omaha-8/Stud-8 | $240 |  | 1 | No |  |
| 2026-05-29 | Orleans | — | NLH Friday Special Monster Stack | $200 |  | 1 | No |  |
| 2026-05-29 | Orleans | — | NLH Monster Stack | $300 |  | 1 | No |  |
| 2026-05-29 | S. Point | — | Crazy Pineapple | $120 |  | 1 | No |  |
| 2026-05-29 | S. Point | — | NLH $15K GTD | $120 |  | 1 | No |  |
| 2026-05-29 | S. Point | — | NLH Deepstack $20K GTD | $200 |  | 1 | No |  |
| 2026-05-29 | S. Point | — | NLH Turbo Bounty ($25) | $120 |  | 1 | No |  |
| 2026-05-29 | Venetian | 22 | NLH Bounty | $600 |  | 1 | No |  |
| 2026-05-29 | Venetian | 23 | PLO8 | $800 |  | 1 | No |  |
| 2026-05-29 | Venetian | 24 | NLH Bounty | $400 |  | 1 | No |  |
| 2026-05-30 | Aria | — | NL 2-7 Single Draw | $600 |  | 1 | No |  |
| 2026-05-30 | Aria | — | NLH | $300 |  | 1 | No |  |
| 2026-05-30 | Aria | — | PLO | $800 |  | 1 | No |  |
| 2026-05-30 | WSOP | 9 | O8 Championship | $10,000 |  | 3 | Yes |  |
| 2026-05-30 | Orleans | — | 1k Bankroll Builder | $125 |  | 1 | No |  |
| 2026-05-30 | Orleans | — | NLH Mega Stack | $400 |  | 1 | No |  |
| 2026-05-30 | Orleans | — | NLH Nightly Monster Stack | $200 |  | 1 | No |  |
| 2026-05-30 | Orleans | — | TORSE Championship | $600 |  | 1 | No |  |
| 2026-05-30 | S. Point | — | Crazy Pineapple | $120 |  | 1 | No |  |
| 2026-05-30 | S. Point | — | NLH $15K GTD | $120 |  | 1 | No |  |
| 2026-05-30 | S. Point | — | NLH Bounty ($50) $20K GTD | $200 |  | 1 | No |  |
| 2026-05-30 | S. Point | — | O8 Omaha 8/B $15K GTD | $200 |  | 1 | No |  |
| 2026-05-30 | Venetian | 25 | NLH | $600 |  | 1 | No |  |
| 2026-05-30 | Venetian | 26 | NLH Bounty | $400 |  | 1 | No |  |
| 2026-05-31 | Aria | — | HORSE | $600 |  | 1 | No |  |
| 2026-05-31 | Aria | — | NLH | $600 |  | 1 | No |  |
| 2026-05-31 | Aria | — | NLH | $300 |  | 1 | No |  |
| 2026-05-31 | WSOP | 10 | NLH Deepstack | $600 |  | 2 | Yes |  |
| 2026-05-31 | WSOP | 11 | NLH GGMillion$ High Roller | $10,000 | 2 | 4 | Yes | 2 flights |
| 2026-05-31 | WSOP | 12 | NL 2-7 Single Draw | $1,500 |  | 3 | Yes |  |
| 2026-05-31 | Orleans | — | Big O | $240 |  | 1 | No |  |
| 2026-05-31 | Orleans | — | NLH Sunday Special | $300 |  | 1 | No |  |
| 2026-05-31 | S. Point | — | Crazy Pineapple $10K GTD | $120 |  | 1 | No |  |
| 2026-05-31 | S. Point | — | NLH $15K GTD | $120 |  | 1 | No |  |
| 2026-05-31 | S. Point | — | NLH Turbo Bounty ($25) | $120 |  | 1 | No |  |
| 2026-05-31 | S. Point | — | NLH Turbo Bounty ($25) $6K GTD | $120 |  | 1 | No |  |
| 2026-05-31 | Venetian | 27 | NLH Seniors | $800 |  | 1 | No |  |
| 2026-05-31 | Venetian | 28 | PLO | $1,100 |  | 1 | No |  |
| 2026-05-31 | Venetian | 29 | NLH Bounty | $400 |  | 1 | No |  |
| 2026-06-01 | Aria | — | NLH | $800 |  | 1 | No |  |
| 2026-06-01 | Aria | — | NLH | $300 |  | 1 | No |  |
| 2026-06-01 | Aria | — | TORSE | $600 |  | 1 | No |  |
| 2026-06-01 | WSOP | 13 | NLH 6-Max | $1,500 |  | 3 | Yes |  |
| 2026-06-01 | WSOP | 14 | Mixed: PLO8, O8, Big O | $1,500 |  | 3 | Yes |  |
| 2026-06-01 | Orleans | — | NLH Monster Stack | $300 |  | 1 | No |  |
| 2026-06-01 | Orleans | — | NLH Nightly Monster Stack | $200 |  | 1 | No |  |
| 2026-06-01 | Orleans | — | PLO | $240 |  | 1 | No |  |
| 2026-06-01 | S. Point | — | NLH 300K Multiday Day 1 | $300 |  | 1 | No | ⚠ Part of weekly 2-day series; Day 2 Restart unlinked in DB |
| 2026-06-01 | S. Point | — | NLH 300K Multiday Day 1 | $300 |  | 1 | No | ⚠ Part of weekly 2-day series; Day 2 Restart unlinked in DB |
| 2026-06-01 | S. Point | — | NLH Chip Chop Survivor | $120 |  | 1 | No |  |
| 2026-06-01 | S. Point | — | NLH Turbo Bounty ($25) | $120 |  | 1 | No |  |
| 2026-06-01 | Venetian | 30 | NLH | $800 |  | 1 | No |  |
| 2026-06-01 | Venetian | 31 | NLH Bounty | $600 |  | 1 | No |  |
| 2026-06-02 | Aria | — | NLH | $800 |  | 1 | No |  |
| 2026-06-02 | Aria | — | NLH | $300 |  | 1 | No |  |
| 2026-06-02 | WSOP | 15 | PLO Deepstack | $600 |  | 2 | Yes |  |
| 2026-06-02 | WSOP | 16 | NLH U.S. WSOP Circuit Championship | $1,700 |  | 3 | Yes |  |
| 2026-06-02 | WSOP | 17 | NL 2-7 Single Draw Championship | $10,000 |  | 3 | Yes |  |
| 2026-06-02 | Orleans | — | NLH Nightly Monster Stack | $200 |  | 1 | No |  |
| 2026-06-02 | Orleans | — | NLH Super Stack | $200 |  | 1 | No |  |
| 2026-06-02 | Orleans | — | TORSE | $240 |  | 1 | No |  |
| 2026-06-02 | S. Point | — | NLH 300K Multiday Day 1 | $300 |  | 1 | No | ⚠ Part of weekly 2-day series; Day 2 Restart unlinked in DB |
| 2026-06-02 | S. Point | — | NLH 300K Multiday Day 1 | $300 |  | 1 | No | ⚠ Part of weekly 2-day series; Day 2 Restart unlinked in DB |
| 2026-06-02 | S. Point | — | NLH Turbo Bounty ($25) | $120 |  | 1 | No |  |
| 2026-06-02 | S. Point | — | O8 Omaha 8/B | $120 |  | 1 | No |  |
| 2026-06-02 | Venetian | 32 | NLH | $800 |  | 1 | No |  |
| 2026-06-02 | Venetian | 33 | NLH Bounty | $600 |  | 1 | No |  |
| 2026-06-03 | Aria | — | NLH | $300 |  | 1 | No |  |
| 2026-06-03 | Aria | — | PLO | $800 |  | 1 | No |  |
| 2026-06-03 | GN | — | Seniors Open | $300 |  | 1 | No |  |
| 2026-06-03 | GN | 2 | NLH | $200 |  | 1 | No |  |
| 2026-06-03 | GN | 3 | TORSE | $250 |  | 1 | No |  |
| 2026-06-03 | GN | 4 | NLH Turbo | $130 |  | 1 | No |  |
| 2026-06-03 | WSOP | 18 | NLH Monster Stack | $1,500 | 4 | 5 | Yes | 4 flights; Spans 5 days total |
| 2026-06-03 | WSOP | 19 | NLH High Roller | $25,000 | 2 | 4 | Yes | 2 flights |
| 2026-06-03 | WSOP | 20 | Dealer's Choice | $1,500 |  | 3 | Yes |  |
| 2026-06-03 | MGM | 1 | NLH Seniors Warm-Up | $400 |  | 1 | No |  |
| 2026-06-03 | MGM | 2 | NLH Grand Stack | $400 | 3 | 2 | Yes | 3 flights |
| 2026-06-03 | Orleans | — | 1k Bankroll Builder | $125 |  | 1 | No |  |
| 2026-06-03 | Orleans | — | NLH Nightly Monster Stack | $200 |  | 1 | No |  |
| 2026-06-03 | Orleans | — | NLH Super Stack | $200 |  | 1 | No |  |
| 2026-06-03 | Orleans | — | PLO 8-or-Better Championship | $600 |  | 1 | No |  |
| 2026-06-03 | S. Point | — | NLH 300K Multiday Day 1 | $300 |  | 1 | No | ⚠ Part of weekly 2-day series; Day 2 Restart unlinked in DB |
| 2026-06-03 | S. Point | — | NLH 300K Multiday Day 1 | $300 |  | 1 | No | ⚠ Part of weekly 2-day series; Day 2 Restart unlinked in DB |
| 2026-06-03 | Venetian | 34 | NLH | $800 |  | 1 | No |  |
| 2026-06-03 | Venetian | 35 | Big O Bounty | $1,100 |  | 1 | No |  |
| 2026-06-04 | Aria | — | NLH | $300 |  | 1 | No |  |
| 2026-06-04 | Aria | — | NLH Seniors | $800 |  | 1 | No |  |
| 2026-06-04 | GN | 5 | NLH | $200 |  | 1 | No |  |
| 2026-06-04 | GN | 6 | PLO Championship | $500 |  | 1 | No |  |
| 2026-06-04 | GN | 7 | NLH | $150 |  | 1 | No |  |
| 2026-06-04 | GN | 8 | NLH Turbo | $130 |  | 1 | No |  |
| 2026-06-04 | WSOP | 21 | PLO8 | $1,500 |  | 3 | Yes |  |
| 2026-06-04 | Orleans | — | NLH Mega Stack | $400 |  | 1 | No |  |
| 2026-06-04 | Orleans | — | NLH Nightly Monster Stack | $200 |  | 1 | No |  |
| 2026-06-04 | Orleans | — | TOE | $240 |  | 1 | No |  |
| 2026-06-04 | Orleans | — | Triple Stud Championship | $600 |  | 1 | No |  |
| 2026-06-04 | S. Point | — | NLH $15K GTD | $120 |  | 1 | No |  |
| 2026-06-04 | S. Point | — | NLH Deepstack $20K GTD | $200 |  | 1 | No |  |
| 2026-06-04 | S. Point | — | NLH Turbo Bounty ($25) | $120 |  | 1 | No |  |
| 2026-06-04 | Venetian | 36 | NLH | $800 | 4 | 2 | Yes | 4 flights |
| 2026-06-05 | Aria | — | NLH | $600 |  | 1 | No |  |
| 2026-06-05 | Aria | — | NLH | $300 |  | 1 | No |  |
| 2026-06-05 | GN | 9 | NLH | $200 |  | 1 | No |  |
| 2026-06-05 | GN | 10 | Stud 8 / PLO8 Championship | $500 |  | 1 | No |  |
| 2026-06-05 | GN | 11 | NLH | $150 |  | 1 | No |  |
| 2026-06-05 | GN | 12 | NLH Turbo | $130 |  | 1 | No |  |
| 2026-06-05 | WSOP | 22 | Big O | $1,500 | 2 | 3 | Yes | 2 flights |
| 2026-06-05 | WSOP | 23 | 7-Card Stud Championship | $10,000 |  | 3 | Yes |  |
| 2026-06-05 | MGM | 3 | Big O/PLO8 | $300 |  | 1 | No |  |
| 2026-06-05 | MGM | 4 | NLH $100 Rebuys/Addons | $160 |  | 1 | No |  |
| 2026-06-05 | Orleans | — | 7 Game Draw Mix Championship | $600 |  | 1 | No |  |
| 2026-06-05 | Orleans | — | NLH Friday Special Monster Stack | $200 |  | 1 | No |  |
| 2026-06-05 | Orleans | — | NLH Monster Stack | $300 |  | 1 | No |  |
| 2026-06-05 | S. Point | — | Crazy Pineapple | $120 |  | 1 | No |  |
| 2026-06-05 | S. Point | — | NLH $15K GTD | $120 |  | 1 | No |  |
| 2026-06-05 | S. Point | — | NLH Deepstack $20K GTD | $200 |  | 1 | No |  |
| 2026-06-05 | S. Point | — | NLH Turbo Bounty ($25) | $120 |  | 1 | No |  |
| 2026-06-06 | Aria | — | NLH | $600 |  | 1 | No |  |
| 2026-06-06 | Aria | — | NLH | $300 |  | 1 | No |  |
| 2026-06-06 | GN | 13 | NLH Golden Saturday | $200 |  | 1 | No |  |
| 2026-06-06 | GN | 14 | PLO | $400 |  | 1 | No |  |
| 2026-06-06 | GN | 15 | NLH | $150 |  | 1 | No |  |
| 2026-06-06 | GN | 16 | NLH Turbo | $130 |  | 1 | No |  |
| 2026-06-06 | WSOP | 24 | NLH High Roller 6-Max | $25,000 |  | 3 | Yes |  |
| 2026-06-06 | MGM | 5 | NLH Big Monster Stack | $400 |  | 1 | No |  |
| 2026-06-06 | MGM | 6 | NLH Mystery Ticket | $500 | 5 | 2 | Yes | 5 flights |
| 2026-06-06 | Orleans | — | NLH Mega Stack | $400 |  | 1 | No |  |
| 2026-06-06 | Orleans | — | NLH Nightly Monster Stack | $200 |  | 1 | No |  |
| 2026-06-06 | Orleans | — | TOE Championship | $600 |  | 1 | No |  |
| 2026-06-06 | Orleans | — | Triple Triple Draw | $240 |  | 1 | No |  |
| 2026-06-06 | S. Point | — | Crazy Pineapple | $120 |  | 1 | No |  |
| 2026-06-06 | S. Point | — | NLH $15K GTD | $120 |  | 1 | No |  |
| 2026-06-06 | S. Point | — | NLH Bounty ($50) $20K GTD | $200 |  | 1 | No |  |
| 2026-06-06 | S. Point | — | O8 Omaha 8/B $15K GTD | $200 |  | 1 | No |  |
| 2026-06-06 | Venetian | 37 | NLH | $1,100 | 4 | 2 | Yes | 4 flights |
| 2026-06-06 | Venetian | 38 | NLH Bounty | $600 |  | 1 | No |  |
| 2026-06-07 | Aria | — | Limit Hold'em | $600 |  | 1 | No |  |
| 2026-06-07 | Aria | — | NLH | $800 |  | 1 | No |  |
| 2026-06-07 | Aria | — | NLH | $300 |  | 1 | No |  |
| 2026-06-07 | GN | 17 | NLH | $200 |  | 1 | No |  |
| 2026-06-07 | GN | 18 | HORSE Championship | $500 |  | 1 | No |  |
| 2026-06-07 | GN | 19 | NLH | $150 |  | 1 | No |  |
| 2026-06-07 | GN | 20 | NLH Bar Poker Open Golden Nugget 10 Year Anniversary Nightly | $150 |  | 1 | No |  |
| 2026-06-07 | GN | 21 | NLH Late Night Survivor Turbo | $120 |  | 1 | No |  |
| 2026-06-07 | WSOP | 25 | NLH Freezeout | $500 |  | 2 | Yes |  |
| 2026-06-07 | WSOP | 26 | NLH | $2,000 |  | 3 | Yes |  |
| 2026-06-07 | WSOP | 27 | Dealer's Choice Championship | $10,000 |  | 3 | Yes |  |
| 2026-06-07 | Orleans | — | Big O | $240 |  | 1 | No |  |
| 2026-06-07 | Orleans | — | NLH Sunday Special | $300 |  | 1 | No |  |
| 2026-06-07 | S. Point | — | Crazy Pineapple $10K GTD | $120 |  | 1 | No |  |
| 2026-06-07 | S. Point | — | NLH $15K GTD | $120 |  | 1 | No |  |
| 2026-06-07 | S. Point | — | NLH Turbo Bounty ($25) | $120 |  | 1 | No |  |
| 2026-06-07 | S. Point | — | NLH Turbo Bounty ($25) $6K GTD | $120 |  | 1 | No |  |
| 2026-06-07 | Venetian | 39 | PLO Bounty | $800 |  | 1 | No |  |
| 2026-06-08 | Aria | — | NLH | $300 |  | 1 | No |  |
| 2026-06-08 | Aria | — | NLH Mystery Bounty | $1,100 |  | 2 | Yes |  |
| 2026-06-08 | Aria | — | TOE | $600 |  | 1 | No |  |
| 2026-06-08 | GN | 22-A1 | Bar Poker Open Championship | ? |  | 3 | Yes |  |
| 2026-06-08 | GN | 22-A2 | Bar Poker Open Championship | ? |  | 3 | Yes |  |
| 2026-06-08 | GN | 23 | NLH Turbo | $130 |  | 1 | No |  |
| 2026-06-08 | GN | 24 | NLH Late Night Survivor Turbo | $120 |  | 1 | No |  |
| 2026-06-08 | WSOP | 28 | NLH / PLO Mixed Deepstack | $600 |  | 2 | Yes |  |
| 2026-06-08 | WSOP | 29 | NLH High Roller | $50,000 |  | 3 | Yes |  |
| 2026-06-08 | WSOP | 30 | Limit Hold'em | $1,500 |  | 3 | Yes |  |
| 2026-06-08 | Orleans | — | 1k Bankroll Builder | $125 |  | 1 | No |  |
| 2026-06-08 | Orleans | — | Mixed BEAST Championship | $600 |  | 1 | No |  |
| 2026-06-08 | Orleans | — | NLH Nightly Monster Stack | $200 |  | 1 | No |  |
| 2026-06-08 | Orleans | — | NLH Super Stack | $200 |  | 1 | No |  |
| 2026-06-08 | S. Point | — | NLH 300K Multiday Day 1 | $300 |  | 1 | No | ⚠ Part of weekly 2-day series; Day 2 Restart unlinked in DB |
| 2026-06-08 | S. Point | — | NLH 300K Multiday Day 1 | $300 |  | 1 | No | ⚠ Part of weekly 2-day series; Day 2 Restart unlinked in DB |
| 2026-06-08 | S. Point | — | NLH Chip Chop Survivor | $120 |  | 1 | No |  |
| 2026-06-08 | S. Point | — | NLH Turbo Bounty ($25) | $120 |  | 1 | No |  |
| 2026-06-08 | Venetian | 40 | NLH Bounty | $600 |  | 1 | No |  |
| 2026-06-09 | Aria | — | NLH | $300 |  | 1 | No |  |
| 2026-06-09 | Aria | — | PLO | $1,100 |  | 1 | No |  |
| 2026-06-09 | GN | 22-B | Bar Poker Open Championship | ? |  | 3 | Yes |  |
| 2026-06-09 | GN | 25 | NLH | $200 |  | 1 | No |  |
| 2026-06-09 | GN | 26 | NLH Tag Team | $250 |  | 1 | No |  |
| 2026-06-09 | GN | 27 | NLH Late Night Survivor Turbo | $120 |  | 1 | No |  |
| 2026-06-09 | WSOP | 31 | NLH Super Turbo Bounty | $1,500 |  | 1 | No |  |
| 2026-06-09 | WSOP | 32 | NLH | $3,000 |  | 4 | Yes |  |
| 2026-06-09 | WSOP | 33 | PLO8 Championship | $10,000 |  | 4 | Yes |  |
| 2026-06-09 | MGM | 7 | NLH Grand Stack | $400 | 2 | 2 | Yes | 2 flights |
| 2026-06-09 | Orleans | — | HORSE | $240 |  | 1 | No |  |
| 2026-06-09 | Orleans | — | NLH Monster Stack | $300 |  | 1 | No |  |
| 2026-06-09 | Orleans | — | NLH Nightly Monster Stack | $200 |  | 1 | No |  |
| 2026-06-09 | S. Point | — | NLH 300K Multiday Day 1 | $300 |  | 1 | No | ⚠ Part of weekly 2-day series; Day 2 Restart unlinked in DB |
| 2026-06-09 | S. Point | — | NLH 300K Multiday Day 1 | $300 |  | 1 | No | ⚠ Part of weekly 2-day series; Day 2 Restart unlinked in DB |
| 2026-06-09 | S. Point | — | NLH Turbo Bounty ($25) | $120 |  | 1 | No |  |
| 2026-06-09 | S. Point | — | O8 Omaha 8/B | $120 |  | 1 | No |  |
| 2026-06-09 | Venetian | 41 | NLH Bounty | $600 |  | 1 | No |  |
| 2026-06-10 | Aria | — | NLH | $800 |  | 1 | No |  |
| 2026-06-10 | Aria | — | NLH | $300 |  | 1 | No |  |
| 2026-06-10 | GN | 28 | NLH | $200 |  | 1 | No |  |
| 2026-06-10 | GN | 29 | NLH Turbo | $130 |  | 1 | No |  |
| 2026-06-10 | GN | 30 | NLH Late Night Survivor Turbo | $120 |  | 1 | No |  |
| 2026-06-10 | WSOP | 34 | NLH Colossus | $500 | 3 | 4 | Yes | 3 flights |
| 2026-06-10 | WSOP | 35 | PLO | $1,500 | 2 | 3 | Yes | 2 flights |
| 2026-06-10 | WSOP | 36 | NLH High Roller | $100,000 |  | 3 | Yes |  |
| 2026-06-10 | WSOP | 37 | HORSE | $1,500 |  | 3 | Yes |  |
| 2026-06-10 | MGM | 8 | PLO Black Chip Bounty | $400 |  | 1 | No |  |
| 2026-06-10 | MGM | 9 | PLO8 Nightly | $250 |  | 1 | No |  |
| 2026-06-10 | Orleans | — | Mixed Omaha-8/Stud-8 | $240 |  | 1 | No |  |
| 2026-06-10 | Orleans | — | NLH Nightly Monster Stack | $200 |  | 1 | No |  |
| 2026-06-10 | Orleans | — | NLH Super Stack | $200 |  | 1 | No |  |
| 2026-06-10 | S. Point | — | NLH 300K Multiday Day 1 | $300 |  | 1 | No | ⚠ Part of weekly 2-day series; Day 2 Restart unlinked in DB |
| 2026-06-10 | S. Point | — | NLH 300K Multiday Day 1 | $300 |  | 1 | No | ⚠ Part of weekly 2-day series; Day 2 Restart unlinked in DB |
| 2026-06-10 | Venetian | 42 | NLH | $800 |  | 1 | No |  |
| 2026-06-10 | Venetian | 43 | NLH Bounty | $600 |  | 1 | No |  |
| 2026-06-11 | Aria | — | NLH | $1,600 |  | 1 | No |  |
| 2026-06-11 | Aria | — | NLH | $300 |  | 1 | No |  |
| 2026-06-11 | Aria | — | NLH Turbo Satellite | $240 |  | 1 | No |  |
| 2026-06-11 | GN | 31 | NLH | $200 |  | 1 | No |  |
| 2026-06-11 | GN | 32 | Mixed Triple Draw Lowball Limit (2-7, A-5, Badugi) | $400 |  | 1 | No |  |
| 2026-06-11 | GN | 33 | NLH Green Chip Bounty | $150 |  | 1 | No |  |
| 2026-06-11 | GN | 34 | NLH Late Night Survivor Turbo | $120 |  | 1 | No |  |
| 2026-06-11 | WSOP | 38 | Limit Hold'em Championship | $10,000 |  | 3 | Yes |  |
| 2026-06-11 | MGM | 10 | NLH Grand Stack | $400 |  | 1 | No |  |
| 2026-06-11 | MGM | 11 | Big O Nightly | $250 |  | 1 | No |  |
| 2026-06-11 | Orleans | — | NLH Mega Stack | $400 |  | 1 | No |  |
| 2026-06-11 | Orleans | — | NLH Nightly Monster Stack | $200 |  | 1 | No |  |
| 2026-06-11 | Orleans | — | PLO | $240 |  | 1 | No |  |
| 2026-06-11 | Orleans | — | Razz Championship | $600 |  | 1 | No |  |
| 2026-06-11 | S. Point | — | NLH $15K GTD | $120 |  | 1 | No |  |
| 2026-06-11 | S. Point | — | NLH Deepstack $20K GTD | $200 |  | 1 | No |  |
| 2026-06-11 | S. Point | — | NLH Turbo Bounty ($25) | $120 |  | 1 | No |  |
| 2026-06-11 | Venetian | 44 | NLH Seniors | $1,100 | 3 | 2 | Yes | 3 flights |
| 2026-06-11 | Venetian | 45 | NLH Bounty | $600 |  | 1 | No |  |
| 2026-06-12 | Aria | — | NLH | $1,600 |  | 1 | No |  |
| 2026-06-12 | Aria | — | NLH | $300 |  | 1 | No |  |
| 2026-06-12 | Aria | — | NLH Turbo Satellite | $240 |  | 1 | No |  |
| 2026-06-12 | GN | 35 | NLH | $200 |  | 1 | No |  |
| 2026-06-12 | GN | 36 | 8-Game Mix Championship (NLH; Stud; Omaha/8; Razz; PLO; LH; Stud/8; 2-7) | $500 |  | 1 | No |  |
| 2026-06-12 | GN | 37 | Mixed Triple Draw Lowball Limit (2-7, A-5, Badugi) | $250 |  | 1 | No |  |
| 2026-06-12 | GN | 38 | NLH Turbo | $130 |  | 1 | No |  |
| 2026-06-12 | WSOP | 39 | NLH Seniors High Roller | $5,000 |  | 4 | Yes |  |
| 2026-06-12 | WSOP | 40 | Razz | $1,500 |  | 3 | Yes |  |
| 2026-06-12 | MGM | 12 | NLH Mystery Bounty | $400 |  | 1 | No |  |
| 2026-06-12 | MGM | 13 | PLO8 Nightly | $250 |  | 1 | No |  |
| 2026-06-12 | Orleans | — | Mixed Dramaha Mix | $240 |  | 1 | No |  |
| 2026-06-12 | Orleans | — | NLH Friday Special Monster Stack | $200 |  | 1 | No |  |
| 2026-06-12 | Orleans | — | NLH Mega Stack | $400 |  | 1 | No |  |
| 2026-06-12 | S. Point | — | NLH $15K GTD | $120 |  | 1 | No |  |
| 2026-06-12 | S. Point | — | NLH Deepstack $20K GTD | $200 |  | 1 | No |  |
| 2026-06-12 | S. Point | — | NLH Turbo Bounty ($25) | $120 |  | 1 | No |  |
| 2026-06-12 | Venetian | 46 | NLH Bounty | $600 |  | 1 | No |  |
| 2026-06-13 | Aria | — | BetMGM NLH Satellite | $160 |  | 1 | No |  |
| 2026-06-13 | Aria | — | PLO BetMGM | $1,100 |  | 1 | No |  |
| 2026-06-13 | GN | 39 | NLH Golden Saturday | $200 |  | 1 | No |  |
| 2026-06-13 | GN | 40 | TORSE Championship | $500 |  | 1 | No |  |
| 2026-06-13 | GN | 41 | NLH | $150 |  | 1 | No |  |
| 2026-06-13 | GN | 42 | NLH Turbo | $130 |  | 1 | No |  |
| 2026-06-13 | WSOP | 41 | NLH Super High Roller | $250,000 |  | 3 | Yes |  |
| 2026-06-13 | WSOP | 42 | Big O Championship | $10,000 |  | 4 | Yes |  |
| 2026-06-13 | MGM | 14 | PLO Double Board Bomb Pot | $300 |  | 1 | No |  |
| 2026-06-13 | MGM | 15 | NLH SUPER Stack | $500 | 5 | 2 | Yes | 5 flights |
| 2026-06-13 | Orleans | — | Big O | $240 |  | 1 | No |  |
| 2026-06-13 | Orleans | — | NLH Nightly Monster Stack | $200 |  | 1 | No |  |
| 2026-06-13 | Orleans | — | NLH Senior's Championship 50+ | $600 |  | 1 | No |  |
| 2026-06-13 | Orleans | — | NLH Super Stack | $200 |  | 1 | No |  |
| 2026-06-13 | S. Point | — | Crazy Pineapple | $120 |  | 1 | No |  |
| 2026-06-13 | S. Point | — | NLH $15K GTD | $120 |  | 1 | No |  |
| 2026-06-13 | S. Point | — | NLH Bounty ($50) $20K GTD | $200 |  | 1 | No |  |
| 2026-06-13 | S. Point | — | O8 Omaha 8/B $15K GTD | $200 |  | 1 | No |  |
| 2026-06-13 | Venetian | 47 | NLH Bounty | $600 |  | 1 | No |  |
| 2026-06-14 | Aria | — | BetMGM NLH Satellite | $240 |  | 1 | No |  |
| 2026-06-14 | Aria | — | BetMGM NLH Turbo Satellite | $160 |  | 1 | No |  |
| 2026-06-14 | Aria | — | NLH BetMGM Mystery Bounty | $1,100 |  | 1 | No |  |
| 2026-06-14 | GN | 43 | Seniors Championship | $500 |  | 1 | No |  |
| 2026-06-14 | GN | 44 | 5-Card PLO / Big O | $400 |  | 1 | No |  |
| 2026-06-14 | GN | 45 | NLH | $150 |  | 1 | No |  |
| 2026-06-14 | GN | 46 | NLH Turbo | $130 |  | 1 | No |  |
| 2026-06-14 | WSOP | 43 | NLH Deepstack 8-Max | $800 |  | 2 | Yes |  |
| 2026-06-14 | WSOP | 44 | NLH Super Turbo Bounty | $10,000 |  | 1 | No |  |
| 2026-06-14 | WSOP | 45 | Mixed O8, Stud 8 | $2,500 |  | 3 | Yes |  |
| 2026-06-14 | Orleans | — | NLH Sunday Special | $300 |  | 1 | No |  |
| 2026-06-14 | Orleans | — | PLO | $240 |  | 1 | No |  |
| 2026-06-14 | S. Point | — | Crazy Pineapple $10K GTD | $120 |  | 1 | No |  |
| 2026-06-14 | S. Point | — | NLH $15K GTD | $120 |  | 1 | No |  |
| 2026-06-14 | S. Point | — | NLH Turbo Bounty ($25) | $120 |  | 1 | No |  |
| 2026-06-14 | S. Point | — | NLH Turbo Bounty ($25) $6K GTD | $120 |  | 1 | No |  |
| 2026-06-14 | Venetian | 48 | NLH | $1,100 |  | 1 | No |  |
| 2026-06-14 | Venetian | 49 | 5-Card PLO | $800 |  | 1 | No |  |
| 2026-06-15 | Aria | — | BetMGM NLH Turbo Satellite | $240 |  | 1 | No |  |
| 2026-06-15 | Aria | — | NLH | $300 |  | 1 | No |  |
| 2026-06-15 | Aria | — | NLH BetMGM | $1,600 |  | 1 | No |  |
| 2026-06-15 | WSOP | 46 | NLH Seniors Championship | $1,000 | 2 | 5 | Yes | 2 flights; Spans 5 days total |
| 2026-06-15 | WSOP | 47 | PLO High Roller | $25,000 | 2 | 4 | Yes | 2 flights |
| 2026-06-15 | WSOP | 48 | Razz Championship | $10,000 |  | 3 | Yes |  |
| 2026-06-15 | Orleans | — | HORSE | $240 |  | 1 | No |  |
| 2026-06-15 | Orleans | — | Mixed Omaha-8/Stud-8 Championship | $600 |  | 1 | No |  |
| 2026-06-15 | Orleans | — | NLH Mega Stack | $400 |  | 1 | No |  |
| 2026-06-15 | Orleans | — | NLH Nightly Monster Stack | $200 |  | 1 | No |  |
| 2026-06-15 | S. Point | — | NLH 300K Multiday Day 1 | $300 |  | 1 | No | ⚠ Part of weekly 2-day series; Day 2 Restart unlinked in DB |
| 2026-06-15 | S. Point | — | NLH 300K Multiday Day 1 | $300 |  | 1 | No | ⚠ Part of weekly 2-day series; Day 2 Restart unlinked in DB |
| 2026-06-15 | S. Point | — | NLH Chip Chop Survivor | $120 |  | 1 | No |  |
| 2026-06-15 | S. Point | — | NLH Turbo Bounty ($25) | $120 |  | 1 | No |  |
| 2026-06-15 | Venetian | 50 | NLH Bounty | $800 |  | 1 | No |  |
| 2026-06-15 | Venetian | 51 | PLO Bounty | $1,100 |  | 1 | No |  |
| 2026-06-16 | Aria | — | HORSE | $800 |  | 1 | No |  |
| 2026-06-16 | Aria | — | NLH | $800 |  | 1 | No |  |
| 2026-06-16 | Aria | — | NLH | $300 |  | 1 | No |  |
| 2026-06-16 | GN | 48-A | NLH Gulf Coast Poker Tour Rookies & Recs Championship | $420 |  | 1 | No |  |
| 2026-06-16 | GN | 49 | PLO8 Championship | $500 |  | 1 | No |  |
| 2026-06-16 | GN | 50 | NLH | $200 |  | 1 | No |  |
| 2026-06-16 | GN | 51 | NLH Gulf Coast Poker Tour Night Owl | $420 |  | 1 | No |  |
| 2026-06-16 | WSOP | 49 | NLH Freezeout | $2,500 |  | 3 | Yes |  |
| 2026-06-16 | MGM | 16 | NLH Grand Stack | $400 | 2 | 2 | Yes | 2 flights |
| 2026-06-16 | Orleans | — | Mixed Limits 2-7 Championship | $600 |  | 1 | No |  |
| 2026-06-16 | Orleans | — | NLH Monster Stack | $300 |  | 1 | No |  |
| 2026-06-16 | Orleans | — | NLH Nightly Monster Stack | $200 |  | 1 | No |  |
| 2026-06-16 | Orleans | — | TOE | $240 |  | 1 | No |  |
| 2026-06-16 | S. Point | — | NLH 300K Multiday Day 1 | $300 |  | 1 | No | ⚠ Part of weekly 2-day series; Day 2 Restart unlinked in DB |
| 2026-06-16 | S. Point | — | NLH 300K Multiday Day 1 | $300 |  | 1 | No | ⚠ Part of weekly 2-day series; Day 2 Restart unlinked in DB |
| 2026-06-16 | S. Point | — | NLH Turbo Bounty ($25) | $120 |  | 1 | No |  |
| 2026-06-16 | S. Point | — | O8 Omaha 8/B | $120 |  | 1 | No |  |
| 2026-06-16 | Venetian | 52 | NLH | $800 |  | 1 | No |  |
| 2026-06-16 | Venetian | 53 | NLH Bounty | $600 |  | 1 | No |  |
| 2026-06-17 | Aria | — | 5-Card PLO | $1,100 |  | 1 | No |  |
| 2026-06-17 | Aria | — | NLH | $800 |  | 1 | No |  |
| 2026-06-17 | Aria | — | NLH Satellite | $300 |  | 1 | No |  |
| 2026-06-17 | GN | 48-B | NLH Gulf Coast Poker Tour Rookies & Recs Championship | $420 |  | 1 | No |  |
| 2026-06-17 | GN | 52 | 7-Card Stud Triple Stud | $400 |  | 1 | No |  |
| 2026-06-17 | GN | 53 | NLH | $200 |  | 1 | No |  |
| 2026-06-17 | GN | 54-A | NLH Gulf Coast Poker Tour Golden Event | $720 |  | 1 | No |  |
| 2026-06-17 | GN | 55 | NLH Turbo | $130 |  | 1 | No |  |
| 2026-06-17 | WSOP | 50 | NLH Millionaire Maker | $1,500 | 4 | 5 | Yes | 4 flights; Spans 5 days total |
| 2026-06-17 | WSOP | 51 | NLH Mystery Bounty | $10,000 |  | 3 | Yes |  |
| 2026-06-17 | WSOP | 52 | 9-Game Mix | $3,000 |  | 3 | Yes |  |
| 2026-06-17 | MGM | 17 | NLH Grand Stack | $400 |  | 1 | No |  |
| 2026-06-17 | MGM | 18 | NLH $100 Rebuys/Addons | $160 |  | 1 | No |  |
| 2026-06-17 | Orleans | — | Big O PL -O | $240 |  | 1 | No |  |
| 2026-06-17 | Orleans | — | NLH Nightly Monster Stack | $200 |  | 1 | No |  |
| 2026-06-17 | Orleans | — | NLH Super Stack | $200 |  | 1 | No |  |
| 2026-06-17 | S. Point | — | NLH 300K Multiday Day 1 | $300 |  | 1 | No | ⚠ Part of weekly 2-day series; Day 2 Restart unlinked in DB |
| 2026-06-17 | S. Point | — | NLH 300K Multiday Day 1 | $300 |  | 1 | No | ⚠ Part of weekly 2-day series; Day 2 Restart unlinked in DB |
| 2026-06-17 | Venetian | 54 | NLH | $1,100 |  | 1 | No |  |
| 2026-06-17 | Venetian | 55 | NLH Bounty | $600 |  | 1 | No |  |
| 2026-06-18 | Aria | — | NLH | $300 |  | 1 | No |  |
| 2026-06-18 | Aria | — | NLH Mystery Bounty | $2,200 |  | 2 | Yes |  |
| 2026-06-18 | Aria | — | NLH Turbo Satellite | $300 |  | 1 | No |  |
| 2026-06-18 | GN | 54-B | NLH Gulf Coast Poker Tour Golden Event | $720 |  | 1 | No |  |
| 2026-06-18 | GN | 54-C | NLH Gulf Coast Poker Tour Golden Event | $720 |  | 1 | No |  |
| 2026-06-18 | GN | 56 | NLH | $200 |  | 1 | No |  |
| 2026-06-18 | GN | 57 | NLH Turbo | $130 |  | 1 | No |  |
| 2026-06-18 | WSOP | 53 | 5-Card PLO | $1,500 |  | 3 | Yes |  |
| 2026-06-18 | WSOP | 54 | HORSE Championship | $10,000 |  | 4 | Yes |  |
| 2026-06-18 | MGM | 19 | NLH Grand Stack | $400 | 2 | 2 | Yes | 2 flights |
| 2026-06-18 | Orleans | — | NLH Monster Stack | $300 |  | 1 | No |  |
| 2026-06-18 | Orleans | — | NLH Monster Stack | $200 |  | 1 | No |  |
| 2026-06-18 | Orleans | — | O8 | $400 |  | 1 | No |  |
| 2026-06-18 | Orleans | — | Triple Stud | $240 |  | 1 | No |  |
| 2026-06-18 | S. Point | — | NLH $15K GTD | $120 |  | 1 | No |  |
| 2026-06-18 | S. Point | — | NLH Deepstack $20K GTD | $200 |  | 1 | No |  |
| 2026-06-18 | S. Point | — | NLH Turbo Bounty ($25) | $120 |  | 1 | No |  |
| 2026-06-18 | Venetian | 56 | NLH | $1,100 |  | 1 | No |  |
| 2026-06-18 | Venetian | 57 | NLH Bounty | $600 |  | 1 | No |  |
| 2026-06-19 | Aria | — | NLH | $800 |  | 1 | No |  |
| 2026-06-19 | Aria | — | NLH | $300 |  | 1 | No |  |
| 2026-06-19 | GN | 54-D | NLH Gulf Coast Poker Tour Golden Event | $720 |  | 1 | No |  |
| 2026-06-19 | GN | 54-E | NLH Gulf Coast Poker Tour Golden Event | $720 |  | 1 | No |  |
| 2026-06-19 | GN | 58 | 7-Card Stud Triple Stud Championship | $500 |  | 1 | No |  |
| 2026-06-19 | GN | 59 | NLH | $200 |  | 1 | No |  |
| 2026-06-19 | GN | 60 | NLH Turbo | $130 |  | 1 | No |  |
| 2026-06-19 | WSOP | 55 | PLO High Roller | $50,000 |  | 3 | Yes |  |
| 2026-06-19 | WSOP | 56 | NLH 6-Max | $3,000 |  | 2 | Yes |  |
| 2026-06-19 | MGM | 20 | NLH Grand Stack | $400 |  | 1 | No |  |
| 2026-06-19 | MGM | 21 | PLO8 Nightly | $250 |  | 1 | No |  |
| 2026-06-19 | Orleans | — | Ladies Championship | $600 |  | 1 | No |  |
| 2026-06-19 | Orleans | — | NLH Friday Special Monster Stack | $200 |  | 1 | No |  |
| 2026-06-19 | Orleans | — | NLH Monster Stack | $300 |  | 1 | No |  |
| 2026-06-19 | S. Point | — | Crazy Pineapple | $120 |  | 1 | No |  |
| 2026-06-19 | S. Point | — | NLH $15K GTD | $120 |  | 1 | No |  |
| 2026-06-19 | S. Point | — | NLH Deepstack $20K GTD | $200 |  | 1 | No |  |
| 2026-06-19 | S. Point | — | NLH Turbo Bounty ($25) | $120 |  | 1 | No |  |
| 2026-06-19 | Venetian | 58 | NLH Seniors | $1,600 | 3 | 2 | Yes | 3 flights |
| 2026-06-19 | Venetian | 59 | PLO | $1,100 |  | 1 | No |  |
| 2026-06-20 | Aria | — | NLH | $800 |  | 1 | No |  |
| 2026-06-20 | Aria | — | NLH | $300 |  | 1 | No |  |
| 2026-06-20 | GN | 61 | NLH Gulf Coast Poker Tour International Tour Challenge | $420 |  | 1 | No |  |
| 2026-06-20 | GN | 62 | NLH | $200 |  | 1 | No |  |
| 2026-06-20 | GN | 63 | NLH Gulf Coast Poker Tour Tag Team | $620 |  | 1 | No |  |
| 2026-06-20 | GN | 64 | NLH Turbo | $130 |  | 1 | No |  |
| 2026-06-20 | WSOP | 57 | PLO | $1,000 | 3 | 3 | Yes | 3 flights |
| 2026-06-20 | WSOP | 58 | 2-7 Triple Draw | $1,500 |  | 3 | Yes |  |
| 2026-06-20 | MGM | 22 | Ladies | $250 |  | 1 | No |  |
| 2026-06-20 | MGM | 23 | NLH SUPER Stack Mystery Bounty | $500 | 5 | 2 | Yes | 5 flights |
| 2026-06-20 | Orleans | — | NLH Mega Stack | $400 |  | 1 | No |  |
| 2026-06-20 | Orleans | — | NLH Nightly Monster Stack | $200 |  | 1 | No |  |
| 2026-06-20 | Orleans | — | TORSE | $400 |  | 1 | No |  |
| 2026-06-20 | Orleans | — | Triple Triple Draw | $240 |  | 1 | No |  |
| 2026-06-20 | S. Point | — | Crazy Pineapple | $120 |  | 1 | No |  |
| 2026-06-20 | S. Point | — | NLH $15K GTD | $120 |  | 1 | No |  |
| 2026-06-20 | S. Point | — | NLH Bounty ($50) $20K GTD | $200 |  | 1 | No |  |
| 2026-06-20 | S. Point | — | O8 Omaha 8/B $15K GTD | $200 |  | 1 | No |  |
| 2026-06-20 | Venetian | 60 | NLH Bounty | $600 |  | 1 | No |  |
| 2026-06-21 | Aria | — | NLH | $1,600 |  | 1 | No |  |
| 2026-06-21 | Aria | — | NLH | $300 |  | 1 | No |  |
| 2026-06-21 | Aria | — | NLH Turbo Satellite | $240 |  | 1 | No |  |
| 2026-06-21 | GN | 65 | Ladies | $300 |  | 1 | No |  |
| 2026-06-21 | GN | 66 | Mixed S.O.R.B.E.T (Stud; Omaha/8; Razz; Badugi; Stud/8; 2-7) | $400 |  | 1 | No |  |
| 2026-06-21 | GN | 67 | NLH | $200 |  | 1 | No |  |
| 2026-06-21 | GN | 68 | NLH | $150 |  | 1 | No |  |
| 2026-06-21 | GN | 69 | NLH Turbo | $130 |  | 1 | No |  |
| 2026-06-21 | WSOP | 59 | NLH Salute To Warriors | $500 |  | 3 | Yes |  |
| 2026-06-21 | WSOP | 60 | Poker Players Championship | $50,000 |  | 5 | Yes | Spans 5 days total |
| 2026-06-21 | Orleans | — | Big O | $240 |  | 1 | No |  |
| 2026-06-21 | Orleans | — | NLH Sunday Special | $300 |  | 1 | No |  |
| 2026-06-21 | S. Point | — | Crazy Pineapple $10K GTD | $120 |  | 1 | No |  |
| 2026-06-21 | S. Point | — | NLH $15K GTD | $120 |  | 1 | No |  |
| 2026-06-21 | S. Point | — | NLH Turbo Bounty ($25) | $120 |  | 1 | No |  |
| 2026-06-21 | S. Point | — | NLH Turbo Bounty ($25) $6K GTD | $120 |  | 1 | No |  |
| 2026-06-21 | Venetian | 61 | NLH Bounty | $600 |  | 1 | No |  |
| 2026-06-22 | Aria | — | NLH | $1,100 |  | 1 | No |  |
| 2026-06-22 | Aria | — | NLH | $300 |  | 1 | No |  |
| 2026-06-22 | Aria | — | O8/Stud 8 | $800 |  | 1 | No |  |
| 2026-06-22 | WSOP | 61 | NLH Super Seniors | $1,000 |  | 4 | Yes |  |
| 2026-06-22 | WSOP | 62 | NLH | $2,500 |  | 3 | Yes |  |
| 2026-06-22 | Orleans | — | HORSE | $240 |  | 1 | No |  |
| 2026-06-22 | Orleans | — | Mixed 11 Game Main Event | $1,100 |  | 2 | Yes |  |
| 2026-06-22 | Orleans | — | NLH Mega Stack | $400 |  | 1 | No |  |
| 2026-06-22 | Orleans | — | NLH Nightly Monster Stack | $200 |  | 1 | No |  |
| 2026-06-22 | S. Point | — | NLH 300K Multiday Day 1 | $300 |  | 1 | No | ⚠ Part of weekly 2-day series; Day 2 Restart unlinked in DB |
| 2026-06-22 | S. Point | — | NLH 300K Multiday Day 1 | $300 |  | 1 | No | ⚠ Part of weekly 2-day series; Day 2 Restart unlinked in DB |
| 2026-06-22 | S. Point | — | NLH Chip Chop Survivor | $120 |  | 1 | No |  |
| 2026-06-22 | S. Point | — | NLH Turbo Bounty ($25) | $120 |  | 1 | No |  |
| 2026-06-22 | Venetian | 62 | NLH | $1,600 |  | 1 | No |  |
| 2026-06-22 | Venetian | 63 | NLH Bounty | $600 |  | 1 | No |  |
| 2026-06-23 | Aria | — | NLH | $300 |  | 1 | No |  |
| 2026-06-23 | Aria | — | NLH Ladies Mystery Bounty | $800 |  | 1 | No |  |
| 2026-06-23 | Aria | — | PLO | $800 |  | 1 | No |  |
| 2026-06-23 | GN | 71 | Super Seniors (60+ or played Seniors) | $400 |  | 1 | No |  |
| 2026-06-23 | GN | 72 | Stud 8 Seven Card Hi/Low 8 or Better | $400 |  | 1 | No |  |
| 2026-06-23 | GN | 74 | NLH Turbo | $130 |  | 1 | No |  |
| 2026-06-23 | WSOP | 63 | NLH Mystery Millions | $1,000 | 6 | 3 | Yes | 6 flights |
| 2026-06-23 | WSOP | 64 | PLO/NLH Mixed High Roller | $25,000 |  | 3 | Yes |  |
| 2026-06-23 | WSOP | 65 | NLH Freezeout | $1,500 |  | 3 | Yes |  |
| 2026-06-23 | MGM | 24 | NLH Grand Stack | $400 | 2 | 2 | Yes | 2 flights |
| 2026-06-23 | Orleans | — | Mixed 5 Game Draw Mix | $600 |  | 1 | No |  |
| 2026-06-23 | Orleans | — | NLH Monster Stack | $300 |  | 1 | No |  |
| 2026-06-23 | Orleans | — | NLH Nightly Monster Stack | $200 |  | 1 | No |  |
| 2026-06-23 | S. Point | — | NLH 300K Multiday Day 1 | $300 |  | 1 | No | ⚠ Part of weekly 2-day series; Day 2 Restart unlinked in DB |
| 2026-06-23 | S. Point | — | NLH 300K Multiday Day 1 | $300 |  | 1 | No | ⚠ Part of weekly 2-day series; Day 2 Restart unlinked in DB |
| 2026-06-23 | S. Point | — | NLH Turbo Bounty ($25) | $120 |  | 1 | No |  |
| 2026-06-23 | S. Point | — | O8 Omaha 8/B | $120 |  | 1 | No |  |
| 2026-06-23 | Venetian | 64 | NLH | $1,100 |  | 1 | No |  |
| 2026-06-23 | Venetian | 65 | NLH Bounty | $600 |  | 1 | No |  |
| 2026-06-24 | Aria | — | NLH | $1,100 |  | 1 | No |  |
| 2026-06-24 | Aria | — | NLH | $300 |  | 1 | No |  |
| 2026-06-24 | Aria | — | Stud 8 | $800 |  | 1 | No |  |
| 2026-06-24 | GN | 75-A | NLH Championship Main Event | $600 |  | 1 | No |  |
| 2026-06-24 | GN | 76 | Mixed Triple Draw Lowball Limit Championship (2-7, A-5, Badugi) | $500 |  | 1 | No |  |
| 2026-06-24 | GN | 77 | PLO Night Double Green Chip Bounty | $250 |  | 1 | No |  |
| 2026-06-24 | GN | 78 | NLH Turbo | $130 |  | 1 | No |  |
| 2026-06-24 | WSOP | 66 | NLH Tag Team | $1,000 |  | 3 | Yes |  |
| 2026-06-24 | WSOP | 67 | 2-7 Triple Draw Championship | $10,000 |  | 3 | Yes |  |
| 2026-06-24 | MGM | 25 | NLH Mystery Bounty | $400 |  | 1 | No |  |
| 2026-06-24 | MGM | 26 | PLO8 Nightly | $250 |  | 1 | No |  |
| 2026-06-24 | Orleans | — | NLH Nightly Monster Stack | $200 |  | 1 | No |  |
| 2026-06-24 | Orleans | — | NLH Super Stack | $200 |  | 1 | No |  |
| 2026-06-24 | Orleans | — | PLO 4/5/6 Championship | $600 |  | 1 | No |  |
| 2026-06-24 | Orleans | — | TORSE | $240 |  | 1 | No |  |
| 2026-06-24 | S. Point | — | NLH 300K Multiday Day 1 | $300 |  | 1 | No | ⚠ Part of weekly 2-day series; Day 2 Restart unlinked in DB |
| 2026-06-24 | S. Point | — | NLH 300K Multiday Day 1 | $300 |  | 1 | No | ⚠ Part of weekly 2-day series; Day 2 Restart unlinked in DB |
| 2026-06-24 | Venetian | 66 | LIPS Ladies | $800 |  | 1 | No |  |
| 2026-06-24 | Venetian | 67 | PLO Bounty | $1,100 |  | 1 | No |  |
| 2026-06-25 | Aria | — | NLH | $800 |  | 1 | No |  |
| 2026-06-25 | Aria | — | NLH | $300 |  | 1 | No |  |
| 2026-06-25 | GN | 75-B | NLH Championship Main Event | $600 |  | 1 | No |  |
| 2026-06-25 | GN | 79 | Mixed 5 Game Draw Mix (2-7; Badeucy; Badugi; A-5; Badacey) | $400 |  | 1 | No |  |
| 2026-06-25 | GN | 80 | NLH | $150 |  | 1 | No |  |
| 2026-06-25 | GN | 81 | NLH Turbo | $130 |  | 1 | No |  |
| 2026-06-25 | WSOP | 68 | NLH Ladies Championship | $1,000 |  | 4 | Yes |  |
| 2026-06-25 | WSOP | 69 | Stud 8 | $1,500 |  | 3 | Yes |  |
| 2026-06-25 | MGM | 27 | NLH Grand Stack | $400 |  | 1 | No |  |
| 2026-06-25 | MGM | 28 | PLO8 Nightly | $250 |  | 1 | No |  |
| 2026-06-25 | Orleans | — | Big O Championship | $600 |  | 1 | No |  |
| 2026-06-25 | Orleans | — | NLH Monster Stack | $300 |  | 1 | No |  |
| 2026-06-25 | Orleans | — | NLH Nightly Monster Stack | $200 |  | 1 | No |  |
| 2026-06-25 | Orleans | — | Unknown Event | $240 |  | 1 | No |  |
| 2026-06-25 | S. Point | — | NLH $15K GTD | $120 |  | 1 | No |  |
| 2026-06-25 | S. Point | — | NLH Deepstack $20K GTD | $200 |  | 1 | No |  |
| 2026-06-25 | S. Point | — | NLH Turbo Bounty ($25) | $120 |  | 1 | No |  |
| 2026-06-25 | Venetian | 68 | NLH | $1,100 | 4 | 2 | Yes | 4 flights |
| 2026-06-25 | Venetian | 69 | PLO Double Board Bomb Pot | $1,100 |  | 1 | No |  |
| 2026-06-26 | Aria | — | NLH | $300 |  | 1 | No |  |
| 2026-06-26 | Aria | — | NLH Seniors | $1,100 |  | 1 | No |  |
| 2026-06-26 | GN | 75-C | NLH Championship Main Event | $600 |  | 1 | No |  |
| 2026-06-26 | GN | 82 | Mixed PLO/8; /B; Stud 8/B Championship | $500 |  | 1 | No |  |
| 2026-06-26 | GN | 83 | NLH | $150 |  | 1 | No |  |
| 2026-06-26 | GN | 84 | NLH Turbo | $130 |  | 1 | No |  |
| 2026-06-26 | WSOP | 70 | PLO Championship | $10,000 |  | 4 | Yes |  |
| 2026-06-26 | MGM | 29 | Big O Championship | $600 |  | 1 | No |  |
| 2026-06-26 | MGM | 30 | Big O Nightly | $250 |  | 1 | No |  |
| 2026-06-26 | Orleans | — | 7-Card Stud Championship | $600 |  | 1 | No |  |
| 2026-06-26 | Orleans | — | NLH Friday Special Monster Stack | $200 |  | 1 | No |  |
| 2026-06-26 | Orleans | — | NLH Monster Stack | $300 |  | 1 | No |  |
| 2026-06-27 | Aria | — | 8-Game Mix | $800 |  | 1 | No |  |
| 2026-06-27 | Aria | — | NLH | $300 |  | 1 | No |  |
| 2026-06-27 | Aria | — | PLO Mystery Bounty | $1,100 |  | 1 | No |  |
| 2026-06-27 | GN | 75-D | NLH Championship Main Event | $600 |  | 1 | No |  |
| 2026-06-27 | GN | 85 | PLO8 Night Omaha Hi/Low 8 or Better | $250 |  | 1 | No |  |
| 2026-06-27 | GN | 86 | NLH Turbo | $130 |  | 1 | No |  |
| 2026-06-27 | WSOP | 71 | Mixed Big Bet 7-Max | $2,500 |  | 3 | Yes |  |
| 2026-06-27 | MGM | 31 | Seniors | $600 |  | 1 | No |  |
| 2026-06-27 | MGM | 32 | PLO8 Big-O Nightly | $250 |  | 1 | No |  |
| 2026-06-27 | Orleans | — | Big O | $400 |  | 1 | No |  |
| 2026-06-27 | Orleans | — | NLH Mega Stack | $400 |  | 1 | No |  |
| 2026-06-27 | Orleans | — | NLH Nightly Monster Stack | $200 |  | 1 | No |  |
| 2026-06-27 | Orleans | — | Triple Triple Draw | $240 |  | 1 | No |  |
| 2026-06-27 | S. Point | — | Crazy Pineapple | $120 |  | 1 | No |  |
| 2026-06-27 | S. Point | — | NLH Bounty ($50) $20K GTD | $200 |  | 1 | No |  |
| 2026-06-27 | Venetian | 70 | NLH Super Seniors | $1,100 | 2 | 2 | Yes | 2 flights |
| 2026-06-27 | Venetian | 71 | NLH Bounty | $600 |  | 1 | No |  |
| 2026-06-28 | Aria | — | BetMGM NLH Satellite | $160 |  | 1 | No |  |
| 2026-06-28 | Aria | — | NLH | $1,100 |  | 1 | No |  |
| 2026-06-28 | GN | 87 | NLH Grand Finale | $200 |  | 1 | No |  |
| 2026-06-28 | GN | 88 | Big O Championship | $500 |  | 1 | No |  |
| 2026-06-28 | GN | 89 | NLH Turbo | $130 |  | 1 | No |  |
| 2026-06-28 | WSOP | 72 | NLH Mini Main Event | $1,000 | 3 | 3 | Yes | 3 flights |
| 2026-06-28 | WSOP | 73 | NLH 6-Max | $5,000 |  | 4 | Yes |  |
| 2026-06-28 | WSOP | 74 | 8-Game Mix | $1,500 |  | 3 | Yes |  |
| 2026-06-28 | MGM | 33 | PLO8 Championship | $600 |  | 1 | No |  |
| 2026-06-28 | MGM | 34 | NLH Double Green Chip Bounty | $250 |  | 1 | No |  |
| 2026-06-28 | Orleans | — | Big O | $240 |  | 1 | No |  |
| 2026-06-28 | Orleans | — | NLH Sunday Special | $300 |  | 1 | No |  |
| 2026-06-28 | S. Point | — | Crazy Pineapple $10K GTD | $120 |  | 1 | No |  |
| 2026-06-28 | S. Point | — | NLH $15K GTD | $120 |  | 1 | No |  |
| 2026-06-28 | S. Point | — | NLH Turbo Bounty ($25) | $120 |  | 1 | No |  |
| 2026-06-28 | Venetian | 72 | Ladies Milestone Satellite 3 | $300 |  | 1 | No |  |
| 2026-06-28 | Venetian | 73 | NLH Bounty | $600 |  | 1 | No |  |
| 2026-06-29 | Aria | — | BetMGM NLH Turbo Satellite | $160 |  | 1 | No |  |
| 2026-06-29 | Aria | — | BetMGM PLO Satellite | $160 |  | 1 | No |  |
| 2026-06-29 | Aria | — | NLH BetMGM Mystery Bounty | $1,100 |  | 1 | No |  |
| 2026-06-29 | WSOP | 75 | Stud 8 Championship | $10,000 |  | 3 | Yes |  |
| 2026-06-29 | MGM | 35 | NLH Grand Stack | $400 |  | 1 | No |  |
| 2026-06-29 | MGM | 36 | NLH Double Green Chip Bounty | $250 |  | 1 | No |  |
| 2026-06-29 | Orleans | — | HORSE | $240 |  | 1 | No |  |
| 2026-06-29 | Orleans | — | Mixed A-5, 2-7, Badugi Championship | $600 |  | 1 | No |  |
| 2026-06-29 | Orleans | — | NLH Nightly Monster Stack | $200 |  | 1 | No |  |
| 2026-06-29 | Orleans | — | NLH Super Stack | $200 |  | 1 | No |  |
| 2026-06-29 | S. Point | — | NLH 300K Multiday Day 1 | $300 |  | 1 | No | ⚠ Part of weekly 2-day series; Day 2 Restart unlinked in DB |
| 2026-06-29 | S. Point | — | NLH 300K Multiday Day 1 | $300 |  | 1 | No | ⚠ Part of weekly 2-day series; Day 2 Restart unlinked in DB |
| 2026-06-29 | S. Point | — | NLH Chip Chop Survivor | $120 |  | 1 | No |  |
| 2026-06-29 | S. Point | — | NLH Turbo Bounty ($25) | $120 |  | 1 | No |  |
| 2026-06-29 | Venetian | 74 | NLH | $800 | 6 | 2 | Yes | 6 flights |
| 2026-06-29 | Venetian | 75 | Ladies Milestone Satellite 3 | $300 |  | 1 | No |  |
| 2026-06-30 | Aria | — | BetMGM NLH Satellite | $400 |  | 1 | No |  |
| 2026-06-30 | Aria | — | BetMGM PLO Turbo Satellite | $160 |  | 1 | No |  |
| 2026-06-30 | Aria | — | PLO BetMGM Mystery Bounty | $1,100 |  | 1 | No |  |
| 2026-06-30 | WSOP | 76 | PLO High Roller | $100,000 |  | 3 | Yes |  |
| 2026-06-30 | WSOP | 77 | Mixed Triple Draw | $2,500 |  | 3 | Yes |  |
| 2026-06-30 | MGM | 37 | NLH Grand Stack | $400 | 2 | 2 | Yes | 2 flights |
| 2026-06-30 | Orleans | — | Main Event Satellite - 1 in 6 | $120 |  | 1 | No |  |
| 2026-06-30 | Orleans | — | NLH Nightly Monster Stack | $200 |  | 1 | No |  |
| 2026-06-30 | Orleans | — | NLH Super Stack | $200 |  | 1 | No |  |
| 2026-06-30 | Orleans | — | PLO | $400 |  | 1 | No |  |
| 2026-06-30 | S. Point | — | NLH 300K Multiday Day 1 | $300 |  | 1 | No | ⚠ Part of weekly 2-day series; Day 2 Restart unlinked in DB |
| 2026-06-30 | S. Point | — | NLH 300K Multiday Day 1 | $300 |  | 1 | No | ⚠ Part of weekly 2-day series; Day 2 Restart unlinked in DB |
| 2026-06-30 | S. Point | — | NLH Turbo Bounty ($25) | $120 |  | 1 | No |  |
| 2026-06-30 | S. Point | — | O8 Omaha 8/B | $120 |  | 1 | No |  |
| 2026-06-30 | Venetian | 76 | LIPS Ladies High Roller | $2,500 |  | 3 | Yes |  |
| 2026-07-01 | Aria | — | BetMGM NLH Satellite | $400 |  | 1 | No |  |
| 2026-07-01 | Aria | — | BetMGM NLH Turbo Satellite | $400 |  | 1 | No |  |
| 2026-07-01 | Aria | — | NLH BetMGM Championship | $3,500 | 2 | 3 | Yes | 2 flights |
| 2026-07-01 | WSOP | 78 | NLH Deepstack Championship | $600 |  | 4 | Yes |  |
| 2026-07-01 | WSOP | 79 | NLH Freezeout | $3,000 |  | 3 | Yes |  |
| 2026-07-01 | WSOP | 80 | 8-Game Mix Championship | $10,000 |  | 3 | Yes |  |
| 2026-07-01 | MGM | 38 | Mixed Big-O/PLO8 Championship | $600 |  | 1 | No |  |
| 2026-07-01 | MGM | 39 | NLH Double Green Chip Bounty | $250 |  | 1 | No |  |
| 2026-07-01 | Orleans | — | Main Event Satellite - 1 in 6 | $120 |  | 1 | No |  |
| 2026-07-01 | Orleans | — | NLH Main Event | $600 |  | 1 | No |  |
| 2026-07-01 | Orleans | — | NLH Main Event | $600 |  | 1 | No |  |
| 2026-07-01 | S. Point | — | NLH 300K Multiday Day 1 | $300 |  | 1 | No | ⚠ Part of weekly 2-day series; Day 2 Restart unlinked in DB |
| 2026-07-01 | S. Point | — | NLH 300K Multiday Day 1 | $300 |  | 1 | No | ⚠ Part of weekly 2-day series; Day 2 Restart unlinked in DB |
| 2026-07-02 | Aria | — | BetMGM NLH Turbo Satellite | $400 |  | 1 | No |  |
| 2026-07-02 | WSOP | 81 | NLH Summer Celebration | $800 | 2 | 2 | Yes | 2 flights |
| 2026-07-02 | WSOP | 82 | WSOP NLH Main Event | $10,000 | 4 | 8 | Yes | 4 flights; Spans 8 days total |
| 2026-07-02 | WSOP | 83 | PLO Double Board Bomb Pot | $1,500 |  | 3 | Yes |  |
| 2026-07-02 | MGM | 40 | HEROS Championship | $600 |  | 1 | No |  |
| 2026-07-02 | MGM | 41 | NLH Double Green Chip Bounty | $250 |  | 1 | No |  |
| 2026-07-02 | Orleans | — | Main Event Satellite - 1 in 6 | $120 |  | 1 | No |  |
| 2026-07-02 | Orleans | — | NLH Main Event | $600 |  | 1 | No |  |
| 2026-07-02 | Orleans | — | NLH Main Event | $600 |  | 1 | No |  |
| 2026-07-02 | S. Point | — | NLH $15K GTD | $120 |  | 1 | No |  |
| 2026-07-02 | S. Point | — | NLH Deepstack $20K GTD | $200 |  | 1 | No |  |
| 2026-07-02 | S. Point | — | NLH Turbo Bounty ($25) | $120 |  | 1 | No |  |
| 2026-07-02 | Venetian | 77 | NLH | $1,100 |  | 1 | No |  |
| 2026-07-03 | Aria | — | NLH | $300 |  | 1 | No |  |
| 2026-07-03 | WSOP | 84 | NLH Super Turbo Bounty | $5,000 |  | 1 | No |  |
| 2026-07-03 | MGM | 42 | Mixed Omaha Championship | $600 |  | 1 | No |  |
| 2026-07-03 | MGM | 43 | PLO8 Nightly | $250 |  | 1 | No |  |
| 2026-07-03 | Orleans | — | Main Event Satellite - 1 in 6 | $120 |  | 1 | No |  |
| 2026-07-03 | Orleans | — | NLH Main Event | $600 |  | 1 | No |  |
| 2026-07-03 | S. Point | — | Crazy Pineapple | $120 |  | 1 | No |  |
| 2026-07-03 | S. Point | — | NLH $15K GTD | $120 |  | 1 | No |  |
| 2026-07-03 | S. Point | — | NLH Deepstack $20K GTD | $200 |  | 1 | No |  |
| 2026-07-03 | S. Point | — | NLH Turbo Bounty ($25) | $120 |  | 1 | No |  |
| 2026-07-03 | Venetian | 78 | NLH Bounty | $1,100 |  | 1 | No |  |
| 2026-07-04 | Aria | — | NLH | $1,100 |  | 1 | No |  |
| 2026-07-04 | Aria | — | PLO Milestone Satellite | $300 |  | 1 | No |  |
| 2026-07-04 | WSOP | 85 | NLH | $1,000 |  | 2 | Yes |  |
| 2026-07-04 | MGM | 44 | TORSE Championship | $600 |  | 1 | No |  |
| 2026-07-04 | MGM | 45 | NLH Double Green Chip Bounty | $250 |  | 1 | No |  |
| 2026-07-04 | Orleans | — | NLH Main Event - Day 2 | $600 |  | 1 | No |  |
| 2026-07-04 | Orleans | — | NLH Super Stack | $300 |  | 1 | No |  |
| 2026-07-04 | Orleans | — | PL Big O | $300 |  | 1 | No |  |
| 2026-07-04 | S. Point | — | Crazy Pineapple | $120 |  | 1 | No |  |
| 2026-07-04 | S. Point | — | NLH $15K GTD | $120 |  | 1 | No |  |
| 2026-07-04 | S. Point | — | NLH Bounty ($50) $20K GTD | $200 |  | 1 | No |  |
| 2026-07-04 | S. Point | — | O8 Omaha 8/B $15K GTD | $200 |  | 1 | No |  |
| 2026-07-04 | Venetian | 79 | NLH | $1,100 |  | 1 | No |  |
| 2026-07-05 | Aria | — | NLH | $300 |  | 1 | No |  |
| 2026-07-05 | Aria | — | PLO Championship | $2,200 |  | 2 | Yes |  |
| 2026-07-05 | WSOP | 86 | NLH Ultra Stack | $600 | 3 | 3 | Yes | 3 flights |
| 2026-07-05 | MGM | MGM-47 | NLH Double Green Chip Bounty | $250 |  | 1 | No |  |
| 2026-07-05 | MGM | MGM-46 | Seniors | $600 |  | 1 | No |  |
| 2026-07-05 | Orleans | — | BEAST | $200 |  | 1 | No |  |
| 2026-07-05 | Orleans | — | NLH Monster Stack | $400 |  | 1 | No |  |
| 2026-07-05 | S. Point | — | Crazy Pineapple $10K GTD | $120 |  | 1 | No |  |
| 2026-07-05 | S. Point | — | NLH $15K GTD | $120 |  | 1 | No |  |
| 2026-07-05 | S. Point | — | NLH Turbo Bounty ($25) | $120 |  | 1 | No |  |
| 2026-07-05 | S. Point | — | NLH Turbo Bounty ($25) $6K GTD | $120 |  | 1 | No |  |
| 2026-07-05 | Venetian | 80 | NLH Bounty | $1,600 |  | 1 | No |  |
| 2026-07-06 | Aria | — | NLH | $1,100 |  | 1 | No |  |
| 2026-07-06 | Aria | — | NLH | $300 |  | 1 | No |  |
| 2026-07-06 | MGM | 48 | NLH Mystery Bounty | $400 |  | 1 | No |  |
| 2026-07-06 | MGM | 49 | PLO8 Big-O Nightly | $250 |  | 1 | No |  |
| 2026-07-06 | Orleans | — | 9-Game Mix | $300 |  | 1 | No |  |
| 2026-07-06 | Orleans | — | PL Big O | $300 |  | 1 | No |  |
| 2026-07-06 | S. Point | — | NLH 300K Multiday Day 1 | $300 |  | 1 | No | ⚠ Part of weekly 2-day series; Day 2 Restart unlinked in DB |
| 2026-07-06 | S. Point | — | NLH 300K Multiday Day 1 | $300 |  | 1 | No | ⚠ Part of weekly 2-day series; Day 2 Restart unlinked in DB |
| 2026-07-06 | S. Point | — | NLH Chip Chop Survivor | $120 |  | 1 | No |  |
| 2026-07-06 | S. Point | — | NLH Turbo Bounty ($25) | $120 |  | 1 | No |  |
| 2026-07-06 | Venetian | 81 | NLH Bounty | $1,100 |  | 1 | No |  |
| 2026-07-06 | Venetian | 82 | PLO Bounty | $2,200 |  | 2 | Yes |  |
| 2026-07-07 | Aria | — | NLH | $1,600 |  | 1 | No |  |
| 2026-07-07 | Aria | — | NLH | $300 |  | 1 | No |  |
| 2026-07-07 | Aria | — | NLH Turbo Satellite | $240 |  | 1 | No |  |
| 2026-07-07 | WSOP | 87 | PLO Mystery Bounty | $1,000 | 2 | 2 | Yes | 2 flights |
| 2026-07-07 | MGM | 50 | PLO Double Board Bomb Pot | $300 |  | 1 | No |  |
| 2026-07-07 | MGM | 51 | NLH GRAND FINALE | $700 | 5 | 2 | Yes | 5 flights |
| 2026-07-07 | Orleans | — | Mixed O-8 | $300 |  | 1 | No |  |
| 2026-07-07 | Orleans | — | NLH Nightly Monster Stack | $200 |  | 1 | No |  |
| 2026-07-07 | S. Point | — | NLH 300K Multiday Day 1 | $300 |  | 1 | No | ⚠ Part of weekly 2-day series; Day 2 Restart unlinked in DB |
| 2026-07-07 | S. Point | — | NLH 300K Multiday Day 1 | $300 |  | 1 | No | ⚠ Part of weekly 2-day series; Day 2 Restart unlinked in DB |
| 2026-07-07 | S. Point | — | NLH Turbo Bounty ($25) | $120 |  | 1 | No |  |
| 2026-07-07 | S. Point | — | O8 Omaha 8/B | $120 |  | 1 | No |  |
| 2026-07-07 | Venetian | 83 | NLH Seniors | $1,100 | 4 | 2 | Yes | 4 flights |
| 2026-07-07 | Venetian | 84 | NLH Bounty | $600 |  | 1 | No |  |
| 2026-07-08 | Aria | — | NLH | $1,100 |  | 1 | No |  |
| 2026-07-08 | Aria | — | NLH | $300 |  | 1 | No |  |
| 2026-07-08 | WSOP | 88 | NLH Gladiators of Poker | $300 | 4 | 3 | Yes | 4 flights |
| 2026-07-08 | WSOP | 89 | NLH Mid-Stakes Championship | $3,000 | 3 | 4 | Yes | 3 flights |
| 2026-07-08 | Orleans | — | NLH Nightly Monster Stack | $200 |  | 1 | No |  |
| 2026-07-08 | Orleans | — | NLH Super Stack | $300 |  | 1 | No |  |
| 2026-07-08 | S. Point | — | NLH 300K Multiday Day 1 | $300 |  | 1 | No | ⚠ Part of weekly 2-day series; Day 2 Restart unlinked in DB |
| 2026-07-08 | S. Point | — | NLH 300K Multiday Day 1 | $300 |  | 1 | No | ⚠ Part of weekly 2-day series; Day 2 Restart unlinked in DB |
| 2026-07-08 | Venetian | 85 | NLH Bounty | $600 |  | 1 | No |  |
| 2026-07-09 | Aria | — | NLH | $1,600 |  | 1 | No |  |
| 2026-07-09 | Aria | — | NLH | $300 |  | 1 | No |  |
| 2026-07-09 | Aria | — | NLH Turbo Satellite | $240 |  | 1 | No |  |
| 2026-07-09 | WSOP | 90 | NLH High Roller | $50,000 |  | 3 | Yes |  |
| 2026-07-09 | WSOP | 91 | Pick Your PLO | $1,500 |  | 3 | Yes |  |
| 2026-07-09 | Orleans | — | NLH Mega Stack | $500 |  | 1 | No |  |
| 2026-07-09 | Orleans | — | NLH Nightly Monster Stack | $200 |  | 1 | No |  |
| 2026-07-09 | S. Point | — | NLH $15K GTD | $120 |  | 1 | No |  |
| 2026-07-09 | S. Point | — | NLH Deepstack $20K GTD | $200 |  | 1 | No |  |
| 2026-07-09 | S. Point | — | NLH Turbo Bounty ($25) | $120 |  | 1 | No |  |
| 2026-07-09 | Venetian | 86 | NLH Bounty | $600 |  | 1 | No |  |
| 2026-07-10 | Aria | — | NLH | $1,100 |  | 1 | No |  |
| 2026-07-10 | Aria | — | NLH | $300 |  | 1 | No |  |
| 2026-07-10 | WSOP | 92 | TORSE | $3,000 |  | 3 | Yes |  |
| 2026-07-10 | Orleans | — | NLH Mega Stack - Flight B | $500 |  | 1 | No |  |
| 2026-07-10 | Orleans | — | NLH Nightly Monster Stack | $200 |  | 1 | No |  |
| 2026-07-10 | S. Point | — | Crazy Pineapple | $120 |  | 1 | No |  |
| 2026-07-10 | S. Point | — | NLH $15K GTD | $120 |  | 1 | No |  |
| 2026-07-10 | S. Point | — | NLH Deepstack $20K GTD | $200 |  | 1 | No |  |
| 2026-07-10 | S. Point | — | NLH Turbo Bounty ($25) | $120 |  | 1 | No |  |
| 2026-07-11 | Aria | — | NLH | $300 |  | 1 | No |  |
| 2026-07-11 | Aria | — | PLO Mystery Bounty | $1,100 |  | 1 | No |  |
| 2026-07-11 | WSOP | 93 | NLH The Closer | $1,500 | 2 | 2 | Yes | 2 flights |
| 2026-07-11 | WSOP | 94 | NLH 6-Max Championship | $10,000 |  | 3 | Yes |  |
| 2026-07-11 | Orleans | — | NLH Nightly Monster Stack | $200 |  | 1 | No |  |
| 2026-07-11 | Orleans | — | NLH Super Stack | $300 |  | 1 | No |  |
| 2026-07-11 | S. Point | — | Crazy Pineapple | $120 |  | 1 | No |  |
| 2026-07-11 | S. Point | — | NLH $15K GTD | $120 |  | 1 | No |  |
| 2026-07-11 | S. Point | — | NLH Bounty ($50) $20K GTD | $200 |  | 1 | No |  |
| 2026-07-11 | S. Point | — | O8 Omaha 8/B $15K GTD | $200 |  | 1 | No |  |
| 2026-07-11 | Venetian | 87 | NLH MSPT | $1,100 | 6 | 2 | Yes | 6 flights |
| 2026-07-12 | Aria | — | NLH | $800 |  | 1 | No |  |
| 2026-07-12 | WSOP | 95 | NLH Summer Saver | $500 | 2 | 2 | Yes | 2 flights |
| 2026-07-12 | WSOP | 96 | PLO 6-Max | $3,000 |  | 3 | Yes |  |
| 2026-07-12 | Orleans | — | NLH Nightly Monster Stack | $200 |  | 1 | No |  |
| 2026-07-12 | Orleans | — | NLH Super Stack | $300 |  | 1 | No |  |
| 2026-07-12 | S. Point | — | Crazy Pineapple $10K GTD | $120 |  | 1 | No |  |
| 2026-07-12 | S. Point | — | NLH $15K GTD | $120 |  | 1 | No |  |
| 2026-07-12 | S. Point | — | NLH Turbo Bounty ($25) | $120 |  | 1 | No |  |
| 2026-07-12 | S. Point | — | NLH Turbo Bounty ($25) $6K GTD | $120 |  | 1 | No |  |
| 2026-07-13 | WSOP | 97 | HORSE High Roller | $25,000 |  | 3 | Yes |  |

---

## Summary

**Total logical events:** 781

### Events by length

| Days | Count | % of total |
|------|-------|------------|
| 1 | 652 | 83.5% |
| 2 | 42 | 5.4% |
| 3 | 66 | 8.5% |
| 4 | 16 | 2.0% |
| 5 | 4 | 0.5% |
| 8 | 1 | 0.1% |

### Events by venue

| Venue | Total | 1-day | 2-day | 3-day | 4-day | 5+ days |
|-------|-------|-------|-------|-------|-------|---------|
| Aria | 116 | 111 | 4 | 1 | 0 | 0 |
| GN | 96 | 93 | 0 | 3 | 0 | 0 |
| MGM | 51 | 41 | 10 | 0 | 0 | 0 |
| Orleans | 162 | 161 | 1 | 0 | 0 | 0 |
| S. Point | 167 | 167 | 0 | 0 | 0 | 0 |
| VDX | 5 | 4 | 1 | 0 | 0 | 0 |
| Venetian | 87 | 72 | 14 | 1 | 0 | 0 |
| WSOP | 97 | 3 | 12 | 61 | 16 | 5 |

### Multi-day events (Days ≥ 2) summary by venue

Total multi-day events: **129**

### Data quality notes

- **Events with missing length data:** 0. All events have is_restart flag and restart rows properly linked, except:
  - South Point 'NLH 300K Multiday Day 1' rows: `parent_event` is NULL on their Day 2 Restart rows, so the 2-day structure cannot be automatically inferred from the DB. These show as 1-day but are actually 2-day events. There are **42** such Day-1 rows across the date range (7 weekly cycles × ~6 Day-1 slots per week).
  - Aria restart rows have NULL `parent_event`; matched by stripping ' - Day X' suffix from restart event names. This appears reliable for the 4 Aria restart events found.
- **Wynn Las Vegas:** No events found in this date range in the database.
- **Venue exclusions:** WSOP Online (31 events), WSOPC Cherokee (8 events), and all other non-LV venues excluded.

*Generated: 2026-05-15*
#!/usr/bin/env node
// Insert Seminole Hard Rock Poker Showdown (SHRPO) 2026 events

const initSqlJs = require('sql.js');
const fs = require('fs');

const VENUE = 'Seminole Hard Rock';
const SERIES = 'Seminole Hard Rock Poker Showdown';
const SRC = 'shrpo-2026';

// Helper: build event object
function ev(num, name, date, time, buyin, variant, reentry, notes, isRestart) {
  return {
    event_number: 'SHRPO-' + num,
    event_name: name,
    date,
    time,
    buyin: buyin || 0,
    reentry: reentry || 'Re-Entry',
    game_variant: variant,
    notes: notes || SERIES,
    source_pdf: SRC,
    is_restart: isRestart ? 1 : 0
  };
}

const events = [
  // ── Event #1: NLH $1M GTD (8 flights + Day 2/3) ──
  ev('1A', 'NLH $1M GTD - Flight A', 'April 8, 2026', '10:00 AM', 400, 'NLH', 'Re-Entry'),
  ev('1B', 'NLH $1M GTD - Flight B', 'April 8, 2026', '5:00 PM', 400, 'NLH', 'Re-Entry'),
  ev('1C', 'NLH $1M GTD - Flight C', 'April 9, 2026', '10:00 AM', 400, 'NLH', 'Re-Entry'),
  ev('1D', 'NLH $1M GTD - Flight D', 'April 9, 2026', '5:00 PM', 400, 'NLH', 'Re-Entry'),
  ev('1E', 'NLH $1M GTD - Flight E', 'April 10, 2026', '10:00 AM', 400, 'NLH', 'Re-Entry'),
  ev('1F', 'NLH $1M GTD - Flight F', 'April 10, 2026', '5:00 PM', 400, 'NLH', 'Re-Entry'),
  ev('1G', 'NLH $1M GTD - Flight G', 'April 11, 2026', '10:00 AM', 400, 'NLH', 'Re-Entry'),
  ev('1H', 'NLH $1M GTD - Flight H', 'April 11, 2026', '5:00 PM', 400, 'NLH', 'Re-Entry'),
  ev('1(2)', 'NLH $1M GTD - Day 2', 'April 12, 2026', '1:00 PM', 0, 'NLH', 'N/A', SERIES, true),
  ev('1(3)', 'NLH $1M GTD - Day 3', 'April 13, 2026', '1:00 PM', 0, 'NLH', 'N/A', SERIES, true),

  // ── Event #2: PLO8 ──
  ev('2', 'PLO8', 'April 8, 2026', '11:00 AM', 600, 'PLO8', 'N/A'),

  // ── Event #3: NLH 6-Max ──
  ev('3', 'NLH 6-Max', 'April 8, 2026', '2:00 PM', 800, 'NLH', 'N/A'),

  // ── Event #4: NLH ──
  ev('4', 'NLH', 'April 8, 2026', '6:00 PM', 300, 'NLH', 'N/A'),

  // ── Event #5: NLH Seniors (50+) ──
  ev('5', 'NLH Seniors (50+)', 'April 9, 2026', '11:00 AM', 600, 'NLH', 'N/A', SERIES + ' | $50,000 GTD'),

  // ── Event #6: Big O ──
  ev('6', 'Big O', 'April 9, 2026', '2:00 PM', 600, 'Big O', 'N/A'),

  // ── Event #7: PLO/NLH Mix ──
  ev('7', 'PLO/NLH Mix', 'April 9, 2026', '6:00 PM', 300, 'PLO/NLH Mix', 'N/A'),

  // ── Event #8: Limit O8 ──
  ev('8', 'Limit O8', 'April 10, 2026', '11:00 AM', 600, 'Limit O8', 'N/A'),

  // ── Event #9: NLH Double Black Chip Bounty ──
  ev('9', 'NLH Double Black Chip Bounty', 'April 10, 2026', '2:00 PM', 1100, 'NLH', 'N/A'),

  // ── Event #10: NLH Black Chip Bounty ──
  ev('10', 'NLH Black Chip Bounty', 'April 10, 2026', '6:00 PM', 300, 'NLH', 'N/A'),

  // ── Event #11: HORSE ──
  ev('11', 'HORSE', 'April 11, 2026', '11:00 AM', 600, 'HORSE', 'N/A'),

  // ── Event #12: 5-Card PLO ──
  ev('12', '5-Card PLO', 'April 11, 2026', '3:00 PM', 1100, '5-Card PLO', 'N/A'),

  // ── Event #13: NLH $100K GTD ──
  ev('13', 'NLH $100K GTD', 'April 12, 2026', '1:00 PM', 400, 'NLH', 'N/A'),

  // ── Event #14: PLO Double Board Bomb Pot ──
  ev('14', 'PLO Double Board Bomb Pot', 'April 12, 2026', '2:00 PM', 600, 'PLO', 'N/A'),

  // ── Event #15: NLH Purple Chip Bounty $200K GTD (3 flights + Day 2) ──
  ev('15A', 'NLH Purple Chip Bounty $200K GTD - Flight A', 'April 12, 2026', '5:00 PM', 1700, 'NLH', 'Re-Entry'),
  ev('15B', 'NLH Purple Chip Bounty $200K GTD - Flight B', 'April 13, 2026', '12:00 PM', 1700, 'NLH', 'Re-Entry'),
  ev('15C', 'NLH Purple Chip Bounty $200K GTD - Flight C (Turbo)', 'April 13, 2026', '5:00 PM', 1700, 'NLH', 'Re-Entry'),
  ev('15(2)', 'NLH Purple Chip Bounty $200K GTD - Day 2', 'April 14, 2026', '1:00 PM', 0, 'NLH', 'N/A', SERIES, true),

  // ── Event #16: PLO (2 flights + Day 2) ──
  ev('16A', 'PLO - Flight A', 'April 12, 2026', '5:00 PM', 400, 'PLO', 'Re-Entry', SERIES + ' | $50,000 GTD'),
  ev('16B', 'PLO - Flight B', 'April 13, 2026', '2:00 PM', 400, 'PLO', 'Re-Entry', SERIES + ' | $50,000 GTD'),
  ev('16(2)', 'PLO - Day 2', 'April 14, 2026', '1:00 PM', 0, 'PLO', 'N/A', SERIES, true),

  // ── Event #17: NLH Double Green Chip Bounty ──
  ev('17', 'NLH Double Green Chip Bounty', 'April 12, 2026', '6:00 PM', 300, 'NLH', 'N/A'),

  // ── Event #18: NLH $100K GTD (6 flights + Day 2) ──
  ev('18A', 'NLH $100K GTD - Flight A', 'April 13, 2026', '11:00 AM', 200, 'NLH', 'Re-Entry'),
  ev('18B', 'NLH $100K GTD - Flight B', 'April 13, 2026', '3:00 PM', 200, 'NLH', 'Re-Entry'),
  ev('18C', 'NLH $100K GTD - Flight C', 'April 13, 2026', '7:00 PM', 200, 'NLH', 'Re-Entry'),
  ev('18D', 'NLH $100K GTD - Flight D', 'April 14, 2026', '11:00 AM', 200, 'NLH', 'Re-Entry'),
  ev('18E', 'NLH $100K GTD - Flight E', 'April 14, 2026', '3:00 PM', 200, 'NLH', 'Re-Entry'),
  ev('18F', 'NLH $100K GTD - Flight F', 'April 14, 2026', '7:00 PM', 200, 'NLH', 'Re-Entry'),
  ev('18(2)', 'NLH $100K GTD - Day 2', 'April 15, 2026', '1:00 PM', 0, 'NLH', 'N/A', SERIES, true),

  // ── Event #19: TORSE ──
  ev('19', 'TORSE', 'April 13, 2026', '12:00 PM', 400, 'TORSE', 'N/A'),

  // ── Event #20: NLH 6-Max Black Chip Bounty ──
  ev('20', 'NLH 6-Max Black Chip Bounty', 'April 13, 2026', '6:00 PM', 300, 'NLH', 'N/A'),

  // ── Event #21: NLH 6-Max ──
  ev('21', 'NLH 6-Max', 'April 14, 2026', '12:00 PM', 600, 'NLH', 'N/A', SERIES + ' | $50,000 GTD'),

  // ── Event #22: Mixed PLO (PLO/PLO8/Big O) ──
  ev('22', 'Mixed PLO (PLO/PLO8/Big O)', 'April 14, 2026', '2:00 PM', 600, 'Mixed PLO', 'N/A'),

  // ── Event #23: NLH Mid-Series Showdown $1M GTD (8 flights + Day 2/3) ──
  ev('23A', 'NLH Mid-Series Showdown $1M GTD - Flight A', 'April 15, 2026', '10:00 AM', 800, 'NLH', 'Re-Entry'),
  ev('23B', 'NLH Mid-Series Showdown $1M GTD - Flight B', 'April 15, 2026', '5:00 PM', 800, 'NLH', 'Re-Entry'),
  ev('23C', 'NLH Mid-Series Showdown $1M GTD - Flight C', 'April 16, 2026', '10:00 AM', 800, 'NLH', 'Re-Entry'),
  ev('23D', 'NLH Mid-Series Showdown $1M GTD - Flight D', 'April 16, 2026', '5:00 PM', 800, 'NLH', 'Re-Entry'),
  ev('23E', 'NLH Mid-Series Showdown $1M GTD - Flight E', 'April 17, 2026', '10:00 AM', 800, 'NLH', 'Re-Entry'),
  ev('23F', 'NLH Mid-Series Showdown $1M GTD - Flight F', 'April 17, 2026', '5:00 PM', 800, 'NLH', 'Re-Entry'),
  ev('23G', 'NLH Mid-Series Showdown $1M GTD - Flight G', 'April 18, 2026', '10:00 AM', 800, 'NLH', 'Re-Entry'),
  ev('23H', 'NLH Mid-Series Showdown $1M GTD - Flight H', 'April 18, 2026', '5:00 PM', 800, 'NLH', 'Re-Entry'),
  ev('23(2)', 'NLH Mid-Series Showdown $1M GTD - Day 2', 'April 19, 2026', '1:00 PM', 0, 'NLH', 'N/A', SERIES, true),
  ev('23(3)', 'NLH Mid-Series Showdown $1M GTD - Day 3', 'April 20, 2026', '1:00 PM', 0, 'NLH', 'N/A', SERIES, true),

  // ── Event #24: NLH Seniors (50+) ──
  ev('24', 'NLH Seniors (50+)', 'April 15, 2026', '11:00 AM', 400, 'NLH', 'N/A'),

  // ── Event #25: Big O ──
  ev('25', 'Big O', 'April 15, 2026', '12:00 PM', 600, 'Big O', 'N/A'),

  // ── Event #26: NLH Black Chip Bounty ──
  ev('26', 'NLH Black Chip Bounty', 'April 15, 2026', '2:00 PM', 300, 'NLH', 'N/A'),

  // ── Event #27: NLH Forty-Forty-Forty (40+) ──
  ev('27', 'NLH Forty-Forty-Forty (40+)', 'April 16, 2026', '11:00 AM', 600, 'NLH', 'N/A', SERIES + ' | $40,000 GTD'),

  // ── Event #28: NLH 6-Max ──
  ev('28', 'NLH 6-Max', 'April 16, 2026', '2:00 PM', 1100, 'NLH', 'N/A'),

  // ── Event #29: NL 2-7 Single Draw ──
  ev('29', 'NL 2-7 Single Draw', 'April 16, 2026', '3:00 PM', 400, 'NL 2-7 Single Draw', 'N/A'),

  // ── Event #30: PLO 8-Handed ──
  ev('30', 'PLO 8-Handed', 'April 16, 2026', '6:00 PM', 400, 'PLO', 'N/A'),

  // ── Event #31: Mixed Triple Draw ──
  ev('31', 'Mixed Triple Draw (2-7/A-5/Badugi)', 'April 17, 2026', '11:00 AM', 600, 'Mixed Triple Draw', 'N/A'),

  // ── Event #32: NLH Black Chip Bounty ──
  ev('32', 'NLH Black Chip Bounty', 'April 17, 2026', '2:00 PM', 300, 'NLH', 'N/A'),

  // ── Event #33: Limit O8 ──
  ev('33', 'Limit O8', 'April 18, 2026', '11:00 AM', 600, 'Limit O8', 'N/A'),

  // ── Event #34: 5-Card PLO Black Chip Bounty ──
  ev('34', '5-Card PLO Black Chip Bounty', 'April 18, 2026', '2:00 PM', 400, '5-Card PLO', 'N/A'),

  // ── Event #35: NLH $100K GTD ──
  ev('35', 'NLH $100K GTD', 'April 19, 2026', '1:00 PM', 400, 'NLH', 'N/A'),

  // ── Event #36: Big Bet Dealer's Choice ──
  ev('36', "Big Bet Dealer's Choice", 'April 19, 2026', '2:00 PM', 600, "Dealer's Choice", 'N/A'),

  // ── Event #37: NLH $500K GTD (4 flights + Day 2) ──
  ev('37A', 'NLH $500K GTD - Flight A', 'April 19, 2026', '4:00 PM', 1100, 'NLH', 'Re-Entry'),
  ev('37B', 'NLH $500K GTD - Flight B', 'April 20, 2026', '12:00 PM', 1100, 'NLH', 'Re-Entry'),
  ev('37C', 'NLH $500K GTD - Flight C', 'April 21, 2026', '12:00 PM', 1100, 'NLH', 'Re-Entry'),
  ev('37D', 'NLH $500K GTD - Flight D (Turbo)', 'April 21, 2026', '6:00 PM', 1100, 'NLH', 'Re-Entry'),
  ev('37(2)', 'NLH $500K GTD - Day 2', 'April 22, 2026', '12:00 PM', 0, 'NLH', 'N/A', SERIES, true),

  // ── Event #38: PLO Turbo ──
  ev('38', 'PLO Turbo', 'April 19, 2026', '8:00 PM', 600, 'PLO', 'N/A'),

  // ── Event #39: NLH Seniors (50+) + Day 2 ──
  ev('39', 'NLH Seniors (50+)', 'April 20, 2026', '11:00 AM', 2200, 'NLH', 'N/A'),
  ev('39(2)', 'NLH Seniors (50+) - Day 2', 'April 21, 2026', '12:00 PM', 0, 'NLH', 'N/A', SERIES, true),

  // ── Event #40: 10-Game Mix + Day 2 ──
  ev('40', '10-Game Mix', 'April 20, 2026', '12:00 PM', 1100, '10-Game Mix', 'N/A'),
  ev('40(2)', '10-Game Mix - Day 2', 'April 21, 2026', '12:00 PM', 0, '10-Game Mix', 'N/A', SERIES, true),

  // ── Event #41: NLH Heads-Up (32 Max) ──
  ev('41', 'NLH Heads-Up (32 Max)', 'April 20, 2026', '12:00 PM', 5000, 'NLH', 'N/A'),

  // ── Event #42: NLH Double Black Chip Bounty ──
  ev('42', 'NLH Double Black Chip Bounty', 'April 20, 2026', '12:00 PM', 600, 'NLH', 'N/A'),

  // ── Event #43: PLO 6-Max Black Chip Bounty ──
  ev('43', 'PLO 6-Max Black Chip Bounty', 'April 20, 2026', '4:00 PM', 600, 'PLO', 'N/A'),

  // ── Event #44: NLH Turbo ──
  ev('44', 'NLH Turbo', 'April 20, 2026', '8:00 PM', 1100, 'NLH', 'N/A'),

  // ── Event #45: NLH Lightning Stack 6-Max ──
  ev('45', 'NLH Lightning Stack 6-Max', 'April 21, 2026', '11:00 AM', 600, 'NLH', 'N/A'),

  // ── Event #46: Limit O8 + Day 2 ──
  ev('46', 'Limit O8', 'April 21, 2026', '12:00 PM', 1100, 'Limit O8', 'N/A'),
  ev('46(2)', 'Limit O8 - Day 2', 'April 22, 2026', '12:00 PM', 0, 'Limit O8', 'N/A', SERIES, true),

  // ── Event #47: 5-Card PLO 6-Max ──
  ev('47', '5-Card PLO 6-Max', 'April 21, 2026', '1:00 PM', 400, '5-Card PLO', 'N/A'),

  // ── Event #48: NLH Progressive Bounty ──
  ev('48', 'NLH Progressive Bounty', 'April 21, 2026', '4:00 PM', 800, 'NLH', 'N/A'),

  // ── Event #49: TORSE + Day 2 ──
  ev('49', 'TORSE', 'April 22, 2026', '11:00 AM', 1100, 'TORSE', 'N/A'),
  ev('49(2)', 'TORSE - Day 2', 'April 23, 2026', '12:00 PM', 0, 'TORSE', 'N/A', SERIES, true),

  // ── Event #50: NLH $200K GTD + Day 2 ──
  ev('50', 'NLH $200K GTD', 'April 22, 2026', '12:00 PM', 2200, 'NLH', 'N/A'),
  ev('50(2)', 'NLH $200K GTD - Day 2', 'April 23, 2026', '12:00 PM', 0, 'NLH', 'N/A', SERIES, true),

  // ── Event #51: NLH Slater Scoops $100K GTD ──
  ev('51', 'NLH Slater Scoops $100K GTD', 'April 22, 2026', '4:00 PM', 300, 'NLH', 'N/A', SERIES + ' | Added $3,500 WPT LHPO Seat'),

  // ── Event #52: NLH $100K GTD + Day 2 ──
  ev('52', 'NLH $100K GTD', 'April 23, 2026', '12:00 PM', 1100, 'NLH', 'N/A'),
  ev('52(2)', 'NLH $100K GTD - Day 2', 'April 24, 2026', '12:00 PM', 0, 'NLH', 'N/A', SERIES, true),

  // ── Event #53: OE ──
  ev('53', 'OE', 'April 23, 2026', '12:00 PM', 600, 'OE', 'N/A'),

  // ── Event #54: NLH 6-Max ──
  ev('54', 'NLH 6-Max', 'April 23, 2026', '1:00 PM', 10000, 'NLH', 'N/A'),

  // ── Event #55: NLH Larry Frank Memorial Charity ──
  ev('55', 'NLH Larry Frank Memorial Charity', 'April 23, 2026', '7:00 PM', 300, 'NLH', 'N/A', SERIES + ' | benefiting Make-A-Wish Foundation'),

  // ── Event #56: WPT Showdown Championship $3M GTD (2 flights + Days 2-5) ──
  ev('56A', 'WPT Showdown Championship $3M GTD - Flight A', 'April 24, 2026', '11:00 AM', 3500, 'NLH', 'Re-Entry'),
  ev('56B', 'WPT Showdown Championship $3M GTD - Flight B', 'April 25, 2026', '11:00 AM', 3500, 'NLH', 'Re-Entry'),
  ev('56(2)', 'WPT Showdown Championship $3M GTD - Day 2', 'April 26, 2026', '12:00 PM', 0, 'NLH', 'N/A', SERIES, true),
  ev('56(3)', 'WPT Showdown Championship $3M GTD - Day 3', 'April 27, 2026', '12:00 PM', 0, 'NLH', 'N/A', SERIES, true),
  ev('56(4)', 'WPT Showdown Championship $3M GTD - Day 4', 'April 28, 2026', '12:00 PM', 0, 'NLH', 'N/A', SERIES, true),
  ev('56(5)', 'WPT Showdown Championship $3M GTD - Day 5 (TV Final Table)', 'April 29, 2026', '12:00 PM', 0, 'NLH', 'N/A', SERIES, true),

  // ── Event #57: PLO8 ──
  ev('57', 'PLO8', 'April 24, 2026', '12:00 PM', 600, 'PLO8', 'N/A'),

  // ── Event #58: NLH ──
  ev('58', 'NLH', 'April 24, 2026', '5:00 PM', 300, 'NLH', 'N/A'),

  // ── Event #59: Big O ──
  ev('59', 'Big O', 'April 25, 2026', '12:00 PM', 600, 'Big O', 'N/A'),

  // ── Event #60: NLH ──
  ev('60', 'NLH', 'April 25, 2026', '5:00 PM', 200, 'NLH', 'N/A', SERIES + ' | $20,000 GTD'),

  // ── Event #61: NLH $100K GTD ──
  ev('61', 'NLH $100K GTD', 'April 26, 2026', '12:00 PM', 400, 'NLH', 'N/A'),

  // ── Event #62: NLH $500K GTD + Day 2 ──
  ev('62', 'NLH $500K GTD', 'April 26, 2026', '2:00 PM', 10000, 'NLH', 'N/A'),
  ev('62(2)', 'NLH $500K GTD - Day 2', 'April 27, 2026', '1:00 PM', 0, 'NLH', 'N/A', SERIES, true),

  // ── Event #63: Mixed PLO (PLO/PLO8/Big O) ──
  ev('63', 'Mixed PLO (PLO/PLO8/Big O)', 'April 26, 2026', '4:00 PM', 1100, 'Mixed PLO', 'N/A'),

  // ── Event #64: NLH Black Chip Bounty ──
  ev('64', 'NLH Black Chip Bounty', 'April 26, 2026', '6:00 PM', 300, 'NLH', 'N/A'),

  // ── Event #65: NLH Turbo ──
  ev('65', 'NLH Turbo', 'April 26, 2026', '9:00 PM', 1100, 'NLH', 'N/A'),

  // ── Event #66: NLH Savage Average ──
  ev('66', 'NLH Savage Average', 'April 27, 2026', '12:00 PM', 600, 'NLH', 'N/A', SERIES + ' | $50,000 GTD'),

  // ── Event #67: 10-Game Mix ──
  ev('67', '10-Game Mix', 'April 27, 2026', '12:00 PM', 600, '10-Game Mix', 'N/A'),

  // ── Event #68: NLH 8-Handed + Day 2 ──
  ev('68', 'NLH 8-Handed', 'April 27, 2026', '2:00 PM', 3000, 'NLH', 'N/A'),
  ev('68(2)', 'NLH 8-Handed - Day 2', 'April 28, 2026', '12:00 PM', 0, 'NLH', 'N/A', SERIES, true),

  // ── Event #69: NLH Turbo Purple Chip Bounty ──
  ev('69', 'NLH Turbo Purple Chip Bounty', 'April 27, 2026', '8:00 PM', 1100, 'NLH', 'N/A'),

  // ── Event #70: NLH ──
  ev('70', 'NLH', 'April 28, 2026', '11:00 AM', 400, 'NLH', 'N/A'),

  // ── Event #71: NLH 8-Handed $250K GTD ──
  ev('71', 'NLH 8-Handed $250K GTD', 'April 28, 2026', '12:00 PM', 5000, 'NLH', 'N/A'),

  // ── Event #72: PLO 6-Max ──
  ev('72', 'PLO 6-Max', 'April 28, 2026', '2:00 PM', 1100, 'PLO', 'N/A'),

  // ── Event #73: NLH The Closer ──
  ev('73', 'NLH The Closer', 'April 28, 2026', '5:00 PM', 300, 'NLH', 'N/A', SERIES + ' | $30,000 GTD | Added $5,300 SHRPO Seat'),
];

async function main() {
  const SQL = await initSqlJs();
  const dbBuffer = fs.readFileSync('./poker-tournaments.db');
  const db = new SQL.Database(dbBuffer);

  // Check for existing SHRPO events
  const existing = db.exec("SELECT COUNT(*) as c FROM tournaments WHERE venue = 'Seminole Hard Rock'");
  const count = existing[0]?.values[0]?.[0] || 0;
  if (count > 0) {
    console.log(`Found ${count} existing Seminole Hard Rock events. Deleting before re-insert...`);
    db.run("DELETE FROM tournaments WHERE venue = 'Seminole Hard Rock'");
  }

  const stmt = db.prepare(`
    INSERT INTO tournaments (
      event_number, event_name, date, time, buyin,
      reentry, game_variant, venue, notes, source_pdf, is_restart
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let inserted = 0;
  for (const e of events) {
    stmt.run([
      e.event_number, e.event_name, e.date, e.time, e.buyin,
      e.reentry, e.game_variant, VENUE, e.notes, e.source_pdf, e.is_restart
    ]);
    inserted++;
  }
  stmt.free();

  console.log(`Inserted ${inserted} SHRPO events.`);

  // Verify
  const verify = db.exec("SELECT event_number, event_name, date, time, buyin, game_variant, is_restart FROM tournaments WHERE venue = 'Seminole Hard Rock' ORDER BY date, time");
  console.log('\nSample events:');
  verify[0]?.values.slice(0, 10).forEach(r => {
    console.log(`  ${r[0]} | ${r[1]} | ${r[2]} | ${r[3]} | $${r[4]} | ${r[5]}${r[6] ? ' (restart)' : ''}`);
  });
  console.log(`  ... and ${verify[0]?.values.length - 10} more`);

  // Save
  const data = db.export();
  fs.writeFileSync('./poker-tournaments.db', Buffer.from(data));
  console.log('\nDatabase saved.');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

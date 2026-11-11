// utils/bankroll-csv.js: cash sessions (owner, 2026-11-01). The PBT rows are the vendor's published sample
// (pokerbankrolltracker.net/PBT_Bankroll_CSV_example.csv), whose own netprofit / grossprofit columns the
// sessions must reproduce. Times carry no zone, so they are checked in local terms.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCsv, detectPreset, applyPreset, applyMapping, guessMapping, gameLabel, stakesFrom, parseLocalDateTime, kindOf,
} from '../bankroll-csv.js';

const PBT = [
  '---PBT Bankroll Export---,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,',
  'id,starttime,endtime,breakminutes,playingminutes,variant,game,limit,tablesize,location,type,currency,exchangerate,buyin,cashout,netprofit,grossprofit,rebuys,rebuycosts,addoncosts,bounties,bountycosts,smallblind,bigblind,3rdblind,ante,expenses,expensesfromstack,handsperhour,place,player,itm,mttname,startstack,private,casinoid,staking,stakingpercent,sharesincomings,sharesoutgoings,stakingplayer,sessionnote,tags,notes,chipgraph,updatetimes',
  ',2024-09-20 18:51:57,2024-09-21 03:44:00,0,532,Cash Game,Holdem,No Limit,Full-Ring,Valentino,Club,EUR,1,105,680,475,482,1,100,,,,"0,5","0,5",0,0,0,7,25,,,,,,no,0,no,,0,0,,,,,,',
  ',2024-08-17 23:18:30,2024-08-18 04:04:00,0,286,Cash Game,Holdem,No Limit,Full-Ring,Grand Casino Aš,Casino,EUR,1,200,230,-120,-116,1,150,,,,1,2,0,0,0,4,25,,,,,,no,5,no,,0,0,,,BHD Asch 2024,,,',
  ',2024-08-17 20:32:32,2024-08-17 22:30:00,18,99,Tournament,Holdem,No Limit,Full-Ring,Grand Casino Aš,Casino,EUR,1,130,0,-117,-130,0,0,0,0,0,0,0,,0,0,,25,98,171,10,Super Freezeout,20000,no,5,no,,13,0,,,BHD Asch 2024,,,',
  ',2024-05-28 14:29:00,2024-05-28 14:29:00,,,Deposit/Payout,,,,,,EUR,1,0,1060,1060,1060,,,,,,,,,,,,,,,,,,0,0,,,,,,,,,,',
].join('\n');

test('PBT: cash games become cash sessions with PBT\'s own net and gross', () => {
  const rows = parseCsv(PBT);
  const p = detectPreset(rows);
  assert.equal(p.preset.id, 'pbt');
  const out = applyPreset(rows, p);
  assert.deepEqual(out.map((o) => o.row && o.row.type), ['cash', 'cash', 'tournament', 'deposit']);
  const [a, b] = out.map((o) => o.row);
  // net = cash out - buy-in - tips - expenses = PBT netprofit; result (cash out - buy-in) = grossprofit
  assert.deepEqual([a.cashout - a.buyin - a.tips - a.expenses, a.cashout - a.buyin], [475, 482]);
  assert.deepEqual([b.cashout - b.buyin - b.tips - b.expenses, b.cashout - b.buyin], [-120, -116]);
  assert.deepEqual([a.buyin, a.rebuys, a.tips, a.stakes, a.game, a.room, a.currency], [205, 1, 7, '0.5/0.5', 'NLH', 'Valentino', 'EUR']);
  assert.deepEqual([b.stakes, b.room, b.tags], ['1/2', 'Grand Casino Aš', ['BHD Asch 2024']]);
  assert.ok(!out[0].warn && !out[1].warn, 'no net mismatch on the sample');
});

test('PBT: the session starts at the file\'s local time and lasts its playing minutes', () => {
  const [a] = applyPreset(parseCsv(PBT), detectPreset(parseCsv(PBT))).map((o) => o.row);
  const st = new Date(a.startedAt), en = new Date(a.endedAt);
  assert.deepEqual([st.getFullYear(), st.getMonth() + 1, st.getDate(), st.getHours(), st.getMinutes()], [2024, 9, 20, 18, 51]);
  assert.equal(a.date, '2024-09-20', 'the local day it started, not the UTC one');
  assert.equal((en - st) / 60000, 532);
});

test('PBT: a net that does not reconcile is flagged in the preview', () => {
  const bad = PBT.replace('105,680,475,482', '105,680,400,482');
  const out = applyPreset(parseCsv(bad), detectPreset(parseCsv(bad)));
  assert.match(out[0].warn, /PBT's net is 400/);
});

test('games and stakes as the app names them', () => {
  assert.deepEqual(
    [gameLabel('Holdem', 'No Limit'), gameLabel("Texas Hold'em", 'Fixed Limit'), gameLabel('Omaha', 'Pot Limit'),
      gameLabel('Omaha Hi/Lo', 'Pot Limit'), gameLabel('5 Card Omaha', 'Pot Limit'), gameLabel('Omaha Hi-Lo', 'Limit'),
      gameLabel('Seven Card Stud', ''), gameLabel('Razz', ''), gameLabel('HORSE', ''), gameLabel('Badugi', 'Limit')],
    ['NLH', 'LHE', 'PLO', 'PLO8', 'PLO5', 'O8', 'Stud Hi', 'Razz', 'Mixed', 'Limit Badugi']);
  assert.deepEqual([stakesFrom('1', '2'), stakesFrom('0,5', '1'), stakesFrom('1', '2', '5'), stakesFrom('', '2')], ['1/2', '0.5/1', '1/2/5', '']);
});

test('times: 24h, am/pm, a date alone is noon and untimed', () => {
  const a = parseLocalDateTime('2026-10-30 21:15');
  assert.deepEqual([a.at.getHours(), a.at.getMinutes(), a.timed], [21, 15, true]);
  assert.equal(parseLocalDateTime('10/30/2026 9:05 PM').at.getHours(), 21);
  assert.equal(parseLocalDateTime('10/30/2026 12:30 am').at.getHours(), 0);
  const d = parseLocalDateTime('2026-10-30');
  assert.deepEqual([d.at.getHours(), d.timed], [12, false]);
  assert.equal(parseLocalDateTime('soon'), null);
});

test('the column matching reads cash sessions: by end time, or by hours', () => {
  const rows = parseCsv('Start,End,Hours,Location,Stakes,Game,Buy In,Cash Out,Tips\n'
    + '2026-10-30 19:00,2026-10-31 01:30,,Parx,$2/$5,NLH,1000,1650,20\n'
    + '2026-10-29 20:00,,4.5,Live! Casino,1-3,PLO,500,300,\n'
    + '2026-10-28 20:00,,,Borgata,1/3,NLH,300,500,\n');
  const m = guessMapping(rows[0]);
  const out = applyMapping(rows, m, { rowsAre: 'cash' });
  assert.deepEqual(out.map((o) => (o.row ? 'row' : o.error)), ['row', 'row', 'No end time or length']);
  const [a, b] = out.map((o) => o.row);
  assert.deepEqual([a.room, a.stakes, a.game, a.buyin, a.cashout, a.tips], ['Parx', '$2/$5', 'NLH', 1000, 1650, 20]);
  assert.equal((new Date(a.endedAt) - new Date(a.startedAt)) / 3600000, 6.5);
  assert.equal((new Date(b.endedAt) - new Date(b.startedAt)) / 3600000, 4.5);
});

test('"Both": a type column splits cash from tournaments; anything else is left out with its value', () => {
  assert.deepEqual([kindOf('Cash Game'), kindOf('Tournament'), kindOf('MTT'), kindOf('Sit & Go'), kindOf('Ring'), kindOf('Expense')],
    ['cash', 'tournament', 'tournament', 'tournament', 'cash', null]);
  const rows = parseCsv('Type,Date,Hours,Name,Location,Buy-in,Cash\n'
    + 'Cash,2026-10-30 19:00,5,,Parx,600,900\n'
    + 'Tournament,2026-10-29,,Sunday Deepstack,Borgata,400,0\n'
    + 'Expense,2026-10-28,,Parking,,20,\n');
  const out = applyMapping(rows, guessMapping(rows[0]), { rowsAre: 'mixed' });
  assert.deepEqual(out.map((o) => (o.row ? o.row.type : o.skip)), ['cash', 'tournament', 'Type "Expense" (only cash and tournament rows import)']);
  assert.deepEqual([out[1].row.name, out[1].row.note], ['Sunday Deepstack', 'Borgata']);
});

test('a column picker shows the first values the column holds, blanks skipped (Bankroll design 81)', async () => {
  const { columnSample } = await import('../bankroll-csv.js');
  const rows = [['Date', 'Event', 'Buy-in'], ['2026-01-02', '', '100'], ['2026-01-05', 'Daily', ''], ['2026-01-09', 'Main', '200'], ['2026-01-10', 'Mega', '50']];
  assert.deepEqual(columnSample(rows, 1), ['Daily', 'Main', 'Mega']);
  assert.deepEqual(columnSample(rows, 2, 2), ['100', '200']);
  assert.deepEqual(columnSample(rows, -1), []);
  assert.deepEqual(columnSample(null, 0), []);
});

test('a day-first file is read day first on every row (App improvements 208)', async () => {
  const { applyMapping, detectDateOrder } = await import('../bankroll-csv.js');
  const rows = [['Date', 'Event', 'Buy-in', 'Winnings'], ['02/03/2024', 'NLH', '100', '0'], ['09/03/2024', 'PLO Bounty', '200', '0'], ['13/04/2024', 'NLH', '100', '300']];
  assert.deepEqual(detectDateOrder(rows, 0), { order: 'day', line: 4, value: '13/04/2024', conflict: false });
  const items = applyMapping(rows, { date: 0, name: 1, buyin: 2, cash: 3 }, { rowsAre: 'tournament' });
  assert.deepEqual(items.filter((i) => i.row).map((i) => i.row.date), ['2024-03-02', '2024-03-09', '2024-04-13']);
  // Both orders in one file: the rows that disagree are errors, not read the other way.
  const mixed = [['Date', 'Event', 'Buy-in', 'Winnings'], ['13/04/2024', 'A', '1', '0'], ['04/13/2024', 'B', '1', '0']];
  assert.equal(detectDateOrder(mixed, 0).conflict, true);
});

// The running cash session on the lock screen (owner, 2026-11-18): cashPlay turns the live session store's session
// and stack updates into what the Live Activity draws, Home's cash card's own figures as text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cashPlay } from '../live-activity.js';

const session = {
  id: 7, live: true, game: 'NLH', stakes: '2/5', room: 'Parx', currency: 'USD',
  buy_in: 1000, rebuys: 1, started_at: '2026-11-18T19:30:00.000Z',
};
const since = new Date(Date.parse(session.started_at)).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

test('no session, no play', () => {
  assert.equal(cashPlay(null, []), null);
  assert.equal(cashPlay({ ...session, started_at: null }, []), null);
});

test("a session with a stack update: the card's figures", () => {
  const p = cashPlay(session, [{ amount: 1840, invested: 1000, at: '2026-11-18T21:00:00.000Z' }], { strip: '#123456' });
  assert.equal(p.id, 'cash-7');
  assert.equal(p.kind, 'cash');
  assert.equal(p.event, 'NLH 2/5');
  assert.equal(p.room, 'Parx');
  assert.equal(p.stripLabel, 'Parx');
  assert.equal(p.strip, '#123456');
  assert.equal(p.inPlay, '$1,000');
  assert.equal(p.stackText, '$1,840');
  assert.equal(p.stackLabel, 'Stack +$840');
  assert.equal(p.result, '+$840');
  assert.equal(p.startedAt, Date.parse(session.started_at));
  assert.equal(p.note, `Since ${since} · 1 rebuy`);
});

test('before the first stack update: no stack, "No update yet"', () => {
  const p = cashPlay({ ...session, rebuys: 0, room: '' }, []);
  assert.equal(p.stackText, '');
  assert.equal(p.result, '');
  assert.equal(p.stackLabel, 'No update yet');
  assert.equal(p.stripLabel, 'Cash game');
  assert.equal(p.note, `Since ${since}`);
});

test("a loss reads with a real minus, and the stack's own result wins", () => {
  const p = cashPlay(session, [{ amount: 600, invested: 1000, result: -400 }]);
  assert.equal(p.stackLabel, 'Stack −$400');
  assert.equal(p.result, '−$400');
});

test("the clock starts on this device's clock: the server's start less the skew", () => {
  const p = cashPlay(session, [], { skew: 5000 });
  assert.equal(p.startedAt, Date.parse(session.started_at) - 5000);
});

test('the session currency', () => {
  const p = cashPlay({ ...session, currency: 'EUR' }, [{ amount: 1500, invested: 1000 }], { cur: { symbol: '€', pos: 'pre' } });
  assert.equal(p.inPlay, '€1,000');
  assert.equal(p.stackLabel, 'Stack +€500');
});

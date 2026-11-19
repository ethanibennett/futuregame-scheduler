// Quick add's dictation (owner, 2026-11-19): a session's text rebuilt from every result, so a result
// the recogniser sends again is written once; what each error means.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionTranscript, joinText, dictationError } from '../quick-add/dictation.js';

const R = (transcript, isFinal) => ({ transcript, isFinal });

test('finals in order, the interim after them', () => {
  const t = sessionTranscript([R('UTG opens to fifteen', true), R(' I three bet', true), R('to forty', false)]);
  assert.equal(t.final, 'UTG opens to fifteen I three bet');
  assert.equal(t.interim, 'to forty');
});

test('a final sent as the whole transcript so far replaces the one before it (iOS Safari)', () => {
  const t = sessionTranscript([R('UTG opens to fifteen', true), R('UTG opens to fifteen I three bet to forty five', true)]);
  assert.equal(t.final, 'UTG opens to fifteen I three bet to forty five');
});

test('the same final sent twice is written once; an interim that repeats it adds nothing', () => {
  const t = sessionTranscript([R('flop king seven deuce', true), R('flop king seven deuce', true), R('king seven deuce', false)]);
  assert.equal(t.final, 'flop king seven deuce');
  assert.equal(t.interim, '');
});

test('short finals are never folded together ("check" then "check call")', () => {
  const t = sessionTranscript([R('check', true), R('check call', true)]);
  assert.equal(t.final, 'check check call');
});

test('joinText: one space between, nothing added for nothing said', () => {
  assert.equal(joinText('', 'I raise'), 'I raise');
  assert.equal(joinText('1/3 live.', 'I raise'), '1/3 live. I raise');
  assert.equal(joinText('1/3 live. ', 'I raise'), '1/3 live. I raise');
  assert.equal(joinText('1/3 live.', '  '), '1/3 live.');
});

test('a pause is not a failure; a refusal and a lost connection say what happened', () => {
  assert.equal(dictationError('no-speech').stop, false);
  assert.equal(dictationError('aborted').stop, false);
  assert.equal(dictationError('not-allowed').kind, 'denied');
  assert.match(dictationError('network').message, /connection/);
  assert.equal(dictationError('anything-else').stop, true);
});

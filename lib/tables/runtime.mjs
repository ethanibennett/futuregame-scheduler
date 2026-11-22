// One play-money table: its seats, the button, the clock, and the hand in progress (docs/play-money-platform.md §3).
//
// The table owns WHO sits where; the hand itself is utils/poker-rules/live-hand.js, which owns the cards and the
// rules. Every change bumps `version` and calls onChange (the service journals the table and streams each
// viewer its own view). A finished hand goes to onHandDone (the service sends it to the scheduler's archive).
//
// Time and randomness come in through `env` so a test can drive the clock and fix the deck.
import { startHand, act as handAct, viewFor as handView, savedHandFor, timeoutMove, currentState } from '../../vite-app/src/utils/poker-rules/live-hand.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export class Table {
  /**
   * cfg: { id, name, hostId, gameType, blinds: { sb, bb, ante }, maxSeats (2-9), buyIn: { min, max },
   *        clock: { decision (s), bank (s) }, inviteToken? }
   * env: { now(), setTimer(fn, ms) -> handle, clearTimer(handle), shuffle() -> deck, commit(deck) -> { salt, hash },
   *        onChange(table), onHandDone(table, record), onCashOut(table, { userId, amount }), handGapMs }
   */
  constructor(cfg, env, saved = null) {
    this.cfg = cfg;
    this.env = env;
    this.seats = saved ? saved.seats : new Array(cfg.maxSeats).fill(null);
    this.button = saved ? saved.button : -1;
    this.handNo = saved ? saved.handNo : 0;
    this.hand = saved ? saved.hand : null;          // live-hand state
    this.handSeats = saved ? saved.handSeats : null; // hand player index -> table seat index
    this.deck = saved ? saved.deck : null;           // { salt, hash } of the hand's deck
    this.lastHand = saved ? saved.lastHand : null;   // { state, handSeats } of the hand just finished, shown until the next
    this.closing = saved ? !!saved.closing : false;
    this.closed = saved ? !!saved.closed : false;
    this.deadline = null;
    this.version = saved ? saved.version || 0 : 0;
    this.timer = null;
    this.startTimer = null;
    if (this.hand && this.hand.phase === 'betting') this.armClock(true);
    else this.scheduleStart();
  }

  toJSON() {
    return {
      cfg: this.cfg, seats: this.seats, button: this.button, handNo: this.handNo, hand: this.hand, handSeats: this.handSeats,
      deck: this.deck, lastHand: this.lastHand, closing: this.closing, closed: this.closed, version: this.version,
    };
  }

  changed() { this.version++; this.env.onChange(this); }

  seatOf(userId) { return this.seats.findIndex((s) => s && s.userId === userId); }

  /* ── Seats ── */

  sit(userId, name, stack, seatIdx = null) {
    if (this.closed || this.closing) return { error: 'This table is closing' };
    if (this.seatOf(userId) >= 0) return { error: 'You are already seated' };
    const want = seatIdx == null ? this.seats.findIndex((s) => !s) : Number(seatIdx);
    if (!(want >= 0 && want < this.seats.length)) return { error: 'The table is full' };
    if (this.seats[want]) return { error: 'That seat is taken' };
    const { min, max } = this.cfg.buyIn;
    if (!(stack >= min && stack <= max)) return { error: `Buy in for ${min} to ${max}` };
    this.seats[want] = { userId, name, stack, status: 'playing', bank: this.cfg.clock.bank, timeouts: 0 };
    this.changed();
    this.scheduleStart();
    return { ok: true, seat: want };
  }

  /* Back in after sitting out. */
  sitIn(userId) {
    const i = this.seatOf(userId);
    if (i < 0) return { error: 'Not seated' };
    const s = this.seats[i];
    if (s.stack <= 0) return { error: 'Buy in again first' };
    s.status = 'playing'; s.timeouts = 0;
    this.changed();
    this.scheduleStart();
    return { ok: true };
  }

  sitOut(userId) {
    const i = this.seatOf(userId);
    if (i < 0) return { error: 'Not seated' };
    this.seats[i].status = 'sitting-out';
    this.changed();
    this.autoActIfDue();
    return { ok: true };
  }

  /* A busted seat buys in again (the chips come from the player's balance; the service has taken them). */
  rebuy(userId, stack) {
    const i = this.seatOf(userId);
    if (i < 0) return { error: 'Not seated' };
    if (this.inHand(i)) return { error: 'After this hand' };
    const s = this.seats[i];
    const { max } = this.cfg.buyIn;
    if (!(stack > 0 && s.stack + stack <= max)) return { error: `Up to ${max} at the table` };
    s.stack += stack; s.status = 'playing'; s.timeouts = 0;
    this.changed();
    this.scheduleStart();
    return { ok: true };
  }

  /* Leaving returns the stack to the player's balance: at once between hands, after the hand if they are in it. */
  leave(userId) {
    const i = this.seatOf(userId);
    if (i < 0) return { error: 'Not seated' };
    if (this.inHand(i)) {
      this.seats[i].status = 'leaving';
      this.changed();
      this.autoActIfDue();
      return { ok: true, after: true };
    }
    this.standUp(i);
    return { ok: true };
  }

  standUp(i) {
    const s = this.seats[i];
    if (!s) return;
    this.seats[i] = null;
    if (s.stack > 0) this.env.onCashOut(this, { userId: s.userId, amount: s.stack });
    this.changed();
  }

  close() {
    this.closing = true;
    if (!this.hand || this.hand.phase !== 'betting') this.finishClose();
    else this.changed();
  }

  finishClose() {
    for (let i = 0; i < this.seats.length; i++) if (this.seats[i]) this.standUp(i);
    this.closed = true;
    this.clearTimers();
    this.changed();
  }

  /* ── Hands ── */

  inHand(tableSeat) {
    return !!(this.hand && this.hand.phase === 'betting' && this.handSeats && this.handSeats.includes(tableSeat));
  }

  dealable() {
    return this.seats.map((s, i) => (s && s.status === 'playing' && s.stack > 0 ? i : -1)).filter((i) => i >= 0);
  }

  scheduleStart() {
    if (this.closed || this.closing || this.startTimer) return;
    if (this.hand && this.hand.phase === 'betting') return;
    if (this.dealable().length < 2) return;
    const gap = this.lastHand ? this.env.handGapMs : Math.min(this.env.handGapMs, 1000);
    this.startTimer = this.env.setTimer(() => { this.startTimer = null; this.deal(); }, gap);
  }

  /* The next hand: the button moves one dealt-in seat, the players are laid out in the replayer's position order. */
  deal() {
    if (this.closed || this.closing) return;
    const ready = this.dealable();
    if (ready.length < 2) return;
    const nextAfter = (from) => { for (let k = 1; k <= this.seats.length; k++) { const i = (from + k) % this.seats.length; if (ready.includes(i)) return i; } return ready[0]; };
    this.button = this.button < 0 ? ready[0] : nextAfter(this.button);
    const clockwise = [this.button];
    while (clockwise.length < ready.length) clockwise.push(nextAfter(clockwise[clockwise.length - 1]));
    // Replayer order: heads-up [BTN/SB, BB]; three-handed [BTN, SB, BB]; else [UTG ... CO, BTN, SB, BB].
    const order = clockwise.length <= 3 ? clockwise : clockwise.slice(3).concat(clockwise.slice(0, 3));
    const deck = this.env.shuffle();
    this.deck = this.env.commit(deck);
    this.handNo++;
    this.handSeats = order;
    for (const i of order) this.seats[i].timeouts = this.seats[i].timeouts || 0;
    this.hand = startHand({
      gameType: this.cfg.gameType, blinds: this.cfg.blinds, deck, handId: `${this.cfg.id}-${this.handNo}`,
      seats: order.map((i) => ({ id: this.seats[i].userId, name: this.seats[i].name, stack: this.seats[i].stack })),
    });
    this.afterMove();
  }

  /* After any change to the hand: arm the clock for the next player, or wrap the hand up. */
  afterMove() {
    if (this.hand.phase === 'over') { this.endHand(); return; }
    this.armClock(false);
    this.changed();
    this.autoActIfDue();
  }

  /* A seat that is sitting out or leaving acts at once, as its clock would. */
  autoActIfDue() {
    if (!this.hand || this.hand.phase !== 'betting') return;
    const st = currentState(this.hand);
    if (!st.legal) return;
    const seat = this.seats[this.handSeats[st.legal.player]];
    if (seat && seat.status !== 'playing') this.forceMove(st.legal.player);
  }

  forceMove(handPlayer) {
    const move = timeoutMove(this.hand);
    if (!move) return;
    handAct(this.hand, handPlayer, move);
    this.afterMove();
  }

  act(userId, move) {
    const i = this.seatOf(userId);
    if (!this.hand || this.hand.phase !== 'betting') return { error: 'No hand in progress' };
    const p = this.handSeats.indexOf(i);
    if (p < 0) return { error: 'You are not in this hand' };
    const r = handAct(this.hand, p, move);
    if (r.error) return r;
    this.seats[i].timeouts = 0;
    this.afterMove();
    return { ok: true };
  }

  /* ── The clock (owner, 2026-11-22, decision 7: the host sets the time per decision and the bank) ── */

  armClock(resume) {
    this.clearTimer();
    const st = currentState(this.hand);
    if (!st.legal) { this.deadline = null; return; }
    const ms = this.cfg.clock.decision * 1000;
    this.deadline = this.env.now() + ms;
    this.clockFor = st.legal.player;
    this.usingBank = false;
    this.timer = this.env.setTimer(() => this.onTimeout(), resume ? ms : ms);
  }

  onTimeout() {
    this.timer = null;
    if (!this.hand || this.hand.phase !== 'betting') return;
    const st = currentState(this.hand);
    if (!st.legal || st.legal.player !== this.clockFor) return;
    const seat = this.seats[this.handSeats[st.legal.player]];
    if (seat && !this.usingBank && seat.bank > 0) {
      // Into the time bank, all of it: what is not used is gone (v1).
      const ms = seat.bank * 1000;
      seat.bank = 0;
      this.usingBank = true;
      this.deadline = this.env.now() + ms;
      this.timer = this.env.setTimer(() => this.onTimeout(), ms);
      this.changed();
      return;
    }
    if (seat) {
      seat.timeouts = (seat.timeouts || 0) + 1;
      if (seat.timeouts >= 2) seat.status = 'sitting-out';
    }
    this.forceMove(st.legal.player);
  }

  clearTimer() { if (this.timer) { this.env.clearTimer(this.timer); this.timer = null; } }
  clearTimers() { this.clearTimer(); if (this.startTimer) { this.env.clearTimer(this.startTimer); this.startTimer = null; } }

  endHand() {
    this.clearTimer();
    this.deadline = null;
    const state = this.hand;
    const handSeats = this.handSeats;
    handSeats.forEach((ts, p) => { if (this.seats[ts]) this.seats[ts].stack = state.result.finals[p]; });
    const record = {
      tableId: this.cfg.id, tableName: this.cfg.name, handNo: this.handNo, handId: state.handId, deckHash: this.deck && this.deck.hash,
      players: handSeats.map((ts, p) => ({ userId: state.ids[p], hand: savedHandFor(state, p), net: state.result.net[p], stack: state.result.finals[p] })),
    };
    this.lastHand = { state, handSeats };
    this.hand = null;
    this.handSeats = null;
    this.env.onHandDone(this, record);
    // Who stands up after the hand: those leaving; a busted seat stays, to buy in again.
    for (let i = 0; i < this.seats.length; i++) {
      const s = this.seats[i];
      if (s && s.status === 'leaving') this.standUp(i);
      else if (s && s.stack <= 0) s.status = 'busted';
    }
    if (this.closing) { this.finishClose(); return; }
    this.changed();
    this.scheduleStart();
  }

  /* ── What one viewer sees ── */

  viewFor(userId) {
    const mySeat = this.seatOf(userId);
    const cur = this.hand ? { state: this.hand, handSeats: this.handSeats } : this.lastHand;
    let hand = null;
    if (cur) {
      const p = cur.handSeats.indexOf(mySeat);
      const v = handView(cur.state, p);
      hand = { ...v, seatOf: cur.handSeats, handNo: this.hand ? this.handNo : this.handNo, you: p };
    }
    return {
      table: {
        id: this.cfg.id, name: this.cfg.name, gameType: this.cfg.gameType, blinds: this.cfg.blinds, maxSeats: this.cfg.maxSeats,
        buyIn: this.cfg.buyIn, clock: this.cfg.clock, hostId: this.cfg.hostId, closed: this.closed, closing: this.closing,
        button: this.button, handNo: this.handNo, version: this.version,
        deadline: this.deadline, deadlineIn: this.deadline != null ? clamp(this.deadline - this.env.now(), 0, 1e9) : null,
        you: mySeat,
        seats: this.seats.map((s) => (s ? { name: s.name, stack: s.stack, status: s.status, bank: s.bank } : null)),
      },
      hand,
    };
  }
}

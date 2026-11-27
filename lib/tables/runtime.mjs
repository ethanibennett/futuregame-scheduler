// One play-money table: its seats, the button, the clock, and the hand in progress (docs/play-money-platform.md §3).
//
// The table owns WHO sits where; the hand itself is utils/poker-rules/live-hand.js, which owns the cards and the
// rules. Every change bumps `version` and calls onChange (the service journals the table and streams each
// viewer its own view). A finished hand goes to onHandDone (the service sends it to the scheduler's archive).
//
// Time and randomness come in through `env` so a test can drive the clock and fix the deck.
import { startHand, act as handAct, viewFor as handView, savedHandFor, timeoutMove, toAct, gameKind } from '../../vite-app/src/utils/poker-rules/live-hand.js';
import { stakesAt, levelAt, levelEndsAt, prizesFor, placeBusts } from './sng.mjs';

/* A finished sit and go stays open this long, so everyone can see the result, then closes. */
const SNG_LINGER_MS = 30 * 60000;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const CHAT_MAX = 280;            // characters in a message
const CHAT_KEEP = 100;           // messages a table keeps
const CHAT_SHOWN = 50;           // messages each view carries
const CHAT_PER_WINDOW = 5;       // messages a player may send ...
const CHAT_WINDOW_MS = 10000;    // ... in this long

export class Table {
  /**
   * cfg: { id, name, hostId, gameType, blinds: { sb, bb, ante }, maxSeats (2-9), buyIn: { min, max },
   *        clock: { decision (s), bank (s) }, startGate?, format?: 'cash' | 'sng',
   *        sng?: { buyIn (balance chips), stack (tournament chips), levelMins } }
   * env: { now(), setTimer(fn, ms) -> handle, clearTimer(handle), shuffle() -> deck, commit(deck) -> { salt, hash },
   *        onChange(table), onHandDone(table, record), onCashOut(table, { userId, amount, kind? }), onFinish?(table, result),
   *        handGapMs }
   *
   * A sit and go (cfg.format 'sng'; owner, 2026-11-26): each player pays cfg.sng.buyIn from their balance to sit
   * (the service takes it) and is seated with cfg.sng.stack tournament chips; leaving before the start gives the
   * buy-in back. Once started nobody joins and nobody buys again; the blinds go up the LADDER every levelMins (at the
   * next hand); a seat sitting out is still dealt and blinded; a player with no chips is out, placed (sng.mjs
   * placeBusts) and taken off the table; the last one with chips wins. The prizes (sng.mjs prizesFor) go to the
   * balances as each place is decided. A host closing a game in progress chops what is left of the pool among the
   * players still in, by their chips.
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
    this.chat = saved && saved.chat ? saved.chat : [];    // [{ id, userId, name, text, at }], the last CHAT_KEEP
    this.muted = saved && saved.muted ? saved.muted : []; // user ids the host has muted
    this.lastSaid = new Map();                            // user id -> times of their recent messages (not journaled)
    this.closing = saved ? !!saved.closing : false;
    this.closed = saved ? !!saved.closed : false;
    /* A table made with startGate deals nothing until the game is started (startGame: the host, or anyone seated
       when the host is not), or until every seat is taken; everyone seated by then is dealt the first hand
       (owner, 2026-11-26: eight players at once; until then the first two to sit started heads-up and everyone
       after them waited for the big blind). A table made before the gate, or without it, has always started. */
    this.started = saved ? (saved.started != null ? !!saved.started : true) : !cfg.startGate;
    // A sit and go's own state: who entered, the places decided, the level being dealt and its stakes, the prizes.
    this.sng = saved && saved.sng ? saved.sng : (cfg.format === 'sng'
      ? { buyIn: cfg.sng.buyIn, stack: cfg.sng.stack, levelMins: cfg.sng.levelMins, base: { ...cfg.blinds },
        entrants: [], places: [], prizes: [], level: 0, blinds: { ...cfg.blinds }, startedAt: null, finished: false, finishedAt: null, cancelled: false }
      : null);
    this.deadline = null;
    this.version = saved ? saved.version || 0 : 0;
    this.timer = null;
    this.startTimer = null;
    this.lingerTimer = null;
    if (this.sng && this.sng.finished && !this.closed) this.linger();
    else if (this.hand && this.hand.phase !== 'over') this.armClock(true);
    else this.scheduleStart();
  }

  get isSng() { return !!this.sng; }
  /* The stakes the next hand is dealt at. */
  get blindsNow() { return this.sng ? this.sng.blinds : this.cfg.blinds; }

  toJSON() {
    return {
      cfg: this.cfg, seats: this.seats, button: this.button, handNo: this.handNo, hand: this.hand, handSeats: this.handSeats,
      deck: this.deck, lastHand: this.lastHand, closing: this.closing, closed: this.closed, version: this.version,
      chat: this.chat, muted: this.muted, started: this.started, sng: this.sng,
    };
  }

  /* ── The start ── */

  /* Who may start the game: the host, or, while the host is not seated, anyone who is. */
  canStart(userId) {
    if (this.started || this.closed || this.closing) return false;
    return userId === this.cfg.hostId || (this.seatOf(this.cfg.hostId) < 0 && this.seatOf(userId) >= 0);
  }

  startGame(userId) {
    if (this.started) return { error: 'The game has started' };
    if (!this.canStart(userId)) return { error: 'The host starts the game' };
    if (this.dealable().length < 2) return { error: 'Two players at least' };
    this.begin();
    this.changed();
    this.scheduleStart();
    return { ok: true };
  }

  /* The game starts: a sit and go closes its entries, sets its prizes and starts its clock. */
  begin() {
    this.started = true;
    if (!this.sng) return;
    const s = this.sng;
    s.entrants = this.seats.filter(Boolean).map((x) => ({ userId: x.userId, name: x.name }));
    s.prizes = prizesFor(s.entrants.length, s.buyIn);
    s.startedAt = this.env.now();
    s.level = 0;
    s.blinds = stakesAt(this.cfg.gameType, s.base, 0);
  }

  /* ── Chat (owner, 2026-11-22, decision 6: free text). Anyone at the table may write; the host may mute a
     player; a message can be reported to the scheduler's Admin inbox, which can remove it (doc §11). ── */

  say(userId, name, text) {
    if (this.closed) return { error: 'This table is closed' };
    const t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    if (!t) return { error: 'Type a message' };
    if (t.length > CHAT_MAX) return { error: `${CHAT_MAX} characters at most` };
    if (this.muted.includes(userId)) return { error: 'The host has muted you at this table' };
    const now = this.env.now();
    const recent = (this.lastSaid.get(userId) || []).filter((at) => now - at < CHAT_WINDOW_MS);
    if (recent.length >= CHAT_PER_WINDOW) return { error: 'Slow down a little' };
    recent.push(now);
    this.lastSaid.set(userId, recent);
    // Ids unique across tables (a report names the message by its id alone): the time, and a count within it.
    const last = this.chat.length ? this.chat[this.chat.length - 1].id : 0;
    const id = Math.max(now * 100, last + 1);
    this.chat.push({ id, userId, name, text: t, at: now });
    if (this.chat.length > CHAT_KEEP) this.chat.splice(0, this.chat.length - CHAT_KEEP);
    this.changed();
    return { ok: true, id };
  }

  mute(byUserId, userId, on) {
    if (byUserId !== this.cfg.hostId) return { error: 'Only the host can mute' };
    if (userId === byUserId) return { error: 'That is you' };
    this.muted = this.muted.filter((u) => u !== userId);
    if (on) this.muted.push(userId);
    this.changed();
    return { ok: true };
  }

  message(id) { return this.chat.find((m) => m.id === Number(id)) || null; }

  removeMessage(id) {
    const before = this.chat.length;
    this.chat = this.chat.filter((m) => m.id !== Number(id));
    if (this.chat.length !== before) this.changed();
    return { ok: true, removed: before - this.chat.length };
  }

  changed() { this.version++; this.env.onChange(this); }

  seatOf(userId) { return this.seats.findIndex((s) => s && s.userId === userId); }

  /* ── Seats ── */

  sit(userId, name, stack, seatIdx = null) {
    if (this.closed || this.closing) return { error: 'This table is closing' };
    if (this.sng && this.started) return { error: 'This sit and go has started' };
    if (this.seatOf(userId) >= 0) return { error: 'You are already seated' };
    const want = seatIdx == null ? this.seats.findIndex((s) => !s) : Number(seatIdx);
    if (!(want >= 0 && want < this.seats.length)) return { error: 'The table is full' };
    if (this.seats[want]) return { error: 'That seat is taken' };
    const { min, max } = this.cfg.buyIn;
    if (!(stack >= min && stack <= max)) return { error: `Buy in for ${min} to ${max}` };
    /* Into a game already going, a new seat waits for the big blind to reach it (doc §3): nobody comes in on the
       button or dodges the blinds by moving. A table with fewer than two in play starts afresh instead. */
    // Stud has no blinds to wait for: a new seat is dealt the next hand.
    const going = this.handNo > 0 && this.regulars().length >= 2 && gameKind(this.cfg.gameType) !== 'stud';
    this.seats[want] = { userId, name, stack, status: 'playing', bank: this.cfg.clock.bank, timeouts: 0, waiting: going };
    this.changed();
    this.scheduleStart();
    return { ok: true, seat: want };
  }

  /* Post to come in at once (owner, 2026-11-22: "Build the post to come in now too"): a seat waiting for the big
     blind posts one from where it sits and is dealt the next hand, unless that hand would put it in the small blind
     (or on the button), where it waits for the button to pass as before. The post is a live big blind: it changes
     nobody's turn, and with no raise the poster has the option (utils/poker-rules/betting.js postOf). `on` false
     goes back to waiting. */
  postIn(userId, on = true) {
    const i = this.seatOf(userId);
    if (i < 0) return { error: 'Not seated' };
    const s = this.seats[i];
    if (!s.waiting) return { error: on ? 'You are already dealt in' : 'Not waiting' };
    s.postNow = !!on;
    this.changed();
    this.scheduleStart();
    return { ok: true };
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
    if (this.sng) return { error: 'No rebuys in a sit and go' };
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
    // In a sit and go under way the chips are the tournament's: a player who goes is blinded off, never paid out.
    if (this.sng && this.started && !this.sng.finished) return { error: 'The game is on: sit out instead, and you keep your seat' };
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
    if (!this.sng) {
      if (s.stack > 0) this.env.onCashOut(this, { userId: s.userId, amount: s.stack });
    } else if (!this.started) {
      // Off a sit and go's list before it starts: the buy-in comes back. Once it has started, a seat's chips are
      // tournament chips (a winner's prize was paid when the place was decided).
      this.env.onCashOut(this, { userId: s.userId, amount: this.sng.buyIn, kind: 'refund' });
    }
    this.changed();
  }

  close() {
    this.closing = true;
    if (!this.hand || this.hand.phase === 'over') this.finishClose();
    else this.changed();
  }

  finishClose() {
    // A sit and go closed while it is on: what is left of the pool (the buy-ins less the prizes already paid) is
    // chopped among the players still in by the chips each holds, the odd chips to the biggest stack. A player
    // already out has what their place paid, as they would have anyway.
    const s = this.sng;
    if (s && this.started && !s.finished && !s.cancelled) {
      s.cancelled = true;
      const left = this.seats.map((x, i) => ({ x, i })).filter(({ x }) => x && x.stack > 0).sort((a, b) => b.x.stack - a.x.stack || a.i - b.i);
      const pool = s.entrants.length * s.buyIn - s.places.reduce((a, p) => a + (p.prize || 0), 0);
      const chips = left.reduce((a, { x }) => a + x.stack, 0);
      const shares = left.map(({ x }) => (chips > 0 ? Math.floor((pool * x.stack) / chips) : 0));
      if (shares.length) shares[0] += pool - shares.reduce((a, b) => a + b, 0);
      left.forEach(({ x }, k) => {
        s.places.push({ userId: x.userId, name: x.name, place: null, prize: shares[k], chop: true });
        if (shares[k] > 0) this.env.onCashOut(this, { userId: x.userId, amount: shares[k], kind: 'prize' });
      });
    }
    for (let i = 0; i < this.seats.length; i++) if (this.seats[i]) this.standUp(i);
    this.closed = true;
    this.clearTimers();
    this.changed();
  }

  /* A finished sit and go stays to be looked at, then closes (journaled: a restart re-arms it). */
  linger() {
    if (this.lingerTimer) return;
    const left = Math.max(0, (this.sng.finishedAt || this.env.now()) + SNG_LINGER_MS - this.env.now());
    this.lingerTimer = this.env.setTimer(() => { this.lingerTimer = null; if (!this.closed) this.finishClose(); }, left);
  }

  /* ── Hands ── */

  inHand(tableSeat) {
    return !!(this.hand && this.hand.phase !== 'over' && this.handSeats && this.handSeats.includes(tableSeat));
  }

  dealable() {
    // A sit and go under way deals every seat with chips, one sitting out included (it is blinded and folded).
    const all = this.sng && this.started;
    return this.seats.map((s, i) => (s && (all || s.status === 'playing') && s.stack > 0 ? i : -1)).filter((i) => i >= 0);
  }

  /* The dealable seats that are not waiting for the big blind. */
  regulars() { return this.dealable().filter((i) => !this.seats[i].waiting); }

  /* Who is dealt in, and the button: the button moves one regular seat; a waiting seat comes in only where this
     hand makes it the big blind (heads-up the second seat from the button, else the third), or, if it chose to post
     (postIn), anywhere but the small blind. Dropping a waiter can move the blinds onto another, so it is settled again
     until nothing changes. `posts`: the seats dealt in on a post (not those that came in as the big blind). */
  lineUp() {
    // Stud: no button and no blinds; everyone dealable plays, in table order (each seat's position is its number).
    if (gameKind(this.cfg.gameType) === 'stud') {
      for (const i of this.dealable()) this.seats[i].waiting = false;
      return { button: -1, clockwise: this.dealable(), posts: [] };
    }
    let regulars = this.regulars();
    if (regulars.length < 2) {
      for (const i of this.dealable()) this.seats[i].waiting = false;
      regulars = this.dealable();
    }
    const nextIn = (list, from) => { for (let k = 1; k <= this.seats.length; k++) { const i = (from + k) % this.seats.length; if (list.includes(i)) return i; } return list[0]; };
    const button = this.button < 0 || !regulars.length ? regulars[0] : nextIn(regulars, this.button);
    let players = this.dealable();
    for (;;) {
      const clockwise = [button];
      while (clockwise.length < players.length) clockwise.push(nextIn(players, clockwise[clockwise.length - 1]));
      const headsUp = clockwise.length === 2;
      const bb = clockwise[headsUp ? 1 : 2];
      const sb = headsUp ? button : clockwise[1];
      const keep = players.filter((i) => !this.seats[i].waiting || i === bb || (!headsUp && this.seats[i].postNow && i !== sb));
      if (keep.length === players.length) {
        const posts = players.filter((i) => this.seats[i].waiting && i !== bb);
        for (const i of players) { this.seats[i].waiting = false; this.seats[i].postNow = false; }
        return { button, clockwise, posts };
      }
      players = keep;
    }
  }

  /* A restart is coming: no new hand is dealt (not journalled: the next process deals again). */
  drain() {
    this.draining = true;
    if (this.startTimer) { this.env.clearTimer(this.startTimer); this.startTimer = null; }
  }

  scheduleStart() {
    if (this.closed || this.closing || this.draining || this.startTimer) return;
    if (this.hand && this.hand.phase !== 'over') return;
    if (this.sng && this.sng.finished) return;
    if (this.dealable().length < 2) return;
    if (!this.started) {
      // Every seat taken starts it by itself.
      if (!this.seats.every(Boolean)) return;
      this.begin();
    }
    const gap = this.lastHand ? this.env.handGapMs : Math.min(this.env.handGapMs, 1000);
    this.startTimer = this.env.setTimer(() => { this.startTimer = null; this.deal(); }, gap);
  }

  /* The next hand: the button moves one dealt-in seat, the players are laid out in the replayer's position order. */
  deal() {
    if (this.closed || this.closing || this.draining) return;
    if (this.dealable().length < 2) return;
    const { button, clockwise, posts } = this.lineUp();
    this.button = button;
    // Replayer order: heads-up [BTN/SB, BB]; three-handed [BTN, SB, BB]; else [UTG ... CO, BTN, SB, BB]. Stud: table order.
    const stud = gameKind(this.cfg.gameType) === 'stud';
    const order = stud || clockwise.length <= 3 ? clockwise : clockwise.slice(3).concat(clockwise.slice(0, 3));
    const deck = this.env.shuffle();
    this.deck = this.env.commit(deck);
    this.handNo++;
    this.handSeats = order;
    for (const i of order) this.seats[i].timeouts = this.seats[i].timeouts || 0;
    // A sit and go: the seats knocked out last hand are cleared, and each hand is dealt at the level its clock is on.
    if (this.sng) for (let i = 0; i < this.seats.length; i++) if (this.seats[i] && this.seats[i].status === 'out') this.seats[i] = null;
    if (this.sng) {
      const lv = levelAt(this.sng, this.env.now());
      if (lv !== this.sng.level) { this.sng.level = lv; this.sng.blinds = stakesAt(this.cfg.gameType, this.sng.base, lv); }
    }
    const blinds = this.blindsNow;
    this.hand = startHand({
      gameType: this.cfg.gameType, blinds, deck, handId: `${this.cfg.id}-${this.handNo}`,
      seats: order.map((i) => ({ id: this.seats[i].userId, name: this.seats[i].name, stack: this.seats[i].stack, ...(stud ? { position: `Seat ${i + 1}` } : {}),
        ...(posts.includes(i) ? { post: blinds.bb } : {}) })),
    });
    this.afterMove();
  }

  /* A draw game's reshuffle of the discards: in the order the cards fall in a fresh CSPRNG-shuffled deck. */
  get handOpts() {
    return { reshuffle: (cards) => { const set = new Set(cards); return this.env.shuffle().filter((c) => set.has(c)); } };
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
    if (!this.hand || this.hand.phase === 'over') return;
    const t = toAct(this.hand);
    if (!t) return;
    const seat = this.seats[this.handSeats[t.player]];
    if (seat && seat.status !== 'playing') this.forceMove(t.player);
  }

  forceMove(handPlayer) {
    const move = timeoutMove(this.hand);
    if (!move) return;
    handAct(this.hand, handPlayer, move, this.handOpts);
    this.afterMove();
  }

  act(userId, move) {
    const i = this.seatOf(userId);
    if (!this.hand || this.hand.phase === 'over') return { error: 'No hand in progress' };
    const p = this.handSeats.indexOf(i);
    if (p < 0) return { error: 'You are not in this hand' };
    const r = handAct(this.hand, p, move, this.handOpts);
    if (r.error) return r;
    this.seats[i].timeouts = 0;
    this.afterMove();
    return { ok: true };
  }

  /* ── The clock (owner, 2026-11-22, decision 7: the host sets the time per decision and the bank) ── */

  armClock(resume) {
    this.clearTimer();
    const t = toAct(this.hand);
    if (!t) { this.deadline = null; return; }
    const ms = this.cfg.clock.decision * 1000;
    this.deadline = this.env.now() + ms;
    this.clockFor = t.player;
    this.usingBank = false;
    // A new turn (not a clock re-armed after a restart): the service may tell a player who is away.
    const seat = this.seats[this.handSeats[t.player]];
    if (!resume && seat && this.env.onTurn) this.env.onTurn(this, seat.userId);
    this.timer = this.env.setTimer(() => this.onTimeout(), resume ? ms : ms);
  }

  onTimeout() {
    this.timer = null;
    if (!this.hand || this.hand.phase === 'over') return;
    const t = toAct(this.hand);
    if (!t || t.player !== this.clockFor) return;
    const seat = this.seats[this.handSeats[t.player]];
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
    this.forceMove(t.player);
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
    if (this.sng && this.started && !this.sng.finished) this.knockOuts(state, handSeats);
    // Who stands up after the hand: those leaving; a busted seat stays, to buy in again (in a sit and go it is out,
    // and its seat is cleared when the next hand is dealt).
    for (let i = 0; i < this.seats.length; i++) {
      const s = this.seats[i];
      if (s && s.status === 'leaving') this.standUp(i);
      else if (s && s.stack <= 0 && !this.sng) s.status = 'busted';
    }
    if (this.closing) { this.finishClose(); return; }
    this.changed();
    this.scheduleStart();
  }

  /* A sit and go after a hand: who it knocked out, their places and prizes; the last one with chips wins. */
  knockOuts(state, handSeats) {
    const s = this.sng;
    const busts = [];
    handSeats.forEach((ts, p) => {
      const seat = this.seats[ts];
      if (seat && seat.stack <= 0) busts.push({ userId: seat.userId, name: seat.name, start: state.players[p].startingStack, seat: ts });
    });
    const left = this.seats.filter((x) => x && x.stack > 0);
    const pay = (pl) => { s.places.push(pl); if (pl.prize > 0) this.env.onCashOut(this, { userId: pl.userId, amount: pl.prize, kind: 'prize' }); };
    for (const pl of placeBusts(busts, left.length, s.prizes)) pay(pl);
    for (const b of busts) this.seats[b.seat].status = 'out';
    if (left.length !== 1) return;
    pay({ userId: left[0].userId, name: left[0].name, place: 1, prize: s.prizes[0] || 0 });
    s.finished = true;
    s.finishedAt = this.env.now();
    if (this.env.onFinish) this.env.onFinish(this, this.standings());
    this.linger();
  }

  /* The places decided so far, best first, and what each paid. */
  standings() {
    const s = this.sng;
    const places = s.places.slice().sort((a, b) => (a.place == null) - (b.place == null) || (a.place || 0) - (b.place || 0) || b.prize - a.prize);
    return { entrants: s.entrants.length, buyIn: s.buyIn, prizes: s.prizes, places, finished: s.finished, cancelled: s.cancelled };
  }

  /* A sit and go as everyone sees it: the entry, the level being dealt and the clock's, the next stakes and when
     they come, the prizes (before the start, what the players registered would make), the places so far. */
  sngView() {
    const s = this.sng;
    const now = this.env.now();
    const registered = this.seats.filter(Boolean).length;
    const clock = levelAt(s, now);
    const ends = this.started && !s.finished ? levelEndsAt(s, now) : null;
    return {
      ...this.standings(),
      buyIn: s.buyIn, stack: s.stack, levelMins: s.levelMins,
      level: s.level + 1, clockLevel: clock + 1,
      next: this.started && !s.finished ? stakesAt(this.cfg.gameType, s.base, clock + 1) : null,
      levelEndsIn: ends != null ? Math.max(0, ends - now) : null,
      entrants: this.started ? s.entrants.length : registered,
      prizes: this.started ? s.prizes : prizesFor(Math.max(registered, 1), s.buyIn),
      left: this.seats.filter((x) => x && x.stack > 0).length,
    };
  }

  /* ── What one viewer sees ── */

  viewFor(userId) {
    const mySeat = this.seatOf(userId);
    const cur = this.hand ? { state: this.hand, handSeats: this.handSeats } : this.lastHand;
    let hand = null;
    if (cur) {
      /* The viewer's place in the hand by who they are, never by the seat they sit in now: the last hand is shown
         until the next is dealt, and a player who has since taken a seat someone left was not dealt it (found by
         test:tables-eight, 2026-11-26: they were shown it as its last player saw it, unshown cards and all). */
      const ids = cur.state && cur.state.ids;
      const p = Array.isArray(ids) ? ids.indexOf(userId) : cur.handSeats.indexOf(mySeat);
      const v = handView(cur.state, p);
      hand = { ...v, seatOf: cur.handSeats, handNo: this.hand ? this.handNo : this.handNo, you: p };
    }
    return {
      table: {
        id: this.cfg.id, name: this.cfg.name, gameType: this.cfg.gameType, blinds: this.blindsNow, maxSeats: this.cfg.maxSeats,
        buyIn: this.cfg.buyIn, clock: this.cfg.clock, hostId: this.cfg.hostId, closed: this.closed, closing: this.closing,
        button: this.button, handNo: this.handNo, version: this.version,
        started: this.started, canStart: this.canStart(userId),
        deadline: this.deadline, deadlineIn: this.deadline != null ? clamp(this.deadline - this.env.now(), 0, 1e9) : null,
        you: mySeat,
        seats: this.seats.map((s) => (s ? { name: s.name, stack: s.stack, status: s.status, bank: s.bank, waiting: !!s.waiting, postNow: !!s.postNow } : null)),
        muted: this.muted.includes(userId),
        // The host sees whom they have muted, to unmute; nobody else is told.
        mutedIds: userId === this.cfg.hostId ? this.muted.slice() : undefined,
        sng: this.sng ? this.sngView() : undefined,
      },
      chat: this.chat.slice(-CHAT_SHOWN).map((m) => ({ id: m.id, userId: m.userId, name: m.name, text: m.text, at: m.at, mine: m.userId === userId })),
      hand,
    };
  }
}

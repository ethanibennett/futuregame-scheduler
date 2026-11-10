"""Random hands for the replayer, played by PokerKit and settled to TDA rules.

    python test/replayer-oracle/generate.py --per-game 200 --seed 1 --out corpus.jsonl [--games NLH,Razz] [--pick 60]

Needs Python 3.11+ and PokerKit (`pip install pokerkit==0.7.7`, no dependencies); see README.md here.
Each line of the output is one hand:
  { id, game, n, mode, hand (the app's saved-hand JSON), expected {name: final stack}, tags [...] }

Why PokerKit (University of Toronto, peer-reviewed): nobody here wrote it, so a replayer that agrees with it
over thousands of random hands is not agreeing with itself. PokerKit decides what is legal at every point
(whose turn, min and max raise, limit caps, the stud bring-in and who opens each street, the draw order) and
ranks every hand. The pot is then settled here, from what each player put in and PokerKit's rankings, to the
TDA rules the app follows:
  - layered side pots; a player's chips count in every layer they reached, folded or not;
  - a big-blind ante is dead money in the main pot (TDA; PokerStars), not a live bet;
  - the odd chip of a hi-lo pot goes to the high half; among tied players, one chip each, starting with the
    first seat left of the button; in stud, razz and each half of stud/8, to the high card by suit in the
    best five (TDA 2015 v1.0, "Odd Chips"; spades, hearts, diamonds, clubs);
  - in hi-lo, a pot (main or side) with no qualifying low among ITS players goes wholly to its high hand.
PokerKit's own payout is checked against that settlement on every hand. They may differ only where PokerKit
is known to settle differently (it gives a tie's whole remainder to one player, layers a big-blind ante as a
live bet, splits the low half of a side pot among all its players when only an outside player has a low,
layers its pots after killing the beaten hands, and hands a stud tie's odd chip out by seat); each such hand
is tagged with the reason, and any other difference stops the run, because then the oracle itself is in doubt.

Tables run from heads-up to ten-handed (fewer where the deck runs out). Cash hands are in dollars and cents;
about one in seven big-bet cash hands carries a straddle (under the gun, on the button, or two of them).
"""
import argparse
import json
import random
import sys
import warnings
from itertools import combinations

from pokerkit import Automation, Deck
from pokerkit import (
    FixedLimitBadugi, FixedLimitDeuceToSevenLowballTripleDraw, FixedLimitRazz, FixedLimitSevenCardStud,
    FixedLimitSevenCardStudHighLowSplitEightOrBetter, FixedLimitTexasHoldem, NoLimitDeuceToSevenLowballSingleDraw,
    NoLimitTexasHoldem,
)
from pokerkit.games import (
    FixedLimitPokerMixin, Holdem, NoLimitPokerMixin, PotLimitPokerMixin, SingleDraw, TripleDraw, UnfixedLimitHoldem,
)
from pokerkit.hands import OmahaEightOrBetterLowHand, OmahaHoldemHand, StandardHighHand, StandardLowHand

warnings.simplefilter('ignore')

AUTO = (
    Automation.ANTE_POSTING, Automation.BET_COLLECTION, Automation.BLIND_OR_STRADDLE_POSTING,
    Automation.RUNOUT_COUNT_SELECTION, Automation.CHIPS_PULLING,
)   # hand killing is done by hand, after the showdown is read: a killed hand is no longer "live" to PokerKit
MIXIN = {'nl': NoLimitPokerMixin, 'pl': PotLimitPokerMixin, 'fl': FixedLimitPokerMixin}
OMAHA_HI = (OmahaHoldemHand,)
OMAHA_HILO = (OmahaHoldemHand, OmahaEightOrBetterLowHand)


def custom(limit, base, hole, types):
    """A game from PokerKit's own parts (its stock limit Omaha hi-lo class carries the pot-limit mixin)."""
    return type('Custom', (MIXIN[limit], base), {'deck': Deck.STANDARD, 'hole_dealing_count': hole, 'hand_types': types})


# game -> (kind, limit, hole cards, PokerKit class, hi-lo)
GAMES = {
    'NLH': ('flop', 'nl', 2, NoLimitTexasHoldem, False),
    'PLH': ('flop', 'pl', 2, custom('pl', UnfixedLimitHoldem, 2, (StandardHighHand,)), False),
    'LHE': ('flop', 'fl', 2, FixedLimitTexasHoldem, False),
    'PLO': ('flop', 'pl', 4, custom('pl', UnfixedLimitHoldem, 4, OMAHA_HI), False),
    'PLO5': ('flop', 'pl', 5, custom('pl', UnfixedLimitHoldem, 5, OMAHA_HI), False),
    'PLO6': ('flop', 'pl', 6, custom('pl', UnfixedLimitHoldem, 6, OMAHA_HI), False),
    'LO Hi': ('flop', 'fl', 4, custom('fl', Holdem, 4, OMAHA_HI), False),
    'PLO8': ('flop', 'pl', 4, custom('pl', UnfixedLimitHoldem, 4, OMAHA_HILO), True),
    'NLO8': ('flop', 'nl', 4, custom('nl', UnfixedLimitHoldem, 4, OMAHA_HILO), True),
    'O8': ('flop', 'fl', 4, custom('fl', Holdem, 4, OMAHA_HILO), True),
    'Big O': ('flop', 'pl', 5, custom('pl', UnfixedLimitHoldem, 5, OMAHA_HILO), True),
    'PLO6 8/b': ('flop', 'pl', 6, custom('pl', UnfixedLimitHoldem, 6, OMAHA_HILO), True),
    'Stud Hi': ('stud', 'fl', 7, FixedLimitSevenCardStud, False),
    'Stud 8': ('stud', 'fl', 7, FixedLimitSevenCardStudHighLowSplitEightOrBetter, True),
    'Razz': ('stud', 'fl', 7, FixedLimitRazz, False),
    '2-7 TD': ('draw3', 'fl', 5, FixedLimitDeuceToSevenLowballTripleDraw, False),
    'PL 2-7 TD': ('draw3', 'pl', 5, custom('pl', TripleDraw, 5, (StandardLowHand,)), False),
    'Badugi': ('draw3', 'fl', 4, FixedLimitBadugi, False),
    'NL 2-7 SD': ('draw1', 'nl', 5, NoLimitDeuceToSevenLowballSingleDraw, False),
    'PL 5CD Hi': ('draw1', 'pl', 5, custom('pl', SingleDraw, 5, (StandardHighHand,)), False),
}
NAMES = ['Ava', 'Bo', 'Cy', 'Di', 'Ed', 'Flo', 'Gus', 'Hal', 'Ivy', 'Jo']
RANKS = '23456789TJQKA'
SUITS = 'cdhs'
FULL_DECK = [r + s for r in RANKS for s in SUITS]
STREETS = {'flop': 4, 'stud': 5, 'draw3': 4, 'draw1': 2}


class Redeal(Exception):
    """The stub ran dry (a full stud table, a long triple draw): deal another hand."""


def cs(card):
    return card.rank.value + card.suit.value


def position_labels(n):
    if n <= 2:
        return ['BTN/SB', 'BB']
    if n == 3:
        return ['BTN', 'SB', 'BB']
    middle = ['UTG', 'UTG+1', 'MP1', 'MP2', 'LJ', 'HJ', 'CO']
    return middle[len(middle) - (n - 3):] + ['BTN', 'SB', 'BB']


class Dealer:
    """Cards in a chosen order: each player's own first cards (so two players can be dealt the same ranks, for
    ties), a chosen board, and the rest shuffled for burns and draws, refilled from the discards as a dealer
    reshuffles the muck."""

    def __init__(self, rng, hands, board):
        used = {c for h in hands for c in h} | set(board)
        self.rng = rng
        self.hands = [list(h) for h in hands]
        self.board = list(board)
        self.stub = [c for c in FULL_DECK if c not in used]
        rng.shuffle(self.stub)
        self.muck = []

    def from_stub(self):
        if not self.stub:
            if not self.muck:
                raise Redeal()
            self.rng.shuffle(self.muck)
            self.stub, self.muck = self.muck, []
        return self.stub.pop()

    def hole(self, k):
        return self.hands[k].pop(0) if self.hands[k] else self.from_stub()

    def board_card(self):
        return self.board.pop(0) if self.board else self.from_stub()


def rig_cards(rng, n, kind, hole):
    """Each player's first cards and the board, sometimes rigged for ties: a 'twin' is dealt the same ranks as
    another player in other suits (chopped highs, quartered lows, tied badugis), and a board can play for
    everyone. Returns (hands, board, tags)."""
    deck = FULL_DECK[:]
    rng.shuffle(deck)
    per = 7 if kind == 'stud' else hole
    tags = []
    board = []
    if kind == 'flop' and rng.random() < 0.12:
        board = rng.choice([['Ah', 'Kh', 'Qh', 'Jh', 'Th'], ['9s', '9h', '9d', '9c', 'Ac'], ['Ts', '9d', '8c', '7h', '6s'],
                            ['2c', '3d', '4h', 'Kd', 'Ks'], ['Ac', '2d', '3h', '8s', '8d']])
        tags.append('board-plays')
    pool = [c for c in deck if c not in board]
    twins = rng.sample(range(n), 2) if rng.random() < 0.3 else None
    hands = [[] for _ in range(n)]
    for k in range(n):
        if twins and k == twins[1]:
            for c in hands[twins[0]]:
                alt = [c[0] + s for s in SUITS if c[0] + s in pool]
                if not pool:
                    raise Redeal()
                pick = rng.choice(alt) if alt else pool[0]
                hands[k].append(pick)
                pool.remove(pick)
            continue
        hands[k] = pool[:per]
        pool = pool[per:]
    if twins:
        tags.append('twins')
    if kind == 'flop' and not board:
        board = pool[:5]
    return hands, board, tags


def chips(rng, mode, bb):
    """A starting stack: short, medium or deep, in chips (tournament, whole quarters of the big blind) or cents
    (cash, any amount)."""
    r = rng.random()
    if r < 0.3:
        s = rng.randint(1, 15) * bb + rng.randint(0, bb - 1)
    elif r < 0.75:
        s = rng.randint(15, 80) * bb + rng.randint(0, bb - 1)
    else:
        s = rng.randint(80, 250) * bb + rng.randint(0, bb - 1)
    if mode == 'mtt':
        q = max(1, bb // 4)
        s -= s % q
    return max(2, s)


def stakes(rng, kind, mode):
    if mode == 'cash':
        bb = rng.choice([10, 25, 50, 100, 200, 300, 500])          # cents
        sb = rng.choice([bb // 2, bb * 2 // 5])
    else:
        bb = rng.choice([100, 200, 400, 600, 1000, 2000])
        sb = bb // 2
    st = {'bb': bb, 'sb': max(1, sb), 'ante': 0, 'bring_in': 0, 'big': bb * 2}
    if kind == 'stud':
        st['ante'] = max(1, bb // rng.choice([5, 8, 10]))
        st['bring_in'] = max(st['ante'], bb // rng.choice([2, 3, 4]))
    elif kind == 'flop' and mode == 'mtt' and rng.random() < 0.5:
        st['ante'] = bb
    return st


# A straddle the app can record, as the seats that post it counted from the first player left of the big
# blind (n = players): each doubles the one before it, in seat order, and the betting opens after the last.
STRADDLES = {
    'utg': lambda n: [0],
    'button': lambda n: [n - 3],
    'utg+mississippi': lambda n: [0, 1],          # a double straddle: under the gun, then the next seat
    'utg+button': lambda n: [0, n - 3],
}


def create(game, n, stacks, st):
    kind, limit, _, cls, _ = GAMES[game]
    if kind == 'stud':
        return cls.create_state(AUTO, False, st['ante'], st['bring_in'], st['bb'], st['big'], stacks, n)
    antes = {1: st['ante']} if st['ante'] else 0   # raw index 1 is the big blind, heads-up included
    blinds = (st['sb'], st['bb'])
    if st.get('straddle_seats'):
        # PokerKit seats the small blind at 0 and the big blind at 1, so the first seat left of the big blind is 2.
        blinds = {0: st['sb'], 1: st['bb'], **{a + 2: st['bb'] * 2 ** (i + 1) for i, a in enumerate(st['straddle_seats'])}}
    if cls.__name__ == 'Custom':
        two = limit == 'fl' or kind == 'draw3'
        args = (st['bb'], st['big'] if limit == 'fl' else st['bb']) if two else (st['bb'],)
        return cls(AUTO, False, antes, blinds, *args)(stacks, n)
    args = (st['bb'], st['big']) if limit == 'fl' else (st['bb'],)
    return cls.create_state(AUTO, False, antes, blinds, *args, stacks, n)


SUIT_ORDER = {'c': 1, 'd': 2, 'h': 3, 's': 4}
RANK_VALUE = {r: i + 2 for i, r in enumerate('23456789TJQKA')}


def stud_odd_key(cards, hand_cls, ace_low):
    """TDA (2015 v1.0): in stud, razz and either half of stud/8, a tie's odd chip goes to the high card by suit
    in the best 5-card hand (spades, hearts, diamonds, clubs). The key is that card, rank then suit (an ace is
    low in an ace-to-five low); where two fives are equally good, the higher top card."""
    best, key = None, 0
    for five in combinations(cards, 5):
        try:
            h = hand_cls(''.join(five))
        except ValueError:
            continue
        low = ace_low or {c[0] for c in five} == set('A2345')    # a wheel played high is five-high
        top = max((1 if low and c[0] == 'A' else RANK_VALUE[c[0]]) * 5 + SUIT_ORDER[c[1]] for c in five)
        if best is None or h > best:
            best, key = h, top
        elif not h < best and top > key:
            key = top
    return key


def settle(contrib, dead, live, allin, hands_by_type, hilo, order, odd_keys=None):
    """Pot layers and who is paid what, to TDA rules (module doc). hands_by_type[t][p]: a PokerKit hand or None;
    greater is better for every type. order: odd-chip priority, a list of seats. odd_keys[t]: stud only, each
    seat's stud_odd_key for hand type t (it orders a tie instead of the seats)."""
    n = len(contrib)
    rank = {p: i for i, p in enumerate(order)}
    caps = sorted({contrib[p] for p in live if allin[p]})
    layers, floor = [], 0
    for cap in caps + [None]:
        amt = sum(max(0, (c if cap is None else min(c, cap)) - floor) for c in contrib)
        elig = [p for p in live if contrib[p] > floor]
        if amt > 0:
            if elig:
                layers.append([amt, elig])
            elif layers:
                layers[-1][0] += amt
            else:
                layers.append([amt, list(live)])
        if cap is None:
            break
        floor = cap
    if not layers:
        layers = [[0, list(live)]]
    layers[0][0] += dead
    won = [0] * n
    ties = []

    def share(amount, players, t):
        if len(players) > 1:
            ties.append(amount % len(players))
        keys = odd_keys[t] if odd_keys and t is not None and odd_keys[t] else None
        ps = sorted(players, key=(lambda p: (-keys[p], p)) if keys else (lambda p: rank[p]))
        base, odd = divmod(amount, len(ps))
        for i, p in enumerate(ps):
            won[p] += base + (1 if i < odd else 0)

    def best(t, players):
        hs = [(hands_by_type[t][p], p) for p in players if hands_by_type[t][p] is not None]
        if not hs:
            return []
        top = max(h for h, _ in hs)
        return [p for h, p in hs if h == top]

    for amount, elig in layers:
        if len(live) == 1:
            won[live[0]] += amount
            continue
        hi = best(0, elig)
        lo = best(1, elig) if hilo else []
        if hi and lo:
            hi_half = amount - amount // 2
            share(hi_half, hi, 0)
            share(amount - hi_half, lo, 1)
        else:
            share(amount, hi or lo or elig, 0 if hi else 1 if lo else None)
    return won, ties, len(layers)


def check_against_pokerkit(final_pk, expected, pushes, hands_by_type, hilo, dead):
    """'' when PokerKit pays exactly what the TDA settlement says; a tag naming the known difference that
    explains it; 'disagree' when nothing does."""
    if final_pk == expected:
        return ''
    if hilo:
        for op in pushes:
            if op.hand_type_index == 1 and any(x > 0 and hands_by_type[1][i] is None for i, x in enumerate(op.amounts)):
                return 'pk-low-half-unclaimed'
    if dead:
        return 'pk-bb-ante-live'
    for op in pushes:
        got = [x for x in op.amounts if x > 0]
        if len(got) > 1 and sum(got) % len(got) > 1:
            return 'pk-remainder-to-one'
    return 'disagree'


def play(game, rng, hid):
    kind, limit, hole, _, hilo = GAMES[game]
    mode = 'cash' if rng.random() < 0.45 else 'mtt'
    # Seats the deck can serve: a board game's hole cards plus five on the board and three burns.
    max_n = 7 if kind == 'stud' else 6 if kind.startswith('draw') else min(10, (52 - 8) // hole)
    n = rng.choice([2, 2] + list(range(2, max_n + 1)))
    st = stakes(rng, kind, mode)
    stacks = [chips(rng, mode, st['bb']) for _ in range(n)]
    if rng.random() < 0.2:                       # equal stacks: all-ins of one size, layers that coincide
        same = rng.choice(stacks)
        for k in rng.sample(range(n), min(n, rng.randint(2, 3))):
            stacks[k] = same
    if kind == 'flop' and limit != 'fl' and mode == 'cash' and n >= 4 and rng.random() < 0.15:
        st['straddle'] = rng.choice(sorted(STRADDLES))
        st['straddle_seats'] = sorted(set(STRADDLES[st['straddle']](n)))
        for i, a in enumerate(st['straddle_seats']):          # a straddle is a choice: nobody posts a short one
            stacks[a + 2] = max(stacks[a + 2], st['bb'] * 2 ** (i + 1) + 1)
    if kind != 'stud' and st['ante']:
        # The big blind must cover blind and ante: short of that, PokerKit posts the ante first and the TDA
        # (and the app) the blind first. Fixtures 37 and 38 hold the app to that case.
        k_bb = 0 if n == 2 else 1
        stacks[k_bb] = max(stacks[k_bb], st['bb'] + st['ante'] + 1)
    state = create(game, n, stacks, st)
    if kind == 'stud':
        k_bb = None
        app_of = list(range(n))
    else:
        k_bb = 0 if n == 2 else 1
        assert state.bets[k_bb] == min(st['bb'], stacks[k_bb]), (state.bets, k_bb)
        app_of = [(k - k_bb - 1) % n for k in range(n)]
    pk_of = {a: k for k, a in enumerate(app_of)}
    hands0, board0, tags = rig_cards(rng, n, kind, hole)
    dealer = Dealer(rng, hands0, board0)
    aggression = rng.choice([0.15, 0.3, 0.5])
    fold_p = rng.choice([0.03, 0.08, 0.15])
    label_all_in = rng.random() < 0.5
    ns = STREETS[kind]
    actions = [[] for _ in range(ns)]
    draws = [[] for _ in range(ns)]
    dealt = [[] for _ in range(n)]
    board = []
    pending = []          # (pk player, app street the draw is recorded on, index in dealt, thrown)
    folded_on = {}
    start = list(stacks)
    pushes = []
    contrib = dead = hands_by_type = live = allin = live_pk = None

    def resolve():
        for k, si, at, thrown in pending:
            new = dealt[k][at:at + len(thrown)]
            draws[si].append({'player': app_of[k], 'discarded': len(thrown), 'discardedCards': ''.join(thrown), 'newCards': ''.join(new)})
        pending.clear()

    guard = 0
    while state.status:
        guard += 1
        if guard > 3000:
            raise RuntimeError('runaway hand')
        if state.can_burn_card():
            state.burn_card(dealer.from_stub())
        elif state.can_deal_hole():
            k = state.hole_dealee_index
            c = dealer.hole(k)
            state.deal_hole(c)
            dealt[k].append(c)
        elif state.can_deal_board():
            cards = [dealer.board_card() for _ in range(state.board_dealing_count)]
            state.deal_board(''.join(cards))
            board.extend(cards)
        elif state.can_stand_pat_or_discard():
            k = state.stand_patter_or_discarder_index
            si = state.street_index - 1
            if pending and pending[0][1] != si:
                resolve()
            held = [cs(c) for c in state.hole_cards[k]]
            cnt = rng.choice([0, 1, 1, 2, 2, 3]) if rng.random() < 0.85 else rng.randint(0, len(held))
            thrown = rng.sample(held, cnt)
            state.stand_pat_or_discard(''.join(thrown))
            dealer.muck.extend(thrown)
            pending.append((k, si, len(dealt[k]), thrown))
        elif state.can_post_bring_in():
            k = state.actor_index
            before = state.stacks[k]
            if rng.random() < 0.75 or not state.can_complete_bet_or_raise_to():
                state.post_bring_in()
                actions[0].append({'player': app_of[k], 'action': 'bring-in', 'amount': before - state.stacks[k]})
            else:
                state.complete_bet_or_raise_to(state.min_completion_betting_or_raising_to_amount)
                actions[0].append({'player': app_of[k], 'action': 'bet', 'amount': before - state.stacks[k]})
        elif state.can_show_or_muck_hole_cards():
            state.show_or_muck_hole_cards(True)
        elif state.can_kill_hand() or state.can_push_chips():
            if contrib is None:
                live = [k for k in range(n) if state.statuses[k]]
                allin = [state.stacks[k] == 0 for k in range(n)]
                contrib = [start[k] - state.stacks[k] for k in range(n)]
                dead = st['ante'] if (st['ante'] and kind != 'stud') else 0
                if dead:
                    contrib[k_bb] -= dead
                hands_by_type = []
                for t in range(2 if hilo else 1):
                    hs = list(state.get_up_hands(0, t)) if len(live) > 1 else [None] * n
                    hands_by_type.append([hs[k] if state.statuses[k] else None for k in range(n)])
            if state.can_kill_hand():
                state.kill_hand()
            else:
                if live_pk is None:
                    live_pk = [k for k in range(n) if state.statuses[k]]
                pushes.append(state.push_chips())
        elif state.actor_index is not None:
            if pending:
                resolve()
            k = state.actor_index
            si = state.street_index
            before = state.stacks[k]
            owe = state.checking_or_calling_amount
            if owe > 0 and rng.random() < fold_p:
                state.fold()
                folded_on[app_of[k]] = si
                actions[si].append({'player': app_of[k], 'action': 'fold', 'amount': 0})
                continue
            if state.can_complete_bet_or_raise_to() and rng.random() < aggression:
                lo = state.min_completion_betting_or_raising_to_amount
                hi = state.max_completion_betting_or_raising_to_amount
                if st.get('straddle') and si == 0 and not state.completion_betting_or_raising_count:
                    # The first raise over a straddle is at least the straddle again (cardroom rule); PokerKit
                    # asks only for a big blind more.
                    lo = min(hi, max(lo, 2 * max(state.bets)))
                x = rng.random()
                to = lo if x < 0.35 else hi if x < 0.65 else rng.randint(lo, hi)
                facing = max(state.bets) > 0
                state.complete_bet_or_raise_to(to)
                verb = 'all-in' if state.stacks[k] == 0 and label_all_in else ('raise' if facing else 'bet')
                actions[si].append({'player': app_of[k], 'action': verb, 'amount': before - state.stacks[k]})
                continue
            state.check_or_call()
            put = before - state.stacks[k]
            verb = 'check' if put == 0 else ('all-in' if state.stacks[k] == 0 and label_all_in else 'call')
            actions[si].append({'player': app_of[k], 'action': verb, 'amount': put})
        else:
            raise RuntimeError('stuck after ' + repr(state.operations[-1:]))
    if pending:
        resolve()

    final_pk = list(state.stacks)
    odd_keys = None
    if kind == 'stud' and len(live) > 1:
        odd_keys = []
        for hs in hands_by_type:
            cls = next((type(h) for h in hs if h is not None), None)
            odd_keys.append({k: stud_odd_key(dealt[k], cls, cls.low) for k in live} if cls else None)
    won, ties, n_layers = settle(contrib, dead, live, allin, hands_by_type, hilo, list(range(n)), odd_keys)
    if ties:
        tags.append('tie')
    if any(t > 0 for t in ties):
        tags.append('odd-chip')
    if len(live) > 1 and n_layers > 1:
        tags.append('side-pots')
    if dead:
        tags.append('bb-ante')
    expected = [start[k] - contrib[k] - (dead if k == k_bb else 0) + won[k] for k in range(n)]
    assert sum(expected) == sum(start), (expected, start)
    note = check_against_pokerkit(final_pk, expected, pushes, hands_by_type, hilo, dead)
    if note and odd_keys:
        # PokerKit hands a stud tie's odd chip out by seat; the TDA by the high card by suit. The same
        # settlement by seat must then match PokerKit (or differ only as it does in every other game).
        by_seat, _, _ = settle(contrib, dead, live, allin, hands_by_type, hilo, list(range(n)))
        seat_final = [start[k] - contrib[k] + by_seat[k] for k in range(n)]
        if seat_final != expected:
            seat_note = check_against_pokerkit(final_pk, seat_final, pushes, hands_by_type, hilo, dead)
            if seat_note != 'disagree':
                tags.append('stud-odd-chip-by-suit')
                note = seat_note or 'pk-odd-chip-by-seat'
    if note == 'disagree' and live_pk and set(live_pk) != set(live):
        # PokerKit layers its pots over the hands left after killing the beaten ones, which can move an odd
        # chip (two pots split separately vs one): the same settlement over its players must then match it.
        alt, _, _ = settle(contrib, dead, live_pk, allin, hands_by_type, hilo, list(range(n)), odd_keys)
        alt_final = [start[k] - contrib[k] - (dead if k == k_bb else 0) + alt[k] for k in range(n)]
        note = check_against_pokerkit(final_pk, alt_final, pushes, hands_by_type, hilo, dead)
        if not note:
            note = 'pk-layers-after-killing'
    if note == 'disagree':
        raise RuntimeError(f'the settlement disagrees with PokerKit on {game} #{hid}: {final_pk} vs {expected}')
    if note:
        tags.append(note)
    return to_app(game, rng, hid, kind, limit, hole, hilo, mode, n, st, start, app_of, pk_of, dealt, board, actions,
                  draws, folded_on, live, allin, won, expected, tags)


def final_draw_hand(k, dealt, draws, app_of, hole):
    hand = dealt[k][:hole]
    for si in range(len(draws)):
        for d in draws[si]:
            if d['player'] != app_of[k] or not d['discarded']:
                continue
            thrown = [d['discardedCards'][i:i + 2] for i in range(0, len(d['discardedCards']), 2)]
            new = [d['newCards'][i:i + 2] for i in range(0, len(d['newCards']), 2)]
            hand = [c for c in hand if c not in thrown] + new
    return hand


def to_app(game, rng, hid, kind, limit, hole, hilo, mode, n, st, start, app_of, pk_of, dealt, board, actions, draws,
           folded_on, live, allin, won, expected, tags):
    """The hand as the app saves it: players seated in the app's order (index 0 first to act preflop, then BTN,
    SB, BB last; stud Seat 1..n), opponents' cards in their slots, every amount in chips or dollars."""
    names = NAMES[:n]
    hero = rng.randrange(n)
    unit = (lambda v: round(v / 100, 2)) if mode == 'cash' else (lambda v: v)
    showdown = len(live) > 1
    shown = {app_of[k] for k in live} if showdown else set()
    labels = ['Seat %d' % (i + 1) for i in range(n)] if kind == 'stud' else position_labels(n)
    players = [{'name': names[a], 'position': labels[a], 'startingStack': unit(start[pk_of[a]])} for a in range(n)]
    opp_slots = [a for a in range(n) if a != hero]
    stud_form = {a: rng.random() < 0.5 for a in opp_slots}   # shown hidden cards: h7 h2 h1 door, or h2 h1 door + 7th
    streets = []
    for si in range(STREETS[kind]):
        cards = {'hero': '', 'opponents': ['' for _ in opp_slots], 'board': ''}
        if kind == 'flop':
            if si == 0:
                cards['hero'] = ''.join(dealt[pk_of[hero]][:hole])
                for i, a in enumerate(opp_slots):
                    if a in shown or rng.random() < 0.4:
                        cards['opponents'][i] = ''.join(dealt[pk_of[a]][:hole])
            cards['board'] = ''.join(board[[0, 0, 3, 4][si]:[0, 3, 4, 5][si]])
        elif kind == 'stud':
            reached = lambda a: folded_on.get(a, 9) >= si
            hc = dealt[pk_of[hero]]
            if reached(hero) and len(hc) >= (3 if si == 0 else si + 3):
                cards['hero'] = ''.join(hc[:3]) if si == 0 else hc[si + 2]
            for i, a in enumerate(opp_slots):
                c = dealt[pk_of[a]]
                if not reached(a) or len(c) < (3 if si == 0 else si + 3):
                    continue
                full = a in shown and len(c) == 7
                if si == 0:
                    cards['opponents'][i] = (c[6] + c[1] + c[0] + c[2] if stud_form[a] else c[1] + c[0] + c[2]) if full else c[2]
                elif si < 4:
                    cards['opponents'][i] = c[si + 2]
                elif full and not stud_form[a]:
                    cards['opponents'][i] = c[6]
        else:
            if si == 0:
                cards['hero'] = ''.join(dealt[pk_of[hero]][:hole])
                for i, a in enumerate(opp_slots):
                    if a in shown:
                        cards['opponents'][i] = ''.join(final_draw_hand(pk_of[a], dealt, draws, app_of, hole))
        dr = []
        for d in draws[si]:
            a = d['player']
            if a == hero or (a in shown and rng.random() < 0.5):
                dr.append(dict(d))
            else:
                dr.append({'player': a, 'discarded': d['discarded'], 'discardedCards': '', 'newCards': ''})
        streets.append({'cards': cards, 'actions': [{**x, 'amount': unit(x['amount'])} for x in actions[si]], 'draws': dr})
    if kind == 'stud':
        blinds = {'sb': 0, 'bb': unit(st['bb']), 'bigBet': unit(st['big']), 'ante': unit(st['ante']), 'bringIn': unit(st['bring_in'])}
    else:
        blinds = {'sb': unit(st['sb']), 'bb': unit(st['bb'])}
        if limit == 'fl':
            blinds['bigBet'] = unit(st['big'])
        if st['ante']:
            blinds['ante'] = unit(st['ante'])
        if st.get('straddle'):
            blinds['straddle'] = True
            for t in st['straddle'].split('+'):
                blinds['straddle_' + t] = True
            if 'mississippi' in st['straddle']:
                blinds['straddleSeats'] = {'mississippi': 1}
            tags.append('straddle')
    paid =[k for k in range(n) if won[k] > 0]
    hand = {
        'gameType': game, 'gameMode': mode, **({'currency': 'USD'} if mode == 'cash' else {}),
        'blinds': blinds, 'players': players, 'heroIdx': hero, 'streets': streets,
        'result': {'winners': [{'playerIdx': app_of[k], 'split': len(paid) > 1} for k in paid]},
    }
    if showdown:
        tags.append('showdown')
        if any(allin[k] for k in live):
            tags.append('all-in')
        if len(live) > 2:
            tags.append('multiway')
    return {'id': f'{game}#{hid}', 'game': game, 'n': n, 'mode': mode, 'hand': hand,
            'expected': {names[app_of[k]]: unit(expected[k]) for k in range(n)}, 'tags': tags}


TELLING = {'stud-odd-chip-by-suit': 16, 'odd-chip': 8, 'tie': 4, 'side-pots': 4, 'straddle': 3, 'multiway': 2, 'showdown': 1}


def pick(recs, count):
    """`count` of one game's hands: half the most telling (odd chips, ties, side pots, straddles, every hand
    PokerKit settles differently), half just as they came."""
    score = lambda r: sum(TELLING.get(t, 6 if t.startswith('pk-') else 0) for t in r['tags'])
    keep = set(sorted(range(len(recs)), key=lambda i: -score(recs[i]))[:count // 2])
    for i in range(len(recs)):
        if len(keep) >= count:
            break
        keep.add(i)
    return [recs[i] for i in sorted(keep)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--per-game', type=int, default=100)
    ap.add_argument('--pick', type=int, default=0, help='write only this many of each game (see pick)')
    ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--games', default='')
    ap.add_argument('--out', required=True)
    o = ap.parse_args()
    games = o.games.split(',') if o.games else list(GAMES)
    rng = random.Random(o.seed)
    made = redealt = 0
    tally = {}
    with open(o.out, 'w', encoding='utf-8') as f:
        for g in games:
            recs = []
            while len(recs) < o.per_game:
                try:
                    recs.append(play(g, rng, len(recs)))
                except Redeal:
                    redealt += 1
            made += len(recs)
            if o.pick and o.pick < len(recs):
                recs = pick(recs, o.pick)
            for rec in recs:
                f.write(json.dumps(rec, separators=(',', ':')) + '\n')
                for t in rec['tags']:
                    tally[t] = tally.get(t, 0) + 1
    print(f'{made} hands played ({redealt} redealt), tags written: {json.dumps(tally)}', file=sys.stderr)


if __name__ == '__main__':
    main()

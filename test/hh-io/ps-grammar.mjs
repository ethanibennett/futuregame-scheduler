// An independent line grammar for PokerStars hand-history text: one regular
// expression per construct the writer emits, each with where it was observed in
// genuine PokerStars hands (fpdb's regression samples, github.com/ChazDazzle/
// fpdb-chaz, pyfpdb/regression-test-files/{cash,tour}/Stars — read, not copied).
// Deliberately NOT the parser (lib/hh-import/pokerstars.mjs) and not built from
// ps-format.js: a line the writer gets wrong cannot pass by sharing the mistake.

const NAME = "[^:()\\[\\]\\s](?:[^:()\\[\\]]*[^:()\\[\\]\\s])?";       // sanitised: no : ( ) [ ]
const CARD = '[2-9TJQKA][hdcs]';
const CARDS = `${CARD}(?: ${CARD})*`;
const AMT = '(?:0|[1-9]\\d*)(?:\\.\\d{2})?';                      // 6, 0.95, 1916.50 — no separators
const MONEY = `[$\u20ac\u00a3\u00a5]?${AMT}`;
const GAME = "(?:Hold'em|Omaha|5 Card Omaha|6 Card Omaha|Omaha Hi/Lo|5 Card Omaha Hi/Lo|6 Card Omaha Hi/Lo|7 Card Stud|7 Card Stud Hi/Lo|Razz|Triple Draw 2-7 Lowball|Single Draw 2-7 Lowball|5 Card Draw|Badugi)";
const LIMIT = '(?:No Limit|Pot Limit|Limit)';
const DATE = '\\d{4}/\\d{2}/\\d{2} \\d{1,2}:\\d{2}:\\d{2} ET';
const ALLIN = '(?: and is all-in)?';
const DESC_HIGH = "(?:high card \\w+|a pair of \\w+|two pair, \\w+ and \\w+|three of a kind, \\w+|a straight, \\w+ to \\w+|a flush, \\w+ high|a full house, \\w+ full of \\w+|four of a kind, \\w+|a straight flush, \\w+ to \\w+|a Royal Flush)";
const LOW = '[2-9TJQKA](?:,[2-9TJQKA]){4}';
const DESC = `(?:${DESC_HIGH}|HI: ${DESC_HIGH}(?:; LO: ${LOW})?|Lo: (?:${LOW}|${DESC_HIGH})|Badugi: [2-9TJQKA](?:,[2-9TJQKA]){3}|[123]-card: [2-9TJQKA](?:,[2-9TJQKA]){0,2})`;
const SUMDESC = `(?:${DESC_HIGH}|HI: ${DESC_HIGH}(?:; LO: ${LOW})?|Lo: (?:${LOW}|${DESC_HIGH})|a Badugi: [2-9TJQKA](?:,[2-9TJQKA]){3}|a [123]-card: [2-9TJQKA](?:,[2-9TJQKA]){0,2})`;
const FOLD = "folded (?:before Flop(?: \\(didn't bet\\))?|on the (?:Flop|Turn|River)|on the (?:3rd|4th|5th|6th) Street(?: \\(didn't bet\\))?|before the Draw(?: \\(didn't bet\\))?|after the (?:1st |2nd |3rd )?Draw)";

export const RULES = [
  // Cash header, two spaces after the colon: "PokerStars Hand #211860382557:  6 Card Omaha Pot Limit
  // ($0.25/$0.50 USD) - 2020/04/12 13:14:23 ET" (cash/Stars/Flop/6-Card-PLO-6max-USD-0.25-0.50-202004).
  ['header-cash', new RegExp(`^[A-Za-z][A-Za-z0-9 .'-]* Hand #\\d+:  ${GAME} ${LIMIT} \\(${MONEY}/${MONEY} (?:USD|EUR|GBP|CAD|CNY)\\) - ${DATE}$`)],
  // Tournament header: "PokerStars Hand #…: Tournament #…, Freeroll  Hold'em No Limit - Level II (30/60)
  // - … ET" (tour/Stars/Flop/NLHE-9max-MTT-Freeroll-201909) and "$10+$1 USD Hold'em No Limit" (…STT-200512).
  ['header-tournament', new RegExp(`^[A-Za-z][A-Za-z0-9 .'-]* Hand #\\d+: Tournament #\\d+, (?:Freeroll |[$\u20ac\u00a3\u00a5]?${AMT}(?:\\+[$\u20ac\u00a3\u00a5]?${AMT})* [A-Z]{3}) ${GAME} ${LIMIT} - Level [IVXLCDM]+ \\(${AMT}/${AMT}\\) - ${DATE}$`)],
  // "Table 'Armida III' 6-max Seat #4 is the button" (cash/Stars/Flop/5-Card-PLO-6max-USD-3.00-6.00-201303);
  // stud "Table 'Atalante II' 8-max" (cash/Stars/Stud/7-Stud-USD-0.04-0.08-200911).
  ['table', /^Table '[^']+' \d{1,2}-max(?: Seat #\d{1,2} is the button)?$/],
  // "Seat 4: Player0 ($2037.50 in chips)" / "(1436 in chips)".
  ['seat', new RegExp(`^Seat \\d{1,2}: ${NAME} \\(${MONEY} in chips\\)$`)],
  // "posts the ante 120", "posts small blind $3", "posts big blind 360 and is all-in"
  // (tour/Stars/Flop/NLHE-FPP-MTT-1r-201005); "posts straddle" is fpdb's re_PostStraddle (unverified at Stars).
  ['post', new RegExp(`^${NAME}: posts (?:the ante|small blind|big blind|straddle) ${MONEY}${ALLIN}$`)],
  ['street', /^\*\*\* (?:HOLE CARDS|DEALING HANDS|3rd STREET|4th STREET|5th STREET|6th STREET|RIVER|FIRST DRAW|SECOND DRAW|THIRD DRAW|SHOW DOWN|SUMMARY) \*\*\*$/],
  // "*** FLOP *** [Tc 7s 8h]", "*** TURN *** [Tc 7s 8h] [6d]", "*** RIVER *** [Tc 7s 8h 6d] [9h]".
  ['board-street', new RegExp(`^\\*\\*\\* (?:FLOP \\*\\*\\* \\[${CARD} ${CARD} ${CARD}\\]|TURN \\*\\*\\* \\[${CARD}(?: ${CARD}){2}\\] \\[${CARD}\\]|RIVER \\*\\*\\* \\[${CARD}(?: ${CARD}){3}\\] \\[${CARD}\\])$`)],
  // "Dealt to Hero [Td 9c 7d 8c Qd]"; stud "Dealt to Nikolay Zem [7d Td] [3d]"; draw "Dealt to Hero [5c 7s 2h] [8s]".
  ['dealt', new RegExp(`^Dealt to ${NAME} \\[${CARDS}\\](?: \\[${CARDS}\\])?$`)],
  ['fold', new RegExp(`^${NAME}: folds$`)],
  ['check', new RegExp(`^${NAME}: checks$`)],
  ['call', new RegExp(`^${NAME}: calls ${MONEY}${ALLIN}$`)],
  ['bet', new RegExp(`^${NAME}: bets ${MONEY}${ALLIN}$`)],
  // "raises $12 to $18"; stud completing the bring-in "raises $0.02 to $0.04" (cash/Stars/Stud/7-StudHL…200911).
  ['raise', new RegExp(`^${NAME}: raises ${MONEY} to ${MONEY}${ALLIN}$`)],
  ['bring-in', new RegExp(`^${NAME}: brings in for ${MONEY}${ALLIN}$`)],
  // "discards 1 card [Jh]", "discards 3 cards", "stands pat", "stands pat on [2s 7d 4d 6d 8s]".
  ['discard', new RegExp(`^${NAME}: discards [1-5] cards?(?: \\[${CARDS}\\])?$`)],
  ['pat', new RegExp(`^${NAME}: stands pat(?: on \\[${CARDS}\\])?$`)],
  ['uncalled', new RegExp(`^Uncalled bet \\(${MONEY}\\) returned to ${NAME}$`)],
  // "shows [Td 9c 7d 8c Qd] (a straight, Six to Ten)"; a folded player's "shows [..]" with no description.
  ['shows', new RegExp(`^${NAME}: shows \\[${CARDS}\\](?: \\(${DESC}\\))?$`)],
  ['mucks', new RegExp(`^${NAME}: mucks hand$`)],
  ['noshow', new RegExp(`^${NAME}: doesn't show hand$`)],
  // "collected $0.29 from side pot-2", "collected 43 from side pot", "collected 1680 from main pot".
  ['collect', new RegExp(`^${NAME} collected ${MONEY} from (?:pot|main pot|side pot|side pot-\\d)$`)],
  // "Total pot $1 | Rake $0.05"; "Total pot 1920 Main pot 1680. Side pot 240. | Rake 0";
  // "Total pot $3.70 Main pot $2.35. Side pot-1 $0.88. Side pot-2 $0.29. | Rake $0.18".
  ['total', new RegExp(`^Total pot ${MONEY}(?: Main pot ${MONEY}\\.(?: Side pot ${MONEY}\\.|(?: Side pot-\\d ${MONEY}\\.){2,}))? \\| Rake ${MONEY}$`)],
  ['board', new RegExp(`^Board \\[${CARDS}\\]$`)],
  // Summary seats: "(button) (small blind) showed [..] and won ($1916.50) with a straight, Six to Ten",
  // "folded before Flop (didn't bet)", "folded on the 3rd Street (didn't bet)", "folded after the 1st Draw",
  // "collected ($0.95)", "mucked".
  ['summary-seat', new RegExp(`^Seat \\d{1,2}: ${NAME}(?: \\(button\\))?(?: \\((?:small|big) blind\\))? (?:${FOLD}|showed \\[${CARDS}\\] and won \\(${MONEY}\\) with ${SUMDESC}|showed \\[${CARDS}\\] and lost with ${SUMDESC}|collected \\(${MONEY}\\)|mucked)$`)],
];

/* The rule a line matches, or null. */
export function ruleFor(line) {
  for (const [name, re] of RULES) if (re.test(line)) return name;
  return null;
}

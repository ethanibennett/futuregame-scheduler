/* The seven online sites, and the only place a fact about one of them lives.
   utils.js derives its venue-prefix timezone map from here, and the availability
   filter asks isSiteAvailable(); nothing else should hardcode a site.

   WHY A MODEL RATHER THAN ONE STATE LIST: the three ways these sites reach a US
   player are not variations on each other, and a single allow-list cannot
   express them. A regulated site is licensed state by state and is absent
   everywhere else. A sweepstakes site operates nationally and withdraws from
   individual states as their law changes — an allow-list for one would be 43
   entries that rot the moment a 44th state is added. An offshore site makes no
   jurisdictional claim at all, so any list we wrote would be our assertion, not
   theirs, and asserting one would be worse than saying nothing.

   ⚠ THESE LISTS EXPIRE. Every one is a claim about gambling law on a specific
   date, and US online poker moves — states license, sweepstakes bans pass,
   operators merge (PokerStars' US rooms became "PokerStars on FanDuel" in April
   2026). `verifiedOn` is the date the list below was checked against the sources
   in `evidence`. Re-check before trusting a filtered-out result, and update the
   date when you do. The filter this feeds is ADVISORY — it hides rows from a
   list, it does not tell anyone what is lawful for them. */

/** Operating models. See the block comment for why these are three shapes and
 *  not one list. */
export const SITE_MODELS = {
  /** State-licensed. Available ONLY in `states`. */
  regulated: 'regulated',
  /** National promotional model. Available everywhere EXCEPT `blockedStates`. */
  sweepstakes: 'sweepstakes',
  /** No domestic licence and no jurisdiction claim we can verify. Never filtered
   *  out by availability: absence of a claim is not a claim of absence. */
  offshore: 'offshore',
};

export const ONLINE_SITES = {
  wsop_com: {
    key: 'wsop_com',
    name: 'WSOP.com',
    /** The strip abbreviation. Kept short: the strip is a vertical rule. */
    abbr: 'WSOP',
    /** The `property` string the feed emits, and therefore the prefix an online
     *  venue name starts with. The timezone lookup keys off this. */
    venuePrefix: 'WSOP.com',
    model: SITE_MODELS.regulated,
    states: ['NV', 'NJ', 'PA', 'MI'],
    /** The zone a card's start time is LABELLED in. The online feed normalizes
     *  every site to Eastern at emit (online-poker-watcher emit/online-feed.ts,
     *  DISPLAY_TZ) — change that constant and this field together or the label
     *  lies about a correct number, which it did for one day (#241). */
    timezone: 'America/New_York',
    verifiedOn: '2026-09-14',
    evidence: 'pokerfuse.com/live-poker/wsop/wsop-online-bracelets/ — playable only from NV, NJ, PA, MI',
  },
  pokerstars: {
    key: 'pokerstars',
    name: 'PokerStars on FanDuel',
    abbr: 'PS',
    venuePrefix: 'PokerStars',
    model: SITE_MODELS.regulated,
    states: ['MI', 'NJ', 'PA'],
    timezone: 'America/New_York',
    verifiedOn: '2026-09-14',
    evidence: 'fanduel.com/about/news/pokerstars-exclusively-on-fanduel-goes-live — MI, NJ, PA on one shared pool (April 2026)',
  },
  betmgm: {
    key: 'betmgm',
    name: 'BetMGM Poker',
    abbr: 'MGM',
    venuePrefix: 'BetMGM',
    model: SITE_MODELS.regulated,
    states: ['NJ', 'MI', 'PA'],
    timezone: 'America/New_York',
    verifiedOn: '2026-09-14',
    evidence: 'pokerfuse.com/online-poker/united-states/betmgm-poker-us-review/ — NJ, MI, PA, one combined pool',
  },
  clubwpt_gold: {
    key: 'clubwpt_gold',
    name: 'ClubWPT Gold',
    abbr: 'WPT',
    venuePrefix: 'ClubWPT Gold',
    model: SITE_MODELS.sweepstakes,
    /** Withdrawn from these. The list only grows as state sweepstakes bans pass,
     *  which is exactly why this is a deny-list. */
    blockedStates: ['CT', 'LA', 'MI', 'MT', 'NJ', 'TN', 'WA'],
    /** States where it operates under a restricted arrangement. Shown, with the
     *  caveat surfaced, rather than hidden: a limited room is still a room. */
    limitedStates: { CA: 'Redemption limited to designated "Game Days" each month' },
    timezone: 'America/New_York',
    verifiedOn: '2026-09-14',
    evidence: 'tech-insider.org/clubwpt-gold-review/ (Aug 2026) + covers.com Tennessee exit (May 2026); CA Game Days per cardplayer.com',
  },
  acr: {
    key: 'acr',
    name: 'Americas Cardroom',
    abbr: 'ACR',
    venuePrefix: 'ACR',
    model: SITE_MODELS.offshore,
    timezone: 'America/New_York',
    verifiedOn: '2026-09-14',
    evidence: 'Winning Poker Network. No US state licence; makes no per-state availability claim.',
  },
  ggpoker: {
    key: 'ggpoker',
    name: 'GGPoker',
    abbr: 'GG',
    venuePrefix: 'GGPoker',
    model: SITE_MODELS.offshore,
    timezone: 'America/New_York',
    verifiedOn: '2026-09-14',
    evidence: 'GGPoker has no US-regulated room; ggpoker.com serves US players offshore.',
  },
  phenom: {
    key: 'phenom',
    name: 'Phenom Poker',
    abbr: 'PHE',
    venuePrefix: 'Phenom',
    /** The plan guessed sweepstakes. It is not: Phenom is a crypto-funded
     *  offshore room (pokerfuse sweepstakes guide lists the sweepstakes rooms
     *  and Phenom is not among them). Recorded because the guess was written
     *  down and someone will otherwise re-derive it. */
    model: SITE_MODELS.offshore,
    timezone: 'America/New_York',
    verifiedOn: '2026-09-14',
    evidence: 'pokerfuse.com/online-poker/sweepstakes/ does not list Phenom; crypto-based offshore room.',
  },
};

/** Ordered for display: regulated first (most players can act on those), then
 *  sweepstakes, then offshore. Within a model, alphabetical by name. */
export const ONLINE_SITE_LIST = Object.values(ONLINE_SITES).sort((a, b) => {
  const rank = { regulated: 0, sweepstakes: 1, offshore: 2 };
  return (rank[a.model] - rank[b.model]) || a.name.localeCompare(b.name);
});

export function getSite(key) {
  return key ? ONLINE_SITES[key] || null : null;
}

/** Can a player in `jurisdiction` (a two-letter US state code, or null) play here?
 *
 *  Returns one of:
 *    'yes'      — available
 *    'limited'  — available under a restriction; `note` says which
 *    'no'       — not available
 *    'unknown'  — we have no basis to answer, and must not pretend to
 *
 *  'unknown' is a real answer and the caller must treat it as such. It is what an
 *  offshore site returns always, and what any site returns when the user's state
 *  is not known. Collapsing it into 'no' would hide every offshore event from a
 *  filter the user turned on expecting it to remove ones they cannot enter;
 *  collapsing it into 'yes' would claim availability we cannot support. */
export function siteAvailability(siteKey, jurisdiction) {
  const site = getSite(siteKey);
  if (!site) return { status: 'unknown', note: null };
  if (site.model === SITE_MODELS.offshore) {
    return { status: 'unknown', note: 'No published state-by-state availability' };
  }
  const st = (jurisdiction || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(st)) return { status: 'unknown', note: 'Your state is not set' };

  if (site.model === SITE_MODELS.regulated) {
    return site.states.includes(st)
      ? { status: 'yes', note: null }
      : { status: 'no', note: `Not licensed in ${st}` };
  }
  // sweepstakes
  if ((site.blockedStates || []).includes(st)) {
    return { status: 'no', note: `Not offered in ${st}` };
  }
  const limited = (site.limitedStates || {})[st];
  if (limited) return { status: 'limited', note: limited };
  return { status: 'yes', note: null };
}

/** The predicate the "only what I can play" filter uses. Deliberately keeps
 *  'unknown' and 'limited': the toggle removes what we KNOW is unavailable, and
 *  nothing else. A filter that also dropped everything unverifiable would empty
 *  the offshore half of the list while appearing to answer a question about the
 *  user's state. */
export function isSiteAvailable(siteKey, jurisdiction) {
  return siteAvailability(siteKey, jurisdiction).status !== 'no';
}

/** venuePrefix → timezone, for the venue-name lookup in utils.js. Derived rather
 *  than written twice: two maps of the same fact drift, and the one that drifted
 *  last time put a Pacific label on an Eastern time. */
export const SITE_VENUE_TIMEZONES = Object.fromEntries(
  ONLINE_SITE_LIST.map(s => [s.venuePrefix, s.timezone])
);

/** The US states and territories the jurisdiction picker offers. Postal codes
 *  because that is what Nominatim's `state` maps to and what the lists above
 *  test. */
export const US_STATES = [
  ['AL','Alabama'],['AK','Alaska'],['AZ','Arizona'],['AR','Arkansas'],['CA','California'],
  ['CO','Colorado'],['CT','Connecticut'],['DE','Delaware'],['DC','District of Columbia'],
  ['FL','Florida'],['GA','Georgia'],['HI','Hawaii'],['ID','Idaho'],['IL','Illinois'],
  ['IN','Indiana'],['IA','Iowa'],['KS','Kansas'],['KY','Kentucky'],['LA','Louisiana'],
  ['ME','Maine'],['MD','Maryland'],['MA','Massachusetts'],['MI','Michigan'],['MN','Minnesota'],
  ['MS','Mississippi'],['MO','Missouri'],['MT','Montana'],['NE','Nebraska'],['NV','Nevada'],
  ['NH','New Hampshire'],['NJ','New Jersey'],['NM','New Mexico'],['NY','New York'],
  ['NC','North Carolina'],['ND','North Dakota'],['OH','Ohio'],['OK','Oklahoma'],['OR','Oregon'],
  ['PA','Pennsylvania'],['RI','Rhode Island'],['SC','South Carolina'],['SD','South Dakota'],
  ['TN','Tennessee'],['TX','Texas'],['UT','Utah'],['VT','Vermont'],['VA','Virginia'],
  ['WA','Washington'],['WV','West Virginia'],['WI','Wisconsin'],['WY','Wyoming'],
];

const STATE_BY_NAME = new Map(US_STATES.map(([code, name]) => [name.toLowerCase(), code]));

/** Nominatim returns `address.state` as a full name ("Nevada"), occasionally a
 *  code, and for DC something else entirely. Null when it is neither — never a
 *  guess, because a wrong state produces a confidently wrong availability answer. */
export function stateCodeFrom(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (/^[A-Za-z]{2}$/.test(s)) {
    const up = s.toUpperCase();
    return US_STATES.some(([code]) => code === up) ? up : null;
  }
  const hit = STATE_BY_NAME.get(s.toLowerCase());
  if (hit) return hit;
  if (/^washington,? d\.?c\.?$/i.test(s) || /district of columbia/i.test(s)) return 'DC';
  return null;
}

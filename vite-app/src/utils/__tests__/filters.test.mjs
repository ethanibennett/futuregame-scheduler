// utils.js reads localStorage at module scope for a debug clock override; stub it so the
// module can be imported outside a browser. Nothing under test touches it.
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

// Dynamic, because a static import is hoisted above the stub above it.
const { isOnline, isWsopOnline, matchesLocation, matchesOnline, getVenueTimezone, eventAvailability, isSeriesEvent, isBraceletEvent, isRingEvent, isWsopOnlineCircuit, shortEventNumber } =
  await import('../utils.js');

let pass = 0, fail = 0;
const eq = (label, actual, expected) => {
  if (actual === expected) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + ' — expected ' + expected + ', got ' + actual); }
};
/* For assertions whose expected value is "true", where naming the condition
   reads better than comparing to a literal. */
const ok = (label, cond) => eq(label, !!cond, true);

const online = { event_name: 'NLH Online Check A', venue: 'ZZ Online Check', is_online: 1, site: 'pokerstars' };
const legacy = { event_name: 'WSOP Online bracelet', venue: 'WSOP Online' };      // predates the column
const vegas  = { event_name: 'NLH', venue: 'Horseshoe / Paris Las Vegas' };        // has coords, NV
const texas  = { event_name: 'NLH', venue: 'Texas Card House Austin' };

// the radius is centred on Las Vegas
const nearVegas = { maxDistance: '50', userLocation: { lat: 36.115, lng: -115.17 } };
const regionTx  = { locationRegion: 'texas' };

console.log('isOnline');
eq('column wins', isOnline(online), true);
eq('legacy venue name still recognised', isOnline(legacy), true);
eq('a live venue is not online', isOnline(vegas), false);
eq('undefined is not online', isOnline(undefined), false);

console.log('matchesLocation — online abstains');
eq('online passes a 50mi radius', matchesLocation(online, nearVegas), true);
eq('online passes a region filter', matchesLocation(online, regionTx), true);
eq('legacy online passes too', matchesLocation(legacy, nearVegas), true);
eq('a Vegas venue passes near Vegas', matchesLocation(vegas, nearVegas), true);
eq('a Vegas venue FAILS the Texas region', matchesLocation(vegas, regionTx), false);

console.log('matchesLocation — uncurated feed series resolve through their property');
// The feed names its "venue" after the SERIES; without a curated VENUE_MAP row the venue string
// resolves no coordinates, and both location filters silently hid the whole series (110 of 194
// feed venues on 2026-09-21, including Big Stax XL and the 2026 RRPO). The row's `property` —
// the hosting room — is the stable key: curated longNames bind it to an abbr, and never-curated
// rooms get an exact-name VENUE_COORDS row.
const rrpo = { venue: '2026 Rock ‘n’ Roll Poker Open', property: 'Seminole Hard Rock Hollywood' };
const bigStax = { venue: 'Big Stax XL', property: 'Parx Casino' };
const pinktober = { venue: '2026 Pinktober Poker Open', property: 'Seminole Hard Rock Tampa' };
const nearPhilly = { maxDistance: '50', userLocation: { lat: 39.9526, lng: -75.1652 } };
eq('an uncurated FL series passes the Florida region via its property', matchesLocation(rrpo, { locationRegion: 'florida' }), true);
eq('and FAILS the Northeast region', matchesLocation(rrpo, { locationRegion: 'northeast' }), false);
eq('Big Stax XL is within 50 miles of Philadelphia', matchesLocation(bigStax, nearPhilly), true);
eq('but not within 50 miles of Vegas', matchesLocation(bigStax, nearVegas), false);
eq('Tampa does not inherit Hollywood coords: 150mi from Hollywood excludes it (they are ~190mi apart)', matchesLocation(pinktober, { maxDistance: '150', userLocation: { lat: 26.0512, lng: -80.2109 } }), false);
eq('a venue with no coords and no property is still hidden, not shown nationwide', matchesLocation({ venue: 'Fall Series' }, nearPhilly), false);

console.log('matchesOnline — the toggle');
eq('shown by default (field absent)', matchesOnline(online, {}), true);
eq('shown when true', matchesOnline(online, { showOnline: true }), true);
eq('hidden when false', matchesOnline(online, { showOnline: false }), false);
eq('a live event is unaffected by the toggle', matchesOnline(vegas, { showOnline: false }), true);
eq('no filters at all', matchesOnline(online, null), true);

console.log('the combination that used to be impossible');
const radiusAndShow = { ...nearVegas, showOnline: true };
eq('radius set, online still shown', matchesLocation(online, radiusAndShow) && matchesOnline(online, radiusAndShow), true);
const radiusAndHide = { ...nearVegas, showOnline: false };
eq('radius set, online hidden by toggle', matchesLocation(online, radiusAndHide) && matchesOnline(online, radiusAndHide), false);
eq('distant live event stays hidden either way', matchesLocation(texas, radiusAndShow), false);

console.log('isWsopOnline — a bracelet is a WSOP thing, not an online thing');
const acr   = { event_name: 'OSSXL #118H - $60,000 GTD', venue: 'ACR OSS XL', is_online: 1, site: 'acr' };
const wsopO = { event_name: 'NLH Bracelet', venue: 'WSOP Online', is_online: 1, site: 'wsop_com' };
eq('an ACR event is online', isOnline(acr), true);
eq('an ACR event is NOT WSOP online', isWsopOnline(acr), false);
eq('a WSOP.com event is WSOP online', isWsopOnline(wsopO), true);
eq('legacy WSOP Online row, no site column', isWsopOnline({ venue: 'WSOP Online' }), true);

console.log('the clock label must match the emitted value');
eq('ACR series resolves to Eastern', getVenueTimezone('ACR OSS XL'), 'America/New_York');
eq('the bare site schedule too', getVenueTimezone('ACR Schedule'), 'America/New_York');
eq('GGPoker likewise', getVenueTimezone('GGPoker Bounty Hunters'), 'America/New_York');
eq('PokerStars .com series resolve to Eastern', getVenueTimezone('PokerStars WCOOP 2026'), 'America/New_York');
eq('and the FanDuel room too', getVenueTimezone('PokerStars on FanDuel September Dynasty Series 2026'), 'America/New_York');
eq('a live venue is untouched by the prefix rule', getVenueTimezone('Horseshoe / Paris Las Vegas'), 'America/Los_Angeles');


const sites = await import('../online-sites.js');
const { siteAvailability, isSiteAvailable, stateCodeFrom, ONLINE_SITES } = sites;

console.log('availability — three models, and "unknown" is a real answer');
eq('WSOP.com in Nevada', siteAvailability('wsop_com', 'NV').status, 'yes');
eq('PokerStars on FanDuel in Pennsylvania', siteAvailability('pokerstars', 'PA').status, 'yes');
eq('PokerStars .com is unavailable in every US state (geo-blocked)', siteAvailability('pokerstars_com', 'PA').status, 'no');
eq('WSOP.com in Texas', siteAvailability('wsop_com', 'TX').status, 'no');
eq('BetMGM in Nevada is not licensed', siteAvailability('betmgm', 'NV').status, 'no');
eq('PokerStars/FanDuel in Michigan', siteAvailability('pokerstars', 'MI').status, 'yes');
eq('ClubWPT Gold is national by default', siteAvailability('clubwpt_gold', 'TX').status, 'yes');
eq('ClubWPT Gold withdrew from Michigan', siteAvailability('clubwpt_gold', 'MI').status, 'no');
// Arizona was missing from the list #242 shipped, which came from a review site
// rather than the operator. It is the regression test for taking a state list
// from the wrong kind of source.
eq('ClubWPT Gold is out of Arizona too', siteAvailability('clubwpt_gold', 'AZ').status, 'no');
eq('and all eight are blocked', ['AZ','CT','LA','MI','MT','NJ','TN','WA']
   .every(st => siteAvailability('clubwpt_gold', st).status === 'no'), true);
eq('ClubWPT Gold is limited in California', siteAvailability('clubwpt_gold', 'CA').status, 'limited');
ok('and says why', /Game Days/.test(siteAvailability('clubwpt_gold', 'CA').note || ''));
/* An offshore site that publishes NOTHING per-state is unknown — answering 'no'
   would be our claim, not theirs, and 'yes' would assert availability we cannot
   support. That is Phenom. It is NOT ACR, whose own EULA names the states it
   excludes, and not GGPoker, which does not serve the US at all. This assertion
   used to read "ACR is unknown everywhere", which was the bug: it treated
   "offshore" as a synonym for "no information" when two of the three offshore
   rooms publish plenty. */
eq('Phenom publishes nothing per-state', siteAvailability('phenom', 'PA').status, 'unknown');
eq('and ACR without a state is unanswerable', siteAvailability('acr', null).status, 'unknown');
eq('no jurisdiction set', siteAvailability('wsop_com', null).status, 'unknown');
eq('a junk state code', siteAvailability('wsop_com', 'ZZZ').status, 'unknown');
eq('a site we do not know', siteAvailability('nope', 'NV').status, 'unknown');
eq('lowercase state still resolves', siteAvailability('wsop_com', 'nv').status, 'yes');

console.log('the filter removes only what is KNOWN unavailable');
eq('known unavailable is filtered', isSiteAvailable('wsop_com', 'TX'), false);
eq('unknown is NOT filtered', isSiteAvailable('acr', 'TX'), true);
eq('limited is NOT filtered', isSiteAvailable('clubwpt_gold', 'CA'), true);

console.log('matchesOnline — the availability arm');
const acrEv = { venue: 'ACR OSS XL', is_online: 1, site: 'acr' };
const wsopEv = { venue: 'WSOP.com Schedule', is_online: 1, site: 'wsop_com' };
const live = { venue: 'Horseshoe / Paris Las Vegas' };
eq('off by default', matchesOnline(wsopEv, { jurisdiction: 'TX' }), true);
eq('on, unlicensed state, hidden', matchesOnline(wsopEv, { onlyAvailableOnline: true, jurisdiction: 'TX' }), false);
eq('on, licensed state, shown', matchesOnline(wsopEv, { onlyAvailableOnline: true, jurisdiction: 'NV' }), true);
eq('offshore survives the toggle', matchesOnline(acrEv, { onlyAvailableOnline: true, jurisdiction: 'TX' }), true);
// Without a state the toggle has nothing to test, and must abstain rather than
// filter on a blank -- which would empty the online half of the list.
eq('on but no jurisdiction abstains', matchesOnline(wsopEv, { onlyAvailableOnline: true }), true);
eq('a live event is never touched', matchesOnline(live, { onlyAvailableOnline: true, jurisdiction: 'TX' }), true);
eq('showOnline still wins', matchesOnline(acrEv, { showOnline: false, onlyAvailableOnline: true, jurisdiction: 'NV' }), false);
eq('eventAvailability on a live event', eventAvailability(live, 'TX').status, 'yes');
eq('eventAvailability on an online one', eventAvailability(wsopEv, 'NV').status, 'yes');

console.log('stateCodeFrom — Nominatim says "Nevada", the lists say "NV"');
eq('full name', stateCodeFrom('Nevada'), 'NV');
eq('case insensitive', stateCodeFrom('new jersey'), 'NJ');
eq('already a code', stateCodeFrom('PA'), 'PA');
eq('DC the long way', stateCodeFrom('District of Columbia'), 'DC');
// A wrong state produces a confidently wrong availability answer, so anything
// unrecognized is null rather than a best guess.
eq('a country is not a state', stateCodeFrom('Ontario'), null);
eq('a two-letter non-state', stateCodeFrom('ZZ'), null);
eq('empty', stateCodeFrom(''), null);

console.log('every site record is complete');
for (const [key, s] of Object.entries(ONLINE_SITES)) {
  ok(`${key}: key matches its index`, s.key === key);
  ok(`${key}: has a name, abbr and venuePrefix`, !!(s.name && s.abbr && s.venuePrefix));
  ok(`${key}: carries a verifiedOn date`, /^\d{4}-\d{2}-\d{2}$/.test(s.verifiedOn || ''));
  ok(`${key}: a regulated site names its states`, s.model !== 'regulated' || (s.states || []).length > 0);
}


console.log('offshore is not one thing — three rooms, three answers');
/* GGPoker does not accept US players AT ALL. The first version of this file
   filed it as a plain offshore site with no state data, which made the answer
   "unknown" and therefore SHOWED it: a player in Pennsylvania was told GGPoker
   was available to them. The watcher's recon said "No US access" in as many
   words; the fact existed and was not encoded. */
eq('GGPoker in Pennsylvania', siteAvailability('ggpoker', 'PA').status, 'no');
eq('GGPoker in Nevada', siteAvailability('ggpoker', 'NV').status, 'no');
eq('GGPoker with no state set is still no', siteAvailability('ggpoker', null).status, 'no');
ok('and it says why', /United States/.test(siteAvailability('ggpoker', 'PA').note || ''));

// ACR DOES serve the US, minus the states its own EULA §1.4 excludes.
eq('ACR in Pennsylvania', siteAvailability('acr', 'PA').status, 'yes');
eq('ACR in Texas', siteAvailability('acr', 'TX').status, 'yes');
eq('ACR in Nevada is excluded', siteAvailability('acr', 'NV').status, 'no');
eq('and in New Jersey', siteAvailability('acr', 'NJ').status, 'no');
eq('and in Michigan', siteAvailability('acr', 'MI').status, 'no');
ok('all nine excluded states', ['WA','KY','DE','LA','MD','MI','MS','NV','NJ']
   .every(st => siteAvailability('acr', st).status === 'no'));
eq('but without a state, ACR is unanswerable', siteAvailability('acr', null).status, 'unknown');

// Phenom publishes nothing per-state, so it stays genuinely unknown.
eq('Phenom is still unknown', siteAvailability('phenom', 'PA').status, 'unknown');
eq('and is therefore not filtered out', isSiteAvailable('phenom', 'PA'), true);

console.log('the toggle, from Pennsylvania');
const ggEv  = { venue: 'GGPoker Schedule', is_online: 1, site: 'ggpoker', buyin: 500 };
const acrEv2 = { venue: 'ACR OSS XL', is_online: 1, site: 'acr', buyin: 66 };
const phEv  = { venue: 'Phenom Schedule', is_online: 1, site: 'phenom', buyin: 100 };
const paOn = { onlyAvailableOnline: true, jurisdiction: 'PA' };
eq('GGPoker is hidden in PA', matchesOnline(ggEv, paOn), false);
eq('ACR is shown in PA', matchesOnline(acrEv2, paOn), true);
eq('Phenom is shown in PA', matchesOnline(phEv, paOn), true);
// From Nevada the answer flips for ACR and stays put for GGPoker.
const nvOn = { onlyAvailableOnline: true, jurisdiction: 'NV' };
eq('ACR is hidden in NV', matchesOnline(acrEv2, nvOn), false);
eq('GGPoker is hidden in NV too', matchesOnline(ggEv, nvOn), false);
eq('with the toggle off, GGPoker is back', matchesOnline(ggEv, { jurisdiction: 'PA' }), true);

console.log('isSeriesEvent reads the emitter naming convention');
eq('a series venue', isSeriesEvent({ venue: 'ACR OSS XL', is_online: 1, site: 'acr' }), true);
eq('the standing schedule is not a series', isSeriesEvent({ venue: 'GGPoker Schedule', is_online: 1, site: 'ggpoker' }), false);
eq('a monthly circuit is', isSeriesEvent({ venue: 'WSOP.com September 2026 Online Circuit', is_online: 1, site: 'wsop_com' }), true);
// A live venue is not answered by this at all.
eq('a live event is not an online series', isSeriesEvent({ venue: 'Horseshoe / Paris Las Vegas' }), false);

console.log('per-site rules — a floor that fits the room');
const rules = f => ({ siteRules: f });
eq('no rules means no restriction', matchesOnline(acrEv2, rules({})), true);
eq('a floor the event clears', matchesOnline(ggEv, rules({ ggpoker: { minBuyin: 200 } })), true);
eq('a floor it does not', matchesOnline(acrEv2, rules({ acr: { minBuyin: 200 } })), false);
// The rule is per SITE: a floor on one room must not touch another.
eq('another room is untouched', matchesOnline(phEv, rules({ acr: { minBuyin: 200 } })), true);
eq('a zero floor is no floor', matchesOnline(acrEv2, rules({ acr: { minBuyin: 0 } })), true);
eq('a blank floor is no floor', matchesOnline(acrEv2, rules({ acr: { minBuyin: '' } })), true);
eq('series only, on a series event', matchesOnline(acrEv2, rules({ acr: { seriesOnly: true } })), true);
eq('series only, on the daily schedule', matchesOnline(ggEv, rules({ ggpoker: { seriesOnly: true } })), false);
// Both at once, and the floor is what fails.
eq('both rules, floor fails', matchesOnline(acrEv2, rules({ acr: { seriesOnly: true, minBuyin: 200 } })), false);
eq('a live event ignores site rules entirely', matchesOnline(vegas, rules({ acr: { minBuyin: 99999 } })), true);


console.log('a ring is not a bracelet');
/* WSOP.com runs TWO trophy series under one site key: the annual Online
   Bracelet series and a monthly Online CIRCUIT series that awards gold RINGS.
   isBraceletEvent asked only "is this WSOP.com online", so every ring event got
   a bracelet the moment the Circuit adapter shipped. Same shape of mistake as
   the ACR bracelet bug in #241 — an over-broad predicate answering a narrower
   question. These rows are copied from the live database. */
const ring = { venue: 'WSOP.com September 2026 Online Circuit', event_name: 'NLH 6-Max',
               event_number: 'WSOP_COM-circuit-202609-3-20260914', category: null,
               is_satellite: 0, is_restart: 0, is_online: 1, site: 'wsop_com' };
const braceletOnline = { venue: 'WSOP.com 2026 Online Bracelet', event_name: "NL Hold'Em Kick Off",
               event_number: 'WSOP_COM-202601-20260530', category: null,
               is_satellite: 0, is_restart: 0, is_online: 1, site: 'wsop_com' };

eq('the circuit series is recognised', isWsopOnlineCircuit(ring), true);
eq('the bracelet series is not', isWsopOnlineCircuit(braceletOnline), false);
eq('and a live venue is not', isWsopOnlineCircuit({ venue: 'Horseshoe / Paris Las Vegas' }), false);

eq('a ring event gets NO bracelet', isBraceletEvent(ring), false);
eq('a ring event gets a RING', isRingEvent(ring), true);
eq('an online bracelet event still gets a bracelet', isBraceletEvent(braceletOnline), true);
eq('and NOT a ring', isRingEvent(braceletOnline), false);

// The exclusions that apply to every trophy event still apply to these.
eq('a circuit satellite is not a ring', isRingEvent({ ...ring, is_satellite: 1 }), false);
eq('a circuit side event is not a ring', isRingEvent({ ...ring, category: 'side' }), false);
eq('nor is one that says so in the name',
   isRingEvent({ ...ring, event_name: 'NLH Side Event - Nightly' }), false);
// A live WSOPC stop must keep working exactly as before.
eq('a live circuit stop still gets a ring',
   isRingEvent({ venue: 'Turning Stone Casino', event_name: 'NLH Monster Stack',
                 event_number: '12', category: null, is_satellite: 0 }), true);


console.log('a room switched off is off');
eq('hidden hides the room', matchesOnline(ggEv, rules({ ggpoker: { hidden: true } })), false);
eq('and leaves other rooms alone', matchesOnline(acrEv2, rules({ ggpoker: { hidden: true } })), true);
eq('hidden:false is not hidden', matchesOnline(ggEv, rules({ ggpoker: { hidden: false } })), true);
/* Off beats the refinements: a floor or a series switch narrows what you see
   WITHIN a room you still want, so they cannot resurrect one you turned off. */
eq('off beats a floor the event clears',
   matchesOnline(ggEv, rules({ ggpoker: { hidden: true, minBuyin: 1 } })), false);
eq('off beats series-only on a series event',
   matchesOnline(acrEv2, rules({ acr: { hidden: true, seriesOnly: true } })), false);
// Turning every room off empties the online half and touches nothing live.
const allOff = rules({ acr: { hidden: true }, ggpoker: { hidden: true }, phenom: { hidden: true } });
eq('every online room off', [ggEv, acrEv2, phEv].every(e => matchesOnline(e, allOff) === false), true);
eq('a live event is still shown', matchesOnline(vegas, allOff), true);


console.log('the event-number pill shows a number, or nothing');
/* Both feeds build event_number as "<base>-<id>-<YYYYMMDD>" — the id and date
   exist only to make it unique per instance, because multi-flight events share
   an event number AND a tournament id and differ only by date. Only `base` is
   the event number, and mtt-series-watcher writes the literal 'PA' as the base
   WHEN POKERATLAS PUBLISHED NO NUMBER. */
eq('a real PokerAtlas number', shortEventNumber('27-281793-20260730'), '27');
eq('a leading-zero number', shortEventNumber('03-296705-20261001'), '03');
/* "PA-283635-…" does NOT mean event 283635 — it means this event has no number
   and 283635 is an internal tournament id. Rendering it would invent an event
   number out of a database key. */
eq('no number published', shortEventNumber('PA-283635-20260816'), null);
// Combined-flight rows carry the list of events they cover; the list IS useful.
eq('a multi-event row', shortEventNumber('2, 6, 8, 10-293208-20260914'), '2, 6, 8, 10');

/* Online rooms mostly do not number their events, and the ids are constructed.
   The first-dash-segment rule this replaced turned them into "#bounty",
   "#daily" and "#WSOP_COM". */
eq('ACR publishes a tournament id, not an event number', shortEventNumber('ACR-35922782-20260914'), null);
eq('GGPoker numbers nothing', shortEventNumber('GGPOKER-bounty-hunters-0230-x-20260915'), null);
eq('nor does Phenom', shortEventNumber('PHENOM-daily-2045-8-game-mix-20260914'), null);
eq('nor the WSOP bracelet id', shortEventNumber('WSOP_COM-202601-20260530'), null);
/* The one constructed id that DOES carry a real number: the online Circuit,
   whose events are "Event #1".."#12". */
eq('the online Circuit event number', shortEventNumber('WSOP_COM-circuit-202609-3-20260914'), '3');
eq('and a two-digit one', shortEventNumber('WSOP_COM-circuit-202609-12-20260923'), '12');

eq('a bare number is itself', shortEventNumber('12'), '12');
eq('a flight suffix survives', shortEventNumber('12H'), '12H');
eq('empty', shortEventNumber(''), null);
eq('null', shortEventNumber(null), null);
eq('undefined', shortEventNumber(undefined), null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

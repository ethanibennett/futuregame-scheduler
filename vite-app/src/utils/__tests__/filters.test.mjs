// utils.js reads localStorage at module scope for a debug clock override; stub it so the
// module can be imported outside a browser. Nothing under test touches it.
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

// Dynamic, because a static import is hoisted above the stub above it.
const { isOnline, isWsopOnline, matchesLocation, matchesOnline, getVenueTimezone, eventAvailability } =
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
eq('a live venue is untouched by the prefix rule', getVenueTimezone('Horseshoe / Paris Las Vegas'), 'America/Los_Angeles');


const sites = await import('../online-sites.js');
const { siteAvailability, isSiteAvailable, stateCodeFrom, ONLINE_SITES } = sites;

console.log('availability — three models, and "unknown" is a real answer');
eq('WSOP.com in Nevada', siteAvailability('wsop_com', 'NV').status, 'yes');
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
// An offshore site publishes no state list. Answering 'no' would be our claim,
// not theirs; answering 'yes' would assert availability we cannot support.
eq('ACR is unknown everywhere', siteAvailability('acr', 'NV').status, 'unknown');
eq('Phenom likewise', siteAvailability('phenom', 'PA').status, 'unknown');
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

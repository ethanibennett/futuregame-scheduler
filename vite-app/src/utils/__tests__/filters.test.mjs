// utils.js reads localStorage at module scope for a debug clock override; stub it so the
// module can be imported outside a browser. Nothing under test touches it.
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

// Dynamic, because a static import is hoisted above the stub above it.
const { isOnline, isWsopOnline, matchesLocation, matchesOnline, getVenueTimezone } =
  await import('../utils.js');

let pass = 0, fail = 0;
const eq = (label, actual, expected) => {
  if (actual === expected) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + ' — expected ' + expected + ', got ' + actual); }
};

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

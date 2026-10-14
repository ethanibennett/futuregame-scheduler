# Venue map

Owner request, 2026-10-13: tapping an event card's venue strip shows where the room is on a map.
Some room names say nothing about where they are unless you already know the property.

## What opens it

- **Schedule and My Schedule cards** (`CalendarEventRow.jsx`, both the full row and the list's
  lite row). The vertical `.cal-venue-strip` opens the map. The card's bar still opens and closes
  the card. On desktop the strip in the detail pane opens the map too.
  - The strip stays a `div role="button"` with a tab stop, Enter/Space, the inset focus ring and
    `aria-label="Show <room> on a map"`.
  - It is not a `<button>` because its name is set in `vertical-rl`. A `<button>` honours
    `writing-mode` only from Safari 17.4, and the app's iOS floor is 15. Below 17.4 the rotated
    name would lie flat across the strip.
- **Up Next cards on the home** (`DashboardView.jsx`). The `.dash-venue-strip` banner is a real
  `<button>`. The card's own tap ignores taps on buttons, so tapping the banner does not also jump
  to My Schedule.
- **The shared-schedule page** renders through `CalendarEventRow`, so its strips open the map too.

**Online events and Personal days** (`hasVenueMap` in `utils/venue-place.js`: `isOnline(t)`, or
venue `Personal`) have no place. Their strip keeps its old behaviour, toggling the card, and shows
no map affordance. The cash-session card on the home (`HomeCashCard.jsx`) is not an event card and
does not open the map.

## What the popup shows (`VenueMapSheet.jsx`)

- **The room's name.** The feed's `property` if the row has one. Otherwise the curated `longName`,
  without its display-only "WSOPC " prefix.
- **Its town**, e.g. "Atlantic City, NJ".
- **The distance from the user's saved location**, e.g. "56 mi from Philadelphia". Shown only when
  one is set, from `savedLocation.userLocation` and the first part of its label. A region alone
  is not a point, so it gets no distance.
- **"Approximate location — town centre"**, when the coordinate is a town centre.
- **The map**, with one pin on the room at about zoom 13 and the room's name as the pin's label.
- **Two buttons:**
  - **Open in Apple Maps:** `https://maps.apple.com/?q=<name>&ll=<lat>,<lng>`. On iOS and the
    Mac this opens the Maps app.
  - **Google Maps:** `https://www.google.com/maps/search/?api=1&query=<lat>,<lng>`.
  - With no coordinate at all, the popup says "No map location on file for this room". The
    buttons become **Search in Apple Maps** and **Search in Google Maps**, searching for the name
    and town.

**Layout.** On the phone layout it is a bottom sheet. On the desktop layout
(`html[data-layout="desktop"]`) it is a dialog centred on the window. Either way it is portalled
to `<body>` and is 37g wide. Every row is a whole r:

| Row | Height |
|---|---|
| Padding | 2r |
| Name, with Close (4g x 5r) beside it | 5r, or 8r when the name takes two lines |
| Town | 3r |
| Distance | 3r |
| Approximate | 3r |
| Gap | 2r |
| Map (35g wide) | 30r |
| Gap | 2r |
| Buttons, 17g + 1g + 17g | 5r |
| Padding | 3r |

`snap-place` puts the sheet's top on an r line counted from the bar.

**Behaviour:**
- Close button, Esc, or a tap on the backdrop closes it.
- Tab stays inside the popup.
- Focus returns to the strip that opened it.
- Reduced motion drops the entrance animation.
- It uses tokens only, so it follows every theme and high contrast. The primary button is the
  aqua brand.

## Where the place comes from

**Coordinates are what the app already knows.** `getVenueCoords()` reads the curated maps first,
then the server-placed ones (docs/venue-coords.md). The popup then asks
`GET /api/venue-place?venue=&property=&lat=&lng=`. It asks only when it opens, and the answer is
cached for the page.

**The town** comes from the source that placed the room, in this order
(`lib/venue-coords.js describePlace`):
1. The room's PokerAtlas directory entry (`data/venue-directory.json` city_state).
2. The town the source named. This is a WSOP.com stop page, or a feed row's `venue_location`.
3. The query a Nominatim placement was made from.

If none of those has a town, the server reverse-geocodes a coordinate: its own placement of the
venue, else the one the popup shows. It uses Nominatim at building zoom, through the same 1/s
queue `resolveVenueCoords` uses. The answer is the postal city: the Strip is "Las Vegas, NV",
where zoom 10 said only "Clark County".

The lookup is limited so that a caller cannot queue unbounded Nominatim requests:
- It runs only for a venue the schedule holds.
- The answer is cached per venue for the process's life. A miss is cached for 6 hours.
- At most 4 lookups are in flight at once.

**City-level coordinates.** The curated `VENUE_COORDS` and `PROPERTY_COORDS` entries marked
city-level carry `approx: true`. `GET /api/venue-coords` sends `approx: 1` for a `nominatim-city`
placement, and `registerVenueCoords` keeps that flag.

Most of the curated city-level rooms are in the PokerAtlas directory with exact coordinates, so
the popup waits up to 2 s for the server's answer. When the server has an exact placement, the
popup uses it instead of the town centre: Texas Card House Houston is pinned on the room, not
downtown. Only when nothing better exists does the popup say "Approximate location — town centre".
An example is a curated series known only by its town, with no `property`, such as Trailblazer
Tour, which is TCH DALLAS. The location filters still use the curated coordinate, as before.

On the shared-schedule page, which loads no `/api/venue-coords`, the popup takes the server's
placement.

## The map: one provider per platform (`utils/venue-map/providers.js`)

| Platform (`Capacitor.getPlatform()`) | Order tried |
|---|---|
| `android` | Google Maps → MapKit JS → OpenStreetMap |
| `ios` (iPhone, iPad, the Mac Catalyst app), `web` | MapKit JS → OpenStreetMap |

That function is the only place the choice is made. Each provider is one module with the same
interface:

```js
export default {
  id,
  available(): Promise<boolean>,
  mount(el, { lat, lng, title, theme }): Promise<{ destroy() }>,
};
```

**How the order is used:**
- A provider is skipped when it is not configured.
- When a provider's mount fails (a refused token, a CDN that will not load), the next one is
  tried. A refused provider is not tried again until the page reloads.
- OpenStreetMap needs no key and is always last. If it cannot draw either (offline), the popup
  says "The map could not load. Open it in Maps below." and the buttons still work.

To add a provider, add one module and one line in `LOADERS` and in the order. The popup does not
change.

**Lazy loading.** Every provider module, and the popup itself (`utils/venue-map/open.js`), is a
dynamic import. No map code and no map library is in the main bundle. On the 2026-10-13 build:
- Leaflet: 151 KB, only in `provider-osm-*.js`.
- MapKit loader: 2.3 KB.
- Google loader: 2 KB.
- The popup: 6.4 KB.

None of these loads until a strip is tapped.

### The three providers

- **MapKit JS** (`provider-mapkit.js`):
  - Loads `https://cdn.apple-mapkit.com/mk/6/mapkit.core.js` with only the `map` and
    `annotations` libraries.
  - Calls `mapkit.init` once per page. Its `authorizationCallback` fetches `/api/mapkit-token`
    each time MapKit wants a token.
  - Draws a `MarkerAnnotation` in the brand colour. `colorScheme` follows the app theme: light
    and cloudy are light, everything else dark.
  - MapKit's own zoom, compass, scale and map-type controls are off, because they would sit off
    the grid.
  - Configured means `/api/mapkit-token` answers 200.
- **Google Maps JavaScript API** (`provider-google.js`, Android only):
  - Loads `https://maps.googleapis.com/maps/api/js` with `key`, `v=weekly`, `loading=async` and a
    callback.
  - Gets `Map`, `ColorScheme` and `marker` from `google.maps.importLibrary()`. With a Map ID the
    pin is an `AdvancedMarkerElement`, which requires one. Without a Map ID it is the classic
    `Marker`.
  - Sets `colorScheme` DARK or LIGHT from the theme, once, at creation.
  - The default UI is off.
  - If Google refuses the key (`gm_authFailure`), the popup falls back to MapKit, then
    OpenStreetMap.
  - Configured means `/api/google-maps-config` answers 200.
- **OpenStreetMap** (`provider-osm.js`):
  - Leaflet 1.9.4 with `https://tile.openstreetmap.org/{z}/{x}/{y}.png`. The required
    "© OpenStreetMap contributors" attribution shows in the corner.
  - On the dark themes the tiles are inverted and turned back to their hues, so water stays blue
    and the map is dimmed but legible.
  - Leaflet's zoom buttons and keyboard handler are off. Pinch, double-tap and the wheel still
    zoom.
  - The tile usage policy allows this light use: one popup's tiles, on a tap.

## Server (`lib/map-providers.js`, mounted in server.js)

Both endpoints are public, because a map of a casino is not sensitive and the shared page has no
session. Neither ever logs a key.

- **`GET /api/mapkit-token`** returns `{ configured: true, token, expiresAt }`.
  - The token is a MapKit JS JWT. Header: `alg ES256`, `kid` = `MAPKIT_KEY_ID`, `typ JWT`.
    Payload: `iss` = `MAPKIT_TEAM_ID`, `iat`, and `exp` 30 minutes on. It is signed with
    `MAPKIT_PRIVATE_KEY`, which is the .p8 contents. Literal `\n` escapes are accepted, and a bare
    base64 body is re-armoured.
  - By default there is no `origin` claim, so one token serves futurega.me, the Capacitor app
    (`capacitor://localhost`, `https://localhost`) and the Mac app.
  - One token is cached and re-signed in its last 5 minutes, so the route needs no rate limit of
    its own.
  - If any of the three variables is missing, it returns 404 `{ configured: false }`.
- **`GET /api/google-maps-config`** returns `{ configured: true, key, mapId }` from
  `GOOGLE_MAPS_BROWSER_KEY` and the optional `GOOGLE_MAPS_MAP_ID`. Without a key it returns 404
  `{ configured: false }`.
- **`GET /api/venue-place`** returns the town (above). See "Where the place comes from".

The boot log says which providers are configured:
`[VenueMap] providers: MapKit JS …, Google Maps …, OpenStreetMap always`.

## Owner setup

### Apple Maps (MapKit JS), for the web, iPhone, iPad and the Mac app

1. In the Apple Developer account, go to **Certificates, Identifiers & Profiles → Identifiers →
   +**, choose **Maps IDs**, and register one (e.g. `maps.me.futurega`).
2. Go to **Keys → +**, name the key, tick **MapKit JS**, and choose **Configure** → the Maps ID
   from step 1. Then choose **Register**.
3. **Download** the `.p8`. It can be downloaded only once. Note the **Key ID** shown on the key.
4. Your **Team ID** is under **Membership**.
5. Set the three variables on Render (the futuregame-scheduler service → Environment). A
   multi-line value can be pasted as it is:
   - `MAPKIT_TEAM_ID`
   - `MAPKIT_KEY_ID`
   - `MAPKIT_PRIVATE_KEY`, the whole `.p8`, including the BEGIN/END lines.
6. Add the same three to the local `ecosystem.config.cjs` under the futuregame-scheduler app's
   `env`. There the key is easiest as one line with `\n` escapes. Then:

   **PC (PowerShell):**
   ```bash
   pm2 restart ecosystem.config.cjs --update-env; pm2 save
   ```

7. Check it. The token route should answer 200, and a popup's map should be Apple's. Its canvas
   carries `data-provider="mapkit"`.

   **PC (PowerShell):**
   ```bash
   Invoke-RestMethod http://localhost:3001/api/mapkit-token | Select-Object configured, expiresAt
   ```

**If Apple refuses the origin-less token.** The popup quietly falls back to OpenStreetMap, and
MapKit's error is "Unauthorized". Apple's current docs ask for `origin` and `scope: mapkit_js` on
dynamically signed tokens. Set `MAPKIT_ORIGIN` (for example `futurega.me,localhost`) in both
places and the token carries both claims.

### Google Maps, for the Android app

1. In a Google Cloud project with billing enabled, enable **Maps JavaScript API**.
2. Create an **API key**. Restrict it as follows:
   - **API restrictions:** Maps JavaScript API only.
   - **Application restrictions:** Websites:
     - `https://futurega.me/*`
     - `https://localhost/*`. This is the Capacitor Android app's origin. `capacitor.config.json`
       sets no `androidScheme`, so Capacitor 8's default `https` on `localhost` applies.
3. Optionally create a **Map ID** under Map Management, JavaScript, vector. It enables the advanced
   marker and cloud styling, including a dark style.
4. Set the variables on Render and in `ecosystem.config.cjs` as above, then restart pm2:
   - `GOOGLE_MAPS_BROWSER_KEY`
   - `GOOGLE_MAPS_MAP_ID`, optional.

Without the Google key, Android uses MapKit when that is configured, otherwise OpenStreetMap.

## Tests and guards

- **`npm run test:venue-map`:**
  - The server test (`test/venue-map.test.js`) signs a token with a throwaway EC P-256 key and
    verifies its header, claims and signature, the cache, the 404 paths, the Google config and
    the place helpers. It boots server.js on a scratch port.
  - The client test (`vite-app/src/utils/__tests__/venue-map.test.mjs`) covers the provider
    order per platform, with `Capacitor.getPlatform` stubbed, and the fallthrough. It also checks
    which events get a map, the room name, approximate flags, distance and links.
- **`npm run check:controls`** has two views, `venue-map` (opened from a Schedule card's strip)
  and `venue-map-upnext` (from an Up Next banner). The map canvas is excluded as a map library's
  drawing: tiles, pin, label and attribution.
- **`npm run check:clipping`** scans the popup from both places.

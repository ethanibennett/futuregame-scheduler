# Venue coordinates

Both location filters (radius and region) hide an event whose venue has no coordinate. The
client only knows coordinates for rooms someone hand-added to `VENUE_MAP` / `PROPERTY_COORDS` /
`VENUE_COORDS`, so every new room was invisible to location search. On 2026-10-08 that was 32 of
92 upcoming live venues and 423 events, including Choctaw Durant, Rozvadov and Baha Mar.

Now the server places every live venue from what its source publishes, and the client checks
that only **after** its curated maps.

## How a venue gets placed (`lib/venue-coords.js` `resolveVenue`)

1. **The feed row's own coordinates** (`venue_lat` / `venue_lng`). The watcher does not send them
   yet; see "Watcher change" below.
2. **The room (`property`) by exact name in the PokerAtlas directory.** PokerAtlas's
   `/api/venues` gives real latitude/longitude for every venue, and the feed's `property` *is*
   PokerAtlas's venue name, so an exact match means the same venue. The snapshot is
   `data/venue-directory.json`. Two venues with the same name resolve only if they stand within
   3 miles of each other or the location hint names one's town.
3. **Nominatim for "room, town"**, but only when the source named both. This is the same service
   `/api/geocode` uses, limited to the named country, and the result must fall in the state the
   source gave. WSOP.com stop pages name the room and town; the watcher emits those stops with
   `property: null`, so the snapshot's `wsop_stops` carries them by feed venue string.
4. **Nominatim for the town alone** (`nominatim-city`). This is the same city-level standard
   `PROPERTY_COORDS` already uses.

It never geocodes a bare room name and never works from a series title. "Riverside Casino"
exists in both Iowa and Laughlin, and "Panama City" is both a Florida town and the capital of
Panama. A venue the sources don't place stays unresolved, and the resolver logs it as `unplaced`.

**Regions** are what `LOCATION_REGIONS` tests:
- a US venue gets its state's postal code;
- a Canadian venue gets `CA-<province>` (bare `CA` means California);
- any other venue gets its ISO country code.

Some ISO country codes are also US postal codes. Those countries get their name instead, following
the existing `MACAU` entry. Without that, Panama (`PA`) and Germany (`DE`) would fall inside
"Northeast US". When the source's location text doesn't give a region, the coordinates are
reverse-geocoded once and the answer is cached.

## Where it runs (server.js)

- **Table `venue_coords`** (`venue` PK, lat, lng, region, source, detail, updated_at). A row with
  `lat` NULL records a miss and is not retried for 24 h.
- **`resolveVenueCoords()`** covers upcoming, non-online venues. It runs:
  - at boot (in the background);
  - hourly at :20, after both feeds ingest and before the push;
  - on production after each feed-sync.
- **Both write paths** read per-row location fields through `noteVenueHints()`. These are
  `venue_lat`, `venue_lng`, `venue_location`, `venue_country` and `venue_region`. The two paths
  are `ingestFeed()` and the `/api/tournaments/feed-sync/:token` receiver. The fields are not
  tournaments columns.
- **`pushMttFeedToProd()`** sends `venueCoords` (this box's resolved map for the feed venues).
  The receiver applies it first, so production does not repeat this box's geocoding.
- **`GET /api/venue-coords`** is public and returns `{ venue: { lat, lng, region } }`. That was
  about 7 KB raw and 2.4 KB gzipped for 92 venues. `App.jsx` fetches it alongside
  `/api/tournaments` and calls `registerVenueCoords()` before the list renders.
  `getVenueCoords()` falls back to it last. `CalendarView` now uses `matchesLocation()` instead
  of its own copy.

## Refreshing the snapshot

Run on the Windows box. The script opens the watcher DB read-only:

**PC (PowerShell):**
```bash
node scripts/build-venue-directory.js
```

This is a bootstrap. Once the watcher change is deployed, a stale snapshot only matters for rooms
the watcher cannot place.

## Watcher change (owner: mtt-series-watcher) — `docs/venue-coords-watcher.diff`

The patch is against `src/db/read.ts` and `src/emit/snbwsop.ts`. It needs no schema change. It
type-checks, and its readers were exercised read-only against the live DB: 1,171 venues located
and 30 stops named.

- `reader.venueGeo()` reads PokerAtlas latitude/longitude per `venue_id` from the stored
  `/api/venues` payloads. `venue_directory` drops those fields.
- `reader.wsopStopVenues()` reads `venueTitle`, `venueLocation` and `countryId` from the stored
  WSOP.com stop pages.
- Each emitted row gains four fields: `venue_lat`, `venue_lng`, `venue_location` and
  `venue_country`. A WSOP.com stop also gets `property` set to the room its page names.
  - This changes the strip of an *uncurated* WSOPC series. Today the client derives the strip
    from the series title. After the change it derives it from the room, which is what
    `property` is for.

Apply from the watcher root:

**PC (PowerShell):**
```bash
git apply D:\projects\scheduler\docs\venue-coords-watcher.diff
```

Then `npm run emit`. The scheduler already accepts the fields on both write paths.

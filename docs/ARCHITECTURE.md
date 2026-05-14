# Prairie Finder Architecture

Prairie Finder is a local TypeScript prototype with a backend-owned iNaturalist sync loop. The server polls public prairie dog observations, normalizes them into a shared event shape, persists live pulls to JSONL, and pushes fresh observations plus sync status to the browser over Server-Sent Events (SSE).

## App Structure

- `src/server.ts`: single Node HTTP process for API routes, SSE clients, polling, JSONL persistence, and static viewer serving.
- `src/feeds/inaturalist.ts`: iNaturalist feed adapter.
- `src/normalize.ts`: converts raw iNaturalist observations into `PrairieDogEvent`.
- `src/types.ts`: shared server-side feed and event types.
- `src/event-store.ts`: append/read helpers for newline-delimited JSON event storage.
- `src/seeds.ts`: bundled seed events used so the map has data before live pulls arrive.
- `src/cli.ts`: one-shot feed collector that writes normalized iNaturalist events to the JSONL store.
- `viewer/`: Vite client app, including `viewer/src/main.ts` and `viewer/src/styles.css`.
- `tests/normalize.test.ts`: focused coverage for iNaturalist normalization.

## Runtime Flow

`npm run server` starts `src/server.ts` with `tsx`. On startup, the server reads the configured JSONL file, seeds an in-memory `seen` set with seed and stored event IDs, binds to `127.0.0.1`, runs an immediate iNaturalist sync, then repeats syncing on `POLL_INTERVAL_MS`.

The server also serves the viewer. If `dist/index.html` exists, it serves the production Vite build from `dist`; otherwise it serves source files from `viewer`, which supports the local prototype path. In viewer development, `npm run viewer` starts Vite on port `5173` and proxies `/api` and `/events` to the Node server on port `8787`.

## Data Model

The canonical record is `PrairieDogEvent` in `src/types.ts`.

Key fields:

- `event_id`: stable app-level ID, currently `inat:<observation id>` or `seed:<id>`.
- `source`, `source_item_id`, `source_url`: source identity and original URL.
- `detected_at`: time Prairie Finder normalized the item.
- `source_created_at`, `source_updated_at`: timestamps from the source when present.
- `match`: why the item matched, with type, matched value, and confidence.
- `taxon`: common/scientific name, taxon ID, and rank when available.
- `location`: public coordinates plus accuracy/privacy metadata and `location_confidence`.
- `media`: up to three normalized media items.
- `display`: UI title, subtitle, and marker color.
- `raw`: optional raw source payload, currently omitted by the live adapter.

Live events are appended to `DATA_FILE` as JSONL. Seed events are not written to disk; `/api/events` returns `seedEvents` followed by stored JSONL events.

## Feed Ingestion

The only implemented live feed is iNaturalist. `INaturalistAdapter.fetchLatest()` queries `https://api.inaturalist.org/v1/observations` for:

- `taxon_id=46175` (`Cynomys`)
- `place_id=1` (United States)
- georeferenced observations
- observations with photos
- newest records first by `created_at`
- `per_page=20` by default

Each raw observation is normalized by `normalizeINaturalistObservation()`. Coordinates come from GeoJSON when present, otherwise from the iNaturalist `location` string. Obscured/geoprivacy fields are preserved in the normalized location metadata, and marker color turns yellow when coordinates are obscured.

Deduplication is in-memory per server process via the `seen` set. The set is initialized from seed event IDs and stored JSONL event IDs. During each poll, events are reversed so older unseen items are appended and broadcast before newer ones.

## API and SSE Flow

Routes in `src/server.ts`:

- `GET /api/events`: returns all seed events plus persisted JSONL events.
- `GET /api/poll`: triggers one manual backend sync and returns only newly detected events.
- `GET /api/status`: returns the current iNaturalist sync state.
- `GET /events`: opens an SSE stream. New observations are sent as `event: prairie-dog`; sync lifecycle updates are sent as `event: sync-state`.
- all other paths: static viewer assets.

When the backend sync loop finds a new event, it:

1. adds the `event_id` to `seen`;
2. appends the event to `DATA_FILE`;
3. logs the event JSON to stdout;
4. broadcasts the event to every connected SSE client.

`sync-state` messages include source, state, poll interval, visible marker limit, last start/finish timestamps, last error, and count of new events from the last sync. There is no replay over SSE. Clients get history from `/api/events` and then live deltas from `/events`.

## Viewer Architecture

The viewer is a small browser app in `viewer/src/main.ts`.

On load it:

1. renders a U.S. SVG map from `us-atlas` TopoJSON using `topojson-client` and `d3-geo`;
2. fetches `/api/events` and plots any events with usable coordinates;
3. opens `new EventSource("/events")` for live updates;
4. renders backend iNaturalist sync status from `sync-state` messages;
5. wires the `Sync now` button to trigger the backend sync endpoint through `GET /api/poll`.

Markers are SVG groups with an optional animated pulse. Newly received observations render as darker green pulsing markers for a short period, then settle into static older markers. The viewer keeps only the newest configured number of plottable markers and fades out older ones as new observations arrive. Clicking or keyboard-selecting a marker opens the original source URL.

Signal inspection lives in the API console output. When a new observation is accepted, the server logs structured JSON with title, source, timestamps, match metadata, location, source URL, image URLs, and the full normalized event.

Non-plottable events are ignored by `plotEvent()` because the current primary surface is map-only.

## Configuration

Environment variables read by the server/CLI:

- `PORT`: server port, default `8787`.
- `DATA_FILE`: JSONL persistence path, default `data/events.jsonl`.
- `POLL_INTERVAL_MS`: server polling interval, default `10000`.
- `MAX_VISIBLE_EVENTS`: newest plottable observations kept on the map, default `25`.

Feed settings currently live in code:

- iNaturalist `perPage`: `20`.
- iNaturalist `placeId`: `1`.
- iNaturalist `taxonId`: `46175`.

No API key is required for the current iNaturalist MVP.

## Local Commands

- `npm install --cache .npm-cache`: install dependencies with a local npm cache.
- `npm run server` or `npm run dev`: run the API, poller, SSE endpoint, and static viewer server.
- `npm run viewer`: run Vite on `127.0.0.1:5173` with API/SSE proxying to `8787`.
- `npm run feed:inat`: run a one-shot iNaturalist pull and append events to JSONL.
- `npm run build`: typecheck and build the viewer into `dist`.
- `npm run typecheck`: TypeScript check only.
- `npm test`: run Node tests under `tests/*.test.ts`.

## Known Limitations

- Persistence is append-only JSONL with no compaction, locking, schema migration, or durable dedupe beyond startup reads.
- Deduplication is process-local; concurrent server/CLI runs can append duplicate events.
- The poller has basic error logging but no backoff, retry budget, or source health reporting.
- iNaturalist settings are hardcoded rather than configurable through environment variables.
- SSE has no event IDs, resume support, heartbeat beyond the initial comment, or replay; reconnecting clients must refetch `/api/events`.
- The viewer duplicates the event type instead of importing the server type.
- Static serving is intentionally minimal and not hardened like a production asset server.
- The map uses a static U.S. SVG projection, not a zoomable slippy map or basemap.
- Non-plottable social/text events are not represented in the UI yet.
- `raw` payloads are supported by the type but omitted by the live iNaturalist adapter.

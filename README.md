# Prairie Finder

A local prairie dog locator prototype. It polls public iNaturalist observations for `Cynomys`, normalizes records to JSON, stores them in JSONL, and displays geolocated events on a U.S. map with pulsing radar-style markers.

## Requirements

- Node.js 20 or newer.
- Network access to `https://api.inaturalist.org`.
- No API key is required for the current iNaturalist MVP.

Optional later feeds may require accounts or keys:

- Flickr requires an API key, and Flickr currently gates API key requests behind Flickr Pro.
- Bluesky or Mastodon can provide text mention streams, but they are not reliable map sources unless a post includes explicit usable location metadata.
- X is deferred because useful geotagged search requires paid developer API access.

## Local Commands

Install dependencies:

```sh
npm install --cache .npm-cache
```

Run a one-shot iNaturalist pull and print normalized JSON:

```sh
npm run feed:inat
```

Run the local hot-reloading development app:

```sh
npm run dev
```

Open the app at `http://127.0.0.1:5173`. Vite hot-reloads frontend changes and proxies API/SSE requests to the backend on `8787`.

Run the Cloudflare realtime Worker locally:

```sh
npm run worker:dev
```

Deploy the realtime Worker:

```sh
npm run worker:deploy
```

After the Worker is deployed, set the Vercel frontend environment variable to the Worker WebSocket endpoint:

```sh
VITE_REALTIME_URL=wss://prairie-dog-finder-realtime.<your-workers-subdomain>.workers.dev/live
```

When `VITE_REALTIME_URL` is set, the frontend connects to the Cloudflare Worker WebSocket for live updates and uses the Worker `/events`, `/status`, and `/sync` endpoints as fallback API calls.

Build and serve the production-style local viewer/API from one process:

```sh
npm run build
npm run server
```

Open the app at `http://127.0.0.1:8787`.

For viewer development, run the API and Vite viewer separately:

```sh
npm run server
npm run viewer
```

Then open `http://127.0.0.1:5173`.

Run local checks:

```sh
npm run typecheck
npm run worker:typecheck
npm test
```

## Runtime Data

Live pulled events are appended to `data/events.jsonl`, which is intentionally ignored by Git. Seed events are bundled in source so the map is not blank before live data arrives.

The server supports these environment variables:

- `PORT`: local API/viewer port, default `8787`.
- `DATA_FILE`: JSONL path, default `data/events.jsonl`.
- `POLL_INTERVAL_MS`: iNaturalist poll interval, default `10000`.
- `MAX_VISIBLE_EVENTS`: newest plottable observations kept on the map, default `25`.

## Realtime Behavior

The backend owns realtime updates for the browser:

- The server continuously syncs iNaturalist on `POLL_INTERVAL_MS`.
- New observations are deduped, appended to JSONL, and pushed to connected browsers over Server-Sent Events.
- The browser does not poll for map updates; it listens to `/events`.
- New observations pulse as darker green markers. Older map markers fade out once the visible limit is exceeded.
- Signal details are written to the API/server console as structured JSON instead of being shown in an in-app inspector.
- iNaturalist itself does not provide a push stream, so the app's iNaturalist realtime behavior is backend-managed near-realtime sync.

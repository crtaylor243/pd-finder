# Vercel Deployment Plan

## Summary

Deploy `pd-finder` from GitHub to Vercel as a Vite frontend backed by Vercel Functions, with production realtime handled by Cloudflare Workers and Durable Objects. The current local app uses one long-running Node HTTP server with `setInterval`, SSE clients, and JSONL writes; Vercel Functions are invoked per request, scale down when idle, and should not rely on local filesystem persistence.

Recommended deployment path:

1. Keep Vercel as the frontend host and serverless API surface.
2. Use Cloudflare Workers + Durable Objects for browser WebSocket connections, centralized iNaturalist polling, dedupe, latest-observation storage, and broadcast.
3. Keep the browser map mostly unchanged, but point production realtime at the Cloudflare Worker through `VITE_REALTIME_URL`.
4. Keep Vercel API routes as a simple fallback/API surface.

## Current App Constraints

- `src/server.ts` currently serves static files, polls iNaturalist, stores events in `data/events.jsonl`, holds `seen` state in memory, and broadcasts SSE updates.
- `data/` is intentionally ignored by Git, so the deployed app will not have local history unless a remote store is added.
- The frontend already builds with Vite into `dist`.
- No iNaturalist API key is required.
- Runtime config today: `PORT`, `DATA_FILE`, `POLL_INTERVAL_MS`, `MAX_VISIBLE_EVENTS`.

## Target Vercel Shape

- Frontend:
  - Vite app deployed as static assets from `dist`.
  - Vercel settings:
    - Framework preset: `Vite`
    - Build command: `npm run build`
    - Output directory: `dist`
    - Install command: default `npm install`

- API:
  - Add Vercel Functions under `api/`.
  - Move iNaturalist sync logic into shared modules that can run in both local server and Vercel Functions.
  - Add:
    - `api/events.ts`: returns stored events plus seed events.
    - `api/status.ts`: returns last sync metadata.
    - `api/sync.ts`: performs one iNaturalist sync, dedupes, persists new events, and returns fresh events.

- Storage:
  - Use remote storage instead of `data/events.jsonl`.
  - Recommended small-budget default: Vercel KV / Upstash Redis.
  - Store:
    - recent normalized events list
    - seen event IDs
    - last sync status
  - Keep a capped event list, e.g. last 100-500 events, rather than unbounded history.

## Realtime Strategy

Vercel can stream function responses, but the current SSE model assumes one long-running process that owns polling and keeps browser clients in memory. Production realtime should use Cloudflare Workers and Durable Objects instead of Vercel serverless functions.

Recommended v1:

- Browser connects to `VITE_REALTIME_URL`, e.g. `wss://prairie-dog-finder-realtime.<subdomain>.workers.dev/live`.
- Cloudflare Cron runs `* * * * *` once per minute.
- The Worker polls iNaturalist centrally, not per browser.
- The Durable Object dedupes observation IDs, stores the latest capped event list, tracks sync state, and broadcasts new observations over WebSocket.
- The frontend animates WebSocket events exactly like local SSE events.

Optional v2:

- Add longer replay/history storage through D1, R2, Supabase, or Postgres.
- Add a custom domain for the Worker endpoint.
- Add a write-protected admin/manual sync endpoint if public triggering becomes a concern.

Important limitation: iNaturalist does not push new observations to this app. “Live” means the backend polls once per minute and pushes any newly discovered observations immediately to connected browsers.

## Implementation Steps

1. Refactor shared feed logic.
   - Keep `INaturalistAdapter`, normalization, seed data, and event types framework-neutral.
   - Extract store operations behind an interface:
     - `readEvents()`
     - `appendEvents(events)`
     - `hasSeen(eventId)`
     - `markSeen(eventId)`
     - `readStatus()`
     - `writeStatus(status)`

2. Add storage adapters.
   - Keep `JsonlEventStore` for local development.
   - Add `RedisEventStore` or `KvEventStore` for Vercel.
   - Select store by env var, e.g. `EVENT_STORE=redis` in Vercel and `EVENT_STORE=jsonl` locally.

3. Add Vercel API routes.
   - `api/events.ts`: load seed events plus stored events.
   - `api/status.ts`: expose sync state including `MAX_VISIBLE_EVENTS`.
   - `api/sync.ts`: run one iNaturalist sync and persist/broadcast by response.

4. Update the frontend API mode.
   - Replace `EventSource("/events")` in production with interval-based sync from `/api/sync`.
   - Keep the existing local SSE path available for local development if useful.
   - Use `MAX_VISIBLE_EVENTS` from `/api/status`.

5. Add Vercel config.
   - Add `vercel.json` only if needed for function config or cron.
   - Otherwise rely on Vercel’s Vite preset.
   - If adding cron later:
     - `crons: [{ "path": "/api/sync", "schedule": "* * * * *" }]`
     - Treat cron as minute-level background warming, not 10-second realtime.

6. Configure Vercel project.
   - Import GitHub repo `crtaylor243/pd-finder`.
   - Set framework preset to Vite.
   - Add storage provider integration/env vars.
   - Add env vars:
     - `MAX_VISIBLE_EVENTS=25`
     - `POLL_INTERVAL_MS=10000` only for local compatibility or client interval config.
     - storage connection vars, e.g. `KV_REST_API_URL` / `KV_REST_API_TOKEN` or Redis URL/token.

7. Deploy and verify.
   - Push branch to GitHub.
   - Import/deploy on Vercel.
   - Confirm `/api/events`, `/api/status`, and `/api/sync`.
   - Confirm frontend renders map, hover previews, marker cap, fade behavior, and source links.
   - Confirm no runtime writes to `data/` are required in production.

8. Deploy Cloudflare realtime.
   - Run `npm run worker:deploy`.
   - Set `VITE_REALTIME_URL` in Vercel to the Worker `/live` WebSocket URL.
   - Redeploy Vercel.
   - Confirm the browser status shows `Live` and receives WebSocket messages.

## Acceptance Criteria

- Vercel deploy succeeds from GitHub.
- Static frontend loads from the Vercel URL.
- iNaturalist sync works without an API key.
- Events persist in the Cloudflare Durable Object across invocations.
- Frontend shows newest observations, hover previews, and max-visible marker behavior.
- Production frontend can connect to the Worker WebSocket when `VITE_REALTIME_URL` is configured.
- No secrets are committed to Git.
- Vercel env vars hold the Worker WebSocket URL and any future storage credentials.

## Risks And Decisions

- True server-push realtime should live outside Vercel Functions. Cloudflare Workers + Durable Objects are the current target.
- Browser-driven sync can multiply iNaturalist traffic. Keep iNaturalist polling centralized in Cloudflare.
- Local JSONL remains useful for development but must not be used as production persistence.
- If the app needs actual always-on sub-minute backend polling, revisit provider cost and rate-limit risk before lowering the Cloudflare cron cadence.

## References

- Vercel builds and Vite output: https://vercel.com/docs/deployments/builds
- Vercel Functions lifecycle: https://vercel.com/docs/functions
- Vercel Functions streaming: https://vercel.com/docs/functions/streaming
- Vercel Cron Jobs: https://vercel.com/docs/cron-jobs
- Vercel Functions limits: https://vercel.com/docs/functions/limitations
- Vite static deploy guidance: https://vite.dev/guide/static-deploy
- Cloudflare Workers pricing: https://developers.cloudflare.com/workers/platform/pricing/
- Cloudflare Cron Triggers: https://developers.cloudflare.com/workers/configuration/cron-triggers/
- Cloudflare Durable Objects WebSockets: https://developers.cloudflare.com/durable-objects/best-practices/websockets/

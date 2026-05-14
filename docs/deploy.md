# Vercel Deployment Plan

## Summary

Deploy `pd-finder` from GitHub to Vercel as a Vite frontend backed by Vercel Functions. The current local app uses one long-running Node HTTP server with `setInterval`, SSE clients, and JSONL writes; that needs a small production reshape because Vercel Functions are invoked per request, scale down when idle, and should not rely on local filesystem persistence.

Recommended deployment path:

1. Keep Vercel as the frontend host and serverless API surface.
2. Replace local JSONL persistence with Vercel KV, Upstash Redis, Neon, or another small hosted store.
3. Replace the always-running 10-second server loop with either client-triggered sync or Vercel Cron.
4. Keep the browser map mostly unchanged, but point it at Vercel API routes instead of the local Node server.

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

Vercel can stream function responses, but the current SSE model assumes one long-running process that owns polling and keeps browser clients in memory. For the first Vercel deployment, avoid long-lived SSE as the production dependency.

Recommended v1:

- Browser calls `GET /api/events` on load.
- Browser calls `GET /api/sync` on a short interval, e.g. 10-30 seconds, or when the user presses `Sync now`.
- API performs one iNaturalist sync per request, writes new events to remote storage, and returns new events.
- Frontend animates any newly returned events exactly like today.

Optional v2:

- Add Vercel Cron to run `/api/sync` on a schedule.
- Use a hosted realtime layer such as Ably, Pusher, Supabase Realtime, or Upstash Redis pub/sub if true push updates become important.
- Keep iNaturalist polling centralized so many browser users do not multiply API requests.

Important limitation: Vercel Cron uses cron expressions, so it is not a good fit for every-10-second scheduling. It is better for minute-level background sync. For 10-second updates on Vercel, either accept client-triggered sync, use a separate always-on worker elsewhere, or add a hosted realtime/queue service.

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

## Acceptance Criteria

- Vercel deploy succeeds from GitHub.
- Static frontend loads from the Vercel URL.
- iNaturalist sync works without an API key.
- Events persist across function invocations using remote storage.
- Frontend shows newest observations, hover previews, and max-visible marker behavior.
- No secrets are committed to Git.
- Vercel env vars hold all storage credentials.

## Risks And Decisions

- True server-push realtime is not the first Vercel target. Use request-based sync first.
- 10-second sync from every browser can multiply iNaturalist traffic. For public release, centralize sync with storage and use a slower client refresh, e.g. 30-60 seconds.
- Local JSONL remains useful for development but must not be used as production persistence.
- If the app needs actual always-on 10-second backend polling, deploy the backend to Fly.io, Render, Railway, or another always-on Node host, and use Vercel only for the frontend.

## References

- Vercel builds and Vite output: https://vercel.com/docs/deployments/builds
- Vercel Functions lifecycle: https://vercel.com/docs/functions
- Vercel Functions streaming: https://vercel.com/docs/functions/streaming
- Vercel Cron Jobs: https://vercel.com/docs/cron-jobs
- Vercel Functions limits: https://vercel.com/docs/functions/limitations
- Vite static deploy guidance: https://vite.dev/guide/static-deploy

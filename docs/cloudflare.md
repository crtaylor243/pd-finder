# Cloudflare Realtime Backend

The app keeps Vercel as the frontend host and uses Cloudflare Workers for production realtime updates.

## Cost Model

The Worker polls iNaturalist once per minute:

```text
1,440 scheduled syncs per day
~43,200 scheduled syncs per month
```

This should fit comfortably inside Cloudflare Workers Free for a small demo. Cloudflare lists Workers Free at 100,000 requests per day, and Durable Objects are available on the free plan. If traffic grows beyond the free plan, Workers Paid starts at $5/month.

## Architecture

```text
iNaturalist
  ^
  |
Cloudflare Cron Trigger, every minute
  |
Cloudflare Worker
  |
Durable Object room
  - dedupes observation IDs
  - stores latest observations
  - tracks sync state
  - broadcasts WebSocket messages
  |
Vercel frontend
```

## Setup

1. Install dependencies:

   ```sh
   npm install
   ```

2. Authenticate Wrangler:

   ```sh
   npx wrangler login
   ```

3. Deploy the Worker:

   ```sh
   npm run worker:deploy
   ```

4. Note the deployed `workers.dev` URL from Wrangler.

5. In Vercel, set:

   ```text
   VITE_REALTIME_URL=wss://prairie-dog-finder-realtime.<your-workers-subdomain>.workers.dev/live
   ```

6. Redeploy Vercel after setting the environment variable.

## Worker Routes

- `GET /live`: WebSocket endpoint for browser clients.
- `GET /events`: latest stored prairie dog observations.
- `GET /status`: current iNaturalist sync state.
- `POST /sync`: manual sync endpoint.

## Local Testing

Run the Worker locally:

```sh
npm run worker:dev
```

Run the Vercel-style frontend locally with a Worker URL:

```sh
VITE_REALTIME_URL=ws://127.0.0.1:8787/live npm run viewer
```

The existing local app still works without Cloudflare:

```sh
npm run dev
```

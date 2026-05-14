import { createServer, type ServerResponse } from "node:http";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { extname, join, normalize } from "node:path";
import { appendJsonLine, readJsonLines } from "./event-store.ts";
import { INaturalistAdapter } from "./feeds/inaturalist.ts";
import { seedEvents } from "./seeds.ts";
import { DEFAULT_MAX_VISIBLE_EVENTS, DEFAULT_POLL_INTERVAL_MS, type SyncState } from "./sync.ts";
import type { PrairieDogEvent } from "./types.ts";

const PORT = Number(process.env.PORT ?? 8787);
const DATA_FILE = process.env.DATA_FILE ?? "data/events.jsonl";
const POLL_INTERVAL_MS = DEFAULT_POLL_INTERVAL_MS;
const MAX_VISIBLE_EVENTS = DEFAULT_MAX_VISIBLE_EVENTS;
const SOURCE_VIEWER_DIR = "viewer";
const BUILT_VIEWER_DIR = "dist";

const adapter = new INaturalistAdapter({ perPage: 20 });
const seen = new Set<string>(seedEvents.map((event) => event.event_id));
const clients = new Set<(message: SseMessage) => void>();
let latestSync: SyncState = {
  source: "inaturalist",
  state: "idle",
  poll_interval_ms: POLL_INTERVAL_MS,
  max_visible_events: MAX_VISIBLE_EVENTS,
  last_started_at: null,
  last_finished_at: null,
  last_error: null,
  last_new_event_count: 0
};

type SseMessage =
  | {
      event: "prairie-dog";
      data: PrairieDogEvent;
    }
  | {
      event: "sync-state";
      data: SyncState;
    };

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (url.pathname === "/api/events") {
    const stored = await readJsonLines(DATA_FILE);
    sendJson(response, [...seedEvents, ...stored]);
    return;
  }

  if (url.pathname === "/api/poll" || url.pathname === "/api/sync") {
    const events = await pollOnce().catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      return [];
    });
    sendJson(response, { events, status: latestSync });
    return;
  }

  if (url.pathname === "/api/status") {
    sendJson(response, latestSync);
    return;
  }

  if (url.pathname === "/events") {
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*"
    });
    response.write(": prairie-finder connected\n\n");

    const send = (message: SseMessage) => {
      response.write(`event: ${message.event}\n`);
      response.write(`data: ${JSON.stringify(message.data)}\n\n`);
    };

    clients.add(send);
    send({ event: "sync-state", data: latestSync });
    request.on("close", () => clients.delete(send));
    return;
  }

  await serveViewer(url.pathname, response);
});

void start();

async function start(): Promise<void> {
  const storedEvents = await readJsonLines(DATA_FILE);
  for (const event of storedEvents) {
    seen.add(event.event_id);
  }

  server.listen(PORT, "127.0.0.1", () => {
    console.log(`Prairie Finder API listening at http://127.0.0.1:${PORT}`);
    console.log(`Viewer available at http://127.0.0.1:${PORT}`);
    void pollOnce().catch((error) => {
      console.error(error instanceof Error ? error.message : error);
    });
    setInterval(() => {
      void pollOnce().catch((error) => {
        console.error(error instanceof Error ? error.message : error);
      });
    }, POLL_INTERVAL_MS);
  });
}

async function pollOnce(): Promise<PrairieDogEvent[]> {
  updateSyncState({
    state: "syncing",
    last_started_at: new Date().toISOString(),
    last_error: null
  });

  try {
    const events = await adapter.fetchLatest();
    const freshEvents: PrairieDogEvent[] = [];

    for (const event of events.reverse()) {
      if (seen.has(event.event_id)) {
        continue;
      }

      freshEvents.push(event);
      await acceptEvent(event);
    }

    updateSyncState({
      state: "idle",
      last_finished_at: new Date().toISOString(),
      last_error: null,
      last_new_event_count: freshEvents.length
    });

    return freshEvents;
  } catch (error) {
    updateSyncState({
      state: "error",
      last_finished_at: new Date().toISOString(),
      last_error: error instanceof Error ? error.message : String(error),
      last_new_event_count: 0
    });
    throw error;
  }
}

async function acceptEvent(event: PrairieDogEvent): Promise<boolean> {
  if (seen.has(event.event_id)) {
    return false;
  }

  seen.add(event.event_id);
  await appendJsonLine(DATA_FILE, event);
  broadcast(event);
  return true;
}

function broadcast(event: PrairieDogEvent): void {
  logSignal(event);
  for (const send of clients) {
    send({ event: "prairie-dog", data: event });
  }
}

function logSignal(event: PrairieDogEvent): void {
  const location = event.location
    ? `${event.location.lat.toFixed(5)}, ${event.location.lng.toFixed(5)} (${event.location.location_confidence})`
    : "not plottable";
  const images = event.media
    ?.filter((item) => item.type === "image")
    .map((item) => item.source_media_url ?? item.thumbnail_url)
    .filter(Boolean);

  console.log(
    JSON.stringify(
      {
        type: "signal",
        event_id: event.event_id,
        title: event.display.title,
        source: event.source,
        observed_at: event.source_created_at ?? null,
        detected_at: event.detected_at,
        match: event.match,
        location,
        place_guess: event.location?.place_guess ?? null,
        source_url: event.source_url,
        images: images ?? [],
        event
      },
      null,
      2
    )
  );
}

function updateSyncState(nextState: Partial<SyncState>): void {
  latestSync = {
    ...latestSync,
    ...nextState
  };

  for (const send of clients) {
    send({ event: "sync-state", data: latestSync });
  }
}

function sendJson(response: ServerResponse, value: unknown): void {
  response.writeHead(200, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*"
  });
  response.end(JSON.stringify(value));
}

async function serveViewer(pathname: string, response: ServerResponse): Promise<void> {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const safePath = normalize(requestedPath).replace(/^(\.\.(\/|\\|$))+/, "");
  const viewerDir = await getViewerDir();
  const filePath = join(process.cwd(), viewerDir, safePath);

  try {
    const contents = await readFile(filePath);
    response.writeHead(200, { "Content-Type": contentType(filePath) });
    response.end(contents);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain" });
    response.end("Not found");
  }
}

async function getViewerDir(): Promise<string> {
  try {
    await access(join(process.cwd(), BUILT_VIEWER_DIR, "index.html"), constants.R_OK);
    return BUILT_VIEWER_DIR;
  } catch {
    return SOURCE_VIEWER_DIR;
  }
}

function contentType(filePath: string): string {
  switch (extname(filePath)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
    case ".ts":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

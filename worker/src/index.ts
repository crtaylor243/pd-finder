type Env = {
  PD_ROOM: DurableObjectNamespace;
  MAX_VISIBLE_EVENTS?: string;
  POLL_INTERVAL_MS?: string;
};

type LocationConfidence = "exact_public" | "approximate_public" | "source_obscured";

type PrairieDogEvent = {
  event_id: string;
  source: "inaturalist";
  source_item_id: string;
  source_url: string;
  detected_at: string;
  source_created_at?: string;
  source_updated_at?: string;
  match: {
    type: "taxon";
    matched_value: string;
    confidence: number;
  };
  taxon?: {
    common_name?: string;
    scientific_name?: string;
    taxon_id?: number | string;
    rank?: string;
  };
  location?: {
    lat: number;
    lng: number;
    accuracy_m?: number;
    place_guess?: string;
    coordinates_obscured?: boolean;
    geoprivacy?: string | null;
    location_confidence: LocationConfidence;
  };
  media?: Array<{
    type: "image";
    thumbnail_url?: string;
    source_media_url?: string;
    license?: string | null;
  }>;
  display: {
    title: string;
    subtitle?: string;
    pulse_color: "green" | "yellow";
  };
};

type SyncState = {
  source: "inaturalist";
  state: "idle" | "syncing" | "error";
  poll_interval_ms: number;
  max_visible_events: number;
  last_started_at: string | null;
  last_finished_at: string | null;
  last_error: string | null;
  last_new_event_count: number;
};

type INaturalistObservation = {
  id?: number;
  uri?: string;
  created_at?: string;
  updated_at?: string;
  species_guess?: string;
  place_guess?: string;
  location?: string;
  geojson?: {
    coordinates?: [number, number];
  };
  obscured?: boolean;
  geoprivacy?: string | null;
  positional_accuracy?: number | null;
  public_positional_accuracy?: number | null;
  taxon?: {
    id?: number;
    name?: string;
    rank?: string;
    preferred_common_name?: string;
  };
  photos?: Array<{
    url?: string;
    license_code?: string | null;
  }>;
};

type ClientMessage =
  | {
      type: "prairie-dog";
      event: PrairieDogEvent;
    }
  | {
      type: "sync-state";
      state: SyncState;
    };

const INATURALIST_OBSERVATIONS_URL = "https://api.inaturalist.org/v1/observations";
const DEFAULT_MAX_VISIBLE_EVENTS = 25;
const DEFAULT_POLL_INTERVAL_MS = 60_000;
const ROOM_NAME = "prairie-dog-finder";
const EVENTS_KEY = "events";
const SEEN_KEY = "seen";
const STATUS_KEY = "status";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    return room(env).fetch(request);
  },

  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    await room(env).fetch("https://worker.internal/sync", { method: "POST" });
  }
};

export class PrairieDogRoom {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    if (url.pathname === "/live") {
      return this.handleLive(request);
    }

    if (url.pathname === "/events") {
      return json(await this.getEvents());
    }

    if (url.pathname === "/status") {
      return json(await this.getStatus());
    }

    if (url.pathname === "/sync" && request.method === "POST") {
      return json(await this.sync());
    }

    return json({ error: "Not found" }, 404);
  }

  async webSocketMessage(_ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (message === "ping") {
      _ws.send("pong");
    }
  }

  async webSocketClose(): Promise<void> {
    // The hibernation API handles socket lifecycle; no in-memory registry is needed.
  }

  async webSocketError(): Promise<void> {
    // Keep the durable object resilient to individual client disconnect failures.
  }

  private async handleLive(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return json({ error: "Expected WebSocket upgrade" }, 426);
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    server.send(JSON.stringify({ type: "sync-state", state: await this.getStatus() } satisfies ClientMessage));

    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }

  private async sync(): Promise<{ events: PrairieDogEvent[]; status: SyncState }> {
    const startedAt = new Date().toISOString();
    await this.setStatus({
      ...(await this.getStatus()),
      state: "syncing",
      last_started_at: startedAt,
      last_error: null
    });

    try {
      const fetchedEvents = await fetchINaturalistEvents();
      const seen = new Set(await this.getSeen());
      const freshEvents: PrairieDogEvent[] = [];

      for (const event of fetchedEvents.reverse()) {
        if (seen.has(event.event_id)) {
          continue;
        }

        seen.add(event.event_id);
        freshEvents.push(event);
      }

      if (freshEvents.length > 0) {
        await this.acceptEvents(freshEvents, Array.from(seen));
      }

      const status = await this.setStatus({
        ...(await this.getStatus()),
        state: "idle",
        last_started_at: startedAt,
        last_finished_at: new Date().toISOString(),
        last_error: null,
        last_new_event_count: freshEvents.length
      });

      return { events: freshEvents, status };
    } catch (error) {
      const status = await this.setStatus({
        ...(await this.getStatus()),
        state: "error",
        last_started_at: startedAt,
        last_finished_at: new Date().toISOString(),
        last_error: error instanceof Error ? error.message : String(error),
        last_new_event_count: 0
      });

      return { events: [], status };
    }
  }

  private async acceptEvents(freshEvents: PrairieDogEvent[], seen: string[]): Promise<void> {
    const existingEvents = await this.getEvents();
    const maxVisibleEvents = this.getMaxVisibleEvents();
    const events = [...existingEvents, ...freshEvents].slice(-maxVisibleEvents);
    const seenLimit = Math.max(250, maxVisibleEvents * 10);

    await Promise.all([
      this.state.storage.put(EVENTS_KEY, events),
      this.state.storage.put(SEEN_KEY, seen.slice(-seenLimit))
    ]);

    for (const event of freshEvents) {
      this.broadcast({ type: "prairie-dog", event });
    }
  }

  private broadcast(message: ClientMessage): void {
    const payload = JSON.stringify(message);
    for (const socket of this.state.getWebSockets()) {
      socket.send(payload);
    }
  }

  private async getEvents(): Promise<PrairieDogEvent[]> {
    return (await this.state.storage.get<PrairieDogEvent[]>(EVENTS_KEY)) ?? [];
  }

  private async getSeen(): Promise<string[]> {
    const storedSeen = await this.state.storage.get<string[]>(SEEN_KEY);

    if (storedSeen) {
      return storedSeen;
    }

    return (await this.getEvents()).map((event) => event.event_id);
  }

  private async getStatus(): Promise<SyncState> {
    return (await this.state.storage.get<SyncState>(STATUS_KEY)) ?? this.createInitialSyncState();
  }

  private async setStatus(status: SyncState): Promise<SyncState> {
    await this.state.storage.put(STATUS_KEY, status);
    this.broadcast({ type: "sync-state", state: status });
    return status;
  }

  private createInitialSyncState(): SyncState {
    return {
      source: "inaturalist",
      state: "idle",
      poll_interval_ms: this.getPollIntervalMs(),
      max_visible_events: this.getMaxVisibleEvents(),
      last_started_at: null,
      last_finished_at: null,
      last_error: null,
      last_new_event_count: 0
    };
  }

  private getPollIntervalMs(): number {
    return toPositiveNumber(this.env.POLL_INTERVAL_MS, DEFAULT_POLL_INTERVAL_MS);
  }

  private getMaxVisibleEvents(): number {
    return toPositiveNumber(this.env.MAX_VISIBLE_EVENTS, DEFAULT_MAX_VISIBLE_EVENTS);
  }
}

function room(env: Env): DurableObjectStub {
  return env.PD_ROOM.get(env.PD_ROOM.idFromName(ROOM_NAME));
}

async function fetchINaturalistEvents(): Promise<PrairieDogEvent[]> {
  const params = new URLSearchParams({
    taxon_id: "46175",
    place_id: "1",
    order_by: "created_at",
    order: "desc",
    per_page: "20"
  });

  params.append("has[]", "geo");
  params.append("has[]", "photos");

  const response = await fetch(`${INATURALIST_OBSERVATIONS_URL}?${params.toString()}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "prairie-dog-finder-worker/0.1"
    }
  });

  if (!response.ok) {
    throw new Error(`iNaturalist request failed: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as { results?: unknown[] };
  return (payload.results ?? []).map((observation) => normalizeObservation(observation));
}

function normalizeObservation(rawObservation: unknown): PrairieDogEvent {
  const observation = rawObservation as INaturalistObservation;

  if (typeof observation.id !== "number") {
    throw new Error("Missing iNaturalist observation id");
  }

  const coordinates = observation.geojson?.coordinates ?? parseLocation(observation.location);
  const lng = coordinates?.[0];
  const lat = coordinates?.[1];
  const publicAccuracy = observation.public_positional_accuracy ?? observation.positional_accuracy ?? undefined;
  const coordinatesObscured = observation.obscured ?? observation.geoprivacy != null;
  const title = observation.taxon?.preferred_common_name ?? observation.species_guess ?? "Prairie dog signal";

  const event: PrairieDogEvent = {
    event_id: `inat:${observation.id}`,
    source: "inaturalist",
    source_item_id: String(observation.id),
    source_url: observation.uri ?? `https://www.inaturalist.org/observations/${observation.id}`,
    detected_at: new Date().toISOString(),
    source_created_at: toIsoString(observation.created_at),
    source_updated_at: toIsoString(observation.updated_at),
    match: {
      type: "taxon",
      matched_value: observation.taxon?.name ?? "Cynomys",
      confidence: observation.taxon?.id ? 0.98 : 0.9
    },
    taxon: {
      common_name: observation.taxon?.preferred_common_name ?? observation.species_guess,
      scientific_name: observation.taxon?.name,
      taxon_id: observation.taxon?.id,
      rank: observation.taxon?.rank
    },
    media: (observation.photos ?? []).slice(0, 3).map((photo) => ({
      type: "image",
      thumbnail_url: photo.url,
      source_media_url: photo.url?.replace("/square.", "/medium."),
      license: photo.license_code ?? null
    })),
    display: {
      title,
      subtitle: "iNaturalist observation",
      pulse_color: coordinatesObscured ? "yellow" : "green"
    }
  };

  if (lat != null && lng != null) {
    event.location = {
      lat,
      lng,
      accuracy_m: publicAccuracy,
      place_guess: observation.place_guess,
      coordinates_obscured: coordinatesObscured,
      geoprivacy: observation.geoprivacy ?? null,
      location_confidence: getLocationConfidence(coordinatesObscured, publicAccuracy)
    };
  }

  return event;
}

function parseLocation(location: string | undefined): [number, number] | undefined {
  if (!location) {
    return undefined;
  }

  const [latRaw, lngRaw] = location.split(",");
  const lat = Number(latRaw);
  const lng = Number(lngRaw);

  return Number.isFinite(lat) && Number.isFinite(lng) ? [lng, lat] : undefined;
}

function getLocationConfidence(obscured: boolean, accuracyMeters: number | undefined): LocationConfidence {
  if (obscured) {
    return "source_obscured";
  }

  if (accuracyMeters != null && accuracyMeters > 1000) {
    return "approximate_public";
  }

  return "exact_public";
}

function toIsoString(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders()
    }
  });
}

function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

function toPositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

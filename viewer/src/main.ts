import { geoAlbersUsa, geoPath } from "d3-geo";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { feature } from "topojson-client";
import us from "us-atlas/states-10m.json";
import "./styles.css";

type PrairieDogEvent = {
  event_id: string;
  source: string;
  source_item_id: string;
  source_url: string;
  detected_at: string;
  source_created_at?: string;
  source_updated_at?: string;
  match: {
    type: string;
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
    location_confidence: string;
  };
  media?: Array<{
    type: string;
    thumbnail_url?: string;
    source_media_url?: string;
    license?: string | null;
  }>;
  display: {
    title: string;
    subtitle?: string;
    pulse_color: "green" | "yellow" | "gray";
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

const svg = requireElement<SVGSVGElement>("#map");
const connectionStatus = requireElement<HTMLSpanElement>("#connectionStatus");
const emptyState = requireElement<HTMLDivElement>("#emptyState");
const hoverPreview = requireElement<HTMLDivElement>("#hoverPreview");
const hoverPreviewImageShell = requireElement<HTMLDivElement>(".hover-preview-image-shell");
const hoverPreviewImage = requireElement<HTMLImageElement>("#hoverPreviewImage");
const hoverPreviewTitle = requireElement<HTMLElement>("#hoverPreviewTitle");
const hoverPreviewPlace = requireElement<HTMLSpanElement>("#hoverPreviewPlace");
const hoverPreviewTime = requireElement<HTMLTimeElement>("#hoverPreviewTime");

const projection = geoAlbersUsa().translate([480, 305]).scale(1180);
const path = geoPath(projection);
const plotted = new Map<string, SVGGElement>();
const plottedOrder: string[] = [];
const remoteRealtimeUrl = getRemoteRealtimeUrl();
const remoteApiBase = remoteRealtimeUrl ? toHttpBase(remoteRealtimeUrl) : undefined;
let maxVisibleEvents = 25;
let syncCadenceMs = 10_000;
let fallbackSyncInterval: number | undefined;

renderMap();
void loadInitialEvents();
connectEventStream();

async function loadInitialEvents(): Promise<void> {
  const [statusResponse, eventsResponse] = await Promise.all([fetch(apiUrl("/status")), fetch(apiUrl("/events"))]);
  const status = (await statusResponse.json()) as SyncState;
  const events = (await eventsResponse.json()) as PrairieDogEvent[];
  maxVisibleEvents = status.max_visible_events;
  updateSyncState(status);
  events.filter((event) => event.location).slice(-maxVisibleEvents).forEach((event) => plotEvent(event, false));
}

function connectEventStream(): void {
  if (remoteRealtimeUrl) {
    connectWorkerWebSocket(remoteRealtimeUrl);
    return;
  }

  const source = new EventSource("/events");

  source.addEventListener("open", () => {
    setStatus("Live", "status-live");
    stopFallbackSync();
  });

  source.addEventListener("prairie-dog", (message) => {
    const event = JSON.parse((message as MessageEvent<string>).data) as PrairieDogEvent;
    plotEvent(event, true);
  });

  source.addEventListener("sync-state", (message) => {
    const state = JSON.parse((message as MessageEvent<string>).data) as SyncState;
    maxVisibleEvents = state.max_visible_events;
    updateSyncState(state);
    enforceVisibleLimit();
  });

  source.addEventListener("error", () => {
    setStatus("Sync loop", "status-waiting");
    source.close();
    startFallbackSync();
  });
}

function connectWorkerWebSocket(url: string): void {
  const socket = new WebSocket(url);

  socket.addEventListener("open", () => {
    setStatus("Live", "status-live");
    stopFallbackSync();
  });

  socket.addEventListener("message", (message) => {
    const payload = JSON.parse(message.data as string) as
      | {
          type: "prairie-dog";
          event: PrairieDogEvent;
        }
      | {
          type: "sync-state";
          state: SyncState;
        };

    if (payload.type === "prairie-dog") {
      plotEvent(payload.event, true);
      return;
    }

    maxVisibleEvents = payload.state.max_visible_events;
    updateSyncState(payload.state);
    enforceVisibleLimit();
  });

  socket.addEventListener("close", () => {
    setStatus("Live polling", "status-waiting");
    startFallbackSync();
  });

  socket.addEventListener("error", () => {
    setStatus("Live polling", "status-waiting");
    socket.close();
    startFallbackSync();
  });
}

function startFallbackSync(): void {
  if (fallbackSyncInterval != null) {
    return;
  }

  void syncOnce();
  fallbackSyncInterval = window.setInterval(() => {
    void syncOnce();
  }, Math.max(5_000, maxVisibleEvents > 0 ? getCurrentCadenceMs() : 10_000));
}

function stopFallbackSync(): void {
  if (fallbackSyncInterval == null) {
    return;
  }

  window.clearInterval(fallbackSyncInterval);
  fallbackSyncInterval = undefined;
}

async function syncOnce(): Promise<void> {
  updateSyncState({
    source: "inaturalist",
    state: "syncing",
    poll_interval_ms: getCurrentCadenceMs(),
    max_visible_events: maxVisibleEvents,
    last_started_at: new Date().toISOString(),
    last_finished_at: null,
    last_error: null,
    last_new_event_count: 0
  });

  try {
    const response = await fetch(syncUrl(), { method: remoteApiBase ? "POST" : "GET" });
    const payload = (await response.json()) as { events: PrairieDogEvent[]; status: SyncState };
    maxVisibleEvents = payload.status.max_visible_events;
    payload.events.forEach((event) => plotEvent(event, true));
    updateSyncState(payload.status);
  } catch (error) {
    updateSyncState({
      source: "inaturalist",
      state: "error",
      poll_interval_ms: getCurrentCadenceMs(),
      max_visible_events: maxVisibleEvents,
      last_started_at: null,
      last_finished_at: new Date().toISOString(),
      last_error: error instanceof Error ? error.message : String(error),
      last_new_event_count: 0
    });
  }
}

function renderMap(): void {
  const topology = us as unknown as {
    objects: {
      states: Parameters<typeof feature>[1];
      nation: Parameters<typeof feature>[1];
    };
  };
  const states = feature(us as never, topology.objects.states) as FeatureCollection<Geometry>;
  const nation = feature(us as never, topology.objects.nation) as Feature<Geometry>;

  const nationPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
  nationPath.setAttribute("class", "nation");
  nationPath.setAttribute("d", path(nation) ?? "");
  svg.append(nationPath);

  const stateGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
  stateGroup.setAttribute("class", "states");
  for (const state of states.features) {
    const statePath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    statePath.setAttribute("d", path(state) ?? "");
    stateGroup.append(statePath);
  }
  svg.append(stateGroup);
}

function plotEvent(event: PrairieDogEvent, animate: boolean): void {
  if (!event.location || plotted.has(event.event_id)) {
    return;
  }

  const point = projection([event.location.lng, event.location.lat]);
  if (!point) {
    return;
  }

  emptyState.classList.add("empty-state-hidden");
  const marker = document.createElementNS("http://www.w3.org/2000/svg", "g");
  marker.setAttribute("class", `marker marker-${event.display.pulse_color}${animate ? " marker-new marker-live" : ""}`);
  marker.setAttribute("transform", `translate(${point[0]} ${point[1]})`);
  marker.setAttribute("tabindex", "0");
  marker.setAttribute("role", "button");
  marker.setAttribute("aria-label", event.display.title);

  const ring = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  ring.setAttribute("class", "marker-ring");
  ring.setAttribute("r", "8");
  marker.append(ring);

  const ringDelay = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  ringDelay.setAttribute("class", "marker-ring marker-ring-delay");
  ringDelay.setAttribute("r", "8");
  marker.append(ringDelay);

  const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  dot.setAttribute("class", "marker-dot");
  dot.setAttribute("r", "5");
  marker.append(dot);

  marker.addEventListener("mouseenter", () => showHoverPreview(event));
  marker.addEventListener("mouseleave", hideHoverPreview);
  marker.addEventListener("focus", () => showHoverPreview(event));
  marker.addEventListener("blur", hideHoverPreview);
  marker.addEventListener("click", () => {
    window.open(event.source_url, "_blank", "noreferrer");
  });
  marker.addEventListener("keydown", (keyboardEvent) => {
    if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") {
      keyboardEvent.preventDefault();
      window.open(event.source_url, "_blank", "noreferrer");
    }
  });

  svg.append(marker);
  plotted.set(event.event_id, marker);
  plottedOrder.push(event.event_id);
  enforceVisibleLimit();

  if (animate) {
    window.setTimeout(() => {
      marker.classList.remove("marker-new", "marker-live");
    }, 12_000);
  }
}

function enforceVisibleLimit(): void {
  while (plottedOrder.length > maxVisibleEvents) {
    const eventId = plottedOrder.shift();
    if (!eventId) {
      continue;
    }

    const marker = plotted.get(eventId);
    plotted.delete(eventId);

    if (!marker) {
      continue;
    }

    marker.classList.add("marker-expiring");
    window.setTimeout(() => marker.remove(), 650);
  }
}

function showHoverPreview(event: PrairieDogEvent): void {
  const imageUrl = getPreviewImageUrl(event);

  if (imageUrl) {
    hoverPreviewImage.src = imageUrl;
    hoverPreviewImageShell.classList.remove("hover-preview-image-empty");
  } else {
    hoverPreviewImage.removeAttribute("src");
    hoverPreviewImageShell.classList.add("hover-preview-image-empty");
  }

  hoverPreviewTitle.textContent = event.display.title;
  hoverPreviewPlace.textContent = event.location?.place_guess ?? event.source;
  hoverPreviewTime.textContent = formatObservationTime(event);
  hoverPreviewTime.dateTime = event.source_created_at ?? event.detected_at;
  hoverPreview.classList.add("hover-preview-visible");
}

function hideHoverPreview(): void {
  hoverPreview.classList.remove("hover-preview-visible");
}

function getPreviewImageUrl(event: PrairieDogEvent): string | undefined {
  const image = event.media?.find((item) => item.type === "image" && (item.source_media_url || item.thumbnail_url));
  return image?.source_media_url ?? image?.thumbnail_url;
}

function formatObservationTime(event: PrairieDogEvent): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(event.source_created_at ?? event.detected_at));
}

function setStatus(label: string, className: string): void {
  connectionStatus.textContent = label;
  connectionStatus.className = `status ${className}`;
}

function updateSyncState(state: SyncState): void {
  syncCadenceMs = state.poll_interval_ms;
}

function getCurrentCadenceMs(): number {
  return syncCadenceMs;
}

function apiUrl(pathname: "/events" | "/status"): string {
  return remoteApiBase ? `${remoteApiBase}${pathname}` : `/api${pathname}`;
}

function syncUrl(): string {
  return remoteApiBase ? `${remoteApiBase}/sync` : "/api/sync";
}

function getRemoteRealtimeUrl(): string | undefined {
  const url = import.meta.env.VITE_REALTIME_URL?.trim();
  return url ? url : undefined;
}

function toHttpBase(webSocketUrl: string): string {
  const url = new URL(webSocketUrl);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = url.pathname.replace(/\/live\/?$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);

  if (!element) {
    throw new Error(`Missing required element: ${selector}`);
  }

  return element;
}

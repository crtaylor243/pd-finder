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
const hoverPreviewSource = requireElement<HTMLAnchorElement>("#hoverPreviewSource");
const hoverPreviewClose = requireElement<HTMLButtonElement>("#hoverPreviewClose");
const observationRail = requireElement<HTMLDivElement>("#observationRail");
const observationList = requireElement<HTMLDivElement>("#observationList");

type PlottedObservation = {
  event: PrairieDogEvent;
  marker: SVGGElement;
  card: HTMLElement;
};

const projection = geoAlbersUsa().translate([480, 305]).scale(1180);
const path = geoPath(projection);
const plotted = new Map<string, PlottedObservation>();
const plottedOrder: string[] = [];
const remoteRealtimeUrl = getRemoteRealtimeUrl();
const remoteApiBase = remoteRealtimeUrl ? toHttpBase(remoteRealtimeUrl) : undefined;
const mobileLayoutQuery = window.matchMedia("(max-width: 880px)");
let maxVisibleEvents = 25;
let syncCadenceMs = 10_000;
let fallbackSyncInterval: number | undefined;
let selectedObservationId: string | undefined;
let railScrollTimer: number | undefined;

renderMap();
void loadInitialEvents();
connectEventStream();

hoverPreviewClose.addEventListener("click", hideHoverPreview);
observationRail.addEventListener("scroll", handleRailScroll, { passive: true });
svg.addEventListener("click", () => {
  if (isMobileLayout()) {
    selectFirstObservation();
  }
});

async function loadInitialEvents(): Promise<void> {
  const [statusResponse, eventsResponse] = await Promise.all([fetch(apiUrl("/status")), fetch(apiUrl("/events"))]);
  const status = (await statusResponse.json()) as SyncState;
  const events = (await eventsResponse.json()) as PrairieDogEvent[];
  maxVisibleEvents = status.max_visible_events;
  updateSyncState(status);
  events.filter((event) => event.location).slice(-maxVisibleEvents).forEach((event) => plotEvent(event, false));
  if (isMobileLayout()) {
    selectFirstObservation();
  }
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

  const hitTarget = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  hitTarget.setAttribute("class", "marker-hit-target");
  hitTarget.setAttribute("r", "18");
  marker.append(hitTarget);

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

  marker.addEventListener("mouseenter", () => {
    if (!isMobileLayout()) {
      showDesktopPreview(event);
    }
  });
  marker.addEventListener("mouseleave", () => {
    if (!isMobileLayout()) {
      hideHoverPreview();
    }
  });
  marker.addEventListener("focus", () => {
    if (!isMobileLayout()) {
      showDesktopPreview(event);
    } else {
      selectObservation(event.event_id, { scrollCard: true });
    }
  });
  marker.addEventListener("blur", () => {
    if (!isMobileLayout()) {
      hideHoverPreview();
    }
  });
  marker.addEventListener("click", (mouseEvent) => {
    mouseEvent.stopPropagation();

    if (isMobileLayout()) {
      selectObservation(event.event_id, { scrollCard: true });
      return;
    }

    window.open(event.source_url, "_blank", "noreferrer");
  });
  marker.addEventListener("keydown", (keyboardEvent) => {
    if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") {
      keyboardEvent.preventDefault();
      if (isMobileLayout()) {
        selectObservation(event.event_id, { scrollCard: true });
      } else {
        showDesktopPreview(event);
      }
    }

    if (keyboardEvent.key === "Escape") {
      hideHoverPreview();
    }
  });

  const card = createObservationCard(event);
  svg.append(marker);
  observationList.prepend(card);
  plotted.set(event.event_id, { event, marker, card });
  plottedOrder.unshift(event.event_id);
  enforceVisibleLimit();

  if (animate && isMobileLayout()) {
    selectObservation(event.event_id, { scrollCard: false });
  }

  if (animate) {
    window.setTimeout(() => {
      marker.classList.remove("marker-new", "marker-live");
    }, 12_000);
  }
}

function enforceVisibleLimit(): void {
  while (plottedOrder.length > maxVisibleEvents) {
    const eventId = plottedOrder.pop();
    if (!eventId) {
      continue;
    }

    const observation = plotted.get(eventId);
    plotted.delete(eventId);

    if (!observation) {
      continue;
    }

    if (selectedObservationId === eventId) {
      selectedObservationId = undefined;
    }

    observation.card.remove();
    observation.marker.classList.add("marker-expiring");
    window.setTimeout(() => observation.marker.remove(), 650);
  }

  if (isMobileLayout() && !selectedObservationId) {
    selectFirstObservation();
  }
}

function showDesktopPreview(event: PrairieDogEvent): void {
  const imageUrl = getPreviewImageUrl(event);

  selectObservation(event.event_id, { scrollCard: false });

  if (imageUrl) {
    hoverPreviewImage.src = imageUrl;
    hoverPreviewImageShell.hidden = false;
  } else {
    hoverPreviewImage.removeAttribute("src");
    hoverPreviewImageShell.hidden = true;
  }

  hoverPreviewTitle.textContent = event.display.title;
  hoverPreviewPlace.textContent = event.location?.place_guess ?? event.source;
  hoverPreviewTime.textContent = formatObservationTime(event);
  hoverPreviewTime.dateTime = event.source_created_at ?? event.detected_at;
  hoverPreviewSource.href = event.source_url;
  hoverPreview.removeAttribute("aria-hidden");
  hoverPreview.classList.add("hover-preview-visible");
}

function hideHoverPreview(): void {
  if (!isMobileLayout()) {
    clearSelectedObservation();
  }

  hoverPreview.setAttribute("aria-hidden", "true");
  hoverPreview.classList.remove("hover-preview-visible");
}

function createObservationCard(event: PrairieDogEvent): HTMLElement {
  const card = document.createElement("article");
  card.className = "observation-card";
  card.dataset.eventId = event.event_id;
  card.setAttribute("tabindex", "0");
  card.setAttribute("aria-label", event.display.title);

  const imageUrl = getPreviewImageUrl(event);
  if (imageUrl) {
    const media = document.createElement("div");
    media.className = "observation-card-media";
    const image = document.createElement("img");
    image.src = imageUrl;
    image.alt = "";
    media.append(image);
    card.append(media);
  }

  const body = document.createElement("div");
  body.className = "observation-card-body";

  const title = document.createElement("strong");
  title.textContent = event.display.title;
  body.append(title);

  const place = document.createElement("span");
  place.textContent = event.location?.place_guess ?? event.source;
  body.append(place);

  const time = document.createElement("time");
  time.textContent = formatObservationTime(event);
  time.dateTime = event.source_created_at ?? event.detected_at;
  body.append(time);

  const source = document.createElement("a");
  source.href = event.source_url;
  source.target = "_blank";
  source.rel = "noreferrer";
  source.textContent = "Open observation";
  source.addEventListener("click", (mouseEvent) => mouseEvent.stopPropagation());
  body.append(source);

  card.append(body);
  card.addEventListener("click", () => selectObservation(event.event_id, { scrollCard: true }));
  card.addEventListener("focus", () => selectObservation(event.event_id, { scrollCard: false }));

  return card;
}

function selectFirstObservation(): void {
  const firstEventId = plottedOrder.at(0);
  if (firstEventId) {
    selectObservation(firstEventId, { scrollCard: false });
  }
}

function selectObservation(eventId: string, options: { scrollCard: boolean }): void {
  const observation = plotted.get(eventId);
  if (!observation) {
    return;
  }

  clearSelectedObservation();
  selectedObservationId = eventId;
  observation.marker.classList.add("marker-selected");
  observation.card.classList.add("observation-card-selected");
  observation.card.setAttribute("aria-current", "true");

  if (options.scrollCard && isMobileLayout()) {
    observation.card.scrollIntoView({ block: "start", behavior: "smooth" });
  }
}

function clearSelectedObservation(): void {
  if (!selectedObservationId) {
    return;
  }

  const previous = plotted.get(selectedObservationId);
  previous?.marker.classList.remove("marker-selected");
  previous?.card.classList.remove("observation-card-selected");
  previous?.card.removeAttribute("aria-current");
  selectedObservationId = undefined;
}

function handleRailScroll(): void {
  if (!isMobileLayout()) {
    return;
  }

  if (railScrollTimer != null) {
    window.clearTimeout(railScrollTimer);
  }

  railScrollTimer = window.setTimeout(() => {
    const closestEventId = getClosestRailEventId();
    if (closestEventId) {
      selectObservation(closestEventId, { scrollCard: false });
    }
  }, 80);
}

function getClosestRailEventId(): string | undefined {
  const railBounds = observationRail.getBoundingClientRect();
  const targetY = railBounds.top + railBounds.height * 0.38;
  let closestEventId: string | undefined;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (const eventId of plottedOrder) {
    const card = plotted.get(eventId)?.card;
    if (!card) {
      continue;
    }

    const cardBounds = card.getBoundingClientRect();
    const cardCenter = cardBounds.top + cardBounds.height / 2;
    const distance = Math.abs(cardCenter - targetY);

    if (distance < closestDistance) {
      closestDistance = distance;
      closestEventId = eventId;
    }
  }

  return closestEventId;
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

function isMobileLayout(): boolean {
  return mobileLayoutQuery.matches;
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

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
const syncStatus = requireElement<HTMLSpanElement>("#syncStatus");
const pollNow = requireElement<HTMLButtonElement>("#pollNow");
const emptyState = requireElement<HTMLDivElement>("#emptyState");
const hoverPreview = requireElement<HTMLDivElement>("#hoverPreview");
const hoverPreviewImage = requireElement<HTMLImageElement>("#hoverPreviewImage");
const hoverPreviewTitle = requireElement<HTMLElement>("#hoverPreviewTitle");
const hoverPreviewPlace = requireElement<HTMLSpanElement>("#hoverPreviewPlace");

const projection = geoAlbersUsa().translate([480, 305]).scale(1180);
const path = geoPath(projection);
const plotted = new Map<string, SVGGElement>();
const plottedOrder: string[] = [];
let maxVisibleEvents = 25;

renderMap();
void loadInitialEvents();
connectEventStream();

pollNow.addEventListener("click", async () => {
  pollNow.disabled = true;
  pollNow.textContent = "Syncing...";

  try {
    const response = await fetch("/api/poll");
    const payload = (await response.json()) as { events: PrairieDogEvent[] };
    payload.events.forEach((event) => plotEvent(event, true));
  } finally {
    pollNow.disabled = false;
    pollNow.textContent = "Sync now";
  }
});

async function loadInitialEvents(): Promise<void> {
  const [statusResponse, eventsResponse] = await Promise.all([fetch("/api/status"), fetch("/api/events")]);
  const status = (await statusResponse.json()) as SyncState;
  const events = (await eventsResponse.json()) as PrairieDogEvent[];
  maxVisibleEvents = status.max_visible_events;
  renderSyncState(status);
  events.filter((event) => event.location).slice(-maxVisibleEvents).forEach((event) => plotEvent(event, false));
}

function connectEventStream(): void {
  const source = new EventSource("/events");

  source.addEventListener("open", () => {
    setStatus("Live", "status-live");
  });

  source.addEventListener("prairie-dog", (message) => {
    const event = JSON.parse((message as MessageEvent<string>).data) as PrairieDogEvent;
    plotEvent(event, true);
  });

  source.addEventListener("sync-state", (message) => {
    const state = JSON.parse((message as MessageEvent<string>).data) as SyncState;
    maxVisibleEvents = state.max_visible_events;
    renderSyncState(state);
    enforceVisibleLimit();
  });

  source.addEventListener("error", () => {
    setStatus("Reconnecting", "status-waiting");
  });
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

  marker.addEventListener("mouseenter", () => showHoverPreview(event, point));
  marker.addEventListener("mouseleave", hideHoverPreview);
  marker.addEventListener("focus", () => showHoverPreview(event, point));
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

function showHoverPreview(event: PrairieDogEvent, point: [number, number]): void {
  const imageUrl = getPreviewImageUrl(event);

  if (!imageUrl) {
    return;
  }

  const svgRect = svg.getBoundingClientRect();
  const mapX = (point[0] / 960) * svgRect.width;
  const mapY = (point[1] / 610) * svgRect.height;
  const previewWidth = 230;
  const previewHeight = 205;
  const margin = 14;
  const left = clamp(mapX + 18, margin, svgRect.width - previewWidth - margin);
  const top = clamp(mapY - previewHeight - 14, margin, svgRect.height - previewHeight - margin);

  hoverPreviewImage.src = imageUrl;
  hoverPreviewTitle.textContent = event.display.title;
  hoverPreviewPlace.textContent = event.location?.place_guess ?? event.source;
  hoverPreview.style.left = `${left}px`;
  hoverPreview.style.top = `${top}px`;
  hoverPreview.classList.add("hover-preview-visible");
}

function hideHoverPreview(): void {
  hoverPreview.classList.remove("hover-preview-visible");
}

function getPreviewImageUrl(event: PrairieDogEvent): string | undefined {
  const image = event.media?.find((item) => item.type === "image" && (item.source_media_url || item.thumbnail_url));
  return image?.source_media_url ?? image?.thumbnail_url;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function setStatus(label: string, className: string): void {
  connectionStatus.textContent = label;
  connectionStatus.className = `status ${className}`;
}

function renderSyncState(state: SyncState): void {
  if (state.state === "syncing") {
    syncStatus.textContent = "Syncing iNaturalist";
    syncStatus.className = "sync-status sync-status-active";
    return;
  }

  if (state.state === "error") {
    syncStatus.textContent = state.last_error ? `Sync error: ${state.last_error}` : "Sync error";
    syncStatus.className = "sync-status sync-status-error";
    return;
  }

  const cadence = Math.round(state.poll_interval_ms / 1000);
  const lastSync = state.last_finished_at ? `Last sync ${formatRelativeTime(state.last_finished_at)}` : "Sync pending";
  syncStatus.textContent = `${lastSync} · ${state.last_new_event_count} new · every ${cadence}s`;
  syncStatus.className = "sync-status";
}

function formatRelativeTime(value: string): string {
  const elapsedSeconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));

  if (elapsedSeconds < 5) {
    return "now";
  }

  if (elapsedSeconds < 60) {
    return `${elapsedSeconds}s ago`;
  }

  return `${Math.round(elapsedSeconds / 60)}m ago`;
}

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);

  if (!element) {
    throw new Error(`Missing required element: ${selector}`);
  }

  return element;
}

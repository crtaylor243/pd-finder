type PrairieDogEvent = {
  event_id: string;
  source: "inaturalist" | "manual_seed";
  source_item_id: string;
  source_url: string;
  detected_at: string;
  source_created_at?: string;
  source_updated_at?: string;
  match: {
    type: "taxon" | "manual_seed";
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
    location_confidence: "exact_public" | "approximate_public" | "source_obscured";
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

const INATURALIST_OBSERVATIONS_URL = "https://api.inaturalist.org/v1/observations";
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 10_000);
const MAX_VISIBLE_EVENTS = Number(process.env.MAX_VISIBLE_EVENTS ?? 25);

export function createInitialSyncState(): SyncState {
  return {
    source: "inaturalist",
    state: "idle",
    poll_interval_ms: POLL_INTERVAL_MS,
    max_visible_events: MAX_VISIBLE_EVENTS,
    last_started_at: null,
    last_finished_at: null,
    last_error: null,
    last_new_event_count: 0
  };
}

export async function fetchINaturalistEvents(): Promise<PrairieDogEvent[]> {
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
      "User-Agent": "prairie-finder/0.1 vercel"
    }
  });

  if (!response.ok) {
    throw new Error(`iNaturalist request failed: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as { results?: unknown[] };
  return (payload.results ?? []).map((observation) => normalizeObservation(observation));
}

export async function runServerlessSync(): Promise<{ events: PrairieDogEvent[]; status: SyncState }> {
  const startedAt = new Date().toISOString();

  try {
    const events = (await fetchINaturalistEvents()).reverse();

    return {
      events,
      status: {
        ...createInitialSyncState(),
        state: "idle",
        last_started_at: startedAt,
        last_finished_at: new Date().toISOString(),
        last_new_event_count: events.length
      }
    };
  } catch (error) {
    return {
      events: [],
      status: {
        ...createInitialSyncState(),
        state: "error",
        last_started_at: startedAt,
        last_finished_at: new Date().toISOString(),
        last_error: error instanceof Error ? error.message : String(error),
        last_new_event_count: 0
      }
    };
  }
}

export function getSeedEvents(): PrairieDogEvent[] {
  return [
    {
      event_id: "seed:badlands-nd",
      source: "manual_seed",
      source_item_id: "badlands-nd",
      source_url: "https://www.inaturalist.org/taxa/46175-Cynomys",
      detected_at: "2026-05-14T16:00:00.000Z",
      source_created_at: "2026-05-14T15:53:09.000Z",
      match: {
        type: "manual_seed",
        matched_value: "Cynomys",
        confidence: 0.98
      },
      taxon: {
        common_name: "Prairie Dogs",
        scientific_name: "Cynomys",
        taxon_id: 46175,
        rank: "genus"
      },
      location: {
        lat: 46.94797509,
        lng: -103.462703079,
        accuracy_m: 88723,
        place_guess: "Medora, ND, USA",
        coordinates_obscured: false,
        geoprivacy: null,
        location_confidence: "approximate_public"
      },
      media: [
        {
          type: "image",
          thumbnail_url: "https://inaturalist-open-data.s3.amazonaws.com/photos/13760582/square.jpg",
          source_media_url: "https://inaturalist-open-data.s3.amazonaws.com/photos/13760582/medium.jpg",
          license: "cc-by-nc-nd"
        }
      ],
      display: {
        title: "Prairie Dogs",
        subtitle: "Seeded iNaturalist-style observation",
        pulse_color: "green"
      }
    }
  ];
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
      location_confidence: coordinatesObscured
        ? "source_obscured"
        : publicAccuracy != null && publicAccuracy > 1000
          ? "approximate_public"
          : "exact_public"
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

function toIsoString(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

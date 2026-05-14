import type { LocationConfidence, PrairieDogEvent } from "./types.ts";

type INaturalistTaxon = {
  id?: number;
  name?: string;
  rank?: string;
  preferred_common_name?: string;
};

type INaturalistPhoto = {
  url?: string;
  license_code?: string | null;
};

type INaturalistObservation = {
  id?: number;
  uri?: string;
  created_at?: string;
  updated_at?: string;
  observed_on?: string;
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
  taxon?: INaturalistTaxon;
  photos?: INaturalistPhoto[];
};

type NormalizeOptions = {
  includeRaw?: boolean;
};

export function normalizeINaturalistObservation(
  rawObservation: unknown,
  options: NormalizeOptions = {}
): PrairieDogEvent {
  const observation = rawObservation as INaturalistObservation;
  const sourceId = requireNumber(observation.id, "iNaturalist observation id");
  const coordinates = observation.geojson?.coordinates ?? parseLocation(observation.location);
  const lng = coordinates?.[0];
  const lat = coordinates?.[1];
  const sourceUrl = observation.uri ?? `https://www.inaturalist.org/observations/${sourceId}`;
  const taxon = observation.taxon;
  const coordinatesObscured = observation.obscured ?? observation.geoprivacy != null;
  const publicAccuracy = observation.public_positional_accuracy ?? observation.positional_accuracy ?? undefined;

  const event: PrairieDogEvent = {
    event_id: `inat:${sourceId}`,
    source: "inaturalist",
    source_item_id: String(sourceId),
    source_url: sourceUrl,
    detected_at: new Date().toISOString(),
    source_created_at: toIsoString(observation.created_at),
    source_updated_at: toIsoString(observation.updated_at),
    match: {
      type: "taxon",
      matched_value: taxon?.name ?? "Cynomys",
      confidence: taxon?.id ? 0.98 : 0.9
    },
    taxon: {
      common_name: taxon?.preferred_common_name ?? observation.species_guess,
      scientific_name: taxon?.name,
      taxon_id: taxon?.id,
      rank: taxon?.rank
    },
    media: normalizePhotos(observation.photos),
    display: {
      title: taxon?.preferred_common_name ?? observation.species_guess ?? "Prairie dog signal",
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

  if (options.includeRaw) {
    event.raw = rawObservation;
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

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return undefined;
  }

  return [lng, lat];
}

function normalizePhotos(photos: INaturalistPhoto[] | undefined): PrairieDogEvent["media"] {
  return (photos ?? []).slice(0, 3).map((photo) => ({
    type: "image",
    thumbnail_url: photo.url,
    source_media_url: photo.url?.replace("/square.", "/medium."),
    license: photo.license_code ?? null
  }));
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

function requireNumber(value: number | undefined, label: string): number {
  if (typeof value !== "number") {
    throw new Error(`Missing ${label}`);
  }

  return value;
}

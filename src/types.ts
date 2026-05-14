export type PrairieDogSource =
  | "inaturalist"
  | "flickr"
  | "bluesky"
  | "mastodon"
  | "x"
  | "reddit"
  | "manual_seed";

export type LocationConfidence =
  | "exact_public"
  | "approximate_public"
  | "source_obscured"
  | "inferred_from_text"
  | "unavailable";

export type PrairieDogEvent = {
  event_id: string;
  source: PrairieDogSource;
  source_item_id: string;
  source_url: string;
  detected_at: string;
  source_created_at?: string;
  source_updated_at?: string;
  match: {
    type: "taxon" | "keyword" | "hashtag" | "image_model" | "manual_seed";
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
    type: "image" | "video" | "audio";
    thumbnail_url?: string;
    source_media_url?: string;
    license?: string | null;
  }>;
  display: {
    title: string;
    subtitle?: string;
    pulse_color: "green" | "yellow" | "gray";
  };
  raw?: unknown;
};

export type FeedAdapter = {
  name: PrairieDogSource;
  fetchLatest(): Promise<PrairieDogEvent[]>;
};

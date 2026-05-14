import type { PrairieDogEvent } from "./types.ts";

export const seedEvents: PrairieDogEvent[] = [
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
  },
  {
    event_id: "seed:colorado",
    source: "manual_seed",
    source_item_id: "colorado",
    source_url: "https://www.inaturalist.org/taxa/46179-Cynomys-ludovicianus",
    detected_at: "2026-05-14T16:04:00.000Z",
    source_created_at: "2026-05-14T16:02:00.000Z",
    match: {
      type: "manual_seed",
      matched_value: "Cynomys ludovicianus",
      confidence: 0.97
    },
    taxon: {
      common_name: "Black-tailed Prairie Dog",
      scientific_name: "Cynomys ludovicianus",
      taxon_id: 46179,
      rank: "species"
    },
    location: {
      lat: 39.7392,
      lng: -104.9903,
      accuracy_m: 500,
      place_guess: "Denver, CO, USA",
      coordinates_obscured: false,
      geoprivacy: null,
      location_confidence: "exact_public"
    },
    display: {
      title: "Black-tailed Prairie Dog",
      subtitle: "Seeded signal",
      pulse_color: "green"
    }
  }
];

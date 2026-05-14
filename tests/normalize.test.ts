import test from "node:test";
import assert from "node:assert/strict";
import { normalizeINaturalistObservation } from "../src/normalize.ts";

test("normalizes a geolocated iNaturalist prairie dog observation", () => {
  const event = normalizeINaturalistObservation({
    id: 123,
    uri: "https://www.inaturalist.org/observations/123",
    created_at: "2026-05-14T09:53:09-06:00",
    updated_at: "2026-05-14T10:01:23-06:00",
    species_guess: "Prairie Dogs",
    place_guess: "Medora, ND, USA",
    location: "46.94797509,-103.462703079",
    obscured: false,
    geoprivacy: null,
    positional_accuracy: 88723,
    public_positional_accuracy: 88723,
    taxon: {
      id: 46175,
      name: "Cynomys",
      rank: "genus",
      preferred_common_name: "Prairie Dogs"
    },
    photos: [
      {
        url: "https://inaturalist-open-data.s3.amazonaws.com/photos/1/square.jpg",
        license_code: "cc-by-nc"
      }
    ]
  });

  assert.equal(event.event_id, "inat:123");
  assert.equal(event.source, "inaturalist");
  assert.equal(event.source_url, "https://www.inaturalist.org/observations/123");
  assert.equal(event.match.matched_value, "Cynomys");
  assert.equal(event.location?.lat, 46.94797509);
  assert.equal(event.location?.lng, -103.462703079);
  assert.equal(event.location?.location_confidence, "approximate_public");
  assert.equal(event.media?.[0]?.source_media_url, "https://inaturalist-open-data.s3.amazonaws.com/photos/1/medium.jpg");
});

test("marks obscured source coordinates as source_obscured", () => {
  const event = normalizeINaturalistObservation({
    id: 456,
    uri: "https://www.inaturalist.org/observations/456",
    location: "39.7392,-104.9903",
    obscured: true,
    geoprivacy: "obscured",
    taxon: {
      id: 46179,
      name: "Cynomys ludovicianus",
      rank: "species",
      preferred_common_name: "Black-tailed Prairie Dog"
    }
  });

  assert.equal(event.location?.location_confidence, "source_obscured");
  assert.equal(event.display.pulse_color, "yellow");
});

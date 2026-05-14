import { normalizeINaturalistObservation } from "../normalize.ts";
import type { FeedAdapter, PrairieDogEvent } from "../types.ts";

const INATURALIST_OBSERVATIONS_URL = "https://api.inaturalist.org/v1/observations";

type INaturalistSearchResponse = {
  results?: unknown[];
};

export type INaturalistAdapterOptions = {
  perPage?: number;
  placeId?: number;
  taxonId?: number;
};

export class INaturalistAdapter implements FeedAdapter {
  name = "inaturalist" as const;

  private readonly perPage: number;
  private readonly placeId: number;
  private readonly taxonId: number;

  constructor(options: INaturalistAdapterOptions = {}) {
    this.perPage = options.perPage ?? 20;
    this.placeId = options.placeId ?? 1;
    this.taxonId = options.taxonId ?? 46175;
  }

  async fetchLatest(): Promise<PrairieDogEvent[]> {
    const params = new URLSearchParams({
      taxon_id: String(this.taxonId),
      place_id: String(this.placeId),
      order_by: "created_at",
      order: "desc",
      per_page: String(this.perPage)
    });

    params.append("has[]", "geo");
    params.append("has[]", "photos");

    const response = await fetch(`${INATURALIST_OBSERVATIONS_URL}?${params.toString()}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "prairie-finder/0.1 local prototype"
      }
    });

    if (!response.ok) {
      throw new Error(`iNaturalist request failed: ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as INaturalistSearchResponse;
    return (payload.results ?? []).map((observation) =>
      normalizeINaturalistObservation(observation, { includeRaw: false })
    );
  }
}

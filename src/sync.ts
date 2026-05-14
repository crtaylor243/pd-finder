import { INaturalistAdapter } from "./feeds/inaturalist.ts";
import { seedEvents } from "./seeds.ts";
import type { PrairieDogEvent } from "./types.ts";

export type SyncState = {
  source: "inaturalist";
  state: "idle" | "syncing" | "error";
  poll_interval_ms: number;
  max_visible_events: number;
  last_started_at: string | null;
  last_finished_at: string | null;
  last_error: string | null;
  last_new_event_count: number;
};

export type SyncResult = {
  events: PrairieDogEvent[];
  status: SyncState;
};

export const DEFAULT_POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 10_000);
export const DEFAULT_MAX_VISIBLE_EVENTS = Number(process.env.MAX_VISIBLE_EVENTS ?? 25);

export function createInitialSyncState(): SyncState {
  return {
    source: "inaturalist",
    state: "idle",
    poll_interval_ms: DEFAULT_POLL_INTERVAL_MS,
    max_visible_events: DEFAULT_MAX_VISIBLE_EVENTS,
    last_started_at: null,
    last_finished_at: null,
    last_error: null,
    last_new_event_count: 0
  };
}

export async function fetchINaturalistEvents(perPage = 20): Promise<PrairieDogEvent[]> {
  const adapter = new INaturalistAdapter({ perPage });
  return adapter.fetchLatest();
}

export async function runServerlessSync(): Promise<SyncResult> {
  const startedAt = new Date().toISOString();

  try {
    const events = await fetchINaturalistEvents();
    const orderedEvents = events.reverse();

    return {
      events: orderedEvents,
      status: {
        ...createInitialSyncState(),
        state: "idle",
        last_started_at: startedAt,
        last_finished_at: new Date().toISOString(),
        last_new_event_count: orderedEvents.length
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
  return seedEvents;
}

import { appendJsonLine } from "./event-store.ts";
import { INaturalistAdapter } from "./feeds/inaturalist.ts";

const DATA_FILE = process.env.DATA_FILE ?? "data/events.jsonl";

async function main(): Promise<void> {
  const adapter = new INaturalistAdapter({ perPage: 20 });
  const seen = new Set<string>();
  const events = await adapter.fetchLatest();

  for (const event of events) {
    if (seen.has(event.event_id)) {
      continue;
    }

    seen.add(event.event_id);
    console.log(JSON.stringify(event));
    await appendJsonLine(DATA_FILE, event);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

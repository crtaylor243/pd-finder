import type { IncomingMessage, ServerResponse } from "node:http";
import { fetchINaturalistEvents, getSeedEvents } from "./_shared.js";

export const config = {
  runtime: "nodejs"
};

export default async function handler(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method !== "GET") {
    sendJson(response, { error: "Method not allowed" }, 405);
    return;
  }

  try {
    const events = await fetchINaturalistEvents();
    sendJson(response, [...getSeedEvents(), ...events.reverse()]);
  } catch (error) {
    sendJson(
      response,
      {
        error: error instanceof Error ? error.message : String(error),
        events: getSeedEvents()
      },
      200
    );
  }
}

function sendJson(response: ServerResponse, value: unknown, status = 200): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(value));
}

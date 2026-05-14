import type { IncomingMessage, ServerResponse } from "node:http";
import { createInitialSyncState } from "./_shared.js";

export const config = {
  runtime: "nodejs"
};

export default function handler(request: IncomingMessage, response: ServerResponse): void {
  if (request.method !== "GET") {
    sendJson(response, { error: "Method not allowed" }, 405);
    return;
  }

  sendJson(response, createInitialSyncState());
}

function sendJson(response: ServerResponse, value: unknown, status = 200): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(value));
}

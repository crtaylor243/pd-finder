import type { IncomingMessage, ServerResponse } from "node:http";
import { runServerlessSync } from "./_shared.js";

export const config = {
  runtime: "nodejs"
};

export default async function handler(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method !== "GET") {
    sendJson(response, { error: "Method not allowed" }, 405);
    return;
  }

  const result = await runServerlessSync();
  sendJson(response, result, result.status.state === "error" ? 502 : 200);
}

function sendJson(response: ServerResponse, value: unknown, status = 200): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(value));
}

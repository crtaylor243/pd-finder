import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { PrairieDogEvent } from "./types.ts";

export async function appendJsonLine(filePath: string, event: PrairieDogEvent): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(event)}\n`, { flag: "a" });
}

export async function readJsonLines(filePath: string): Promise<PrairieDogEvent[]> {
  try {
    const contents = await readFile(filePath, "utf8");
    return contents
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as PrairieDogEvent);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

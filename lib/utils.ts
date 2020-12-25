import * as fs from "fs/promises";

import { DateTime } from "luxon";

export async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function pathExists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

export function logWithTimestamp(message: string) {
  console.error(
    `[${DateTime.local().toLocaleString(DateTime.DATETIME_MED)}] ${message}`
  );
}

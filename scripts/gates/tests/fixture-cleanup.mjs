import { rmSync } from "node:fs";

export function removeFixture(directory) {
  try {
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  } catch (error) {
    throw new Error(`fixture cleanup failed for ${directory}: ${error?.code ?? error?.message}`, { cause: error });
  }
}

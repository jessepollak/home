import { describe, expect, test } from "bun:test";
import { redirectOnAccessRequired } from "./access-response";

function json(value: unknown, status: number) {
  return Response.json(value, { status });
}

describe("access response navigation", () => {
  test("hard-navigates only for the versioned deployment access denial", async () => {
    const destinations: string[] = [];
    const redirected = await redirectOnAccessRequired(
      json({ version: 1, error: { code: "ACCESS_REQUIRED" } }, 401),
      { currentPath: "/borrow?asset=usdc#review", navigate: (value) => destinations.push(value) },
    );
    expect(redirected).toBe(true);
    expect(destinations).toEqual(["/access?next=%2Fborrow%3Fasset%3Dusdc%23review"]);

    for (const response of [
      json({ error: { code: "UNAUTHENTICATED" } }, 401),
      json({ version: 1, error: { code: "ACCESS_UNAVAILABLE" } }, 503),
      json({ version: 2, error: { code: "ACCESS_REQUIRED" } }, 401),
    ]) expect(await redirectOnAccessRequired(response, {
      currentPath: "/", navigate: (value) => destinations.push(value),
    })).toBe(false);
    expect(destinations).toHaveLength(1);
  });
});

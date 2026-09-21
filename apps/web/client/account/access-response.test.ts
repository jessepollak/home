import "./dom-test-harness";

import { describe, expect, spyOn, test } from "bun:test";
import { redirectOnAccessRequired } from "./access-response";

function json(value: unknown, status: number) {
  return Response.json(value, { status });
}

describe("access response navigation", () => {
  test("fires a hard navigation once when protected calls repeat", async () => {
    window.history.replaceState({}, "", "/borrow?asset=usdc#review");
    const assign = spyOn(window.location, "assign").mockImplementation(() => {});
    const responses = [
      json({ version: 1, error: { code: "ACCESS_REQUIRED" } }, 401),
      json({ version: 1, error: { code: "ACCESS_REQUIRED" } }, 401),
    ];

    await expect(Promise.all(responses.map((response) => redirectOnAccessRequired(response))))
      .resolves.toEqual([true, true]);
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith("/access?next=%2Fborrow%3Fasset%3Dusdc%23review");
    assign.mockRestore();
  });

  test("deduplicates concurrent versioned access denials without swallowing later expiry", async () => {
    const destinations: string[] = [];
    const navigate = (value: string) => destinations.push(value);
    const concurrent = await Promise.all([
      redirectOnAccessRequired(
        json({ version: 1, error: { code: "ACCESS_REQUIRED" } }, 401),
        { currentPath: "/borrow?asset=usdc#review", navigate },
      ),
      redirectOnAccessRequired(
        json({ version: 1, error: { code: "ACCESS_REQUIRED" } }, 401),
        { currentPath: "/borrow?asset=usdc#review", navigate },
      ),
    ]);
    expect(concurrent).toEqual([true, true]);
    expect(destinations).toEqual(["/access?next=%2Fborrow%3Fasset%3Dusdc%23review"]);

    expect(await redirectOnAccessRequired(
      json({ version: 1, error: { code: "ACCESS_REQUIRED" } }, 401),
      { currentPath: "/borrow?asset=usdc#review", navigate },
    )).toBe(true);
    expect(destinations).toEqual([
      "/access?next=%2Fborrow%3Fasset%3Dusdc%23review",
      "/access?next=%2Fborrow%3Fasset%3Dusdc%23review",
    ]);

    const accessDestinations: string[] = [];
    expect(await redirectOnAccessRequired(
      json({ version: 1, error: { code: "ACCESS_REQUIRED" } }, 401),
      {
        currentPath: "/access?next=%2Fsave%3Fasset%3Dusdc",
        navigate: (value) => accessDestinations.push(value),
      },
    )).toBe(true);
    expect(accessDestinations).toEqual([]);

    for (const response of [
      json({ error: { code: "UNAUTHENTICATED" } }, 401),
      json({ version: 1, error: { code: "ACCESS_UNAVAILABLE" } }, 503),
      json({ version: 2, error: { code: "ACCESS_REQUIRED" } }, 401),
    ]) expect(await redirectOnAccessRequired(response, {
      currentPath: "/", navigate: (value) => destinations.push(value),
    })).toBe(false);
    expect(destinations).toHaveLength(2);
  });
});

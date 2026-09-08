import { describe, expect, test } from "bun:test";
import { createErrorInvestDiscover } from "@/server/market-data/invest-discover";
import type { InvestDiscoverResponse } from "@/server/market-data/invest-discover";
import { createInvestDiscoverHandler } from "./handler";
import { dynamic, runtime } from "./route";

const payload: InvestDiscoverResponse = {
  version: 1,
  provider: "codex",
  fetchedAt: "2026-09-08T20:00:00.000Z",
  icons: { nvdac: "https://icons.example.test/nvda.png", cbbtc: null },
  memes: {
    status: "ready",
    assets: [],
    snapshots: [],
  },
};

describe("GET /api/invest/discover", () => {
  test("is a public Node route and returns the discover contract", async () => {
    expect(runtime).toBe("nodejs");
    expect(dynamic).toBe("force-dynamic");

    const response = await createInvestDiscoverHandler(async () => payload)();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=45, stale-while-revalidate=45",
    );
    expect(await response.json()).toEqual(payload);
  });

  test("does not leak upstream errors", async () => {
    const response = await createInvestDiscoverHandler(async () => {
      throw new Error("upstream body and fixture-secret");
    })();
    const body = await response.text();
    expect(response.status).toBe(502);
    expect(body).toBe(JSON.stringify(createErrorInvestDiscover()));
    expect(body).not.toContain("fixture-secret");
  });
});

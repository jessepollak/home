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
    nextOffset: null,
    exhausted: true,
  },
};

const discoverRequest = (path = "/api/invest/discover") =>
  new Request(`http://home.test${path}`);

describe("GET /api/invest/discover", () => {
  test("is a public Node route and returns the discover contract", async () => {
    expect(runtime).toBe("nodejs");
    expect(dynamic).toBe("force-dynamic");

    const response = await createInvestDiscoverHandler(async () => payload)(
      discoverRequest(),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=45, stale-while-revalidate=45",
    );
    expect(await response.json()).toEqual(payload);
  });

  test("forwards the requested offset to the reader", async () => {
    let requestedOffset = -1;
    const response = await createInvestDiscoverHandler(async (offset) => {
      requestedOffset = offset;
      return payload;
    })(discoverRequest("/api/invest/discover?offset=24"));

    expect(response.status).toBe(200);
    expect(requestedOffset).toBe(24);
  });

  test("rejects a malformed offset without touching Codex", async () => {
    let called = false;
    const response = await createInvestDiscoverHandler(async () => {
      called = true;
      return payload;
    })(discoverRequest("/api/invest/discover?offset=-1"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid-offset" });
    expect(called).toBe(false);
  });

  test("does not leak upstream errors", async () => {
    const response = await createInvestDiscoverHandler(async () => {
      throw new Error("upstream body and fixture-secret");
    })(discoverRequest());
    const body = await response.text();
    expect(response.status).toBe(502);
    expect(body).toBe(JSON.stringify(createErrorInvestDiscover()));
    expect(body).not.toContain("fixture-secret");
  });

  test("never caches a provider error envelope as a successful page", async () => {
    const response = await createInvestDiscoverHandler(async () => ({
      ...payload,
      memes: {
        ...payload.memes,
        status: "error" as const,
        message: "envelope failed",
      },
    }))(discoverRequest("/api/invest/discover?offset=24"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

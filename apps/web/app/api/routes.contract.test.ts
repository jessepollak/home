import { describe, expect, test } from "bun:test";

type RouteResult = {
  runtime: unknown;
  dynamic: unknown;
  response: Response;
};

const protectedRoutes: ReadonlyArray<{
  name: string;
  invoke: () => Promise<RouteResult>;
}> = [
  {
    name: "GET /api/activity",
    invoke: async () => {
      const route = await import("./activity/route");
      return {
        runtime: route.runtime,
        dynamic: route.dynamic,
        response: await route.GET(new Request("http://home.test/api/activity?to=2026-09-07T12%3A00%3A00.000Z")),
      };
    },
  },
  {
    name: "GET /api/borrow",
    invoke: async () => {
      const route = await import("./borrow/route");
      return {
        runtime: route.runtime,
        dynamic: route.dynamic,
        response: await route.GET(new Request("http://home.test/api/borrow")),
      };
    },
  },
  {
    name: "POST /api/funding/onramp-session",
    invoke: async () => {
      const route = await import("./funding/onramp-session/route");
      return {
        runtime: route.runtime,
        dynamic: route.dynamic,
        response: await route.POST(new Request("http://home.test/api/funding/onramp-session", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-home-account-provider": "base-account",
          },
          body: JSON.stringify({ assetId: "usdc" }),
        })),
      };
    },
  },
  {
    name: "GET /api/funding/providers",
    invoke: async () => {
      const route = await import("./funding/providers/route");
      return {
        runtime: route.runtime,
        dynamic: route.dynamic,
        response: await route.GET(new Request("http://home.test/api/funding/providers?region=ID")),
      };
    },
  },
  {
    name: "GET /api/portfolio",
    invoke: async () => {
      const route = await import("./portfolio/route");
      return {
        runtime: route.runtime,
        dynamic: route.dynamic,
        response: await route.GET(new Request("http://home.test/api/portfolio?mode=base-account")),
      };
    },
  },
  {
    name: "GET /api/savings/positions",
    invoke: async () => {
      const route = await import("./savings/positions/route");
      return {
        runtime: route.runtime,
        dynamic: route.dynamic,
        response: await route.GET(new Request("http://home.test/api/savings/positions")),
      };
    },
  },
  {
    name: "GET /api/session",
    invoke: async () => {
      const route = await import("./session/route");
      return {
        runtime: route.runtime,
        dynamic: route.dynamic,
        response: await route.GET(new Request("http://home.test/api/session")),
      };
    },
  },
];

const publicRoutes: ReadonlyArray<{
  name: string;
  load: () => Promise<{ runtime: unknown; dynamic: unknown }>;
}> = [
  { name: "GET /api/invest/discover", load: () => import("./invest/discover/route") },
  { name: "GET /api/market-prices", load: () => import("./market-prices/route") },
  { name: "GET /api/market-prices/history", load: () => import("./market-prices/history/route") },
  { name: "POST /api/client-errors", load: () => import("./client-errors/route") },
];

describe("API route composition", () => {
  test("keeps protected routes dynamic, Node-only, and authenticated", async () => {
    for (const route of protectedRoutes) {
      const result = await route.invoke();
      expect(result.runtime, route.name).toBe("nodejs");
      expect(result.dynamic, route.name).toBe("force-dynamic");
      expect(result.response.status, route.name).toBe(401);
      expect(result.response.headers.get("cache-control"), route.name).toContain("no-store");
    }
  });

  test("keeps public and reporting routes dynamic and Node-only", async () => {
    for (const route of publicRoutes) {
      const routeModule = await route.load();
      expect(routeModule.runtime, route.name).toBe("nodejs");
      expect(routeModule.dynamic, route.name).toBe("force-dynamic");
    }
  });
});

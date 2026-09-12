import { describe, expect, test } from "bun:test";

const routeGlob = new Bun.Glob("**/route.ts");
const routePaths = [...routeGlob.scanSync({ cwd: import.meta.dir })].sort();
const publicRoutes = new Set([
  "auth/base/logout/route.ts",
  "auth/base/nonce/route.ts",
  "auth/base/verify/route.ts",
  "client-errors/route.ts",
  "funding/webhooks/[provider]/route.ts",
  "invest/discover/route.ts",
  "market-prices/history/route.ts",
  "market-prices/route.ts",
  "savings/vaults/route.ts",
]);
const privateRoutes = routePaths.filter((path) => !publicRoutes.has(path));
const httpVerbs = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;
const allowedRouteExports = new Set(["runtime", "dynamic", ...httpVerbs]);

type RouteModule = Record<string, unknown>;

describe("API route composition", () => {
  test("classifies every route discovered from the API directory", () => {
    expect(routePaths.length).toBeGreaterThan(0);
    for (const path of publicRoutes) expect(routePaths, path).toContain(path);
    expect([...publicRoutes].length + privateRoutes.length).toBe(routePaths.length);
  });

  test("keeps every route module limited to HTTP and route metadata exports", async () => {
    for (const path of routePaths) {
      const route = await loadRoute(path);
      expect(Object.keys(route).sort(), path).toEqual(
        Object.keys(route).filter((name) => allowedRouteExports.has(name)).sort(),
      );
    }
  });

  test("keeps every private route dynamic, Node-only, authenticated, and private", async () => {
    for (const path of privateRoutes) {
      const route = await loadRoute(path);
      expect(route.runtime, path).toBe("nodejs");
      expect(route.dynamic, path).toBe("force-dynamic");
      const verbs = httpVerbs.filter((verb) => typeof route[verb] === "function");
      expect(verbs.length, path).toBeGreaterThan(0);

      for (const verb of verbs) {
        const response = await invokeRoute(route, path, verb);
        const name = `${verb} /api/${routeUrlPath(path)}`;
        expect(response.status, name).toBe(401);
        const body = await response.json() as { error?: { code?: unknown; message?: unknown } };
        expect(body, name).toEqual({
          error: {
            code: expect.stringMatching(/^[A-Z][A-Z0-9_]+$/),
            message: expect.any(String),
          },
        });
        const cacheControl = response.headers.get("cache-control") ?? "";
        expect(cacheControl, name).toContain("private");
        expect(cacheControl, name).toContain("no-store");
        const vary = response.headers.get("vary") ?? "";
        expect(vary, name).toContain("Authorization");
        expect(vary, name).toContain("X-Home-Account-Provider");
      }
    }
  });
});

async function loadRoute(path: string): Promise<RouteModule> {
  return await import(`./${path.replace(/\.ts$/, "")}`) as RouteModule;
}

async function invokeRoute(
  route: RouteModule,
  path: string,
  verb: (typeof httpVerbs)[number],
): Promise<Response> {
  const handler = route[verb] as (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;
  const query = path === "portfolio/valuation/route.ts" ? "?region=US" : "";
  const request = new Request(`https://home.test/api/${routeUrlPath(path)}${query}`, {
    method: verb,
    ...(verb === "GET" || verb === "HEAD"
      ? {}
      : { headers: { "content-type": "application/json" }, body: "{}" }),
  });
  return await handler(request, {
    params: Promise.resolve({
      id: "11111111-1111-4111-8111-111111111111",
      provider: "ripio",
    }),
  });
}

function routeUrlPath(path: string): string {
  return path
    .replace(/\/route\.ts$/, "")
    .replace("[id]", "11111111-1111-4111-8111-111111111111")
    .replace("[provider]", "ripio");
}

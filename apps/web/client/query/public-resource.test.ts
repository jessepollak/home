import { describe, expect, test } from "bun:test";
import { DeploymentExpiredError } from "./deployment-headers";
import { publicResource, reloadForExpiredDeployment } from "./public-resource";

const endpoint = "/api/invest/asset";
const mock = (response: Response) => async () => response;

function withDeploymentId(run: () => Promise<void>): Promise<void> {
  const previous = process.env.NEXT_DEPLOYMENT_ID;
  process.env.NEXT_DEPLOYMENT_ID = "dpl_current";
  return run().finally(() => {
    if (previous === undefined) delete process.env.NEXT_DEPLOYMENT_ID;
    else process.env.NEXT_DEPLOYMENT_ID = previous;
  });
}

describe("publicResource", () => {
  test("returns JSON and sends deployment, accept, caller headers, GET and no-store", async () => withDeploymentId(async () => {
    const calls: { path: RequestInfo | URL; init?: RequestInit }[] = [];
    const value = await publicResource(endpoint, {
      headers: { "x-priority": "prefetch" },
      fetchImpl: async (path, init) => {
        calls.push({ path, init });
        return Response.json({ value: 123 });
      },
    });
    expect(value).toEqual({ value: 123 });
    expect(calls).toEqual([{ path: endpoint, init: {
      method: "GET",
      headers: { "x-deployment-id": "dpl_current", accept: "application/json", "x-priority": "prefetch" },
      cache: "no-store",
      signal: undefined,
    } }]);
  }));

  test("rethrows an aborted fetch error unchanged", async () => {
    const controller = new AbortController();
    const error = new DOMException("Aborted", "AbortError");
    controller.abort();
    await expect(publicResource(endpoint, { signal: controller.signal, fetchImpl: async () => { throw error; } })).rejects.toBe(error);
  });

  test("rethrows an aborted body-read error unchanged", async () => {
    const controller = new AbortController();
    const error = new DOMException("Aborted", "AbortError");
    const response = Response.json({ value: 123 });
    response.text = async () => { controller.abort(); throw error; };
    await expect(publicResource(endpoint, { signal: controller.signal, fetchImpl: mock(response) })).rejects.toBe(error);
  });

  test("rethrows an AbortError even when the caller signal is not marked aborted", async () => {
    const error = new DOMException("Aborted", "AbortError");
    await expect(publicResource(endpoint, { fetchImpl: async () => { throw error; } })).rejects.toBe(error);
  });

  test("classifies non-aborted fetch failures as network", async () => {
    await expect(publicResource(endpoint, { fetchImpl: async () => { throw new Error("offline"); } }))
      .rejects.toMatchObject({ kind: "network", status: null });
  });

  test("preserves JSON error bodies and never resolves a failed read", async () => {
    await expect(publicResource(endpoint, { fetchImpl: mock(Response.json({ status: "error" }, { status: 503 })) }))
      .rejects.toMatchObject({ kind: "http", status: 503, body: { status: "error" } });
  });

  test("classifies non-JSON error bodies as HTTP with no body", async () => {
    await expect(publicResource(endpoint, { fetchImpl: mock(new Response("Provider down", { status: 500 })) }))
      .rejects.toMatchObject({ kind: "http", status: 500, body: undefined });
  });

  test("classifies malformed successful JSON as parse failure", async () => {
    await expect(publicResource(endpoint, { fetchImpl: mock(new Response("{", { status: 200 })) }))
      .rejects.toMatchObject({ kind: "parse", status: 200 });
  });

  test("reloads on pinned non-JSON 404 and throws deployment expired", async () => withDeploymentId(async () => {
    const expired: string[] = [];
    await expect(publicResource(endpoint, {
      fetchImpl: mock(new Response("Not Found", { status: 404 })),
      onDeploymentExpired: (id) => { expired.push(id); },
    })).rejects.toBeInstanceOf(DeploymentExpiredError);
    expect(expired).toEqual(["dpl_current"]);
  }));

  test("never reloads for a pinned JSON 404 contract response", async () => withDeploymentId(async () => {
    const expired: string[] = [];
    await expect(publicResource(endpoint, {
      fetchImpl: mock(Response.json({ status: "unknown-asset" }, { status: 404 })),
      onDeploymentExpired: (id) => { expired.push(id); },
    })).rejects.toMatchObject({ kind: "http", status: 404, body: { status: "unknown-asset" } });
    expect(expired).toEqual([]);
  }));

  test("does not reload for unpinned text 404", async () => {
    const expired: string[] = [];
    await expect(publicResource(endpoint, {
      headers: { "x-deployment-id": "" },
      fetchImpl: mock(new Response("Not Found", { status: 404 })),
      onDeploymentExpired: (id) => { expired.push(id); },
    })).rejects.toMatchObject({ kind: "http", status: 404, body: undefined });
    expect(expired).toEqual([]);
  });

  test("rejects paths that are not same-origin relative", async () => {
    for (const path of ["https://elsewhere.test/api", "api/asset", "//elsewhere.test/api", "/\\elsewhere.test/api", ""]) {
      await expect(publicResource(path, { fetchImpl: async () => { throw new Error("must not fetch"); } }))
        .rejects.toBeInstanceOf(TypeError);
    }
  });

  test("uses a reload guard per deployment ID and fails safe if storage throws", () => {
    const records = new Map<string, string>();
    let reloads = 0;
    const storage = {
      getItem: (key: string) => records.get(key) ?? null,
      setItem: (key: string, value: string) => { records.set(key, value); },
    };
    const reload = () => { reloads += 1; };
    reloadForExpiredDeployment("a", { storage, reload });
    reloadForExpiredDeployment("a", { storage, reload });
    reloadForExpiredDeployment("b", { storage, reload });
    reloadForExpiredDeployment("a", { storage, reload });
    expect(reloads).toBe(2);
    expect(JSON.parse(records.get("home.deployment-reload.v1") ?? "null")).toEqual(["a", "b"]);
    records.set("home.deployment-reload.v1", "not json");
    reloadForExpiredDeployment("d", { storage, reload });
    expect(reloads).toBe(2);
    const throwingGet = { ...storage, getItem: () => { throw new Error("denied"); } };
    const throwingSet = { ...storage, setItem: () => { throw new Error("denied"); } };
    reloadForExpiredDeployment("c", { storage: throwingGet, reload });
    reloadForExpiredDeployment("c", { storage: throwingSet, reload });
    expect(reloads).toBe(2);
  });
});

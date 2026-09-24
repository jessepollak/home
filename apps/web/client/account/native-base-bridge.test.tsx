import "./dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, render, renderHook, waitFor } from "@testing-library/react";
import type { VerifiedAccountSession } from "./session-client";
import { jsonResponse } from "@/tests/helpers/http";
// composite-account-provider.test.tsx replaces ./native-base-bridge process-wide; the query suffix loads the real module.
const unmockedBridgeSpecifier: string = "./native-base-bridge.tsx?unmocked";
const {
  default: NativeBaseAccountBridge,
  useNativeBaseIdentity,
}: typeof import("./native-base-bridge") = await import(unmockedBridgeSpecifier);

const SEED_SESSION: VerifiedAccountSession = {
  user: { subject: "seed-subject" },
  smartAccount: {
    address: "0x2222222222222222222222222222222222222222",
    chainId: 8453,
  },
  accountProvider: "cdp-embedded",
};

const originalFetch = globalThis.fetch;
const sessionReads: string[] = [];

function stubSessionEndpoint(response: () => Response) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    sessionReads.push(String(input));
    return response();
  }) as typeof fetch;
}

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  sessionReads.length = 0;
});

describe("native-only account bridge", () => {
  test.each([
    { rendered: "a CDP render hint", renderSeed: { session: SEED_SESSION, source: "cdp-hint" as const }, probes: 0 },
    { rendered: "a Home session", renderSeed: { session: { ...SEED_SESSION, accountProvider: "base-account" as const }, source: "home-session" as const }, probes: 1 },
    { rendered: "no seed", renderSeed: null, probes: 0 },
  ])("native session probes on mount after the server rendered $rendered: $probes", async ({ renderSeed, probes }) => {
    stubSessionEndpoint(() => jsonResponse({ error: { code: "UNAUTHENTICATED" } }, 401));

    render(<NativeBaseAccountBridge renderSeed={renderSeed}>{null}</NativeBaseAccountBridge>);

    await waitFor(() => expect(sessionReads.filter((url) => url === "/api/session").length).toBe(probes));
    await Promise.resolve();
    await Promise.resolve();
    expect(sessionReads.filter((url) => url === "/api/session").length).toBe(probes);
  });
});

describe("native Base identity restore", () => {
  test("probes the session endpoint on mount by default", async () => {
    stubSessionEndpoint(() => jsonResponse({ error: { code: "UNAUTHENTICATED" } }, 401));

    const { result } = renderHook(() => useNativeBaseIdentity(true));

    await waitFor(() => expect(result.current.isSettled).toBe(true));
    expect(result.current.identity).toBeNull();
    expect(sessionReads).toEqual(["/api/session"]);
  });

  test("settles signed out without a session request when the mount restore is skipped", async () => {
    stubSessionEndpoint(() => jsonResponse({ error: { code: "UNAUTHENTICATED" } }, 401));

    const { result } = renderHook(() => useNativeBaseIdentity(true, { restoreOnMount: false }));

    expect(result.current.isSettled).toBe(true);
    expect(result.current.hasSettled).toBe(true);
    expect(result.current.boundary.isInitialized).toBe(true);
    expect(result.current.boundary.isSignedIn).toBe(false);
    await Promise.resolve();
    await Promise.resolve();
    expect(sessionReads).toEqual([]);
  });

  test("still restores on an explicit retry after skipping the mount restore", async () => {
    stubSessionEndpoint(() => jsonResponse({ error: { code: "UNAUTHENTICATED" } }, 401));

    const { result } = renderHook(() => useNativeBaseIdentity(true, { restoreOnMount: false }));
    await act(async () => { await result.current.restore(); });

    await waitFor(() => expect(sessionReads).toEqual(["/api/session"]));
    expect(result.current.identity).toBeNull();
  });
});

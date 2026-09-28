import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, jest, test } from "bun:test";
import { onlineManager } from "@tanstack/react-query";
import { getHomeQueryClient, ownerQueryKey } from "@/client/query/query-client";
import { cardsBody } from "@/tests/browser/fixtures/bodies";

const { cleanup, renderHook, waitFor } = await import("@testing-library/react");
const { CardRefreshError, useCards } = await import("./use-cards");

afterEach(() => { cleanup(); onlineManager.setOnline(true); getHomeQueryClient().clear(); });

const frozenWrite = { version: 1, card: { id: "ic_fixture4821", status: "frozen" } };

function setup(respond: (path: string, options?: { method?: string; body?: unknown }) => unknown) {
  const calls: { path: string; method: string; body: unknown }[] = [];
  const fetchAccountResource = jest.fn(async (path: string, options?: { method?: "GET" | "POST" | "PUT"; body?: unknown }) => {
    calls.push({ path, method: options?.method ?? "GET", body: options?.body });
    return respond(path, options);
  });
  const hook = renderHook(() => useCards({ ownerKey: "owner-1", fetchAccountResource }));
  return { hook, calls };
}

describe("useCards", () => {
  test("reads card state through the shared contract parser", async () => {
    const { hook } = setup(() => cardsBody("frozen"));
    await waitFor(() => expect(hook.result.current.query.data?.state).toBe("frozen"));
  });

  test("an invalid card state response is an error, not a state", async () => {
    const { hook } = setup(() => ({ version: 1, state: "active", cards: [{ id: "ic_1", status: "active", last4: "4242424242424242" }] }));
    await waitFor(() => expect(hook.result.current.query.isError).toBe(true));
    expect(hook.result.current.query.data).toBeUndefined();
  });

  test("freeze and unfreeze post an empty body and confirm from a fresh card read", async () => {
    let current: "active" | "frozen" = "active";
    const { hook, calls } = setup((path) => {
      if (path.endsWith("/freeze") || path.endsWith("/unfreeze")) {
        current = path.endsWith("/freeze") ? "frozen" : "active";
        return { version: 1, card: { id: "ic_fixture4821", status: current } };
      }
      return cardsBody(current);
    });
    await waitFor(() => expect(hook.result.current.query.data).toBeDefined());
    await hook.result.current.commands.setFrozen("ic_fixture4821", true);
    await hook.result.current.commands.setFrozen("ic_fixture4821", false);
    expect(calls.filter((call) => call.method === "POST")).toEqual([
      { path: "/api/cards/ic_fixture4821/freeze", method: "POST", body: {} },
      { path: "/api/cards/ic_fixture4821/unfreeze", method: "POST", body: {} },
    ]);
    expect(calls.filter((call) => call.path === "/api/cards").length).toBeGreaterThanOrEqual(3);
  });

  test("a successful freeze whose card re-read fails rejects and leaves the query in error", async () => {
    let readFails = false;
    const { hook } = setup((path, options) => {
      if (options?.method === "POST") { readFails = true; return { version: 1, card: { id: "ic_fixture4821", status: "frozen" } }; }
      if (readFails) throw new Error("cards read failed");
      return cardsBody("active");
    });
    await waitFor(() => expect(hook.result.current.query.data).toBeDefined());
    await expect(hook.result.current.commands.setFrozen("ic_fixture4821", true)).rejects.toBeInstanceOf(CardRefreshError);
    expect(getHomeQueryClient().getQueryState(ownerQueryKey("owner-1", "cards"))?.status).toBe("error");
  });

  test("a re-read that pauses offline after a successful freeze is not a confirmation", async () => {
    const { hook, calls } = setup((path, options) => {
      if (options?.method === "POST") { onlineManager.setOnline(false); return frozenWrite; }
      return cardsBody("active");
    });
    await waitFor(() => expect(hook.result.current.query.data).toBeDefined());
    const reads = calls.filter((call) => call.path === "/api/cards").length;
    await expect(hook.result.current.commands.setFrozen("ic_fixture4821", true)).rejects.toBeInstanceOf(CardRefreshError);
    expect(calls.filter((call) => call.path === "/api/cards").length).toBe(reads);
    expect(getHomeQueryClient().getQueryState(ownerQueryKey("owner-1", "cards"))?.fetchStatus).toBe("paused");
  });

  test("a re-read that answers unavailable after a successful freeze is not a confirmation", async () => {
    let written = false;
    const { hook } = setup((path, options) => {
      if (options?.method === "POST") { written = true; return frozenWrite; }
      return cardsBody(written ? "unavailable" : "active");
    });
    await waitFor(() => expect(hook.result.current.query.data).toBeDefined());
    await expect(hook.result.current.commands.setFrozen("ic_fixture4821", true)).rejects.toBeInstanceOf(CardRefreshError);
    await waitFor(() => expect(hook.result.current.query.data?.state).toBe("unavailable"));
  });

  test("a re-read that still shows the previous status is not a confirmation", async () => {
    const { hook } = setup((path, options) => options?.method === "POST" ? frozenWrite : cardsBody("active"));
    await waitFor(() => expect(hook.result.current.query.data).toBeDefined());
    await expect(hook.result.current.commands.setFrozen("ic_fixture4821", true)).rejects.toBeInstanceOf(CardRefreshError);
  });

  test("a successful freeze confirmed by the re-read resolves with the frozen card", async () => {
    let written = false;
    const { hook } = setup((path, options) => {
      if (options?.method === "POST") { written = true; return frozenWrite; }
      return cardsBody(written ? "frozen" : "active");
    });
    await waitFor(() => expect(hook.result.current.query.data).toBeDefined());
    await expect(hook.result.current.commands.setFrozen("ic_fixture4821", true)).resolves.toBeUndefined();
    await waitFor(() => expect(hook.result.current.query.data?.state).toBe("frozen"));
  });

  test("a failed write keeps its own error even when the re-read also fails", async () => {
    let reads = 0;
    const { hook } = setup((path, options) => {
      if (options?.method === "POST") throw new Error("freeze failed");
      if (reads++ > 0) throw new Error("cards read failed");
      return cardsBody("active");
    });
    await waitFor(() => expect(hook.result.current.query.data).toBeDefined());
    await expect(hook.result.current.commands.setFrozen("ic_fixture4821", true)).rejects.toThrow("freeze failed");
  });

  test("a lock whose response was lost is confirmed by a re-read showing the card locked", async () => {
    let written = false;
    const { hook } = setup((path, options) => {
      if (options?.method === "POST") { written = true; throw new Error("response lost"); }
      return cardsBody(written ? "frozen" : "active");
    });
    await waitFor(() => expect(hook.result.current.query.data).toBeDefined());
    await expect(hook.result.current.commands.setFrozen("ic_fixture4821", true)).resolves.toBeUndefined();
    await waitFor(() => expect(hook.result.current.query.data?.state).toBe("frozen"));
  });

  test("a failed lock whose re-read still shows the card unlocked keeps its error", async () => {
    const { hook } = setup((path, options) => {
      if (options?.method === "POST") throw new Error("freeze failed");
      return cardsBody("active");
    });
    await waitFor(() => expect(hook.result.current.query.data).toBeDefined());
    await expect(hook.result.current.commands.setFrozen("ic_fixture4821", true)).rejects.toThrow("freeze failed");
  });

  test("a write response for another card is rejected", async () => {
    const { hook } = setup((path) => path.endsWith("/freeze") ? { version: 1, card: { id: "ic_other", status: "frozen" } } : cardsBody("active"));
    await waitFor(() => expect(hook.result.current.query.data).toBeDefined());
    await expect(hook.result.current.commands.setFrozen("ic_fixture4821", true)).rejects.toThrow();
  });

  test("enrollment returns only a Bridge-hosted verification link", async () => {
    let url = "https://bridge.withpersona.com/verify?inquiry=1";
    const { hook } = setup((path) => path === "/api/cards/enrollment" ? { version: 1, kycUrl: url } : cardsBody("verification-required"));
    await expect(hook.result.current.commands.enroll()).resolves.toBe(url);
    url = "https://evil.example/verify";
    await expect(hook.result.current.commands.enroll()).rejects.toThrow();
  });

  test("the reveal key request sends only the nonce and checks the card id", async () => {
    const secret = `ek_test_${"a".repeat(20)}`;
    const { hook, calls } = setup((path) => path.endsWith("/ephemeral-key")
      ? { version: 1, cardId: "ic_fixture4821", ephemeralKeySecret: secret } : cardsBody("active"));
    await expect(hook.result.current.commands.revealKey("ic_fixture4821", "nonce_abcdefgh")).resolves.toMatchObject({ ephemeralKeySecret: secret });
    expect(calls.at(-1)).toEqual({ path: "/api/cards/ic_fixture4821/ephemeral-key", method: "POST", body: { nonce: "nonce_abcdefgh" } });
    await expect(hook.result.current.commands.revealKey("ic_other1", "nonce_abcdefgh")).rejects.toThrow();
  });
});

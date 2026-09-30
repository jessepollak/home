import { describe, expect, test } from "bun:test";
import { TransferExecutionError } from "@/shared/transfers/types";
import { createHomeQueryClient, ownerQueryKey } from "@/client/query/query-client";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { ResourceFailureKind } from "@/client/account/resource-failure";
import { recentActionsQuery, recentActionsStatus, retryRecentActions } from "./recent-actions-query";

const address = "0x1111111111111111111111111111111111111111" as const;
const session: VerifiedAccountSession = {
  user: { subject: "subject" },
  smartAccount: { address, chainId: 8453 },
  accountProvider: "cdp-embedded",
};
const failure = (reason: ConstructorParameters<typeof TransferExecutionError>[0], kind: ResourceFailureKind, status?: number) =>
  Object.assign(new TransferExecutionError(reason), { kind }, status === undefined ? {} : { status });

describe("recent actions recovery", () => {
  test("rejects malformed responses inside the query and forwards the signal; caches parsed rows", async () => {
    const client = createHomeQueryClient();
    let receivedSignal: AbortSignal | undefined;
    const malformed = recentActionsQuery({ owner: "owner", session, fetchOperations: async (signal) => {
      receivedSignal = signal;
      return {};
    } });
    await expect(client.fetchQuery(malformed)).rejects.toThrow("Recent actions response is invalid.");
    expect(receivedSignal).toBeInstanceOf(AbortSignal);
    expect(client.getQueryData(malformed.queryKey)).toBeUndefined();

    const valid = recentActionsQuery({ owner: "owner", session, fetchOperations: async (signal) => {
      receivedSignal = signal;
      return { actions: [null, { id: "malformed-item" }] };
    } });
    const payload = await client.fetchQuery(valid);
    expect(payload).toEqual({ operations: [], unparsedSavingsDeposits: [], truncated: false, incomplete: false, readSequence: expect.any(Number) });
    expect(client.getQueryData<unknown>(valid.queryKey)).toEqual(payload);
    expect(receivedSignal).toBeInstanceOf(AbortSignal);
    client.clear();
  });

  test("caches only session-owned parsed operations in descending update order", async () => {
    const client = createHomeQueryClient();
    const row = (id: string, confirmedAt: string, subject = session.user.subject) => ({
      id, kind: "send", status: "confirmed", createdAt: "2026-09-12T12:00:00.000Z", confirmedAt,
      owner: { subject, address: session.smartAccount!.address, chainId: 8453, accountProvider: session.accountProvider },
      summary: { title: "Send", amounts: [], warnings: [], expiresAt: "2026-09-12T13:00:00.000Z" },
    });
    const options = recentActionsQuery({ owner: "owner", session, fetchOperations: async () => ({ actions: [
      row("older", "2026-09-12T12:01:00.000Z"),
      row("foreign", "2026-09-12T12:03:00.000Z", "another-owner"),
      row("newer", "2026-09-12T12:02:00.000Z"),
    ] }) });
    expect((await client.fetchQuery(options)).operations.map((item) => item.action.id)).toEqual(["newer", "older"]);
    expect(client.getQueryData<unknown>(options.queryKey)).toMatchObject({
      operations: [{ action: { id: "newer" }, status: "confirmed" }, { action: { id: "older" }, status: "confirmed" }],
      unparsedSavingsDeposits: [],
    });
    client.clear();
  });
  test("keeps a settled trade row whose token decimals exceed the cash-out range", async () => {
    const client = createHomeQueryClient();
    const options = recentActionsQuery({ owner: "owner", session, fetchOperations: async () => ({ actions: [{
      id: "trade-36", kind: "trade", status: "confirmed", createdAt: "2026-09-12T12:00:00.000Z", confirmedAt: "2026-09-12T12:01:00.000Z",
      owner: { subject: session.user.subject, address: session.smartAccount!.address, chainId: 8453, accountProvider: session.accountProvider },
      summary: { title: "Buy MICRO", amounts: [{ assetId: "micro", symbol: "MICRO", decimals: 36, amountBaseUnits: "1", direction: "receive" }], warnings: [], expiresAt: "2026-09-12T13:00:00.000Z" },
    }] }) });
    expect((await client.fetchQuery(options)).operations.map((item) => item.action.id)).toEqual(["trade-36"]);
    expect(client.getQueryData<unknown>(options.queryKey)).toMatchObject({ operations: [{ action: { id: "trade-36", amounts: [{ decimals: 36 }] } }], unparsedSavingsDeposits: [] });
    client.clear();
  });


  test("caches parsed operations and owned unparsed savings-deposit stubs under one actions key", async () => {
    const client = createHomeQueryClient();
    const owner = { subject: session.user.subject, address, chainId: 8453, accountProvider: session.accountProvider };
    const vaultAddress = "0x2222222222222222222222222222222222222222";
    const parsedDeposit = {
      id: "parsed", kind: "savings-deposit", status: "pending", owner,
      createdAt: "2026-09-12T12:00:00.000Z", confirmedAt: "2026-09-12T12:01:00.000Z",
      summary: { title: "Deposit", amounts: [], warnings: [], expiresAt: "2026-09-12T13:00:00.000Z" },
    };
    const stub = {
      id: "stub", kind: "savings-deposit", status: "confirmed", owner, settledAt: "2026-09-12T12:02:00.000Z",
      summary: { metadata: { product: "savings", operation: "deposit", vaultAddress } },
    };
    const options = recentActionsQuery({ owner: "owner", session, fetchOperations: async () => ({ actions: [
      parsedDeposit, { ...stub, id: parsedDeposit.id }, stub,
      { ...stub, id: "invalid-status", status: "legacy", settledAt: null, summary: null },
      { ...stub, id: "foreign-subject", owner: { ...owner, subject: "another-owner" } },
      { ...stub, id: "foreign-provider", owner: { ...owner, accountProvider: "another-provider" } },
      { ...stub, id: "foreign-chain", owner: { ...owner, chainId: 1 } },
      { ...stub, id: "foreign-address", owner: { ...owner, address: vaultAddress } },
      { ...stub, id: "malformed-owner", owner: null },
      { ...stub, id: "send", kind: "send" }, null,
    ] }) });
    expect([...options.queryKey]).toEqual([...ownerQueryKey("owner", "actions")]);
    const payload = await client.fetchQuery(options);
    expect(payload.operations.map((operation) => operation.action.id)).toEqual(["parsed"]);
    expect(payload.unparsedSavingsDeposits).toEqual([
      { status: "confirmed", settledAt: stub.settledAt, vaultAddress },
      { status: null, vaultAddress: null },
    ]);
    expect(client.getQueryData<unknown>(ownerQueryKey("owner", "actions"))).toEqual(payload);
    expect(client.getQueryCache().getAll()).toHaveLength(1);
    client.clear();
  });

  test("shares truncation and owner-scoped incomplete cash-out flags in the parsed cache", async () => {
    const client = createHomeQueryClient();
    const owner = { subject: session.user.subject, address, chainId: 8453, accountProvider: session.accountProvider };
    const malformed = { id: "cashout", kind: "cash-out", owner, summary: null };
    const options = recentActionsQuery({ owner: "owner", session, fetchOperations: async () => ({ actions: [malformed], truncated: true }) });
    expect(await client.fetchQuery(options)).toMatchObject({ operations: [], truncated: true, incomplete: true });
    const foreign = recentActionsQuery({ owner: "owner", session, fetchOperations: async () => ({
      actions: [{ ...malformed, owner: { ...owner, subject: "foreign" } }],
    }) });
    expect(await client.fetchQuery({ ...foreign, staleTime: 0 })).toMatchObject({ operations: [], truncated: false, incomplete: false });
    client.clear();
  });

  test("retries only transient transport failures at most twice", () => {
    for (const error of [failure("unavailable", "network"), ...[429, 500, 503, 599].map((status) => failure("unavailable", "http", status))]) {
      expect(retryRecentActions(0, error)).toBe(true);
      expect(retryRecentActions(1, error)).toBe(true);
      expect(retryRecentActions(2, error)).toBe(false);
    }
    for (const status of [400, 401, 404, 410, 499, 600]) {
      expect(retryRecentActions(0, failure("unavailable", "http", status))).toBe(false);
    }
    for (const kind of ["parse", "access", "http"] as const) {
      expect(retryRecentActions(0, failure("unavailable", kind))).toBe(false);
    }
    expect(retryRecentActions(0, new TransferExecutionError("unavailable"))).toBe(false);
    for (const reason of ["stale-session", "invalid-request"] as const) {
      expect(retryRecentActions(0, failure(reason, "network"))).toBe(false);
    }
    expect(retryRecentActions(0, new DOMException("aborted", "AbortError"))).toBe(false);
    expect(retryRecentActions(0, new SyntaxError("invalid JSON"))).toBe(false);
    expect(retryRecentActions(0, new Error("invalid contract"))).toBe(false);
  });

  test("refetches on return only after a failed query", () => {
    const options = recentActionsQuery({ owner: "owner", session, fetchOperations: async () => ({ actions: [] }) });
    const state = (status: "error" | "success") => ({ state: { status } });
    const onFocus = options.refetchOnWindowFocus;
    const onReconnect = options.refetchOnReconnect;
    if (typeof onFocus !== "function" || typeof onReconnect !== "function") throw new Error("Expected conditional refetch callbacks.");
    expect(onFocus(state("success") as Parameters<typeof onFocus>[0])).toBe(false);
    expect(onReconnect(state("success") as Parameters<typeof onReconnect>[0])).toBe(false);
    expect(onFocus(state("error") as Parameters<typeof onFocus>[0])).toBe(true);
    expect(onReconnect(state("error") as Parameters<typeof onReconnect>[0])).toBe(true);
  });

  test("separates first load, healthy, recently loaded, and sustained failure states", () => {
    const base = { hasData: false, isPending: false, isError: false, dataUpdatedAt: 0, errorUpdatedAt: 0 };
    expect(recentActionsStatus({ ...base, isPending: true })).toBe("loading");
    expect(recentActionsStatus(base)).toBe("ready");
    expect(recentActionsStatus({ ...base, hasData: true, dataUpdatedAt: 1_000 })).toBe("ready");
    expect(recentActionsStatus({ ...base, isError: true, errorUpdatedAt: 1_000 })).toBe("error");
    expect(recentActionsStatus({ ...base, hasData: true, isError: true, dataUpdatedAt: 1_000, errorUpdatedAt: 121_000 })).toBe("ready");
    expect(recentActionsStatus({ ...base, hasData: true, isError: true, dataUpdatedAt: 1_000, errorUpdatedAt: 121_001 })).toBe("error");
    expect(recentActionsStatus({
      ...base, hasData: true, isError: true, dataUpdatedAt: 1_000, errorUpdatedAt: 1_000,
    }, { tolerateStaleError: false })).toBe("error");
    expect(recentActionsStatus(
      { ...base, hasData: true, dataUpdatedAt: 1_000 }, { tolerateStaleError: false },
    )).toBe("ready");
  });
});

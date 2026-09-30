import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, jest, test } from "bun:test";
import { getHomeQueryClient, ownerQueryKey } from "@/client/query/query-client";
import { dataOwnerKey } from "@/client/account/owner-keys";
import { invalidateAfterAction } from "@/client/query/after-action";
import { queryScopes } from "@/client/query/query-scopes";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { cardSpendingData } from "./card-spending";
import type { CardSpendingResponse } from "@/shared/cards/allowance-contract";

const { cleanup, renderHook, waitFor } = await import("@testing-library/react");
const { useCardSpending } = await import("./use-card-spending");

afterEach(() => { cleanup(); getHomeQueryClient().clear(); });

const available: Extract<CardSpendingResponse, { status: "available" }> = { version: 1, status: "available", setEnabled: true, spender: "0x2222222222222222222222222222222222222222", walletBaseUnits: "100000000", allowanceBaseUnits: "25000000", availableBaseUnits: "25000000", retired: [], blockNumber: "1", fetchedAt: "2026-09-28T12:00:00.000Z" };

function setup(respond: () => unknown, ownerKey: string | null = "owner-1") {
  const fetchAccountResource = jest.fn(async () => respond());
  const hook = renderHook(() => useCardSpending({ ownerKey, fetchAccountResource }));
  return { hook, fetchAccountResource };
}

describe("useCardSpending", () => {
  test("parses an owner-keyed read and refreshes the spending endpoint", async () => {
    const { hook, fetchAccountResource } = setup(() => available);
    await waitFor(() => expect(hook.result.current.query.data).toEqual(available));
    expect(fetchAccountResource).toHaveBeenCalledWith("/api/cards/spending", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(getHomeQueryClient().getQueryData<CardSpendingResponse>(ownerQueryKey("owner-1", "card-spending"))).toEqual(available);
    expect(cardSpendingData(hook.result.current.query).status).toBe("ready");
    await hook.result.current.refresh();
    expect(fetchAccountResource).toHaveBeenCalledTimes(2);
  });
  test("after-action invalidation refreshes the verified session's spending query", async () => {
    const session: VerifiedAccountSession = { user: { subject: "owner-1" }, smartAccount: { address: "0x1111111111111111111111111111111111111111", chainId: 8453 }, accountProvider: "cdp-embedded" };
    const owner = dataOwnerKey(session);
    const { hook, fetchAccountResource } = setup(() => available, owner);
    await waitFor(() => expect(hook.result.current.query.data).toEqual(available));
    expect(getHomeQueryClient().getQueryData<CardSpendingResponse>(ownerQueryKey(owner, "card-spending"))).toEqual(available);
    await invalidateAfterAction(getHomeQueryClient(), dataOwnerKey(session));
    expect(fetchAccountResource).toHaveBeenCalledTimes(2);
  });
  test("spending query uses the registered scope's freshness and persistence policy", async () => {
    const { hook } = setup(() => available);
    await waitFor(() => expect(hook.result.current.query.data).toEqual(available));
    const query = getHomeQueryClient().getQueryCache().find({ queryKey: ownerQueryKey("owner-1", "card-spending"), exact: true });
    expect(query?.options).toMatchObject({ staleTime: queryScopes["card-spending"].staleTime });
    expect(query?.meta).toEqual({ ownerKey: "owner-1", persistence: queryScopes["card-spending"].persistence });
  });
  test("server unavailable is explicit unknown data, never zero", async () => {
    const { hook } = setup(() => ({ version: 1, status: "unavailable", fetchedAt: available.fetchedAt }));
    await waitFor(() => expect(hook.result.current.query.data?.status).toBe("unavailable"));
    expect(cardSpendingData(hook.result.current.query)).toEqual({ status: "unavailable" });
  });
  test("malformed responses fail parsing", async () => {
    const { hook } = setup(() => ({ ...available, availableBaseUnits: "0" }));
    await waitFor(() => expect(hook.result.current.query.isError).toBe(true));
    expect(cardSpendingData(hook.result.current.query)).toEqual({ status: "unavailable" });
  });
  test("503 CARDS_UNAVAILABLE is a query error", async () => {
    const { hook } = setup(() => { throw Object.assign(new Error("unavailable"), { status: 503, code: "CARDS_UNAVAILABLE" }); });
    await waitFor(() => expect(hook.result.current.query.isError).toBe(true));
    expect(hook.result.current.query.data).toBeUndefined();
  });
  test("without an owner the query is disabled", () => {
    const { hook, fetchAccountResource } = setup(() => available, null);
    expect(fetchAccountResource).not.toHaveBeenCalled();
    expect(cardSpendingData(hook.result.current.query)).toEqual({ status: "loading" });
  });
  test("not-configured does not invent a spending balance", async () => {
    const { hook } = setup(() => ({ version: 1, status: "not-configured" }));
    await waitFor(() => expect(hook.result.current.query.data?.status).toBe("not-configured"));
    expect(cardSpendingData(hook.result.current.query)).toEqual({ status: "not-configured" });
  });
});

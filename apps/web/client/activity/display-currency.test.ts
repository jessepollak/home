import { describe, expect, test } from "bun:test";
import { deferred, present } from "@/tests/helpers/async";
import { QueryClient, type InfiniteData } from "@tanstack/react-query";
import { activityAssets, ACTIVITY_HISTORY_START, type ActivityPage } from "@/shared/activity/types";
import { parseActivityPage } from "@/shared/activity/contract";
import { computeActivityValuationAmount } from "@/shared/activity/valuation";
import type { FiatCurrencyCode } from "@/config/regions";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { activityWindowScope } from "@/client/query/after-action";
import { ownerQueryKey } from "@/client/query/query-client";
import { activityOwnerKey, refreshLatestActivity } from "./use-activity";
import { retainActivityPage } from "./retained-activity";
import { presentActivityTransferRow } from "./activity-presenter";

const walletAddress = "0x1111111111111111111111111111111111111111" as const;
const session: VerifiedAccountSession = {
  user: { subject: "activity-currency-test" }, accountProvider: "cdp-embedded",
  smartAccount: { address: walletAddress, chainId: 8453 },
};
const ownerKey = activityOwnerKey(session);
const windowEnd = "2026-10-01T12:00:00.000Z";
const usdc = present(activityAssets.find((asset) => asset.id === "usdc"));

function page(currency: FiatCurrencyCode, to = windowEnd, priced = true): ActivityPage & { version: 1 } {
  const fxRate = currency === "USD" ? null : { atoms: "5", scale: 0 };
  return {
    version: 1, walletAddress, chainId: 8453, currency,
    window: { from: ACTIVITY_HISTORY_START, to }, nextCursor: null,
    source: { provider: "cdp-sql", cached: false, stale: false, executionTimestamp: to, executionTimeMs: 0, fetchedAt: to },
    transfers: [{
      id: `8453:${usdc.tokenAddress.toLowerCase()}:one`, logId: "one", chainId: 8453, assetId: usdc.id,
      tokenAddress: usdc.tokenAddress, tokenSymbol: usdc.symbol, tokenDecimals: usdc.decimals,
      tokenImageUrl: null, walletAddress, fromAddress: "0x2222222222222222222222222222222222222222",
      toAddress: walletAddress, direction: "incoming", amountBaseUnits: "1234567", blockNumber: "100",
      blockHash: `0x${"a".repeat(64)}`, transactionHash: `0x${"b".repeat(64)}`, logIndex: "0",
      blockTimestamp: "2026-09-30T12:00:00.000Z",
      valuation: priced ? {
        status: "priced", currency, method: "peg", peg: "USD", close: null,
        amount: computeActivityValuationAmount({ amountBaseUnits: "1234567", tokenDecimals: 6, unitPrice: null, fxRate }),
        fx: fxRate ? { provider: "Coinbase", base: "USD", quote: currency, date: "2026-09-30", rate: fxRate, provisional: false } : null,
      } : { status: "unpriced", currency, reason: "fx-unavailable" },
    }],
  };
}

function clientWithCurrent(currency: FiatCurrencyCode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  client.setQueryData(ownerQueryKey(ownerKey, activityWindowScope), windowEnd);
  client.setQueryData(ownerQueryKey(ownerKey, "activity", windowEnd, currency, "all"), {
    pages: [page(currency)], pageParams: [null],
  });
  return client;
}

describe("activity display currency", () => {
  test("reprices identical transactions without changing identities, counts or native amounts", () => {
    const usd = parseActivityPage(page("USD"), session, windowEnd, "USD");
    const brl = parseActivityPage(page("BRL"), session, windowEnd, "BRL");
    const nativeFacts = (value: ActivityPage) => value.transfers.map(({ valuation: _valuation, ...transfer }) => transfer);
    expect(nativeFacts(brl)).toEqual(nativeFacts(usd));
    expect(present(usd.transfers[0]).valuation.status).toBe("priced");
    expect(present(brl.transfers[0]).valuation.status).toBe("priced");
    expect(present(brl.transfers[0]).valuation).not.toEqual(present(usd.transfers[0]).valuation);
    const usdRow = presentActivityTransferRow(present(usd.transfers[0]), { regionId: "BR" });
    const brlRow = presentActivityTransferRow(present(brl.transfers[0]), { regionId: "BR" });
    expect(usdRow.valueContext).toBe(brlRow.valueContext);
    expect(usdRow.value).toBe("+$1,23");
    expect(brlRow.value).toBe("+R$\u00a06,17");
  });

  test("never retains another currency's rows or known valuations", () => {
    const previous = page("BRL");
    const next = page("USD", windowEnd, false);
    expect(retainActivityPage(next, previous)).toBe(next);
    expect(retainActivityPage({ ...next, transfers: [] }, previous).transfers).toEqual([]);
    expect(present(retainActivityPage(next, previous).transfers[0]).valuation).toMatchObject({ status: "unpriced", currency: "USD" });
  });

  test("requests explicit USD under BR and ignores other-currency window seeds", async () => {
    const queryClient = clientWithCurrent("USD");
    queryClient.setQueryData(ownerQueryKey(ownerKey, "activity", windowEnd, "USD", "all"), { pages: [page("USD", windowEnd, false)], pageParams: [null] });
    queryClient.setQueryData(ownerQueryKey(ownerKey, "activity", "2026-10-01T11:59:00.000Z", "BRL", "all"), {
      pages: [page("BRL")], pageParams: [null], retainedPage: page("BRL"),
    });
    const requests: string[] = [];
    const outcome = await refreshLatestActivity({
      queryClient, ownerKey, session, regionId: "BR", currency: "USD", isCurrent: () => true, onPrefetchKey: () => {},
      fetchActivity: async (query) => {
        requests.push(query);
        const params = new URLSearchParams(query);
        return page("USD", present(params.get("to")), false);
      },
    });
    expect(outcome).toBe("advanced");
    expect(requests).toHaveLength(1);
    expect(new URLSearchParams(requests[0]).get("currency")).toBe("USD");
    const to = present(queryClient.getQueryData<string>(ownerQueryKey(ownerKey, activityWindowScope)));
    const data = present(queryClient.getQueryData<InfiniteData<ActivityPage> & { retainedPage: ActivityPage }>(ownerQueryKey(ownerKey, "activity", to, "USD", "all")));
    expect(present(data.pages[0]).currency).toBe("USD");
    expect(data.retainedPage.currency).toBe("USD");
    expect(present(data.retainedPage.transfers[0]).valuation.status).toBe("unpriced");
    queryClient.clear();
  });

  test("a late previous-currency refresh cannot advance the visible window", async () => {
    const queryClient = clientWithCurrent("BRL");
    let current = true;
    const response = deferred<unknown>();
    let requestedTo = "";
    const pending = refreshLatestActivity({
      queryClient, ownerKey, session, regionId: "BR", currency: "BRL", isCurrent: () => current, onPrefetchKey: () => {},
      fetchActivity: (query) => {
        requestedTo = present(new URLSearchParams(query).get("to"));
        return response.promise;
      },
    });
    current = false;
    response.resolve(page("BRL", requestedTo));
    expect(await pending).toBe("skipped");
    expect(queryClient.getQueryData(ownerQueryKey(ownerKey, activityWindowScope))).toBe(windowEnd);
    expect(queryClient.getQueryData(ownerQueryKey(ownerKey, "activity", requestedTo, "USD", "all"))).toBeUndefined();
    queryClient.clear();
  });

  test.each([{ regionId: "GLOBAL", currency: null, expected: "USD" }, { regionId: "BR", currency: undefined, expected: "BRL" }] as const)(
    "preserves the default $expected valuation currency", async ({ regionId, currency, expected }) => {
      const queryClient = clientWithCurrent(expected);
      const requestedCurrencies: string[] = [];
      await refreshLatestActivity({
        queryClient, ownerKey, session, regionId, currency, isCurrent: () => true, onPrefetchKey: () => {},
        fetchActivity: async (query) => {
          const params = new URLSearchParams(query);
          requestedCurrencies.push(present(params.get("currency")));
          return page(expected, present(params.get("to")));
        },
      });
      expect(requestedCurrencies).toEqual([expected]);
      queryClient.clear();
    },
  );
});

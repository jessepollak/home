import "@/client/account/dom-test-harness";

import { useMemo } from "react";
import { afterEach, expect, jest, test } from "bun:test";
import { dataOwnerKey } from "@/client/account/owner-keys";
import { buildBalancesSnapshotFixture } from "@/shared/balances/fixtures";
import type { AccountWalletClient } from "@/client/account/cdp-client";
import { getHomeQueryClient, ownerQueryKey, publicQueryKey } from "@/client/query/query-client";
import { BASE_USDC_ADDRESS, MORPHO_V1_CANDIDATE_ADDRESSES } from "@/shared/savings/config";
import type { MorphoVaultsResult } from "@/shared/savings/types";
import { getSavingsRateState, SAVINGS_RATE_FRESHNESS_MS } from "./portfolio-summary";
const { act, cleanup, render } = await import("@testing-library/react");
const { AccountWalletContext, AccountWalletClientProvider, createBlockedAccountWalletClient } = await import("@/client/account/cdp-client");
const { useSavingsRateLabel } = await import("./use-savings-rate-label");
const { resolveProductOffering } = await import("@/shared/operator-settings/products");
const deploymentOffering = resolveProductOffering({ kind: "deployment" });

const wallet = { verification: null, session: null, fetchBalances: async () => { throw new Error("Unexpected balance request"); } } as unknown as AccountWalletClient;

function rates(at: number, netApy: number): MorphoVaultsResult {
  const fetchedAt = new Date(at).toISOString();
  const asset = { address: BASE_USDC_ADDRESS, symbol: "USDC", decimals: 6 } as const;
  const source = { provider: "Morpho GraphQL", endpoint: "https://api.morpho.org/graphql", query: "vaults", fetchedAt } as const;
  return {
    version: "v1", chainId: 8453, asset, source, stale: false,
    candidates: [{ version: "v1", vaultAddress: MORPHO_V1_CANDIDATE_ADDRESSES[0], name: "Vault", symbol: "USDC vault", listed: true,
      chainId: 8453, asset, curatorAddress: null, grossApy: netApy, netApy, feeRate: null,
      totalAssetsRaw: "1", liquidityRaw: "1", stateAsOf: fetchedAt, blockNumber: "1", source }],
  };
}

function RateLabel({ onRender }: { onRender?: (label: string | null) => void }) {
  const { value: label } = useSavingsRateLabel("US", true, deploymentOffering);
  onRender?.(label);
  return <output>{label}</output>;
}

afterEach(() => {
  cleanup();
  getHomeQueryClient().clear();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test("a fresh savings observation replaces the displayed rate", () => {
  jest.setSystemTime(Date.parse("2025-01-01T00:00:00.000Z"));
  const start = Date.now();
  const query = getHomeQueryClient();
  const key = publicQueryKey("savings-vaults");
  query.setQueryData(key, rates(start, 0.04));
  const view = render(<AccountWalletContext.Provider value={wallet}><RateLabel /></AccountWalletContext.Provider>);
  expect(view.container.textContent).toBe("Up to 4.00% APY");

  query.setQueryData(key, rates(start + 10_000, 0.06));
  view.rerender(<AccountWalletContext.Provider value={wallet}><RateLabel /></AccountWalletContext.Provider>);
  expect(view.container.textContent).toBe("Up to 6.00% APY");
});

test("the rate label recomputes at its freshness deadline and retains the stale rate", () => {
  jest.useFakeTimers();
  const start = Date.parse("2025-01-01T00:00:00.000Z");
  jest.setSystemTime(start);
  let nowMs = start;
  jest.spyOn(Date, "now").mockImplementation(() => nowMs);
  const observation = rates(start, 0.04);
  const candidate = observation.candidates[0];
  const stateAt = (nowMs: number) => getSavingsRateState(candidate, {
    metadataFetchedAt: observation.source.fetchedAt,
    metadataStale: observation.stale,
    nowMs,
  });
  const renders = jest.fn();
  getHomeQueryClient().setQueryData(publicQueryKey("savings-vaults"), observation);
  const view = render(<AccountWalletContext.Provider value={wallet}><RateLabel onRender={renders} /></AccountWalletContext.Provider>);
  expect(view.container.textContent).toBe("Up to 4.00% APY");
  expect(stateAt(Date.now()).status).toBe("available");

  nowMs += SAVINGS_RATE_FRESHNESS_MS;
  void act(() => jest.advanceTimersByTime(SAVINGS_RATE_FRESHNESS_MS));
  expect(Date.now()).toBe(start + SAVINGS_RATE_FRESHNESS_MS);
  expect(stateAt(Date.now()).status).toBe("available");
  const rendersBeforeExpiry = renders.mock.calls.length;
  nowMs += 1;
  void act(() => jest.advanceTimersByTime(1));
  expect(Date.now()).toBe(start + SAVINGS_RATE_FRESHNESS_MS + 1);
  expect(stateAt(Date.now()).status).toBe("stale");
  expect(renders.mock.calls.length).toBeGreaterThan(rendersBeforeExpiry);
  expect(view.container.textContent).toBe("Up to 4.00% APY");

  nowMs += SAVINGS_RATE_FRESHNESS_MS;
  void act(() => jest.advanceTimersByTime(SAVINGS_RATE_FRESHNESS_MS));
  expect(stateAt(Date.now()).status).toBe("stale");
  expect(view.container.textContent).toBe("Up to 4.00% APY");
});


test("vault positions reuse a snapshot and invalidate when balances change", () => {
  jest.setSystemTime(Date.parse("2025-01-01T00:00:00.000Z"));
  const query = getHomeQueryClient();
  const snapshot = buildBalancesSnapshotFixture();
  const session = { user: { subject: "memo-savings" }, smartAccount: { address: snapshot.owner.address, chainId: 8453 as const }, accountProvider: "cdp-embedded" as const };
  const key = ownerQueryKey(dataOwnerKey(session), "balances", "US");
  query.setQueryData(key, snapshot);
  query.setQueryData(publicQueryKey("savings-vaults"), rates(Date.now(), 0.04));
  const stored = query.getQueryData<typeof snapshot>(key)!;
  const holdings = stored.holdings;
  let reads = 0;
  Object.defineProperty(stored, "holdings", { configurable: true, get: () => { reads++; return holdings; } });
  const currentWallet = { ...createBlockedAccountWalletClient("provider-unavailable"), status: "verified" as const,
    verification: "server" as const, session, fetchBalances: async () => snapshot };
  const surface = () => <AccountWalletClientProvider client={currentWallet as never}><RateLabel /></AccountWalletClientProvider>;
  const view = render(surface());
  const initial = reads;
  expect(initial).toBeGreaterThan(0);
  expect(view.container.textContent).toBe("Up to 4.00% APY");
  view.rerender(surface());
  expect(reads).toBe(initial);
  query.setQueryData(key, { ...snapshot, block: { ...snapshot.block, number: "999999" } });
  const replacement = query.getQueryData<typeof snapshot>(key)!;
  const replacementHoldings = replacement.holdings;
  let replacementReads = 0;
  Object.defineProperty(replacement, "holdings", { configurable: true, get: () => { replacementReads++; return replacementHoldings; } });
  view.rerender(surface());
  expect(replacementReads).toBeGreaterThan(0);
  expect(view.container.textContent).toBe("Up to 4.00% APY");
});

test("unknown owner holdings never become the advertised maximum rate", () => {
  jest.setSystemTime(Date.parse("2025-01-01T00:00:00.000Z"));
  const query = getHomeQueryClient();
  const snapshot = buildBalancesSnapshotFixture();
  const session = { user: { subject: "loading-savings" }, smartAccount: { address: snapshot.owner.address, chainId: 8453 as const }, accountProvider: "cdp-embedded" as const };
  query.setQueryData(publicQueryKey("savings-vaults"), rates(Date.now(), 0.04));
  const currentWallet: AccountWalletClient = { ...createBlockedAccountWalletClient("provider-unavailable"), status: "restoring" as const,
    verification: "provisional" as const, session, fetchBalances: async () => snapshot };
  function Surface() {
    const client = useMemo(() => currentWallet, []);
    return <AccountWalletContext.Provider value={client}><RateLabel /></AccountWalletContext.Provider>;
  }
  const view = render(<Surface />);
  expect(view.container.textContent).toBe("");
  query.setQueryData(ownerQueryKey(dataOwnerKey(session), "balances", "US"), snapshot);
  view.rerender(<Surface />);
  expect(view.container.textContent).toBe("Up to 4.00% APY");
});

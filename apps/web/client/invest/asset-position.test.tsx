import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import { investAssets, type InvestAsset } from "@/config/invest-assets";
import { AccountWalletClientProvider, createBlockedAccountWalletClient } from "@/client/account/cdp-client";
import { PresentationRegionProvider } from "@/client/invest/presentation-quote";
import { getHomeQueryClient } from "@/client/query/query-client";
import { balancesSnapshot } from "@/tests/browser/fixtures/balances";
import type { Holding } from "@/shared/balances/types";

const { cleanup, render, waitFor } = await import("@testing-library/react");
const { AssetPosition, findAssetHolding } = await import("./asset-position");
const bitcoin = investAssets.find((asset) => asset.id === "cbbtc")!;
const stock = investAssets.find((asset) => asset.id === "nvdac")!;
const owner = balancesSnapshot().owner.address;

function patch(update: (holding: Holding) => Holding) {
  const snapshot = balancesSnapshot();
  return { ...snapshot, holdings: snapshot.holdings.map(update) };
}

function show(asset: InvestAsset, fetchBalances: () => Promise<unknown>) {
  const client = {
    ...createBlockedAccountWalletClient("provider-unavailable"),
    status: "verified" as const,
    verification: "server" as const,
    session: {
      user: { subject: "asset-position-subject" },
      smartAccount: { address: owner, chainId: 8453 as const },
      accountProvider: "cdp-embedded" as const,
    },
    fetchBalances,
  };
  return render(<AccountWalletClientProvider client={client as never}>
    <PresentationRegionProvider regionId="US">
      <AssetPosition asset={asset} assetMarkResolution={{}} />
    </PresentationRegionProvider>
  </AccountWalletClientProvider>);
}

afterEach(() => { cleanup(); getHomeQueryClient().clear(); });

describe("AssetPosition", () => {
  test("renders nothing without a verified session", () => {
    const view = render(<AccountWalletClientProvider client={createBlockedAccountWalletClient("unconfigured")}>
      <PresentationRegionProvider regionId="US"><AssetPosition asset={bitcoin} assetMarkResolution={{}} /></PresentationRegionProvider>
    </AccountWalletClientProvider>);
    expect(view.queryByText("Your balance")).toBeNull();
  });

  test("renders nothing outside an account wallet provider", () => {
    const view = render(<PresentationRegionProvider regionId="US"><AssetPosition asset={bitcoin} assetMarkResolution={{}} /></PresentationRegionProvider>);
    expect(view.queryByText("Your balance")).toBeNull();
  });

  test("shows the held value and exact quantity for crypto", async () => {
    const view = show(bitcoin, async () => patch((holding) => holding.id === "cbbtc" ? {
      ...holding, balance: { status: "ready", baseUnits: "1234000" },
      value: { status: "priced", currency: "USD", amount: { atoms: "151030", scale: 2 }, asOf: new Date().toISOString() },
    } : holding));
    await waitFor(() => expect(view.getByText("Your balance")).toBeTruthy());
    expect(view.getByText("$1,510.30")).toBeTruthy();
    expect(view.getByText(/0\.01234 cbBTC/)).toBeTruthy();
  });

  test("shows no row when the asset is not held", async () => {
    let loaded = false;
    const view = show(bitcoin, async () => {
      loaded = true;
      return patch((holding) => holding.id === "cbbtc" ? { ...holding, balance: { status: "ready", baseUnits: "0" } } : holding);
    });
    await waitFor(() => expect(loaded).toBe(true));
    await waitFor(() => expect(view.queryByRole("list", { name: "Your balance" })).toBeNull());
    expect(view.queryByText("Your balance")).toBeNull();
  });

  test("a failed balances read is shown as unavailable, never as zero", async () => {
    const view = show(bitcoin, async () => { throw new Error("synthetic balances failure"); });
    await waitFor(() => expect(view.getByText("Balance unavailable")).toBeTruthy(), { timeout: 2000 });
    expect(view.queryByText("$0.00")).toBeNull();
  });

  test("an absent dynamic meme is unavailable, not unheld, while wallet inventory is incomplete", async () => {
    const degen = investAssets.find((asset) => asset.id === "degen")!;
    const meme = { ...degen, id: "dynamic-meme", contractAddress: "0x00000000000000000000000000000000000000aa" as const };
    for (const catalog of ["incomplete", "unavailable"] as const) {
      const view = show(meme, async () => ({ ...balancesSnapshot(), coverage: { registry: "complete", catalog } }));
      await waitFor(() => expect(view.getByText("Balance unavailable")).toBeTruthy());
      cleanup();
      getHomeQueryClient().clear();
    }
    let loaded = false;
    const view = show(meme, async () => { loaded = true; return { ...balancesSnapshot(), coverage: { registry: "complete", catalog: "complete" } }; });
    await waitFor(() => expect(loaded).toBe(true));
    await waitFor(() => expect(view.queryByText("Your balance")).toBeNull());
  });

  const priced = { status: "priced", currency: "USD", amount: { atoms: "17960", scale: 2 }, asOf: "2026-09-25T20:00:00.000Z" } as const;
  const stockCases: Array<{ name: string; value: Holding["value"]; shown: string; context: string | null }> = [
    { name: "open reference", value: { ...priced, reference: { kind: "tokenized-equity", session: "open" } }, shown: "$179.60", context: null },
    { name: "closed reference", value: { ...priced, reference: { kind: "tokenized-equity", session: "closed" } }, shown: "$179.60", context: "Last close" },
    { name: "paused", value: { status: "unpriced", reason: "price-paused" }, shown: "—", context: "Paused" },
    { name: "stale", value: { status: "unpriced", reason: "price-stale" }, shown: "—", context: "Price delayed" },
    { name: "unavailable", value: { status: "unpriced", reason: "price-unavailable" }, shown: "—", context: "Value unavailable" },
    { name: "removed", value: { status: "unpriced", reason: "asset-removed" }, shown: "—", context: "No longer listed" },
  ];

  for (const { name, value, shown, context } of stockCases) {
    test(`a held stock with a ${name} value shows ${shown} ${context ?? "without context"}`, async () => {
      const view = show(stock, async () => patch((holding) => holding.id === "nvdac" ? {
        ...holding, balance: { status: "ready", baseUnits: "1".padEnd(holding.decimals + 1, "0") }, value,
      } : holding));
      await waitFor(() => expect(view.getByText(shown)).toBeTruthy());
      for (const label of ["Last close", "Paused", "Price delayed", "Value unavailable", "No longer listed"]) {
        if (label === context) expect(view.getByText(label)).toBeTruthy();
        else expect(view.queryByText(label)).toBeNull();
      }
      if (shown === "—") expect(view.queryByText("$179.60")).toBeNull();
    });
  }
});

describe("findAssetHolding", () => {
  test("matches the asset contract case-insensitively", () => {
    const holdings = balancesSnapshot().holdings;
    const upper = { ...bitcoin, contractAddress: bitcoin.contractAddress.toUpperCase().replace("0X", "0x") as `0x${string}` };
    expect(findAssetHolding(holdings, upper)?.id).toBe("cbbtc");
  });
});

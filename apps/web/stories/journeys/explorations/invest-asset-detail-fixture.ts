import { createBlockedAccountWalletClient, type AccountWalletClient } from "@/client/account/cdp-client";
import { investAssets } from "@/config/invest-assets";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { MarketDataState } from "@/shared/invest/invest-market";
import { balancesSnapshot } from "@/tests/browser/fixtures/balances";

export const assetDetailTime = "2026-09-28T12:00:00.000Z";
const bitcoin = investAssets.find((item) => item.id === "cbbtc");
if (!bitcoin) throw new Error("Missing Bitcoin fixture asset");
export const assetDetailAsset = bitcoin;
export const assetDetailMarket: MarketDataState = {
  status: "ready",
  snapshots: [{ assetId: bitcoin.id, displayPrice: "$122391.18", asOf: assetDetailTime, sourceLabel: "Codex", changeLabel: "+4.1%" }],
};
const session: VerifiedAccountSession = {
  user: { subject: "synthetic-invest-journey" },
  smartAccount: { address: "0x1111111111111111111111111111111111111111", chainId: 8453 },
  accountProvider: "cdp-embedded",
};

export function createAssetDetailClient(): AccountWalletClient {
  return {
    ...createBlockedAccountWalletClient("unconfigured"),
    status: "verified",
    verification: "server",
    session,
    fetchBalances: async () => {
      const snapshot = balancesSnapshot("US");
      return { ...snapshot, holdings: snapshot.holdings.map((holding) => holding.id === assetDetailAsset.id
        ? { ...holding, balance: { status: "ready", baseUnits: "1234000" },
          value: { status: "priced", currency: "USD", amount: { atoms: "151030", scale: 2 }, asOf: assetDetailTime } }
        : holding) };
    },
  };
}

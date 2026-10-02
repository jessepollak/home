import { describe, expect, test } from "bun:test";
import { BASE_USDC_ADDRESS, MORPHO_V1_CANDIDATE_ADDRESSES } from "@/shared/savings/config";
import type { MorphoVaultCandidate, MorphoVaultsResult } from "@/shared/savings/types";
import { resolveProductOffering } from "@/shared/operator-settings/products";
import { savingsManagement, savingsRateLabel } from "./savings-management";

const fetchedAt = "2026-09-10T12:00:00.000Z";
const nowMs = Date.parse("2026-09-10T12:04:00.000Z");
const asset = { address: BASE_USDC_ADDRESS, symbol: "USDC", decimals: 6 } as const;
const source = { provider: "Morpho GraphQL", endpoint: "https://api.morpho.org/graphql", query: "vaults", fetchedAt } as const;
const candidate: MorphoVaultCandidate = {
  version: "v1",
  vaultAddress: MORPHO_V1_CANDIDATE_ADDRESSES[0],
  name: "Test vault",
  symbol: "USDC vault",
  listed: true,
  chainId: 8453,
  asset,
  curatorAddress: null,
  grossApy: 0.055,
  netApy: 0.055,
  feeRate: 0,
  totalAssetsRaw: "1",
  liquidityRaw: "1",
  stateAsOf: fetchedAt,
  blockNumber: "1",
  source,
};
const metadata: MorphoVaultsResult = {
  version: "v1",
  chainId: 8453,
  asset,
  candidates: [candidate],
  source,
  stale: false,
};

describe("savings rate label", () => {
  test("formats available APY for the presentation region", () => {
    expect(savingsRateLabel(candidate, metadata, nowMs, "DE")).toBe("5,50\u00a0% APY");
    expect(savingsRateLabel(candidate, metadata, nowMs, "GLOBAL")).toBe("5.50% APY");
  });

  test("keeps unavailable rates unavailable regardless of region", () => {
    expect(savingsRateLabel(null, metadata, nowMs, "DE")).toBe("Rate unavailable");
    expect(savingsRateLabel(candidate, null, nowMs, "DE")).toBe("Rate unavailable");
  });
});

describe("savings performance fee", () => {
  const fee = (feeRate: number, regionId: "GLOBAL" | "DE" | "TR") => savingsManagement({
    address: candidate.vaultAddress,
    snapshot: null,
    metadata: { ...metadata, candidates: [{ ...candidate, feeRate }] },
    nowMs,
    regionId,
    actionsAvailable: true,
    usdcBaseUnits: null,
    usdcUnavailable: false,
    offering: resolveProductOffering({ kind: "deployment" }),
  }).details.find(([label]) => label === "Performance fee")?.[1];

  test("formats the fee like the savings rate for the presentation region", () => {
    expect(fee(0.1, "GLOBAL")).toBe("10.00%");
    expect(fee(0.1, "DE")).toBe("10,00\u00a0%");
    expect(fee(0.1, "TR")).toBe("%10,00");
    expect(fee(0.055, "DE")).toBe(savingsRateLabel(candidate, metadata, nowMs, "DE").replace(" APY", ""));
  });

  test("keeps a small charged fee visible", () => {
    expect(fee(0.00004, "GLOBAL")).toBe("0.004%");
    expect(fee(0.00004, "DE")).toBe("0,004\u00a0%");
    expect(fee(0.00004, "TR")).toBe("%0,004");
  });

  test("shows an invalid negative fee as unavailable", () => {
    expect(fee(-0.1, "DE")).toBe("—");
  });

  test("formats a zero fee through the locale-aware percent", () => {
    expect(fee(0, "GLOBAL")).toBe("0%");
    expect(fee(0, "DE")).toBe("0\u00a0%");
    expect(fee(0, "TR")).toBe("%0");
  });
});

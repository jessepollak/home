import { describe, expect, test } from "bun:test";
import { summarizeSavingsPortfolio } from "@/client/savings/portfolio-summary";
import { buildBalancesSnapshotFixture } from "@/shared/balances/fixtures";
import { selectVaultPositions } from "@/shared/balances/select";
import { BASE_USDC_ADDRESS, MORPHO_V1_CANDIDATE_ADDRESSES } from "@/shared/savings/config";
import { verifiedEmptySavings } from "./verified-empty-savings";

const snapshot = buildBalancesSnapshotFixture();
const summary = summarizeSavingsPortfolio({
  supportedVaultAddresses: MORPHO_V1_CANDIDATE_ADDRESSES,
  requiredAsset: { address: BASE_USDC_ADDRESS, symbol: "USDC", decimals: 6 },
  candidates: [], positions: selectVaultPositions(snapshot),
});
const complete = { balanceStatus: "ready" as const, snapshot, balanceStale: false, vaultStatus: "ready" as const, summary, shownCount: 0 };

describe("verified empty savings", () => {
  test("requires a complete ready snapshot and portfolio with no shown vaults", () => {
    expect(verifiedEmptySavings(complete)).toBe(true);
    for (const changed of [
      { balanceStatus: "loading" as const }, { balanceStatus: "failed" as const },
      { snapshot: null }, { snapshot: { ...snapshot, stale: true as const } },
      { balanceStale: true }, { snapshot: { ...snapshot, coverage: { ...snapshot.coverage, registry: "partial" as const } } },
      { vaultStatus: "loading" as const }, { vaultStatus: "failed" as const },
      { summary: null }, { summary: { ...summary, balance: { status: "unavailable" as const, asset: null, totalBaseUnits: null, reason: "positions-incomplete" as const } } },
      { summary: { ...summary, funded: true } }, { shownCount: 1 },
    ]) expect(verifiedEmptySavings({ ...complete, ...changed })).toBe(false);
  });
});

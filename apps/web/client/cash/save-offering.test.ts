import { describe, expect, test } from "bun:test";
import { deploymentProductSettings, resolveProductOffering } from "@/shared/operator-settings/products";
import { BASE_USDC_ADDRESS, VERIFIED_SAVE_VAULTS } from "@/shared/savings/config";
import type { MorphoVaultCandidate } from "@/shared/savings/types";
import { depositOffered, saveEntryOffered } from "./save-offering";

const settings = deploymentProductSettings();
const allReducing = resolveProductOffering({
  kind: "saved",
  value: { ...settings, vaults: Object.fromEntries(Object.keys(settings.vaults).map((id) => [id, "reducing-only"])) },
});
const deployment = resolveProductOffering({ kind: "deployment" });
const asset = { address: BASE_USDC_ADDRESS, symbol: "USDC", decimals: 6 } as const;
const candidate: MorphoVaultCandidate = {
  version: "v1", vaultAddress: VERIFIED_SAVE_VAULTS[0].address, name: "Vault", symbol: "USDC vault", listed: true,
  chainId: 8453, asset, curatorAddress: null, grossApy: null, netApy: null, feeRate: null,
  totalAssetsRaw: "1", liquidityRaw: "1", stateAsOf: null, blockNumber: "1",
  source: { provider: "Morpho GraphQL", endpoint: "https://api.morpho.org/graphql", query: "vaults", fetchedAt: "2026-09-10T12:00:00.000Z" },
};

describe("save entry offering", () => {
  test("unknown vault metadata keeps the entry while an offered vault exists", () => {
    expect(saveEntryOffered(deployment, null)).toBe(true);
    expect(saveEntryOffered(deployment, [])).toBe(true);
  });

  test("unknown vault metadata hides the entry when every vault is reducing-only", () => {
    expect(saveEntryOffered(allReducing, null)).toBe(false);
    expect(saveEntryOffered(allReducing, [candidate])).toBe(false);
    expect(depositOffered(allReducing, candidate)).toBe(false);
  });

  test("exit-only Save offers no entry", () => {
    const exitOnly = resolveProductOffering({ kind: "saved", value: { ...settings, products: { ...settings.products, save: "exit-only" } } });
    expect(saveEntryOffered(exitOnly, null)).toBe(false);
    expect(depositOffered(exitOnly, candidate)).toBe(false);
  });
});

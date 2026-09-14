import { describe, expect, test } from "bun:test";
import { BASE_MORPHO_USDC_VAULTS } from "@/shared/assets/base";
import { MORPHO_BLUE_ADDRESS } from "@/shared/morpho-markets/config";
import {
  MORPHO_V1_CANDIDATE_ADDRESSES,
  VERIFIED_SAVE_VAULTS,
  getVerifiedSaveVault,
  isConfiguredMorphoVault,
  isSaveActionAllowed,
} from "./config";

describe("verified Save vault registry", () => {
  test("contains only the existing ordered Base MetaMorpho vaults", () => {
    expect(VERIFIED_SAVE_VAULTS.map(({ address }) => address)).toEqual(
      BASE_MORPHO_USDC_VAULTS.map(({ address }) => address),
    );
    expect(MORPHO_V1_CANDIDATE_ADDRESSES).toEqual(
      BASE_MORPHO_USDC_VAULTS.map(({ address }) => address),
    );
    expect(VERIFIED_SAVE_VAULTS.every(
      (vault, index) =>
        vault.rank === index + 1 &&
        vault.capabilities.save === "enabled" &&
        !("marketId" in vault) &&
        !("morpho" in vault),
    )).toBe(true);
    expect(getVerifiedSaveVault(MORPHO_BLUE_ADDRESS)).toBeNull();
  });

  test("keeps compatibility lookup behavior case-insensitive", () => {
    const configured = BASE_MORPHO_USDC_VAULTS[0].address;
    expect(isConfiguredMorphoVault(configured.toUpperCase())).toBe(true);
    expect(getVerifiedSaveVault(configured.toUpperCase())?.address).toBe(configured);
    expect(isConfiguredMorphoVault("0x1111111111111111111111111111111111111111")).toBe(false);
    expect(getVerifiedSaveVault("0x1111111111111111111111111111111111111111")).toBeNull();
  });

  test("fails closed for omitted capabilities and permits reducing-only withdrawals", () => {
    expect(isSaveActionAllowed(undefined, "deposit")).toBe(false);
    expect(isSaveActionAllowed(undefined, "withdraw")).toBe(false);
    expect(isSaveActionAllowed("reducing-only", "deposit")).toBe(false);
    expect(isSaveActionAllowed("reducing-only", "withdraw")).toBe(true);
    expect(isSaveActionAllowed("enabled", "deposit")).toBe(true);
    expect(isSaveActionAllowed("enabled", "withdraw")).toBe(true);
  });
});

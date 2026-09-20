import { describe, expect, test } from "bun:test";
import { formatPresentationFiat } from "@/shared/formatting";
import {
  applyReferenceDeposit,
  presentReferencePosition,
  referenceVaultInitials,
} from "./reference-position";
import {
  referenceDebtPosition,
  referenceEmptyPosition,
  referenceFundedPosition,
  referenceFundedPositions,
  referenceLoadingPosition,
  referenceLocalCashPosition,
  referenceLongContentPosition,
  referencePosition,
  referenceUnavailableCashPosition,
  referenceUnavailableDebtPosition,
  referenceUnavailableSavedPosition,
  referenceVaultMetadata,
  referencePrepareMoneyAction,
  referenceSharePreviewBaseUnits,
  REFERENCE_ACCOUNT,
} from "./reference-fixtures";

describe("presentReferencePosition", () => {
  test("presents the funded fixture as a 1,250.00 net position with zero debt omitted", () => {
    const view = presentReferencePosition(referenceFundedPosition);

    expect(view.status).toBe("ready");
    expect(view.netPositionLabel).toBe("$1,250.00");
    expect(view.assetsLabel).toBe("$1,250.00");
    expect(view.debtStatus).toBe("omitted");
    expect(view.debtLabel).toBeNull();
    expect(view.availableLabel).toBe("$250.00");
    expect(view.statusNote).toBeNull();
    expect(view.cash.rows).toHaveLength(1);
    expect(view.cash.rows[0]!.primary).toBe("$250.00");
    expect(view.saved.totalLabel).toBe("$1,000.00");
    expect(view.saved.apyLabel).toBe("4.04% APY");
    expect(view.saved.apyValueLabel).toBe("4.04%");
    expect(view.saved.funded).toBe(true);
  });

  test("keeps Gauntlet first, and discloses per-vault amounts, rates, fees, and curator", () => {
    const view = presentReferencePosition(referenceFundedPosition);
    const [gauntlet, steakhouse, re7] = view.saved.vaults;

    expect(gauntlet!.name).toBe("Gauntlet USDC Prime");
    expect(gauntlet!.amountLabel).toBe("$750.00");
    expect(gauntlet!.apyLabel).toBe("4.10% APY");
    expect(gauntlet!.feeLabel).toBe("10.00%");
    expect(gauntlet!.curatorLabel).toBe("0x1234…345678");
    expect(gauntlet!.funded).toBe(true);
    expect(steakhouse!.name).toBe("Steakhouse USDC");
    expect(steakhouse!.amountLabel).toBe("$250.00");
    expect(steakhouse!.apyLabel).toBe("3.85% APY");
    expect(steakhouse!.curatorLabel).toBe("—");
    expect(re7!.funded).toBe(false);
    expect(re7!.amountLabel).toBe("$0.00");
    expect(referenceVaultInitials(gauntlet!.name)).toBe("GU");
  });

  test("shows positive debt as a supporting fact and subtracts it from net position", () => {
    const view = presentReferencePosition(referenceDebtPosition);

    expect(view.status).toBe("ready");
    expect(view.debtStatus).toBe("shown");
    expect(view.debtLabel).toBe("−$500.00");
    expect(view.assetsLabel).toBe("$1,250.00");
    expect(view.netPositionLabel).toBe("$750.00");
  });

  test("never renders an unavailable debt as zero", () => {
    const view = presentReferencePosition(referenceUnavailableDebtPosition);

    expect(view.debtStatus).toBe("unavailable");
    expect(view.debtLabel).toBeNull();
    expect(view.netPositionLabel).toBeNull();
    expect(view.assetsLabel).toBe("$1,250.00");
    expect(view.statusNote).toContain("Debt unavailable");
    expect(view.status).toBe("unavailable");
  });

  test("names an unavailable cash slice and does not present a complete total", () => {
    const view = presentReferencePosition(referenceUnavailableCashPosition);

    expect(view.cash.status).toBe("unavailable");
    expect(view.cash.rows).toEqual([]);
    expect(view.cash.subtotalLabel).toBeNull();
    expect(view.netPositionLabel).toBeNull();
    expect(view.availableLabel).toBeNull();
    expect(view.statusNote).toBe("Cash balance unavailable");
    expect(view.status).toBe("unavailable");
  });

  test("names an unavailable saved slice while keeping cash visible", () => {
    const view = presentReferencePosition(referenceUnavailableSavedPosition);

    expect(view.saved.status).toBe("unavailable");
    expect(view.saved.totalLabel).toBeNull();
    expect(view.saved.vaults).toEqual([]);
    expect(view.cash.rows[0]!.primary).toBe("$250.00");
    expect(view.netPositionLabel).toBeNull();
    expect(view.statusNote).toBe("Saved balance unavailable");
  });

  test("presents loading without any amount", () => {
    const view = presentReferencePosition(referenceLoadingPosition);

    expect(view.status).toBe("loading");
    expect(view.netPositionLabel).toBeNull();
    expect(view.assetsLabel).toBeNull();
    expect(view.cash.rows).toEqual([]);
    expect(view.saved.vaults).toEqual([]);
  });

  test("leads an empty position with a zero total and no fabricated rate", () => {
    const view = presentReferencePosition(referenceEmptyPosition);

    expect(view.status).toBe("ready");
    expect(view.netPositionLabel).toBe("$0.00");
    expect(view.saved.status).toBe("empty");
    expect(view.saved.funded).toBe(false);
    expect(view.saved.totalLabel).toBe("$0.00");
    expect(view.saved.apyLabel).toBeNull();
    expect(view.saved.vaults.every((vault) => !vault.funded)).toBe(true);
  });

  test("renders local cash through the shared formatter and marks the total partial", () => {
    const view = presentReferencePosition(referenceLocalCashPosition);
    const localRow = view.cash.rows[1]!;

    expect(view.status).toBe("partial");
    expect(view.netPositionLabel).toBe("$1,250.00");
    expect(view.statusNote).toBe("IDR balance not included until a display quote is configured");
    expect(localRow.name).toBe("Indonesian rupiah");
    expect(localRow.primary).toBe(
      formatPresentationFiat({ atoms: "12345678901234", scale: 2 }, "IDR", 2, "US"),
    );
    expect(localRow.primary).toContain("123");
  });

  test("keeps large values and long labels formatted by the shared money path", () => {
    const view = presentReferencePosition(referenceLongContentPosition);

    expect(view.status).toBe("ready");
    expect(view.netPositionLabel).toBe("$12,345,678.99");
    expect(view.cash.rows[0]!.primary).toBe("$1,234,567.89");
    expect(view.saved.vaults[0]!.name).toBe(
      "Gauntlet Diversified Onchain Treasury Savings Strategy Prime",
    );
    expect(view.saved.totalLabel).toBe("$11,111,111.10");
  });
});

describe("applyReferenceDeposit", () => {
  test("moves the exact deposit from cash into the selected vault without changing net position", () => {
    const before = presentReferencePosition(referenceFundedPosition);
    const next = applyReferenceDeposit(referenceFundedPosition, {
      vaultAddress: referenceFundedPositions[1]!.vaultAddress,
      amountBaseUnits: "25000000",
    });
    const after = presentReferencePosition(next);

    expect(before.netPositionLabel).toBe("$1,250.00");
    expect(after.netPositionLabel).toBe("$1,250.00");
    expect(after.assetsLabel).toBe("$1,250.00");
    expect(after.cash.rows[0]!.primary).toBe("$225.00");
    expect(after.availableLabel).toBe("$225.00");
    expect(after.saved.totalLabel).toBe("$1,025.00");
    expect(after.saved.vaults[0]!.amountLabel).toBe("$775.00");
    expect(after.saved.vaults[1]!.amountLabel).toBe("$250.00");
    expect(after.saved.apyLabel).toBe("4.04% APY");
  });

  test("rejects a deposit larger than the fixture cash", () => {
    expect(() => applyReferenceDeposit(referenceFundedPosition, {
      vaultAddress: referenceFundedPositions[1]!.vaultAddress,
      amountBaseUnits: "250000001",
    })).toThrow("cannot exceed");
  });

  test("rejects a non-positive amount and an unknown vault", () => {
    expect(() => applyReferenceDeposit(referenceFundedPosition, {
      vaultAddress: referenceFundedPositions[1]!.vaultAddress,
      amountBaseUnits: "0",
    })).toThrow("positive USDC amount");
    expect(() => applyReferenceDeposit(referenceFundedPosition, {
      vaultAddress: REFERENCE_ACCOUNT,
      amountBaseUnits: "1000000",
    })).toThrow("known vault position");
  });

  test("rejects a deposit when a fixture slice is unavailable", () => {
    expect(() => applyReferenceDeposit(referenceUnavailableCashPosition, {
      vaultAddress: referenceFundedPositions[1]!.vaultAddress,
      amountBaseUnits: "1000000",
    })).toThrow("no available cash slice");
    expect(() => applyReferenceDeposit(referencePosition({
      saved: { status: "unavailable" },
    }), {
      vaultAddress: referenceFundedPositions[1]!.vaultAddress,
      amountBaseUnits: "1000000",
    })).toThrow("no available saved slice");
  });

  test("scales the 6-decimal USDC amount into 18-decimal share preview units", () => {
    expect(referenceSharePreviewBaseUnits("25000000")).toBe("25000000000000000000");
    expect(referenceSharePreviewBaseUnits("1")).toBe("1000000000000");
  });

  test("prepares the selected vault with its own discovery APY", async () => {
    const prepare = referencePrepareMoneyAction(referenceVaultMetadata);
    const steakhouse = referenceVaultMetadata.candidates[0]!;
    const action = await prepare("savings-deposit", {
      vaultAddress: steakhouse.vaultAddress,
      amountBaseUnits: "25000000",
    });
    if (!action.metadata || action.metadata.product !== "savings") {
      throw new Error("Expected savings metadata.");
    }
    expect(action.metadata.vaultName).toBe("Steakhouse USDC");
    expect(action.metadata.discoveryRate.netApy).toBe("0.0385");
  });

  test("uses the fixture metadata for a two-vault account", () => {
    expect(referenceVaultMetadata.candidates).toHaveLength(3);
    const view = presentReferencePosition(referencePosition({
      saved: {
        status: "available",
        metadata: referenceVaultMetadata,
        positions: referenceFundedPositions,
      },
    }));
    expect(view.saved.vaults.filter((vault) => vault.funded)).toHaveLength(2);
  });
});

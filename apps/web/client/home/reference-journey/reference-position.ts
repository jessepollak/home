import type { FiatCurrencyCode, RegionId } from "@/config/regions";
import {
  formatExactSavingsApy,
  getSavingsRateState,
  summarizeSavingsPortfolio,
  type SavingsPortfolioPosition,
} from "@/client/savings/portfolio-summary";
import { preferredSavingsCandidates } from "@/client/savings/format";
import {
  formatAddress,
  formatPresentationFiat,
  formatPresentationPercentage,
  formatUsdStablecoinAmount,
  presentationCurrencyName,
} from "@/shared/formatting";
import {
  BASE_USDC_ADDRESS,
  BASE_USDC_DECIMALS,
  MORPHO_V1_CANDIDATE_ADDRESSES,
} from "@/shared/savings/config";
import type { MorphoVaultsResult } from "@/shared/savings/types";
import type { BalanceRowModel } from "@/shared/balances/present";

/**
 * Reference-journey presentation model for [issue #654](https://github.com/jessepollak/home/issues/654).
 *
 * This module is production-intended presentation source, not the live Home data path.
 * It derives a net position, supporting facts, and ledger rows from explicit fixture
 * slices so the reference composition can distinguish complete, partial, zero-debt, and
 * unavailable states. A slice is either a verified amount, unavailable, or still loading,
 * and an incomplete total never renders as a complete one.
 *
 * The model follows [#634's selected Net position contract](https://github.com/jessepollak/home/issues/634):
 * net position is the headline, assets remain a supporting fact, positive or unavailable
 * debt stays visible, and verified zero debt is omitted. Production `displayTotal`
 * ("Total balance") is unchanged; adoption belongs to the follow-up implementation leaf.
 */

export type ReferenceAmountSlice =
  | { status: "loading" }
  | { status: "available"; baseUnits: string }
  | { status: "unavailable" };

export type ReferenceSavedSlice =
  | { status: "loading" }
  | { status: "unavailable" }
  | {
      status: "available";
      metadata: MorphoVaultsResult;
      positions: readonly SavingsPortfolioPosition[];
    };

export type ReferenceDebtSlice =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "verified"; baseUnits: string };

/**
 * Local cash held in a currency without a configured display quote. Production shows the
 * holding while the total stays partial, so the reference renders the row and names the
 * missing slice instead of dropping it or inventing a conversion rate.
 */
export type ReferenceLocalCash = {
  key: string;
  name: string;
  currency: FiatCurrencyCode;
  atoms: string;
  scale: number;
};

export type ReferenceMoneyPosition = {
  status: "loading" | "ready";
  cash: ReferenceAmountSlice;
  saved: ReferenceSavedSlice;
  debt: ReferenceDebtSlice;
  localCash?: readonly ReferenceLocalCash[];
  nowMs: number;
  regionId?: RegionId;
};

export type ReferenceVaultView = {
  vaultAddress: string;
  name: string;
  initials: string;
  amountLabel: string;
  apyLabel: string;
  apyAvailable: boolean;
  feeLabel: string;
  curatorLabel: string;
  funded: boolean;
};

export type ReferencePositionView = {
  status: "loading" | "ready" | "partial" | "unavailable";
  netPositionLabel: string | null;
  assetsLabel: string | null;
  debtLabel: string | null;
  debtStatus: "omitted" | "shown" | "unavailable" | "loading";
  availableLabel: string | null;
  statusNote: string | null;
  cash: {
    status: "loading" | "available" | "unavailable";
    subtotalLabel: string | null;
    rows: readonly BalanceRowModel[];
  };
  saved: {
    status: "loading" | "empty" | "available" | "unavailable";
    funded: boolean;
    totalLabel: string | null;
    /** Combined weighted APY with its unit, for ledger and tile captions. */
    apyLabel: string | null;
    /** The bare combined rate, matching the existing `Earning ~x%` hero caption. */
    apyValueLabel: string | null;
    vaults: readonly ReferenceVaultView[];
  };
};

const USDC_SCALE = BASE_USDC_DECIMALS;
const USDC = { address: BASE_USDC_ADDRESS, symbol: "USDC", decimals: BASE_USDC_DECIMALS } as const;

export function presentReferencePosition(
  position: ReferenceMoneyPosition,
): ReferencePositionView {
  if (position.status === "loading") {
    return {
      status: "loading",
      netPositionLabel: null,
      assetsLabel: null,
      debtLabel: null,
      debtStatus: "loading",
      availableLabel: null,
      statusNote: null,
      cash: { status: "loading", subtotalLabel: null, rows: [] },
      saved: {
        status: "loading",
        funded: false,
        totalLabel: null,
        apyLabel: null,
        apyValueLabel: null,
        vaults: [],
      },
    };
  }

  const regionId = position.regionId;
  const cashBaseUnits = position.cash.status === "available" ? position.cash.baseUnits : null;
  const rows: BalanceRowModel[] = [];
  if (cashBaseUnits !== null) {
    rows.push({
      key: "reference-cash-usd",
      group: "cash",
      name: presentationCurrencyName("USD"),
      mark: { kind: "flag", currency: "USD" },
      primary: formatUsdStablecoinAmount(cashBaseUnits, USDC_SCALE, regionId),
      secondary: null,
      tone: "default",
    });
  }
  for (const local of position.localCash ?? []) {
    rows.push({
      key: local.key,
      group: "cash",
      name: local.name,
      mark: { kind: "flag", currency: local.currency },
      primary: formatPresentationFiat(
        { atoms: local.atoms, scale: local.scale },
        local.currency,
        2,
        regionId,
      ),
      secondary: null,
      tone: "default",
    });
  }

  const savedView = presentSaved(position.saved, position.nowMs, regionId);
  const localCashNote = position.localCash?.length
    ? `${position.localCash.map((entry) => entry.currency).join(" and ")} ${position.localCash.length === 1 ? "balance" : "balances"} not included until a display quote is configured`
    : null;

  const missing: string[] = [];
  if (position.cash.status === "unavailable") missing.push("Cash balance unavailable");
  if (position.cash.status === "loading") missing.push("Cash balance loading");
  if (savedView.status === "unavailable") missing.push("Saved balance unavailable");
  if (savedView.status === "loading") missing.push("Saved balance loading");
  if (position.debt.status === "unavailable") missing.push("Debt unavailable");
  if (position.debt.status === "loading") missing.push("Debt loading");
  if (localCashNote) missing.push(localCashNote);

  const cashSubtotalLabel = cashBaseUnits === null ? null : formatUsdStablecoinAmount(cashBaseUnits, USDC_SCALE, regionId);
  const assetsComplete =
    cashBaseUnits !== null &&
    savedView.totalBaseUnits !== null &&
    position.debt.status !== "loading";
  const assetsAtoms = assetsComplete
    ? BigInt(cashBaseUnits!) + BigInt(savedView.totalBaseUnits!)
    : null;
  const debtVerified = position.debt.status === "verified" ? BigInt(position.debt.baseUnits) : null;
  const netAtoms = assetsAtoms !== null && debtVerified !== null ? assetsAtoms - debtVerified : null;
  const netPositionLabel = netAtoms === null
    ? null
    : formatPresentationFiat({ atoms: netAtoms.toString(), scale: USDC_SCALE }, "USD", 2, regionId);
  const assetsLabel = assetsAtoms === null
    ? null
    : formatPresentationFiat({ atoms: assetsAtoms.toString(), scale: USDC_SCALE }, "USD", 2, regionId);

  const debtStatus: ReferencePositionView["debtStatus"] = position.debt.status === "unavailable"
    ? "unavailable"
    : position.debt.status === "loading"
      ? "loading"
      : debtVerified !== null && debtVerified !== BigInt(0)
        ? "shown"
        : "omitted";
  const debtLabel = debtStatus === "shown"
    ? formatPresentationFiat(
        { atoms: `-${debtVerified!.toString()}`, scale: USDC_SCALE },
        "USD",
        2,
        regionId,
      )
    : null;

  const status: ReferencePositionView["status"] = missing.length === 0
    ? "ready"
    : netPositionLabel === null
      ? "unavailable"
      : "partial";

  return {
    status,
    netPositionLabel,
    assetsLabel,
    debtLabel,
    debtStatus,
    availableLabel: cashSubtotalLabel,
    statusNote: missing.length > 0 ? missing.join(" · ") : null,
    cash: {
      status: position.cash.status,
      subtotalLabel: cashSubtotalLabel,
      rows,
    },
    saved: {
      status: savedView.status,
      funded: savedView.funded,
      totalLabel: savedView.totalLabel,
      apyLabel: savedView.apyLabel,
      apyValueLabel: savedView.apyValueLabel,
      vaults: savedView.vaults,
    },
  };
}

function presentSaved(
  saved: ReferenceSavedSlice,
  nowMs: number,
  regionId: RegionId | undefined,
): {
  status: "loading" | "empty" | "available" | "unavailable";
  funded: boolean;
  totalLabel: string | null;
  totalBaseUnits: string | null;
  apyLabel: string | null;
  apyValueLabel: string | null;
  vaults: readonly ReferenceVaultView[];
} {
  if (saved.status === "loading") {
    return {
      status: "loading",
      funded: false,
      totalLabel: null,
      totalBaseUnits: null,
      apyLabel: null,
      apyValueLabel: null,
      vaults: [],
    };
  }
  if (saved.status === "unavailable") {
    return {
      status: "unavailable",
      funded: false,
      totalLabel: null,
      totalBaseUnits: null,
      apyLabel: null,
      apyValueLabel: null,
      vaults: [],
    };
  }

  const summary = summarizeSavingsPortfolio({
    supportedVaultAddresses: MORPHO_V1_CANDIDATE_ADDRESSES,
    requiredAsset: USDC,
    candidates: saved.metadata.candidates,
    positions: saved.positions,
    metadataFetchedAt: saved.metadata.source.fetchedAt,
    metadataStale: saved.metadata.stale,
    nowMs,
  });

  if (summary.balance.status !== "available") {
    return {
      status: "unavailable",
      funded: false,
      totalLabel: null,
      totalBaseUnits: null,
      apyLabel: null,
      apyValueLabel: null,
      vaults: [],
    };
  }

  const positionByAddress = new Map(
    saved.positions.map((entry) => [entry.vaultAddress.toLowerCase(), entry]),
  );
  const vaults = preferredSavingsCandidates(saved.metadata.candidates)
    .map((candidate): ReferenceVaultView => {
      const entry = positionByAddress.get(candidate.vaultAddress.toLowerCase());
      const baseUnits = entry?.position?.assetsRaw ?? null;
      const funded = baseUnits !== null && /^(?:0|[1-9][0-9]*)$/.test(baseUnits) && BigInt(baseUnits) > BigInt(0);
      const rate = getSavingsRateState(candidate, {
        metadataFetchedAt: saved.metadata.source.fetchedAt,
        metadataStale: saved.metadata.stale,
        nowMs,
      });
      return {
        vaultAddress: candidate.vaultAddress,
        name: candidate.name,
        initials: referenceVaultInitials(candidate.name),
        amountLabel: baseUnits === null
          ? "Unavailable"
          : formatUsdStablecoinAmount(baseUnits, USDC_SCALE, regionId),
        apyLabel: rate.status === "available"
          ? `${formatPresentationPercentage(rate.value, regionId)} APY`
          : rate.status === "stale"
            ? "APY stale"
            : "APY unavailable",
        apyAvailable: rate.status === "available",
        feeLabel: formatPresentationPercentage(candidate.feeRate, regionId),
        curatorLabel: candidate.curatorAddress ? formatAddress(candidate.curatorAddress) : "—",
        funded,
      };
    });

  const combinedApy = summary.apy.status === "available"
    ? formatExactSavingsApy(summary.apy.value)
    : null;
  const apyLabel = combinedApy !== null
    ? `${combinedApy} APY`
    : summary.apy.status === "stale"
      ? "APY data stale"
      : summary.apy.status === "partial"
        ? "APY partially unavailable"
        : "APY unavailable";

  if (BigInt(summary.balance.totalBaseUnits) === BigInt(0)) {
    return {
      status: "empty",
      funded: false,
      totalLabel: formatUsdStablecoinAmount("0", USDC_SCALE, regionId),
      totalBaseUnits: "0",
      apyLabel: null,
      apyValueLabel: null,
      vaults,
    };
  }

  return {
    status: "available",
    funded: true,
    totalLabel: formatUsdStablecoinAmount(summary.balance.totalBaseUnits, USDC_SCALE, regionId),
    totalBaseUnits: summary.balance.totalBaseUnits,
    apyLabel,
    apyValueLabel: combinedApy,
    vaults,
  };
}

/** The fixture account only supports canonical-USDC savings, so the net stays USDC-scaled. */
export function applyReferenceDeposit(
  position: ReferenceMoneyPosition,
  deposit: { vaultAddress: string; amountBaseUnits: string },
): ReferenceMoneyPosition {
  if (position.cash.status !== "available") {
    throw new ReferenceFixtureError("The fixture has no available cash slice to move.");
  }
  if (position.saved.status !== "available") {
    throw new ReferenceFixtureError("The fixture has no available saved slice to move into.");
  }
  if (!/^(?:0|[1-9][0-9]*)$/.test(deposit.amountBaseUnits) || BigInt(deposit.amountBaseUnits) <= BigInt(0)) {
    throw new ReferenceFixtureError("A deposit fixture needs a positive USDC amount.");
  }
  const amount = BigInt(deposit.amountBaseUnits);
  if (amount > BigInt(position.cash.baseUnits)) {
    throw new ReferenceFixtureError("A fixture deposit cannot exceed its available cash.");
  }
  const target = position.saved.positions.find(
    (entry) => entry.vaultAddress.toLowerCase() === deposit.vaultAddress.toLowerCase(),
  );
  if (!target) {
    throw new ReferenceFixtureError("A fixture deposit needs a known vault position.");
  }
  return {
    ...position,
    cash: {
      status: "available",
      baseUnits: (BigInt(position.cash.baseUnits) - amount).toString(),
    },
    saved: {
      ...position.saved,
      positions: position.saved.positions.map((entry) =>
        entry.vaultAddress.toLowerCase() === deposit.vaultAddress.toLowerCase()
          ? {
              ...entry,
              position: {
                assetsRaw: (BigInt(entry.position?.assetsRaw ?? "0") + amount).toString(),
              },
            }
          : entry,
      ),
    },
  };
}

export function referenceVaultInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

class ReferenceFixtureError extends Error {}

import type { RegionId } from "@/config/regions";
import { formatFiatAmount } from "@/shared/formatting";

export type MoneyPositionKind =
  | "cash"
  | "saved"
  | "invested"
  | "collateral"
  | "card";

export type MoneyPositionSourceStatus = "ready" | "stale" | "unavailable";

export type MoneyPositionSlice = {
  id: string;
  kind: MoneyPositionKind;
  label: string;
  detail: string;
  amountMinor: string | null;
  status: MoneyPositionSourceStatus;
  unavailableReason?: string;
};

export type MoneyPositionDebt = {
  label: string;
  detail: string;
  amountMinor: string | null;
  status: MoneyPositionSourceStatus;
  unavailableReason?: string;
};

export type MoneyPositionInput = {
  currency: string;
  quoteCurrencyMinorUnitScale: number;
  regionId: RegionId;
  slices: readonly MoneyPositionSlice[];
  debt: MoneyPositionDebt;
};

export type MoneyPositionSummary = {
  knownAssetsMinor: bigint;
  assetsMinor: bigint | null;
  debtMinor: bigint | null;
  netPositionMinor: bigint | null;
  spendableMinor: bigint | null;
  missingLabels: readonly string[];
  staleLabels: readonly string[];
  status: "complete" | "stale" | "partial" | "unavailable";
};

export type MoneyPositionAmountSummary = {
  amountMinor: bigint | null;
  status: MoneyPositionSourceStatus;
};

export type BorrowPositionSummary = {
  collateral: MoneyPositionAmountSummary;
  debt: MoneyPositionAmountSummary;
  positionAfterDebt: MoneyPositionAmountSummary;
};

function readMinorUnits(value: string | null, label: string): bigint | null {
  if (value === null) return null;
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throw new TypeError(`${label} must use non-negative integer minor units.`);
  }
  return BigInt(value);
}

/**
 * Derives display-only totals from already reconciled slices. Each asset must
 * enter exactly one slice; borrowed proceeds may enter cash only when matching
 * debt is supplied separately.
 */
export function summarizeMoneyPosition(input: MoneyPositionInput): MoneyPositionSummary {
  const parsedSlices = input.slices.map((slice) => ({
    slice,
    amount: slice.status === "unavailable"
      ? null
      : readMinorUnits(slice.amountMinor, slice.label),
  }));
  const debtMinor = input.debt.status === "unavailable"
    ? null
    : readMinorUnits(input.debt.amountMinor, input.debt.label);
  const missingLabels = [
    ...parsedSlices
      .filter(({ slice, amount }) => slice.status === "unavailable" || amount === null)
      .map(({ slice }) => slice.label),
    ...(input.debt.status === "unavailable" || debtMinor === null ? [input.debt.label] : []),
  ];
  const staleLabels = [
    ...input.slices.filter((slice) => slice.status === "stale").map((slice) => slice.label),
    ...(input.debt.status === "stale" ? [input.debt.label] : []),
  ];
  const knownAssetsMinor = parsedSlices.reduce(
    (total, { amount }) => total + (amount ?? BigInt(0)),
    BigInt(0),
  );
  const complete = missingLabels.length === 0;
  const cashSlices = parsedSlices.filter(({ slice }) => slice.kind === "cash");
  const spendableMinor = cashSlices.some(({ slice, amount }) =>
    slice.status === "unavailable" || amount === null)
    ? null
    : cashSlices.reduce((total, { amount }) => total + (amount ?? BigInt(0)), BigInt(0));
  const hasKnownValue = parsedSlices.some(({ amount }) => amount !== null) || debtMinor !== null;

  return {
    knownAssetsMinor,
    assetsMinor: complete ? knownAssetsMinor : null,
    debtMinor,
    netPositionMinor: complete && debtMinor !== null ? knownAssetsMinor - debtMinor : null,
    spendableMinor,
    missingLabels,
    staleLabels,
    status: !complete
      ? hasKnownValue ? "partial" : "unavailable"
      : staleLabels.length > 0 ? "stale" : "complete",
  };
}

export function summarizeMoneyPositionKind(
  input: MoneyPositionInput,
  kind: MoneyPositionKind,
): MoneyPositionAmountSummary {
  const slices = input.slices.filter((slice) => slice.kind === kind);
  if (slices.some((slice) => slice.status === "unavailable" || slice.amountMinor === null)) {
    return { amountMinor: null, status: "unavailable" };
  }
  return {
    amountMinor: slices.reduce(
      (total, slice) => total + (readMinorUnits(slice.amountMinor, slice.label) ?? BigInt(0)),
      BigInt(0),
    ),
    status: slices.some((slice) => slice.status === "stale") ? "stale" : "ready",
  };
}

export function summarizeMoneyPositionDebt(
  input: MoneyPositionInput,
): MoneyPositionAmountSummary {
  if (input.debt.status === "unavailable" || input.debt.amountMinor === null) {
    return { amountMinor: null, status: "unavailable" };
  }
  return {
    amountMinor: readMinorUnits(input.debt.amountMinor, input.debt.label),
    status: input.debt.status,
  };
}

export function summarizeBorrowPosition(input: MoneyPositionInput): BorrowPositionSummary {
  const collateral = summarizeMoneyPositionKind(input, "collateral");
  const debt = summarizeMoneyPositionDebt(input);
  let positionAfterDebt: MoneyPositionAmountSummary;
  if (collateral.amountMinor === null || debt.amountMinor === null) {
    positionAfterDebt = { amountMinor: null, status: "unavailable" };
  } else {
    positionAfterDebt = {
      amountMinor: collateral.amountMinor - debt.amountMinor,
      status: collateral.status === "stale" || debt.status === "stale"
        ? "stale"
        : "ready",
    };
  }
  return { collateral, debt, positionAfterDebt };
}

export function moneyPositionKindTotal(
  input: MoneyPositionInput,
  kind: MoneyPositionKind,
): bigint | null {
  return summarizeMoneyPositionKind(input, kind).amountMinor;
}

export function shouldPresentMoneyPositionDebt(
  summary: Pick<MoneyPositionSummary, "debtMinor">,
): boolean {
  return summary.debtMinor === null || summary.debtMinor > BigInt(0);
}

export function formatMoneyPositionAmount(
  amountMinor: bigint | null,
  input: Pick<MoneyPositionInput, "currency" | "quoteCurrencyMinorUnitScale" | "regionId">,
): string {
  if (amountMinor === null) return "Unavailable";
  const scale = input.quoteCurrencyMinorUnitScale;
  if (!Number.isSafeInteger(scale) || scale < 0 || scale > 20) {
    throw new TypeError("Quote currency minor-unit scale must be an integer from 0 through 20.");
  }
  return formatFiatAmount(amountMinor, scale, input.currency, {
    regionId: input.regionId,
    fractionDigits: scale,
    minimumFractionDigits: scale,
  });
}

export function moneyPositionStatusMessage(
  summary: MoneyPositionSummary,
): string | null {
  if (summary.status === "partial") {
    const stale = summary.staleLabels.length > 0
      ? ` Last verified values shown for: ${summary.staleLabels.join(", ")}.`
      : "";
    return `Position total unavailable. Missing: ${summary.missingLabels.join(", ")}.${stale} Known amounts remain itemized below.`;
  }
  if (summary.status === "unavailable") {
    return `Position unavailable. Missing: ${summary.missingLabels.join(", ")}. Missing amounts are not zero.`;
  }
  if (summary.status === "stale") {
    return `Last verified values shown for: ${summary.staleLabels.join(", ")}.`;
  }
  return null;
}

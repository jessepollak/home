import type { HomeAssetBalanceItem } from "./present-home-balances";

export type HomeBalanceRowPresentation = {
  visualBalance: string;
  accessibleBalance?: string;
  tone?: "default" | "muted" | "error";
};

const cashTokenAmountPattern =
  /^((?:<)?(?:0|[1-9]\d{0,2}(?:,\d{3})*)(?:\.\d+)?)\s+(\S+)$/;

/**
 * Keeps an unpriced cash token's unit in the presentation DTO and accessible
 * label while showing only the numeric quantity in Home's primary value slot.
 * The shape check also repairs legacy cached rows that stored the same value
 * with a muted tone.
 */
export function presentHomeBalanceRow(
  item: HomeAssetBalanceItem,
): HomeBalanceRowPresentation {
  if (item.group !== "cash" || item.tone === "error") {
    return {
      visualBalance: item.displayBalance,
      tone: item.tone,
    };
  }

  const tokenAmount = cashTokenAmountPattern.exec(item.displayBalance);
  if (!tokenAmount) {
    return {
      visualBalance: item.displayBalance,
      tone: item.tone,
    };
  }

  return {
    visualBalance: tokenAmount[1],
    accessibleBalance: item.displayBalance,
    tone: "default",
  };
}

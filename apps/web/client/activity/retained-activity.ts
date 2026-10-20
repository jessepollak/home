import { replaceEqualDeep } from "@tanstack/react-query";
import { compareActivityTransferKeys } from "@/shared/activity/contract";
import { sameActivityTransfer } from "@/shared/activity/pages";
import type { ActivityPage } from "./types";

export function retainActivityRows<T>(previous: readonly T[], next: readonly T[], key: (row: T) => string, successful = true): T[] {
  const rows = new Map(previous.map((row) => [key(row), row]));
  for (const row of next) {
    if (successful || !rows.has(key(row))) rows.set(key(row), row);
  }
  return [...rows.values()];
}

export function retainActivityPage(next: ActivityPage, previous: ActivityPage | null): ActivityPage {
  if (!previous || previous.walletAddress !== next.walletAddress || previous.currency !== next.currency) return next;
  const previousTransfers = new Map(previous.transfers.map((row) => [row.id, row]));
  const transfers = retainActivityRows(previous.transfers, next.transfers, (row) => row.id, next.onchainStatus !== "unavailable")
    .map((row) => {
      const known = previousTransfers.get(row.id);
      return known?.valuation.status === "priced" && row.valuation.status === "unpriced" &&
        ["quote-unavailable", "fx-unavailable", "no-recent-close"].includes(row.valuation.reason) && sameActivityTransfer(known, row)
        ? { ...row, valuation: known.valuation } : row;
    }).sort((left, right) => -compareActivityTransferKeys(left, right));
  const previousCards = new Map(previous.cards?.rows.map((row) => [row.id, row]));
  const nextCards = next.cards?.rows.map((row) => {
    const known = previousCards.get(row.id);
    return known && Date.parse(known.updatedAt) > Date.parse(row.updatedAt) ? known : row;
  }) ?? [];
  const cardPage = next.cards ?? previous.cards;
  const cards = cardPage ? {
    ...cardPage,
    rows: retainActivityRows(previous.cards?.rows ?? [], nextCards, (row) => row.id, next.cards?.status === "ready"),
  } : undefined;
  if (transfers.length === next.transfers.length && transfers.every((row, index) => row === next.transfers[index]) &&
    cards?.rows.length === next.cards?.rows.length && cards?.rows.every((row, index) => row === next.cards?.rows[index])) return next;
  if (next === previous) return previous;
  return replaceEqualDeep(previous, { ...next, transfers, ...(cards ? { cards } : {}) });
}

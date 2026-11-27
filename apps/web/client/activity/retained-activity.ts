import { replaceEqualDeep } from "@tanstack/react-query";
import { ACTIVITY_SHOWN_ROW_LIMIT, compareActivityTransferKeys, type ShownActivityRows } from "@/shared/activity/contract";
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

function sameShownSet(page: ActivityPage, shown: ShownActivityRows | undefined): shown is ShownActivityRows {
  return shown !== undefined && shown.walletAddress === page.walletAddress && shown.currency === page.currency;
}

function withShownRows<T extends { id: string }>(rows: readonly T[], shown: readonly T[], preferShown: boolean): T[] {
  const shownById = new Map(shown.map((row) => [row.id, row]));
  const present = new Set(rows.map((row) => row.id));
  return [
    ...preferShown ? rows.map((row) => shownById.get(row.id) ?? row) : rows,
    ...shown.filter((row) => !present.has(row.id)),
  ];
}

export function withShownActivityRows(page: ActivityPage, shown: ShownActivityRows | undefined, preferShown = false): ActivityPage {
  if (!sameShownSet(page, shown)) return page;
  const transfers = withShownRows(page.transfers, shown.transfers, preferShown);
  const cardRows = withShownRows(page.cards?.rows ?? [], shown.cards?.rows ?? [], preferShown);
  const sameTransfers = transfers.length === page.transfers.length && transfers.every((row, index) => row === page.transfers[index]);
  const pageCards = page.cards?.rows ?? [];
  const sameCards = cardRows.length === pageCards.length && cardRows.every((row, index) => row === pageCards[index]);
  if (sameTransfers && sameCards) return page;
  const cardPage = page.cards ?? shown.cards;
  return {
    ...page,
    transfers: sameTransfers ? page.transfers : transfers.sort((left, right) => -compareActivityTransferKeys(left, right)),
    ...(cardPage ? { cards: sameCards ? cardPage : { ...cardPage, rows: cardRows } } : {}),
  };
}

export function shownActivityRows(page: ActivityPage, previous: ShownActivityRows | undefined): ShownActivityRows {
  const windowEnd = sameShownSet(page, previous) && Date.parse(previous.windowEnd) > Date.parse(page.window.to)
    ? previous.windowEnd : page.window.to;
  const transfers = [...page.transfers].sort((left, right) => -compareActivityTransferKeys(left, right))
    .slice(0, ACTIVITY_SHOWN_ROW_LIMIT);
  const cards = page.cards ? {
    ...page.cards,
    rows: [...page.cards.rows].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .slice(0, ACTIVITY_SHOWN_ROW_LIMIT),
  } : undefined;
  return replaceEqualDeep(previous, {
    windowEnd, walletAddress: page.walletAddress, currency: page.currency, transfers, ...(cards ? { cards } : {}),
  });
}

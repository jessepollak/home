import { compareActivityTransferKeys } from "./contract";
import type { ActivityPage, ActivityTransfer } from "./types";

export function mergeActivityPages(pages: ActivityPage[]): ActivityPage {
  const first = pages[0];
  if (!first) throw new Error("Activity page is missing.");
  const transfers: ActivityTransfer[] = [];
  const seen = new Map<string, ActivityTransfer>();
  let previous: ActivityTransfer | undefined;
  for (const page of pages) {
    if (page.window.to !== first.window.to) throw new Error("Activity window changed.");
    for (const transfer of page.transfers) {
      const existing = seen.get(transfer.id);
      if (existing) {
        if (!sameActivityTransfer(existing, transfer)) throw new Error("Activity overlap changed.");
        if (existing.valuation.status !== "priced" && transfer.valuation.status === "priced") {
          transfers[transfers.indexOf(existing)] = transfer;
          seen.set(transfer.id, transfer);
        }
        continue;
      }
      if (previous && compareActivityTransferKeys(previous, transfer) <= 0) {
        throw new Error("Activity page order did not advance.");
      }
      seen.set(transfer.id, transfer);
      transfers.push(transfer);
      previous = transfer;
    }
  }
  const last = pages.at(-1) ?? first;
  return {
    ...first,
    transfers,
    nextCursor: last.nextCursor,
  };
}

export function sameActivityTransfer(left: ActivityTransfer, right: ActivityTransfer): boolean {
  return JSON.stringify(withoutValuation(left)) === JSON.stringify(withoutValuation(right));
}

function withoutValuation(transfer: ActivityTransfer): Omit<ActivityTransfer, "valuation"> {
  const { valuation, ...rest } = transfer;
  void valuation;
  return rest;
}

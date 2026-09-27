import type { FiatCurrencyCode } from "@/config/regions";
import type { ExactDecimal } from "@/shared/balances/types";
import type { ActivityFeedItem } from "./activity-feed";
import type { ActivityTransfer } from "./types";

export type ActivityFeedGroupEntry<T> = { kind: "single"; entry: T } | { kind: "run"; entries: readonly T[] };

function incomingTokenKey(item: ActivityFeedItem): string | null {
  if (item.kind !== "transfer" || item.transfer.direction !== "incoming") return null;
  const { chainId, tokenAddress, tokenDecimals } = item.transfer;
  return `${chainId}:${tokenAddress.toLowerCase()}:${tokenDecimals}`;
}

export function groupActivityFeed<T>(
  entries: readonly T[],
  sourceOf: (entry: T) => ActivityFeedItem,
): ActivityFeedGroupEntry<T>[] {
  const groups: ActivityFeedGroupEntry<T>[] = [];
  const seenTransfers = new Set<string>();
  let pending: { entry: T; key: string | null } | undefined;
  let run: T[] | undefined;

  const flush = () => {
    if (run) groups.push({ kind: "run", entries: run });
    else if (pending) groups.push({ kind: "single", entry: pending.entry });
    pending = undefined;
    run = undefined;
  };

  for (const entry of entries) {
    const source = sourceOf(entry);
    if (source.kind === "transfer") {
      if (seenTransfers.has(source.transfer.id)) continue;
      seenTransfers.add(source.transfer.id);
    }
    const key = incomingTokenKey(source);
    if (key !== null && key === pending?.key) {
      if (!run) run = [pending.entry];
      run.push(entry);
    } else {
      flush();
      pending = { entry, key };
    }
  }
  flush();
  return groups;
}

export function transferRunTotals(transfers: readonly ActivityTransfer[]): {
  baseUnits: string;
  value: { status: "priced"; currency: FiatCurrencyCode; amount: ExactDecimal } | { status: "unavailable" };
} {
  let baseUnits = BigInt(0);
  let currency: FiatCurrencyCode | undefined;
  let scale = 0;
  let atoms = BigInt(0);
  let allPriced = transfers.length > 0;
  for (const transfer of transfers) {
    baseUnits += BigInt(transfer.amountBaseUnits);
    const valuation = transfer.valuation;
    if (valuation.status !== "priced" || (currency !== undefined && currency !== valuation.currency)) {
      allPriced = false;
      continue;
    }
    currency = valuation.currency;
    if (!allPriced) continue;
    const nextScale = valuation.amount.scale;
    if (nextScale > scale) {
      atoms *= BigInt(10) ** BigInt(nextScale - scale);
      scale = nextScale;
    }
    atoms += BigInt(valuation.amount.atoms) * BigInt(10) ** BigInt(scale - nextScale);
  }
  return {
    baseUnits: baseUnits.toString(),
    value: allPriced && currency !== undefined
      ? { status: "priced", currency, amount: { atoms: atoms.toString(), scale } }
      : { status: "unavailable" },
  };
}

export function assignTransferRunKeys(
  runs: readonly (readonly string[])[],
  previous: ReadonlyMap<string, string>,
): { keys: string[]; byChild: Map<string, string> } {
  const keys: string[] = [];
  const byChild = new Map<string, string>();
  const claimed = new Set<string>();
  for (const children of runs) {
    const first = children[0];
    if (first === undefined) continue;
    const old = children.map((child) => previous.get(child)).find((key) => key && !claimed.has(key));
    const base = `transfer-run:${first}`;
    let key = old ?? base;
    let suffix = 2;
    while (claimed.has(key)) key = `${base}:${suffix++}`;
    claimed.add(key);
    keys.push(key);
    for (const child of children) byChild.set(child, key);
  }
  return { keys, byChild };
}

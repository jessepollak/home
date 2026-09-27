import { describe, expect, test } from "bun:test";
import type { RecentMoneyActionOperation } from "@/shared/actions/contracts/list";
import type { ActivityTransfer } from "./types";
import type { ActivityFeedItem } from "./activity-feed";
import { assignTransferRunKeys, groupActivityFeed, transferRunTotals } from "./activity-groups";

const TOKEN = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;
const OTHER_TOKEN = "0x2222222222222222222222222222222222222222" as const;
const WALLET = "0x1111111111111111111111111111111111111111" as const;
const TIME = "2026-09-24T12:00:00.000Z";

function transfer(id: string, overrides: Partial<ActivityTransfer> = {}): ActivityTransfer {
  return {
    id, logId: id, chainId: 8453, assetId: "usdc", tokenAddress: TOKEN,
    tokenSymbol: "USDC", tokenDecimals: 6, tokenImageUrl: null,
    walletAddress: WALLET, fromAddress: OTHER_TOKEN, toAddress: WALLET,
    direction: "incoming", amountBaseUnits: "1000000", blockNumber: "150",
    blockHash: `0x${"b".repeat(64)}`, transactionHash: `0x${"a".repeat(64)}`,
    logIndex: "1", blockTimestamp: TIME,
    valuation: { status: "unpriced", currency: "USD", reason: "quote-unavailable" },
    ...overrides,
  };
}

function feed(value: ActivityTransfer): ActivityFeedItem {
  return { kind: "transfer", id: value.id, timestamp: value.blockTimestamp, transfer: value };
}

function action(id: string, status: "pending" | "confirmed"): ActivityFeedItem {
  const operation: RecentMoneyActionOperation = {
    action: { id, kind: "send", title: "Send", amounts: [], warnings: [], createdAt: TIME, expiresAt: TIME },
    status, createdAt: TIME, updatedAt: TIME,
  };
  return { kind: "action", id, timestamp: TIME, operation, transfers: [] };
}

const group = (items: readonly ActivityFeedItem[]) => groupActivityFeed(items, (item) => item);
const layout = (items: readonly ActivityFeedItem[]) => group(items).map((entry) =>
  entry.kind === "run" ? entry.entries.map(({ id }) => id) : entry.entry.id);

function priced(amount: string, scale: number, currency: "USD" | "EUR" = "USD") {
  return { status: "priced" as const, currency, amount: { atoms: amount, scale },
    method: "peg" as const, peg: "USD" as const, close: null, fx: null };
}

describe("groupActivityFeed", () => {
  test("groups only adjacent matching incoming token contracts while preserving original entries", () => {
    const a = feed(transfer("a"));
    const b = feed(transfer("b", { tokenAddress: TOKEN.toUpperCase() as `0x${string}` }));
    const c = feed(transfer("c", { tokenAddress: OTHER_TOKEN, tokenSymbol: "USDC" }));
    const d = feed(transfer("d"));
    expect(layout([a, b, c, d])).toEqual([["a", "b"], "c", "d"]);
    const [run] = group([a, b]);
    expect(run?.kind).toBe("run");
    if (run?.kind === "run") {
      expect(run.entries[0]).toBe(a);
      expect(run.entries[1]).toBe(b);
    }
    expect(layout([a, c, b])).toEqual(["a", "c", "b"]);
  });

  test("does not group matching symbols on different chains or decimal scales", () => {
    const a = feed(transfer("a"));
    const chain = feed(transfer("chain", { chainId: 10 as ActivityTransfer["chainId"] }));
    const decimals = feed(transfer("decimals", { tokenDecimals: 18 }));
    expect(layout([a, chain, decimals, feed(transfer("b"))])).toEqual(["a", "chain", "decimals", "b"]);
  });

  test("outgoing and self transfers and pending and confirmed actions break runs", () => {
    for (const breaker of [
      feed(transfer("out", { direction: "outgoing" })),
      feed(transfer("self", { direction: "self" })),
      action("pending", "pending"), action("confirmed", "confirmed"),
    ]) {
      expect(layout([feed(transfer("a")), breaker, feed(transfer("b"))]))
        .toEqual(["a", breaker.id, "b"]);
    }
    expect(layout([feed(transfer("alone"))])).toEqual(["alone"]);
  });

  test("drops later duplicates by transfer id without double-counting even across a breaker", () => {
    const a = feed(transfer("a"));
    const b = feed(transfer("b"));
    expect(layout([a, feed(transfer("a", { amountBaseUnits: "9000000" })), b]))
      .toEqual([["a", "b"]]);
    expect(layout([a, action("stop", "pending"), feed(transfer("a")), b]))
      .toEqual(["a", "stop", "b"]);
  });
});

describe("transferRunTotals", () => {
  test("sums base units beyond Number precision and priced valuations exactly at the maximum scale", () => {
    const totals = transferRunTotals([
      transfer("a", { amountBaseUnits: "900719925474099300000", valuation: priced("123", 2) }),
      transfer("b", { amountBaseUnits: "900719925474099300001", valuation: priced("45678", 4) }),
    ]);
    expect(totals).toEqual({ baseUnits: "1801439850948198600001",
      value: { status: "priced", currency: "USD", amount: { atoms: "57978", scale: 4 } } });
  });

  test("does not expose partial fiat totals for a missing valuation or mixed currencies", () => {
    const first = transfer("first", { valuation: priced("125", 2) });
    const unpriced = transfer("unpriced");
    const differentCurrency = transfer("eur", { valuation: priced("125", 2, "EUR") });
    expect(transferRunTotals([first, unpriced])).toEqual({ baseUnits: "2000000", value: { status: "unavailable" } });
    expect(transferRunTotals([first, differentCurrency]).value).toEqual({ status: "unavailable" });
  });
});

describe("assignTransferRunKeys", () => {
  test("retains a run key when a new head joins and when a next page extends the tail", () => {
    const first = assignTransferRunKeys([["b", "c"]], new Map());
    const head = assignTransferRunKeys([["a", "b", "c"]], first.byChild);
    const tail = assignTransferRunKeys([["a", "b", "c", "d"]], head.byChild);
    expect(head.keys).toEqual(first.keys);
    expect(tail.keys).toEqual(first.keys);
    expect(tail.byChild).toEqual(new Map(["a", "b", "c", "d"].map((id) => [id, first.keys[0]!])));
  });

  test("a split keeps the key on the newer half and mints a distinct key for the older half", () => {
    const prior = assignTransferRunKeys([["a", "b", "c", "d"]], new Map());
    const split = assignTransferRunKeys([["a", "b"], ["c", "d"]], prior.byChild);
    expect(split.keys).toEqual([prior.keys[0], "transfer-run:c"]);
    expect(split.byChild.get("b")).toBe(prior.keys[0]);
    expect(split.byChild.get("d")).toBe("transfer-run:c");
    const dissolved = assignTransferRunKeys([], split.byChild);
    expect(dissolved).toEqual({ keys: [], byChild: new Map() });
  });

  test("mints unique keys even if a generated key collides with an already claimed one", () => {
    const assigned = assignTransferRunKeys([["a"], ["b"], ["b"]], new Map([["a", "transfer-run:b"]]));
    expect(assigned.keys).toEqual(["transfer-run:b", "transfer-run:b:2", "transfer-run:b:3"]);
  });
});

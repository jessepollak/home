import { describe, expect, test } from "bun:test";
import type { RecentMoneyActionOperation } from "@/shared/actions/contracts/list";
import type { MoneyActionAmount } from "@/shared/money-actions/types";
import type { ActivityTransfer } from "./types";
import type { ActivityFeedItem } from "./activity-feed";
import { presentActivityLedgerEntries, presentActivityLedgerItems } from "./activity-ledger-items";
import { isActivityLedgerGroup } from "./activity-ledger";

const WALLET = "0x1111111111111111111111111111111111111111" as const;
const OTHER = "0x2222222222222222222222222222222222222222" as const;
const TOKEN = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;
const HASH = `0x${"a".repeat(64)}` as const;
const TIME = "2026-09-15T12:00:00.000Z";

function transfer(direction: ActivityTransfer["direction"] = "incoming", priced = false): ActivityTransfer {
  return {
    id: `8453:${TOKEN}:log-id`, logId: "log-id", chainId: 8453, assetId: "usdc",
    tokenAddress: TOKEN, tokenSymbol: "USDC", tokenDecimals: 6, tokenImageUrl: null,
    walletAddress: WALLET, fromAddress: direction === "incoming" ? OTHER : WALLET,
    toAddress: direction === "outgoing" ? OTHER : WALLET, direction,
    amountBaseUnits: "1000001", blockNumber: "150", blockHash: `0x${"b".repeat(64)}`,
    transactionHash: HASH, logIndex: "1", blockTimestamp: TIME,
    valuation: priced
      ? { status: "priced", currency: "USD", amount: { atoms: "2500", scale: 2 }, method: "peg", peg: "USD", close: null, fx: null }
      : { status: "unpriced", currency: "USD", reason: "quote-unavailable" },
  };
}

function action(status: RecentMoneyActionOperation["status"]): RecentMoneyActionOperation {
  return {
    action: { id: "action-id", kind: "send", title: "Send USDC", amounts: [
      { assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "1234567", direction: "spend", estimated: true },
      { assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "500000", direction: "receive" },
    ], warnings: [], expiresAt: TIME, createdAt: TIME },
    status, createdAt: TIME, updatedAt: TIME, transactionHash: HASH,
  };
}

function fromTransfer(value: ActivityTransfer): ActivityFeedItem {
  return { kind: "transfer", id: value.id, timestamp: value.blockTimestamp, transfer: value };
}
function fromAction(value: RecentMoneyActionOperation): Extract<ActivityFeedItem, { kind: "action" }> {
  return { kind: "action", id: value.action.id, timestamp: value.updatedAt, operation: value, transfers: [] };
}

const present = (items: ActivityFeedItem[]) => presentActivityLedgerItems(items, { regionId: "US", timeZone: "UTC" });

test("card purchase directions distinguish returned, captured and declined money", () => {
  const base = { id: "ipi_synthetic", kind: "transaction" as const, amountMinor: "1234", currency: "USD",
    merchantName: "Synthetic Cafe", merchantCategory: null, declineReasonCode: null, createdAt: TIME, updatedAt: TIME };
  for (const [status, amount, direction] of [
    ["pending", "−$12.34", "out"], ["completed", "−$12.34", "out"],
    ["reversed", "−$12.34", "out"], ["refunded", "+$12.34", "in"],
    ["declined", "$12.34", "none"],
  ] as const) {
    const [row] = present([{ kind: "card", id: base.id, timestamp: TIME, purchase: { ...base, status } }]);
    expect(row).toMatchObject({ family: "card", title: "Synthetic Cafe", statusLabel: status[0]!.toUpperCase() + status.slice(1),
      amount, detailAmount: amount, direction, mark: { kind: "glyph", glyph: "card" } });
    if (status === "declined") expect(row?.ownerSentence?.description).toBe("Your balance didn't change.");
  }
  const [declined] = present([{ kind: "card", id: base.id, timestamp: TIME,
    purchase: { ...base, status: "declined", declineReasonCode: "insufficient_funds" } }]);
  expect(declined).toMatchObject({ status: "failed", statusLabel: "Declined · insufficient funds" });
});


describe("presentActivityLedgerEntries", () => {
  const options = { regionId: "US" as const, timeZone: "UTC" };
  const onDay = (id: string, day: number, amountBaseUnits: string, priced = true) => fromTransfer({
    ...transfer("incoming", priced), id,
    blockTimestamp: `2026-09-${day}T12:00:00.000Z`, amountBaseUnits,
  });
  const pairsFor = (sources: ActivityFeedItem[]) => {
    const items = presentActivityLedgerItems(sources, options);
    return sources.map((source, index) => ({ source, item: items[index]! }));
  };

  test("presents ordered date ranges, group identity, a priced sum and original child objects", () => {
    const pairs = pairsFor([onDay("newest", 24, "1000001"), onDay("middle", 23, "2000000"),
      onDay("oldest", 22, "3000000")]);
    const [entry] = presentActivityLedgerEntries(pairs, options);
    expect(entry && isActivityLedgerGroup(entry)).toBe(true);
    if (!entry || !isActivityLedgerGroup(entry)) return;
    expect(entry).toMatchObject({
      id: "transfer-run:newest", title: "Received", countLabel: "3 transfers",
      newestTimestamp: "2026-09-24T12:00:00.000Z", oldestTimestamp: "2026-09-22T12:00:00.000Z",
      rangeLabel: "Sep 22 – 24", fullRangeLabel: "Sep 22, 2026, 12:00 PM – Sep 24, 2026, 12:00 PM",
      amount: "+$75.00", amountContext: "+6.00 USDC", direction: "in",
      toggleLabel: "3 Received USDC transfers", mark: pairs[0]!.item.mark,
    });
    expect(entry.children.map(({ id }) => id)).toEqual(["newest", "middle", "oldest"]);
    entry.children.forEach((item, index) => expect(item).toBe(pairs[index]!.item));
  });

  test("reuses an unchanged transfer-run summary across unrelated feed updates", () => {
    const pairs = pairsFor([onDay("new", 24, "1000000"), onDay("old", 23, "1000000")]);
    const first = presentActivityLedgerEntries(pairs, options);
    const unrelated = pairsFor([fromTransfer({ ...transfer("outgoing"), id: "other",
      blockTimestamp: "2026-09-22T12:00:00.000Z" })]);
    expect(presentActivityLedgerEntries([...pairs, ...unrelated], options, first)[0]).toBe(first[0]);
    const changed = [...pairs.slice(0, 1), { ...pairs[1]!, item: { ...pairs[1]!.item, amount: "+$10.00" } }];
    expect(presentActivityLedgerEntries(changed, options, first)[0]).not.toBe(first[0]);
  });

  test("formats only after aggregation and omits fiat context when any price is unavailable", () => {
    const first = onDay("a", 24, "500000");
    const second = onDay("b", 24, "500000", false);
    const [entry] = presentActivityLedgerEntries(pairsFor([first, second]), options);
    expect(entry && isActivityLedgerGroup(entry)).toBe(true);
    if (!entry || !isActivityLedgerGroup(entry)) return;
    expect(entry).toMatchObject({ amount: "+1.00 USDC",
      rangeLabel: "Sep 24", fullRangeLabel: "Sep 24, 2026, 12:00 PM" });
    expect(entry.amountContext).toBeUndefined();
    const unknown = { ...transfer(), assetId: null, tokenSymbol: null, tokenDecimals: null };
    const [fallback] = presentActivityLedgerEntries(pairsFor([
      fromTransfer({ ...unknown, id: "unknown-a", amountBaseUnits: "120" }),
      fromTransfer({ ...unknown, id: "unknown-b", amountBaseUnits: "23" }),
    ]), options);
    expect(fallback).toMatchObject({ title: "Received", toggleLabel: "2 Received unknown token transfers", amount: "+143 base units" });
  });

  test("keeps tiny priced fiat totals marked as dust", () => {
    const tiny = (id: string) => fromTransfer({ ...transfer(), id, amountBaseUnits: "1",
      valuation: { status: "priced" as const, currency: "USD" as const, amount: { atoms: "1", scale: 5 },
        method: "peg" as const, peg: "USD" as const, close: null, fx: null } });
    const [entry] = presentActivityLedgerEntries(pairsFor([tiny("a"), tiny("b")]), options);
    expect(entry).toMatchObject({ amount: "+<$0.01", amountContext: "+<0.01 USDC" });
  });
});

describe("presentActivityLedgerItems", () => {
  test("retains source order, canonical identities, and maps all action statuses", () => {
    for (const [source, expected] of [
      ["pending", "waiting-chain"], ["unknown", "ambiguous"],
      ["confirmed", "confirmed"], ["failed", "failed"],
    ] as const) {
      const [first, second] = present([fromAction(action(source)), fromTransfer(transfer())]);
      expect(first).toMatchObject({ family: "home-action", id: "action-id", status: expected, updatedAt: TIME });
      expect(second).toMatchObject({ family: "onchain-transfer", id: transfer().id, status: "confirmed" });
      expect(first?.nextAction).toBeUndefined();
    }
  });

  test("shows submitted and confirming stages only for pending actions with a submission handle", () => {
    const submitted = action("pending");
    submitted.submittedAt = TIME;
    expect(present([fromAction(submitted)])[0]?.steps).toEqual([
      { status: "complete", title: "Submitted", time: "Sep 15, 2026, 12:00 PM" },
      { status: "current", title: "Confirming on Base" },
    ]);
    submitted.submittedAt = "not-a-date";
    expect(present([fromAction(submitted)])[0]?.steps).toEqual([
      { status: "complete", title: "Submitted" },
      { status: "current", title: "Confirming on Base" },
    ]);
    submitted.submittedAt = undefined;
    expect(present([fromAction(submitted)])[0]?.steps).toEqual([
      { status: "complete", title: "Submitted" },
      { status: "current", title: "Confirming on Base" },
    ]);
    submitted.transactionHash = undefined;
    submitted.userOperationHash = HASH;
    expect(present([fromAction(submitted)])[0]?.steps).toHaveLength(2);
    submitted.userOperationHash = undefined;
    expect(present([fromAction(submitted)])[0]?.steps).toBeUndefined();
    for (const status of ["confirmed", "failed", "unknown"] as const) {
      expect(present([fromAction(action(status))])[0]?.steps).toBeUndefined();
    }
  });

  test("maps transfer directions, full counterparties, bounded quantities and priced fiat", () => {
    const [incoming, outgoing, self] = present([
      fromTransfer(transfer("incoming", true)), fromTransfer(transfer("outgoing")), fromTransfer(transfer("self")),
    ]);
    expect(incoming).toMatchObject({ title: "Received", direction: "in", amount: "+$25.00", amountContext: "+1.00 USDC", detailAmount: "+1.00 USDC", detailValue: "+$25.00", detailAsset: { name: "US dollar", openable: true, symbol: "US" }, mark: { kind: "asset", assetKey: expect.any(String) }, detail: { counterpartyLabel: "From", counterparty: OTHER, network: "Base", transaction: { value: HASH, display: "0xaaaaaaaa…aaaaaaaa", explorer: { href: `https://basescan.org/tx/${HASH}` } } } });
    expect(outgoing).toMatchObject({ title: "Sent", direction: "out", amount: "−1.00 USDC", detailAmount: "−1.00 USDC", detailValue: "Unknown", detail: { counterpartyLabel: "To", counterparty: OTHER } });
    expect(self).toMatchObject({ title: "Self transfer", direction: "none", amount: "1.00 USDC", detailAmount: "1.00 USDC", detailValue: "Unknown", detail: { counterpartyLabel: "To" } });
    expect(incoming?.detail.family === "onchain-transfer" && incoming.detail.facts).toBeUndefined();
  });

  test("keeps the year in full date labels when the short label omits it", () => {
    const old = "2025-12-31T12:00:00.000Z";
    const operation = { ...action("confirmed"), updatedAt: old };
    const [transferItem, actionItem] = present([fromTransfer({ ...transfer(), blockTimestamp: old }), fromAction(operation)]);
    for (const value of [transferItem, actionItem]) {
      expect(value).toMatchObject({ dateLabel: "Dec 31, 12:00 PM", fullDateLabel: "Dec 31, 2025, 12:00 PM" });
    }
  });

  test("keeps unknown token quantities in base units and omits unavailable fiat", () => {
    const unknown = { ...transfer(), assetId: null, tokenSymbol: null, tokenDecimals: null,
      tokenAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const,
      amountBaseUnits: "123456789", tokenImageUrl: "https://example.com/token.png" };
    const [item] = present([fromTransfer(unknown)]);
    expect(item).toMatchObject({ amount: "+123456789 base units", detailAmount: "+123456789 base units",
      mark: { imageUrl: "https://example.com/token.png" },
      activateLabel: "View received unknown token transaction details", detailValue: "Unknown",
      detailAsset: { name: "Unknown token", openable: true } });
  });

  test("presents cash-out facts without exposing order identities or internals", () => {
    const cashout = action("pending");
    cashout.action.kind = "cash-out";
    cashout.action.metadata = {
      product: "cashout", operation: "deposit", providerId: "peer", providerName: "Peer",
      environment: "production", platform: "cashapp", platformLabel: "Cash App", currency: "USD",
      canonicalHandle: "alice", approximateFiatAmount: "1.50", minConversionRate: "1",
      intentAmountRange: { min: "1000000", max: "2000000" }, estimateAsOf: TIME,
      escrow: "0x777777779d229cdF3110e9de47943791c26300Ef", etaSeconds: 120,
    };
    const [item] = present([fromAction(cashout)]);
    expect(item).toMatchObject({ title: "Cash out to Cash App", status: "waiting-provider" });
    expect(item?.detail).toMatchObject({ family: "home-action", operation: "Cash out to Cash App", facts: [
      { label: "Provider", value: "Peer" }, { label: "Payout app", value: "Cash App" },
      { label: "Payout handle", value: "alice" }, { label: "You receive", value: "≈ $1.50 to Cash App" },
      { label: "Arrives", value: "Usually within 2 minutes" },
      { label: "You receive", value: "0.50 USDC" },
    ] });
    expect(item?.detailAsset).toBeUndefined();
    expect(item?.detailValue).toBeUndefined();
    expect(JSON.stringify(item?.detail)).not.toContain("escrow");
  });

  test("shows the receive amount and arrival exactly as the reviewed quote stated them", () => {
    const cashout = action("pending");
    cashout.action.kind = "cash-out";
    cashout.action.metadata = {
      product: "cashout", operation: "deposit", providerId: "peer", providerName: "Peer",
      environment: "production", platform: "monzo", platformLabel: "Monzo", currency: "GBP",
      canonicalHandle: "alice", approximateFiatAmount: "37.06", minConversionRate: "1",
      intentAmountRange: { min: "1000000", max: "2000000" }, estimateAsOf: TIME,
      escrow: "0x777777779d229cdF3110e9de47943791c26300Ef", etaSeconds: null,
      quote: {
        fees: { provider: { amount: "0", currency: "GBP" }, network: null, operator: null },
        rate: { from: "USDC", to: "GBP", value: "0.7412" },
        receive: { amount: "37.06", currency: "GBP", approximate: true }, arrival: { source: "unknown" },
      },
    };
    const [item] = present([fromAction(cashout)]);
    const facts = item?.detail.family === "home-action" ? item.detail.facts ?? [] : [];
    expect(facts).toContainEqual({ label: "You receive", value: "≈ £37.06 to Monzo" });
    expect(facts).toContainEqual({ label: "Arrives", value: "Arrival time varies" });
  });

  test("formats primary and secondary action amounts without leaking source internals", () => {
    const [item] = present([fromAction(action("unknown")), fromTransfer(transfer())]);
    expect(item).toMatchObject({ title: "Send USDC", amount: "−~$1.23", detailAmount: "−~1.23 USDC", direction: "out", detail: { operation: "Send", facts: [{ label: "You receive", value: "0.50 USDC" }] } });
    for (const value of present([fromAction(action("unknown")), fromTransfer(transfer())])) {
      const detail = JSON.stringify(value.detail);
      expect(detail).not.toContain(TOKEN);
      expect(detail).not.toContain("action-id");
      expect(detail).not.toContain("150");
      const facts = value.detail.family === "home-action" || value.detail.family === "onchain-transfer" ? value.detail.facts ?? [] : [];
      expect(facts.every((fact) => !/token contract|action id|block number/i.test(fact.label))).toBe(true);
    }
  });

  test("keeps upper-bound ceilings exact in rows, headlines and secondary facts until settled", () => {
    const base = action("pending");
    const maximum: MoneyActionAmount = {
      assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "100000362", direction: "spend", maximum: true,
    };
    const withAmounts = (amounts: MoneyActionAmount[]) => fromAction({ ...base, action: { ...base.action, amounts } });
    const [pending] = present([withAmounts([maximum])]);
    expect(pending).toMatchObject({ amount: "−100.000362 USDC", detailAmount: "−100.000362 USDC",
      detailAmountParts: { amount: "−100.000362", symbol: "USDC" } });
    expect(present([withAmounts([{ ...maximum, maximum: undefined }])])[0])
      .toMatchObject({ amount: "−$100.00", detailAmount: "−100.00 USDC" });
    const [secondary] = present([withAmounts([{ ...maximum, maximum: undefined }, maximum])]);
    expect(secondary?.detail).toMatchObject({ facts: [{ label: "Up to", value: "100.000362 USDC" }] });
    expect(secondary?.detailAsset).toMatchObject({ name: "US dollar", openable: true });
    expect(present([withAmounts([{ ...maximum, maximum: undefined }, { ...maximum, assetId: "weth", symbol: "WETH" }])])[0]?.detailAsset)
      .toBeUndefined();
    const eth = { ...maximum, symbol: "ETH", decimals: 18, amountBaseUnits: "1000000000000000001" };
    const [localized] = presentActivityLedgerItems([withAmounts([eth])], { regionId: "DE" });
    expect(localized).toMatchObject({ amount: "−1,000000000000000001 ETH", detailAmount: "−1,000000000000000001 ETH" });
    expect(maximum.amountBaseUnits).toBe("100000362");
  });

  test("bounds detail and row values across token classes and locales", () => {
    for (const [symbol, decimals, amountBaseUnits, display] of [
      ["ETH", 18, "1", "<0,000001 ETH"],
      ["cbBTC", 8, "990000", "0,0099 cbBTC"],
      ["vault shares", 18, "999999", "<0,000001 vault shares"],
      ["ZORA", 18, "1234567890123456789012", "1.234,56 ZORA"],
      ["TOKEN1", 0, "5678", "5.678 TOKEN1"],
    ] as const) {
      const original = action("confirmed");
      const token: MoneyActionAmount = { assetId: symbol, symbol, decimals, amountBaseUnits, direction: "spend" };
      const [entry] = presentActivityLedgerItems([
        fromAction({ ...original, action: { ...original.action, amounts: [token] } }),
      ], { regionId: "DE" });
      expect(entry?.amount).toBe(`−${display}`);
      expect(entry?.detailAmount).toBe(`−${display}`);
      expect(token.amountBaseUnits).toBe(amountBaseUnits);
    }
    const [meme] = present([fromTransfer({ ...transfer(), assetId: null, tokenSymbol: "ZORA",
      tokenDecimals: 18, amountBaseUnits: "1234567890123456789012" })]);
    expect(meme).toMatchObject({ amount: "+1,234.56 ZORA", detailAmount: "+1,234.56 ZORA",
      detailAmountParts: { amount: "+1,234.56", symbol: "ZORA" } });
    const [dust, large] = present([fromTransfer({ ...transfer(), amountBaseUnits: "1" }),
      fromTransfer({ ...transfer(), amountBaseUnits: "123456789012" })]);
    expect(dust?.detailAmount).toBe("+<0.01 USDC");
    expect(large?.detailAmount).toBe("+123,456.78 USDC");
  });

  test("uses transfer currency and exact Base asset identity without inferring availability", () => {
    const euro = { ...transfer("outgoing", true), valuation: {
      status: "priced" as const, currency: "EUR" as const,
      amount: { atoms: "2500", scale: 2 }, method: "peg" as const,
      peg: "EUR" as const, close: null, fx: null,
    } };
    expect(present([fromTransfer(euro)])[0]?.detailValue).toBe("−€25.00");
    expect(present([fromTransfer({ ...transfer(), tokenAddress: "0x123" })])[0]?.detailAsset?.openable).toBe(false);
    expect(present([fromTransfer({ ...transfer(), tokenAddress: "0x" + "A".repeat(40) as `0x${string}` })])[0]?.detailAsset)
      .toMatchObject({ assetKey: `eip155:8453/erc20:0x${"a".repeat(40)}`, openable: true });
  });

  test("single-asset send uses its matching outgoing transfer and confirmed missing valuation is unknown", () => {
    const send = action("confirmed");
    send.action.amounts = [{ ...send.action.amounts[0]!, amountBaseUnits: "1000001" }];
    const matched = { ...transfer("outgoing", true), valuation: {
      status: "priced" as const, currency: "EUR" as const,
      amount: { atoms: "3456", scale: 2 }, method: "peg" as const,
      peg: "EUR" as const, close: null, fx: null,
    } };
    const feed = { ...fromAction(send), transfers: [transfer("incoming", true), matched] };
    expect(present([feed])[0]).toMatchObject({ detailValue: "−€34.56", detailAsset: {
      name: "US dollar", openable: true,
    }, detail: { facts: [] } });
    expect(present([fromAction(send)])[0]?.detailValue).toBe("Unknown");
    expect(present([{ ...fromAction(send), transfers: [transfer("incoming", true)] }])[0]?.detailValue)
      .toBe("Unknown");
    send.status = "pending";
    expect(present([fromAction(send)])[0]?.detailValue).toBeUndefined();
    expect(present([{ ...feed, operation: send, transfers: [{ ...matched,
      valuation: { status: "unpriced", currency: "EUR", reason: "quote-unavailable" } }] }])[0]?.detailValue)
      .toBe("Unknown");
    send.status = "failed";
    expect(present([fromAction(send)])[0]?.detailValue).toBeUndefined();
    send.status = "unknown";
    expect(present([fromAction(send)])[0]?.detailValue).toBeUndefined();
    send.status = "confirmed";
    send.action.amounts.push({ assetId: "vault-shares", symbol: "vault shares", decimals: 18,
      amountBaseUnits: "123", direction: "receive" });
    expect(present([{ ...fromAction(send), transfers: [matched] }])[0]).toMatchObject({
      detailValue: "−€34.56", detailAsset: { name: "US dollar" },
    });
  });

  test("sums all priced matching logs before formatting the action fiat value", () => {
    const send = action("confirmed");
    send.action.amounts = [send.action.amounts[0]!];
    const first = { ...transfer("outgoing", true), valuation: {
      status: "priced" as const, currency: "USD" as const, amount: { atoms: "25005", scale: 3 },
      method: "peg" as const, peg: "USD" as const, close: null, fx: null,
    } };
    const second = { ...first, id: "second-log", amountBaseUnits: "234566", tokenDecimals: null,
      valuation: { ...first.valuation, amount: { atoms: "12505", scale: 3 } } };
    const ignored = { ...first, id: "wrong-decimals", tokenDecimals: 8, amountBaseUnits: "999999",
      valuation: { ...first.valuation, amount: { atoms: "999999", scale: 2 } } };
    const [entry] = present([{ ...fromAction(send), transfers: [first, second, ignored, transfer("incoming", true)] }]);
    expect(entry).toMatchObject({ detailAmount: "−~1.23 USDC", detailValue: "−$37.51" });
  });

  test("does not value an aggregate with an unpriced matching log", () => {
    const send = action("confirmed");
    send.action.amounts = [send.action.amounts[0]!];
    const first = transfer("outgoing", true);
    const second = { ...transfer("outgoing"), id: "second-log", amountBaseUnits: "234566" };
    expect(present([{ ...fromAction(send), transfers: [first, second] }])[0]?.detailValue).toBe("Unknown");
  });

  test("does not combine matching logs quoted in different currencies", () => {
    const send = action("confirmed");
    send.action.amounts = [send.action.amounts[0]!];
    const first = transfer("outgoing", true);
    const second = { ...transfer("outgoing", true), id: "second-log", amountBaseUnits: "234566",
      valuation: { status: "priced" as const, currency: "EUR" as const, amount: { atoms: "1250", scale: 2 },
        method: "peg" as const, peg: "EUR" as const, close: null, fx: null } };
    expect(present([{ ...fromAction(send), transfers: [first, second] }])[0]?.detailValue).toBe("Unknown");
  });

  test("does not value matching logs when their quantity differs from the action amount", () => {
    const send = action("confirmed");
    send.action.amounts = [send.action.amounts[0]!];
    const first = transfer("outgoing", true);
    const second = { ...first, id: "second-log", amountBaseUnits: "234567" };
    expect(present([{ ...fromAction(send), transfers: [first, second] }])[0]?.detailValue).toBe("Unknown");
  });

  test("trades keep two legs without a value line or asset row", () => {
    const trade = action("confirmed");
    trade.action.kind = "trade";
    trade.action.metadata = {
      product: "trade", provider: "cdp-swaps", direction: "buy", network: { name: "Base", chainId: 8453 },
      assetId: "cbbtc", assetName: "Bitcoin",
      fromAsset: { id: "usdc", symbol: "USDC", decimals: 6, address: TOKEN },
      toAsset: { id: "cbbtc", symbol: "cbBTC", decimals: 8, address: TOKEN },
      fromAmountBaseUnits: "1234567", expectedToAmountBaseUnits: "500000", minimumToAmountBaseUnits: "450000",
      slippageBps: 100, fees: [], approval: "permit2-exact", quoteBlockNumber: "123", quotedAt: TIME,
      permitDeadline: "123", executionDeadline: "123",
    };
    const [entry] = present([{ ...fromAction(trade), transfers: [transfer("outgoing", true)] }]);
    expect(entry?.detailValue).toBeUndefined();
    expect(entry?.detailAsset).toBeUndefined();
    expect(entry?.detail).toMatchObject({ facts: [{ label: "cbBTC contract", value: TOKEN, kind: "address" }, { label: "You receive", value: "0.50 USDC" }] });
  });

  test("supply-and-borrow keeps both legs without a value line or asset row", () => {
    const borrow = action("confirmed");
    borrow.action.kind = "borrow";
    borrow.action.metadata = {
      product: "borrow", operation: "supply-and-borrow", marketId: `0x${"1".repeat(64)}`,
      loanAsset: { id: "usdc", symbol: "USDC" }, collateralAsset: { id: "cbbtc", symbol: "cbBTC" },
      projectedHealthFactorWad: null, projectedLiquidationPriceRaw: null, borrowAprWad: "0",
      source: { blockNumber: "1", blockHash: `0x${"2".repeat(64)}`, blockTimestamp: TIME },
    };
    const [entry] = present([{ ...fromAction(borrow), transfers: [transfer("outgoing", true)] }]);
    expect(entry?.detailValue).toBeUndefined();
    expect(entry?.detailAsset).toBeUndefined();
  });

  test("USDC row amounts are denominated dollars with direction and estimate prefixes, while other tokens keep units", () => {
    const base = action("confirmed");
    const usdc: MoneyActionAmount = { assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "123456789012", direction: "spend", estimated: true };
    const withAmount = (amount: MoneyActionAmount) => ({ ...base, action: { ...base.action, amounts: [amount] } });
    expect(present([fromAction(withAmount(usdc))])[0]?.amount).toBe("−~$123,456.78");
    expect(present([fromAction(withAmount({ ...usdc, direction: "receive" }))])[0]?.amount).toBe("+~$123,456.78");
    expect(present([fromAction(withAmount({ ...usdc, symbol: "BTC", estimated: false }))])[0]?.amount).toMatch(/BTC/);
  });
});

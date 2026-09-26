import { describe, expect, test } from "bun:test";
import type { RecentMoneyActionOperation } from "@/shared/actions/contracts/list";
import type { ActivityTransfer } from "./types";
import type { ActivityFeedItem } from "./activity-feed";
import { presentActivityLedgerItems } from "./activity-ledger-items";

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
function fromAction(value: RecentMoneyActionOperation): ActivityFeedItem {
  return { kind: "action", id: value.action.id, timestamp: value.updatedAt, operation: value, transfers: [] };
}

const present = (items: ActivityFeedItem[]) => presentActivityLedgerItems(items, { regionId: "US", timeZone: "UTC" });

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

  test("maps transfer directions, full counterparties, exact quantities and priced fiat", () => {
    const [incoming, outgoing, self] = present([
      fromTransfer(transfer("incoming", true)), fromTransfer(transfer("outgoing")), fromTransfer(transfer("self")),
    ]);
    expect(incoming).toMatchObject({ title: "Received", direction: "in", amount: "+$25.00", amountContext: "+1.00 USDC", detailAmount: "+1.000001 USDC", mark: { kind: "asset", assetKey: expect.any(String) }, detail: { counterpartyLabel: "From", counterparty: OTHER, network: "Base", facts: [{ label: "Value", value: "+$25.00" }], transaction: { value: HASH, display: "0xaaaaaaaa…aaaaaaaa", explorer: { href: `https://basescan.org/tx/${HASH}` } } } });
    expect(outgoing).toMatchObject({ title: "Sent", direction: "out", amount: "−1.00 USDC", detailAmount: "−1.000001 USDC", detail: { counterpartyLabel: "To", counterparty: OTHER, facts: [] } });
    expect(self).toMatchObject({ title: "Self transfer", direction: "none", amount: "1.00 USDC", detailAmount: "1.000001 USDC", detail: { counterpartyLabel: "To" } });
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
      amountBaseUnits: "123456789", tokenImageUrl: "https://example.com/token.png" };
    const [item] = present([fromTransfer(unknown)]);
    expect(item).toMatchObject({ amount: "+123456789 base units", detailAmount: "+123456789 base units",
      mark: { imageUrl: "https://example.com/token.png" },
      activateLabel: "View received unknown token transaction details", detail: { facts: [] } });
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
      { label: "Payout handle", value: "alice" }, { label: "Approximate receive", value: "≈ 1.50 USD" },
      { label: "Estimated delivery", value: "About 2 min" },
      { label: "You receive", value: "0.5 USDC" },
    ] });
    expect(JSON.stringify(item?.detail)).not.toContain("escrow");
  });

  test("formats primary and secondary action amounts without leaking source internals", () => {
    const [item] = present([fromAction(action("unknown")), fromTransfer(transfer())]);
    expect(item).toMatchObject({ title: "Send USDC", amount: "−~1.23 USDC", detailAmount: "−~1.234567 USDC", direction: "out", detail: { operation: "Send", facts: [{ label: "You receive", value: "0.5 USDC" }] } });
    for (const value of present([fromAction(action("unknown")), fromTransfer(transfer())])) {
      const detail = JSON.stringify(value.detail);
      expect(detail).not.toContain(TOKEN);
      expect(detail).not.toContain("action-id");
      expect(detail).not.toContain("150");
      const facts = value.detail.family === "home-action" || value.detail.family === "onchain-transfer" ? value.detail.facts ?? [] : [];
      expect(facts.every((fact) => !/token contract|action id|block number/i.test(fact.label))).toBe(true);
    }
  });
});

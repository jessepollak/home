import { describe, expect, test } from "bun:test";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { parseRecentMoneyActions, readRecentActionsIncomplete, readRecentActionsTruncated } from "./list";

const session: VerifiedAccountSession = {
  user: { subject: "subject-a" },
  smartAccount: { address: "0x1111111111111111111111111111111111111111", chainId: 8453 },
  accountProvider: "cdp-embedded",
};
const transactionHash = `0x${"a".repeat(64)}` as const;

function row(address = session.smartAccount!.address, status = "confirmed") {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    provider: "cdp-embedded",
    kind: "send",
    summary: {
      title: "Send USDC",
      amounts: [{ assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "1", direction: "spend" }],
      warnings: ["Network fee shown by wallet."],
      expiresAt: "2026-09-12T05:10:00.000Z",
    },
    status,
    transactionHash,
    createdAt: "2026-09-12T05:00:00.000Z",
    confirmedAt: "2026-09-12T05:02:00.000Z",
    owner: { subject: "subject-a", address, chainId: 8453, accountProvider: "cdp-embedded" },
  };
}

describe("recent Home action activity", () => {
  test("retains a card allowance with zero amount entries but rejects mismatched or malformed metadata", () => {
    const metadata = { product: "card", operation: "set-allowance", provider: "bridge", mode: "production",
      token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", spender: "0x65bf8b55eedef53c094e40003a03390de744df33",
      allowanceBaseUnits: "25000000", previousAllowanceBaseUnits: "0", maximumBaseUnits: "100000000", source: { blockNumber: "100" } };
    const card = { ...row(), kind: "card-allowance", summary: { ...row().summary, title: "Set card spending limit", amounts: [], metadata } };
    expect(parseRecentMoneyActions({ actions: [card] }, session)[0]?.action).toMatchObject({ kind: "card-allowance", amounts: [], metadata });
    expect(parseRecentMoneyActions({ actions: [{ ...card, summary: { ...card.summary, amounts: row().summary.amounts } }] }, session)).toEqual([]);
    expect(parseRecentMoneyActions({ actions: [{ ...card, kind: "send" }] }, session)).toEqual([]);
    expect(parseRecentMoneyActions({ actions: [{ ...card, summary: { ...card.summary, metadata: { ...metadata, spender: "not-an-address" } } }] }, session)).toEqual([]);
  });
  test("rejects invalid top-level responses without hiding malformed individual records", () => {
    for (const value of [null, [], {}, { actions: null }, { actions: {} }]) {
      expect(() => parseRecentMoneyActions(value, session)).toThrow("Recent actions response is invalid.");
    }
    expect(parseRecentMoneyActions({ actions: [null, { ...row(), status: "legacy" }, row("0x3333333333333333333333333333333333333333"), row()] }, session)).toHaveLength(1);
    expect(parseRecentMoneyActions(null, { ...session, smartAccount: null })).toEqual([]);
  });

  test("accepts only the full verified owner tuple", () => {
    expect(parseRecentMoneyActions({ actions: [row()] }, session)).toHaveLength(1);
    expect(parseRecentMoneyActions({ actions: [row("0x3333333333333333333333333333333333333333")] }, session)).toEqual([]);
  });

  test("drops rows whose amount members are not atomic amounts", () => {
    const amount = row().summary.amounts[0];
    const badDecimals = { ...row(), summary: { ...row().summary, amounts: [{ ...amount, decimals: -1 }] } };
    const badUnits = { ...row(), summary: { ...row().summary, amounts: [{ ...amount, amountBaseUnits: "01" }] } };
    const overLimit = { ...row(), summary: { ...row().summary, amounts: [{ ...amount, amountBaseUnits: "1".repeat(79) }] } };
    const badMember = { ...row(), summary: { ...row().summary, amounts: [null] } };
    const badWarning = { ...row(), summary: { ...row().summary, warnings: [null] } };
    expect(parseRecentMoneyActions({ actions: [badDecimals, badUnits, overLimit, badMember, row()] }, session)).toHaveLength(1);
    expect(parseRecentMoneyActions({ actions: [badWarning] }, session)).toEqual([]);
  });

  test("keeps a non-cash-out row whose token decimals exceed the cash-out escrow bound", () => {
    const tradeRow = { ...row(), kind: "trade", summary: { ...row().summary, amounts: [{ ...row().summary.amounts[0], decimals: 36 }] } };
    expect(parseRecentMoneyActions({ actions: [tradeRow] }, session)).toHaveLength(1);
    const cashoutRow = { ...row(), kind: "cash-out", summary: { ...row().summary, amounts: [{ ...row().summary.amounts[0], decimals: 21 }] } };
    expect(parseRecentMoneyActions({ actions: [cashoutRow] }, session)).toEqual([]);
  });

  test("preserves typed cash-out identity without parsing titles or calldata", () => {
    const cashout = {
      ...row(),
      kind: "cash-out",
      summary: {
        ...row().summary,
        title: "Cash out with Peer",
        metadata: {
          product: "cashout",
          operation: "deposit",
          providerId: "peer",
          providerName: "Peer",
          environment: "sandbox",
          platform: "cashapp",
          platformLabel: "Cash App",
          currency: "USD",
          canonicalHandle: "$alice",
          approximateFiatAmount: "10.00",
          minConversionRate: "1000000000000000000",
          intentAmountRange: { min: "10000000", max: "10000000" },
          estimateAsOf: "2026-09-14T12:00:00.000Z",
          escrow: "0x777777779d229cdF3110e9de47943791c26300Ef",
        },
      },
    };
    expect(parseRecentMoneyActions({ actions: [cashout] }, session)[0]?.action.metadata).toMatchObject({
      product: "cashout", providerId: "peer", platform: "cashapp", canonicalHandle: "$alice",
    });
    const withPayee = { ...cashout, summary: { ...cashout.summary,
      metadata: { ...cashout.summary.metadata, payeeHash: `0x${"ab".repeat(32)}` } } };
    expect(parseRecentMoneyActions({ actions: [withPayee] }, session)[0]?.action.metadata).toMatchObject({
      payeeHash: `0x${"ab".repeat(32)}`,
    });
    const quote = {
      fees: { provider: { amount: "0", currency: "USD" }, network: null, operator: null }, rate: null,
      receive: { amount: "10.00", currency: "USD", approximate: true }, arrival: { source: "unknown" },
    };
    const withQuote = { ...cashout, summary: { ...cashout.summary, metadata: { ...cashout.summary.metadata, quote } } };
    expect(parseRecentMoneyActions({ actions: [withQuote] }, session)[0]?.action.metadata).toMatchObject({ quote });
    const badQuote = { ...cashout, summary: { ...cashout.summary, metadata: { ...cashout.summary.metadata, quote: { ...quote, rate: { from: "USDC", to: "USD", value: "0" } } } } };
    expect(parseRecentMoneyActions({ actions: [badQuote] }, session)[0]?.action.metadata).toBeUndefined();
  });

  test("preserves validated savings metadata for confirmed Activity rows", () => {
    const savings = {
      ...row(),
      kind: "savings-deposit",
      summary: {
        ...row().summary,
        metadata: {
          product: "savings",
          operation: "deposit",
          vaultAddress: "0x2222222222222222222222222222222222222222",
          vaultName: "Configured USDC vault",
          network: { name: "Base", chainId: 8453 },
          feeWad: "0",
          limitBaseUnits: "500000000",
          previewSharesBaseUnits: "1000000000000000000",
          shareDecimals: 18,
          exchangeConstraint: "deposit-minimum-shares-or-revert",
          minimumSharesBaseUnits: "999000000000000000",
          discoveryRate: { status: "unavailable", netApy: null, fetchedAt: null, stateAsOf: null },
          source: {
            blockNumber: "51026404",
            blockHash: `0x${"ab".repeat(32)}`,
            blockTimestamp: "1789214400",
          },
        },
      },
    };

    expect(parseRecentMoneyActions({ actions: [savings] }, session)[0]?.action.metadata)
      .toMatchObject({ product: "savings", operation: "deposit", minimumSharesBaseUnits: "999000000000000000" });
    const legacy = {
      ...savings,
      summary: {
        ...savings.summary,
        metadata: {
          ...savings.summary.metadata,
          exchangeConstraint: "deposit-preview-no-minimum-shares",
          minimumSharesBaseUnits: undefined,
        },
      },
    };
    expect(parseRecentMoneyActions({ actions: [legacy] }, session)[0]?.action.metadata)
      .toMatchObject({ product: "savings", exchangeConstraint: "deposit-preview-no-minimum-shares" });
  });

  test("keeps pending rows without transaction hashes and rejects non-derived statuses", () => {
    const pending = { ...row(undefined, "pending"), transactionHash: undefined };
    const parsed = parseRecentMoneyActions({ actions: [pending] }, session);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.status).toBe("pending");
    expect(parsed[0]?.transactionHash).toBeUndefined();
    expect(parseRecentMoneyActions({ actions: [{ ...row(), status: "rejected" }] }, session)).toEqual([]);
  });

  test("carries the recorded submission time separately from the confirmation time", () => {
    const [submitted] = parseRecentMoneyActions({ actions: [{ ...row(undefined, "pending"), submittedAt: "2026-09-12T05:06:00.000Z" }] }, session);
    expect(submitted?.updatedAt).toBe("2026-09-12T05:02:00.000Z");
    expect(submitted?.submittedAt).toBe("2026-09-12T05:06:00.000Z");
    expect(parseRecentMoneyActions({ actions: [{ ...row(undefined, "pending"), submittedAt: "not-a-date" }] }, session)[0]?.submittedAt).toBeUndefined();
    expect(parseRecentMoneyActions({ actions: [row(undefined, "pending")] }, session)[0]?.submittedAt).toBeUndefined();
    const [settled] = parseRecentMoneyActions({ actions: [{ ...row(), settledAt: "2026-09-12T05:06:30.000Z" }] }, session);
    expect(settled?.settledAt).toBe("2026-09-12T05:06:30.000Z");
    expect(parseRecentMoneyActions({ actions: [{ ...row(), settledAt: "not-a-date" }] }, session)[0]?.settledAt).toBeUndefined();
  });

  test("reports a rejected same-owner cash-out row as incomplete", () => {
    const malformedDeposit = { ...row(), kind: "cash-out", summary: { ...row().summary, warnings: undefined } };
    expect(readRecentActionsIncomplete({ actions: [malformedDeposit] }, session)).toBe(true);
    const malformedWithdraw = { ...row(), kind: "cash-out-withdraw", summary: { ...row().summary, amounts: null } };
    expect(readRecentActionsIncomplete({ actions: [malformedWithdraw] }, session)).toBe(true);
    const nullAmount = { ...row(), kind: "cash-out", summary: { ...row().summary, amounts: [null] } };
    expect(readRecentActionsIncomplete({ actions: [nullAmount] }, session)).toBe(true);
    expect(parseRecentMoneyActions({ actions: [nullAmount] }, session)).toEqual([]);
    const partialAmount = { ...row(), kind: "cash-out-withdraw", summary: { ...row().summary, amounts: [{ assetId: "usdc" }] } };
    expect(readRecentActionsIncomplete({ actions: [partialAmount] }, session)).toBe(true);
    const corruptKind = { ...malformedDeposit, kind: undefined, cashout: { version: 1 } };
    expect(readRecentActionsIncomplete({ actions: [corruptKind] }, session)).toBe(true);
    const validAmount = { ...row(), kind: "cash-out", summary: { ...row().summary, amounts: [{ assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "1", direction: "spend" }] } };
    expect(readRecentActionsIncomplete({ actions: [validAmount] }, session)).toBe(false);
    expect(parseRecentMoneyActions({ actions: [validAmount] }, session)).toHaveLength(1);
    const hugeDecimals = { ...row(), kind: "cash-out", summary: { ...row().summary, amounts: [{ assetId: "usdc", symbol: "USDC", decimals: 400, amountBaseUnits: "1", direction: "spend" }] } };
    expect(readRecentActionsIncomplete({ actions: [hugeDecimals] }, session)).toBe(true);
    const eighteenDecimals = { ...row(), kind: "cash-out", summary: { ...row().summary, amounts: [{ assetId: "usdc", symbol: "USDC", decimals: 18, amountBaseUnits: "1", direction: "spend" }] } };
    expect(readRecentActionsIncomplete({ actions: [eighteenDecimals] }, session)).toBe(false);
    const twentyDecimals = { ...row(), kind: "cash-out", summary: { ...row().summary, amounts: [{ assetId: "usdc", symbol: "USDC", decimals: 20, amountBaseUnits: "1", direction: "spend" }] } };
    expect(readRecentActionsIncomplete({ actions: [twentyDecimals] }, session)).toBe(false);
    const twentyOneDecimals = { ...row(), kind: "cash-out", summary: { ...row().summary, amounts: [{ assetId: "usdc", symbol: "USDC", decimals: 21, amountBaseUnits: "1", direction: "spend" }] } };
    expect(readRecentActionsIncomplete({ actions: [twentyOneDecimals] }, session)).toBe(true);
    const withdrawMetadata = { product: "cashout", operation: "withdraw", providerId: "peer", providerName: "Peer", environment: "sandbox", platform: "cashapp", platformLabel: "Cash App", currency: "USD", approximateFiatAmount: "1", minConversionRate: "1", intentAmountRange: { min: "1", max: "2" }, estimateAsOf: "2026-09-14T12:00:00.000Z", escrow: "0x777777779d229cdF3110e9de47943791c26300Ef", depositId: "escrow-1" };
    const withdrawMissingMetadata = { ...row(), kind: "cash-out-withdraw", summary: { ...row().summary, amounts: [{ assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "1", direction: "receive" }] } };
    expect(readRecentActionsIncomplete({ actions: [withdrawMissingMetadata] }, session)).toBe(true);
    const validWithdraw = { ...withdrawMissingMetadata, summary: { ...withdrawMissingMetadata.summary, metadata: withdrawMetadata } };
    expect(readRecentActionsIncomplete({ actions: [validWithdraw] }, session)).toBe(false);
    const depositWithWithdrawMetadata = { ...validAmount, summary: { ...validAmount.summary, metadata: withdrawMetadata } };
    const emptyDepositLink = { ...validWithdraw, summary: { ...validWithdraw.summary, metadata: { ...withdrawMetadata, depositId: "" } } };
    expect(readRecentActionsIncomplete({ actions: [emptyDepositLink] }, session)).toBe(true);
    const blankDepositLink = { ...validWithdraw, summary: { ...validWithdraw.summary, metadata: { ...withdrawMetadata, depositId: "   " } } };
    expect(readRecentActionsIncomplete({ actions: [blankDepositLink] }, session)).toBe(true);
    expect(parseRecentMoneyActions({ actions: [emptyDepositLink] }, session)).toEqual([]);
    expect(readRecentActionsIncomplete({ actions: [depositWithWithdrawMetadata] }, session)).toBe(true);
    const unknownKindWithCorruptProgress = { ...row(), kind: "legacy", cashout: "broken" };
    expect(readRecentActionsIncomplete({ actions: [unknownKindWithCorruptProgress] }, session)).toBe(true);
    const unknownKindWithNullProgress = { ...row(), kind: "legacy", cashout: null };
    expect(readRecentActionsIncomplete({ actions: [unknownKindWithNullProgress] }, session)).toBe(true);
    const brokenBaseUnits = { ...row(), kind: "cash-out", summary: { ...row().summary, amounts: [{ assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "broken", direction: "spend" }] } };
    expect(readRecentActionsIncomplete({ actions: [brokenBaseUnits] }, session)).toBe(true);
    expect(parseRecentMoneyActions({ actions: [brokenBaseUnits] }, session)).toEqual([]);
    const progressOnSend = { ...row(), cashout: { version: 1 } };
    expect(readRecentActionsIncomplete({ actions: [progressOnSend] }, session)).toBe(true);
    expect(parseRecentMoneyActions({ actions: [progressOnSend] }, session)).toEqual([]);
    const foreign = { ...malformedDeposit, owner: { ...malformedDeposit.owner, subject: "other" } };
    expect(readRecentActionsIncomplete({ actions: [foreign] }, session)).toBe(false);
    expect(readRecentActionsIncomplete({ actions: [{ ...malformedDeposit, owner: { ...malformedDeposit.owner, address: "0x3333333333333333333333333333333333333333" } }] }, session)).toBe(false);
    expect(readRecentActionsIncomplete({ actions: [{ ...malformedDeposit, owner: { ...malformedDeposit.owner, accountProvider: "base-account" } }] }, session)).toBe(false);
    const malformedOtherKind = { ...row(), summary: { ...row().summary, warnings: undefined } };
    expect(readRecentActionsIncomplete({ actions: [malformedOtherKind] }, session)).toBe(false);
    expect(readRecentActionsIncomplete({ actions: [row()] }, session)).toBe(false);
    expect(readRecentActionsIncomplete({ actions: [null] }, session)).toBe(false);
    expect(readRecentActionsIncomplete({ actions: {} }, session)).toBe(false);
    expect(readRecentActionsIncomplete(null, { ...session, smartAccount: null })).toBe(false);
  });

  test("reads only an explicit truncation flag", () => {
    expect(readRecentActionsTruncated({ actions: [], truncated: true })).toBe(true);
    for (const value of [{ actions: [] }, { actions: [], truncated: false }, { actions: [], truncated: "true" }, null, "truncated"])
      expect(readRecentActionsTruncated(value)).toBe(false);
  });
});

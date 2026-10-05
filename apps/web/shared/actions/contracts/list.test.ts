import { getAddress } from "viem";
import { describe, expect, test } from "bun:test";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { parseRecentActionsPayload, parseRecentMoneyActions, readRecentActionsIncomplete, readRecentActionsTruncated } from "./list";
import { MAX_MONEY_ACTION_AMOUNT_DECIMALS } from "@/shared/money-actions/types";

const session: VerifiedAccountSession = {
  user: { subject: "subject-a" },
  smartAccount: { address: "0x1111111111111111111111111111111111111111", chainId: 8453 },
  accountProvider: "cdp-embedded",
};
const transactionHash = `0x${"a".repeat(64)}` as const;
function smartAccountAddress(): string {
  const account = session.smartAccount;
  if (!account) throw new Error("test session must have a smart account");
  return account.address;
}


function row(address = smartAccountAddress(), status = "confirmed") {
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
  test("parses retained savings separately without adding them to Activity", () => {
    const retained = { ...row(undefined, "unknown"), kind: "savings-deposit" };
    const payload = { actions: [], retainedSavingsDeposits: [retained] };
    expect(parseRecentActionsPayload(payload, session)).toMatchObject({
      operations: [], retainedSavingsDeposits: [{ action: { id: retained.id, kind: "savings-deposit" }, status: "unknown" }],
      retainedSavingsDepositsUnavailable: false, unparsedSavingsDeposits: [],
    });
    expect(parseRecentMoneyActions(payload, session)).toEqual([]);
  });
  test("retained savings require the complete owner tuple and savings-deposit kind", () => {
    const retained = { ...row(), kind: "savings-deposit" };
    const foreign = [
      { ...retained, owner: { ...retained.owner, subject: "other" } },
      { ...retained, owner: { ...retained.owner, address: "0x3333333333333333333333333333333333333333" } },
      { ...retained, owner: { ...retained.owner, chainId: 1 } },
      { ...retained, owner: { ...retained.owner, accountProvider: "base-account" } },
    ];
    const parsed = parseRecentActionsPayload({ actions: [], retainedSavingsDeposits: [...foreign, retained] }, session);
    expect(parsed.retainedSavingsDeposits).toHaveLength(1);
    expect(parsed.unparsedSavingsDeposits).toEqual([]);
    expect(parsed.retainedSavingsDepositsUnavailable).toBe(false);
    expect(parseRecentActionsPayload({ actions: [], retainedSavingsDeposits: [retained] }, { ...session, smartAccount: null }).retainedSavingsDeposits).toEqual([]);
  });
  test("retained malformed same-owner deposits become unresolved stubs", () => {
    const malformed = { ...row(undefined, "unknown"), kind: "savings-deposit",
      summary: { ...row().summary, amounts: [null], metadata: { product: "savings", operation: "deposit", vaultAddress: smartAccountAddress() } } };
    expect(parseRecentActionsPayload({ actions: [], retainedSavingsDeposits: [malformed, { ...malformed, owner: { ...malformed.owner, subject: "other" } }] }, session))
      .toMatchObject({ retainedSavingsDeposits: [], unparsedSavingsDeposits: [{ status: "unknown", vaultAddress: smartAccountAddress() }] });
  });
  test("a malformed retained element holds savings unresolved", () => {
    const retained = { ...row(undefined, "unknown"), kind: "savings-deposit" };
    const owner = retained.owner;
    for (const element of [null, {}, { id: "row-without-kind" }, { kind: "send", id: "other-kind" }, [], ["savings-deposit"],
      { kind: "savings-deposit", status: "unknown" },
      { kind: "savings-deposit", owner: { ...owner, subject: undefined } },
      { kind: "savings-deposit", owner: { ...owner, address: "not-an-address" } }]) {
      const parsed = parseRecentActionsPayload({ actions: [], retainedSavingsDeposits: [retained, element] }, session);
      expect(parsed.retainedSavingsDeposits).toHaveLength(1);
      expect(parsed.retainedSavingsDepositsUnavailable).toBe(true);
    }
  });
  test("retained ids already in recent operations are skipped, including malformed copies", () => {
    const retained = { ...row(), kind: "savings-deposit" };
    const parsed = parseRecentActionsPayload({ actions: [retained], retainedSavingsDeposits: [retained, { ...retained, summary: null }] }, session);
    expect(parsed.operations).toHaveLength(1);
    expect(parsed.retainedSavingsDeposits).toEqual([]);
    expect(parsed.unparsedSavingsDeposits).toEqual([]);
  });
  test("omitted or undefined retained fields default empty and only a true unavailable flag is accepted", () => {
    for (const payload of [{ version: 1, truncated: false, actions: [] }, { version: 1, truncated: false, actions: [], retainedSavingsDeposits: undefined }]) {
      expect(parseRecentActionsPayload(payload, session)).toEqual({
        operations: [], retainedSavingsDeposits: [], retainedSavingsDepositsUnavailable: false, unparsedSavingsDeposits: [], truncated: false, incomplete: false,
      });
    }
    expect(parseRecentActionsPayload({ actions: [], retainedSavingsDepositsUnavailable: true }, session).retainedSavingsDepositsUnavailable).toBe(true);
    expect(parseRecentActionsPayload({ actions: [], retainedSavingsDepositsUnavailable: "true" }, session).retainedSavingsDepositsUnavailable).toBe(false);
  });
  test.each([null, {}, "invalid"])("a present non-array retained field %j holds savings unresolved", (field) => {
    expect(parseRecentActionsPayload({ version: 1, truncated: false, actions: [], retainedSavingsDeposits: field }, session)).toEqual({
      operations: [], retainedSavingsDeposits: [], retainedSavingsDepositsUnavailable: true, unparsedSavingsDeposits: [], truncated: false, incomplete: false,
    });
  });
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
    expect(parseRecentMoneyActions({ actions: [{ ...row(), owner: { ...row().owner, chainId: 1 } }, row()] }, session)).toHaveLength(1);
    expect(parseRecentMoneyActions({ actions: [{ ...row(), owner: { ...row().owner, chainId: undefined } }] }, session)).toEqual([]);
  });
  test("rejects malformed amounts and warnings without dropping other valid rows", () => {
    const valid = row();
    const badAmount = { ...valid, summary: { ...valid.summary, amounts: [{ ...valid.summary.amounts[0], amountBaseUnits: "not-a-number" }] } };
    const badWarnings = { ...valid, summary: { ...valid.summary, warnings: ["ok", null, 7] } };
    expect(parseRecentMoneyActions({ actions: [badAmount, badWarnings, valid] }, session)).toHaveLength(1);
  });
  test("keeps issued amounts across the full decimal range and drops only amounts beyond it", () => {
    const valid = row();
    const withDecimals = (decimals: unknown) => ({ ...valid, kind: "trade", summary: { ...valid.summary, amounts: [{ ...valid.summary.amounts[0], decimals }] } });
    expect(parseRecentMoneyActions({ actions: [withDecimals(21), withDecimals(36), withDecimals(MAX_MONEY_ACTION_AMOUNT_DECIMALS)] }, session)).toHaveLength(3);
    expect(parseRecentMoneyActions({ actions: [withDecimals(MAX_MONEY_ACTION_AMOUNT_DECIMALS + 1), withDecimals(20.5), withDecimals(-1)] }, session)).toEqual([]);
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
  test("preserves legacy borrow Activity metadata without a risk flag", () => {
    const metadata = { product: "borrow", operation: "withdraw-collateral", marketId: `0x${"1".repeat(64)}`,
      loanAsset: { id: "usdc", symbol: "USDC" }, collateralAsset: { id: "eth", symbol: "ETH" },
      projectedHealthFactorWad: null, projectedLiquidationPriceRaw: null, borrowAprWad: "0",
      source: { blockNumber: "1", blockHash: `0x${"2".repeat(64)}`, blockTimestamp: "1789214400" } };
    const legacy = { ...row(), kind: "withdraw-collateral", summary: { ...row().summary, metadata } };
    expect(parseRecentMoneyActions({ actions: [legacy] }, session)[0]?.action.metadata).toMatchObject({ product: "borrow", operation: "withdraw-collateral", marketId: metadata.marketId });
    expect(parseRecentMoneyActions({ actions: [legacy] }, session)[0]?.action.metadata).not.toHaveProperty("riskIncreased");
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
    const maxDecimals = { ...row(), kind: "cash-out", summary: { ...row().summary, amounts: [{ assetId: "usdc", symbol: "USDC", decimals: MAX_MONEY_ACTION_AMOUNT_DECIMALS, amountBaseUnits: "1", direction: "spend" }] } };
    expect(readRecentActionsIncomplete({ actions: [maxDecimals] }, session)).toBe(true);
    const beyondBoundDecimals = { ...row(), kind: "cash-out", summary: { ...row().summary, amounts: [{ assetId: "usdc", symbol: "USDC", decimals: MAX_MONEY_ACTION_AMOUNT_DECIMALS + 1, amountBaseUnits: "1", direction: "spend" }] } };
    expect(readRecentActionsIncomplete({ actions: [beyondBoundDecimals] }, session)).toBe(true);
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

  test("only version 1 with explicit false truncation is exhaustive", () => {
    expect(readRecentActionsTruncated({ version: 1, actions: [], truncated: false })).toBe(false);
    expect(readRecentActionsTruncated({ version: 1, actions: [], truncated: true })).toBe(true);
    for (const value of [{ actions: [], truncated: false }, { version: 0, actions: [], truncated: false },
      { version: 2, actions: [], truncated: false }, { version: 1, actions: [] },
      { version: 1, actions: [], truncated: "false" }, null, [], "truncated"])
      expect(readRecentActionsTruncated(value)).toBe(true);
  });

  test("keeps receipt block numbers only for cash-out withdrawals with digit strings", () => {
    const metadata = { product: "cashout", operation: "withdraw", providerId: "peer", providerName: "Peer", environment: "sandbox",
      platform: "cashapp", platformLabel: "Cash App", currency: "USD", approximateFiatAmount: "1", minConversionRate: "1",
      intentAmountRange: { min: "1", max: "2" }, estimateAsOf: "2026-09-14T12:00:00.000Z",
      escrow: "0x777777779d229cdF3110e9de47943791c26300Ef", depositId: "escrow-1" };
    const withdrawal = { ...row(), kind: "cash-out-withdraw", summary: { ...row().summary, metadata } };
    for (const receiptBlockNumber of ["0", "12345678901234567890"]) {
      expect(parseRecentMoneyActions({ actions: [{ ...withdrawal, receiptBlockNumber }] }, session)[0]?.receiptBlockNumber).toBe(receiptBlockNumber);
    }
    for (const receiptBlockNumber of [undefined, null, 123, "", "-1", "1.5", "0x10", " 123 ", "bad"]) {
      const parsed = parseRecentMoneyActions({ actions: [{ ...withdrawal, receiptBlockNumber }] }, session);
      expect(parsed).toHaveLength(1);
      expect(parsed[0]).not.toHaveProperty("receiptBlockNumber");
    }
    for (const kind of ["send", "cash-out"]) {
      expect(parseRecentMoneyActions({ actions: [{ ...row(), kind, receiptBlockNumber: "123" }] }, session)[0]).not.toHaveProperty("receiptBlockNumber");
    }
  });
});

test("recent action hash fields canonicalize mixed-case and reject malformed wire values", () => {
  const checksum = getAddress("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
  const input = { ...row(checksum), providerHandle: `0x${"Ab".repeat(32)}`, transactionHash: `0x${"Cd".repeat(32)}` };
  const parsed = parseRecentMoneyActions({ actions: [input] }, { ...session, smartAccount: { address: checksum, chainId: 8453 } });
  expect(String(parsed[0]?.transactionHash)).toBe(`0x${"cd".repeat(32)}`);
  expect(String(parsed[0]?.userOperationHash)).toBe(`0x${"ab".repeat(32)}`);
  expect(parseRecentMoneyActions({ actions: [{ ...input, owner: { ...input.owner, address: checksum.replace("A", "a") } }] }, { ...session, smartAccount: { address: checksum, chainId: 8453 } })).toEqual([]);
  expect(parseRecentMoneyActions({ actions: [{ ...input, transactionHash: "0xno" }] }, { ...session, smartAccount: { address: checksum, chainId: 8453 } })[0]?.transactionHash).toBeUndefined();
});

test("borrow action metadata carries canonical market and source hashes only", () => {
  const metadata = { product: "borrow", operation: "borrow", marketId: `0x${"Ab".repeat(32)}`,
    loanAsset: { id: "usdc", symbol: "USDC" }, collateralAsset: { id: "asset", symbol: "ASSET" },
    source: { blockNumber: "1", blockHash: `0x${"Cd".repeat(32)}`, blockTimestamp: "1" } };
  const withMetadata = (value: unknown) => ({ ...row(), summary: { ...row().summary, metadata: value } });
  const parsed = parseRecentMoneyActions({ actions: [withMetadata(metadata)] }, session)[0]?.action.metadata;
  expect(parsed?.product === "borrow" ? String(parsed.marketId) : null).toBe(`0x${"ab".repeat(32)}`);
  expect(parsed?.product === "borrow" ? String(parsed.source.blockHash) : null).toBe(`0x${"cd".repeat(32)}`);
  const invalid = parseRecentMoneyActions({ actions: [withMetadata({ ...metadata, source: { ...metadata.source, blockHash: "0x1234" } })] }, session)[0]?.action.metadata;
  expect(invalid).toBeUndefined();
});

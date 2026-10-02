import { describe, expect, test } from "bun:test";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { parsePendingActionResponse } from "./get";

const ID = "11111111-1111-4111-8111-111111111111";
const ADDRESS = "0x1111111111111111111111111111111111111111" as const;
const VAULT = "0x2222222222222222222222222222222222222222" as const;
const session: VerifiedAccountSession = {
  user: { subject: "subject-a" },
  smartAccount: { address: ADDRESS, chainId: 8453 },
  accountProvider: "cdp-embedded",
};

function pendingSavings(operation: "deposit" | "withdraw") {
  return {
    id: ID,
    kind: operation === "deposit" ? "savings-deposit" : "savings-withdraw",
    summary: {
      title: operation === "deposit" ? "Deposit USDC" : "Withdraw USDC",
      amounts: [],
      warnings: [],
      expiresAt: "2099-09-12T00:00:00.000Z",
      metadata: {
        product: "savings",
        operation,
        vaultAddress: VAULT,
        vaultName: "Configured USDC vault",
        network: { name: "Base", chainId: 8453 },
        feeWad: "100000000000000000",
        limitBaseUnits: "500000000",
        previewSharesBaseUnits: "1000000000000000000",
        shareDecimals: 18,
        exchangeConstraint: operation === "deposit"
          ? "deposit-minimum-shares-or-revert"
          : "withdraw-exact-assets-or-revert",
        ...(operation === "deposit" ? { minimumSharesBaseUnits: "999000000000000000" } : {}),
        discoveryRate: {
          status: "current",
          netApy: "0.04",
          fetchedAt: "2026-09-12T12:00:01.000Z",
          stateAsOf: "2026-09-12T12:00:00.000Z",
        },
        source: {
          blockNumber: "51026404",
          blockHash: `0x${"ab".repeat(32)}`,
          blockTimestamp: "1789214400",
        },
      },
    },
    calls: [{ to: VAULT, data: "0x1234", value: "0" }],
    expiresAt: "2099-09-12T00:00:00.000Z",
  };
}

describe("pending action response parser", () => {
  test("resumes a card allowance without a money amount and rejects missing metadata", () => {
    const pending = pendingSavings("deposit");
    const metadata = { product: "card", operation: "revoke-allowance", provider: "bridge", mode: "sandbox",
      token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", spender: "0x65bf8b55eedef53c094e40003a03390de744df33",
      allowanceBaseUnits: "0", previousAllowanceBaseUnits: "25000000", maximumBaseUnits: null, source: { blockNumber: "100" } };
    const card = { ...pending, kind: "card-allowance", summary: { ...pending.summary, amounts: [], metadata } };
    expect(parsePendingActionResponse(card, ID, session)).toMatchObject({ kind: "card-allowance", amounts: [], metadata });
    expect(parsePendingActionResponse({ ...card, summary: { ...card.summary, metadata: undefined } }, ID, session)).toBeNull();
    expect(parsePendingActionResponse({ ...card, kind: "send" }, ID, session)).toBeNull();
  });
  test("preserves optional cash-out deposit payee hash on reload", () => {
    const value = pendingSavings("deposit");
    const metadata = {
      product: "cashout", operation: "deposit", providerId: "peer", providerName: "Peer", environment: "production",
      platform: "cashapp", platformLabel: "Cash App", currency: "USD", canonicalHandle: "Alice",
      approximateFiatAmount: "2", minConversionRate: "1", intentAmountRange: { min: "1000000", max: "1000000" },
      estimateAsOf: "2026-09-12T12:00:00.000Z", escrow: VAULT,
    };
    const cashout = { ...value, kind: "cash-out", summary: { ...value.summary, metadata } };
    expect(parsePendingActionResponse(cashout, ID, session)?.metadata).toMatchObject(metadata);
    const withPayee = { ...cashout, summary: { ...cashout.summary,
      metadata: { ...metadata, payeeHash: `0x${"ab".repeat(32)}` } } };
    expect(parsePendingActionResponse(withPayee, ID, session)?.metadata).toMatchObject(withPayee.summary.metadata);
  });
  test("keeps a reviewed cash-out quote on reload and refuses a malformed one", () => {
    const value = pendingSavings("deposit");
    const quote = {
      fees: { provider: { amount: "0", currency: "USD" }, network: null, operator: null }, rate: null,
      receive: { amount: "2", currency: "USD", approximate: true }, arrival: { source: "unknown" },
    };
    const metadata = {
      product: "cashout", operation: "deposit", providerId: "peer", providerName: "Peer", environment: "production",
      platform: "cashapp", platformLabel: "Cash App", currency: "USD", canonicalHandle: "Alice",
      approximateFiatAmount: "2", minConversionRate: "1", intentAmountRange: { min: "1000000", max: "1000000" },
      estimateAsOf: "2026-09-12T12:00:00.000Z", escrow: VAULT, quote,
    };
    const cashout = (next: unknown) => ({ ...value, kind: "cash-out", summary: { ...value.summary, metadata: next } });
    expect(parsePendingActionResponse(cashout(metadata), ID, session)?.metadata).toMatchObject({ quote });
    expect(parsePendingActionResponse(cashout({ ...metadata, quote: { ...quote, arrival: { source: "guess" } } }), ID, session)?.metadata).toBeUndefined();
  });
  test.each(["deposit", "withdraw"] as const)(
    "retains validated savings %s metadata on reload",
    (operation) => {
      const parsed = parsePendingActionResponse(pendingSavings(operation), ID, session);

      expect(parsed).toMatchObject({
        kind: operation === "deposit" ? "savings-deposit" : "savings-withdraw",
        metadata: {
          product: "savings",
          operation,
          vaultAddress: VAULT,
          source: { blockNumber: "51026404" },
        },
      });
    },
  );

  test("restores a validated USDC network fee on pending review", () => {
    const value = pendingSavings("deposit");
    const fee = { payment: "usdc", token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", paymaster: "0x2FAEB0760D4230Ef2aC21496Bb4F0b47D634FD4c", maxFeeBaseUnits: "100000", decimals: 6 } as const;
    const parsed = parsePendingActionResponse({ ...value, summary: { ...value.summary, networkFee: fee } }, ID, session);
    expect(parsed?.networkFee).toEqual({ ...fee, token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" });
  });

  test("rejects a malformed stored fee instead of treating it as a disabled policy", () => {
    const value = pendingSavings("deposit");
    expect(parsePendingActionResponse({ ...value, summary: { ...value.summary, networkFee: { payment: "usdc", maxFeeBaseUnits: "bad" } } }, ID, session)).toBeNull();
    expect(parsePendingActionResponse(value, ID, session)).not.toBeNull();
  });

  test("retains an already-stored legacy deposit on reload", () => {
    const value = pendingSavings("deposit");
    value.summary.metadata.exchangeConstraint = "deposit-preview-no-minimum-shares";
    value.summary.metadata = { ...value.summary.metadata, minimumSharesBaseUnits: undefined };
    expect(parsePendingActionResponse(value, ID, session)?.metadata).toMatchObject({
      product: "savings", exchangeConstraint: "deposit-preview-no-minimum-shares",
    });
  });
  test("restores legacy borrow metadata without a risk flag", () => {
    const value = pendingSavings("withdraw");
    const metadata = { product: "borrow", operation: "withdraw-collateral", marketId: `0x${"1".repeat(64)}`,
      loanAsset: { id: "usdc", symbol: "USDC" }, collateralAsset: { id: "eth", symbol: "ETH" },
      projectedHealthFactorWad: null, projectedLiquidationPriceRaw: null, borrowAprWad: "0",
      source: { blockNumber: "1", blockHash: `0x${"2".repeat(64)}`, blockTimestamp: "1789214400" } };
    const legacy = { ...value, kind: "withdraw-collateral", summary: { ...value.summary, metadata } };
    expect(parsePendingActionResponse(legacy, ID, session)?.metadata).toMatchObject({ product: "borrow", operation: "withdraw-collateral", marketId: metadata.marketId });
    expect(parsePendingActionResponse(legacy, ID, session)?.metadata).not.toHaveProperty("riskIncreased");
  });

  test("drops malformed savings metadata instead of restoring untrusted review facts", () => {
    const value = pendingSavings("deposit");
    value.summary.metadata.source.blockHash = "0x1234";

    const parsed = parsePendingActionResponse(value, ID, session);

    expect(parsed).not.toBeNull();
    expect(parsed?.metadata).toBeUndefined();
  });
});

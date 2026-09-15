import { describe, expect, test } from "bun:test";
import {
  labelForMoneyActionKind,
  labelForOperationStatus,
  presentOperationDetails,
  primaryOperationAmount,
} from "./operation-details";
import type { RecentMoneyActionOperation } from "./recent-operations";

const HASH = `0x${"a".repeat(64)}` as const;

function baseOperation(overrides: Partial<RecentMoneyActionOperation> = {}): RecentMoneyActionOperation {
  return {
    action: {
      id: "11111111-1111-4111-8111-111111111111",
      kind: "trade",
      title: "Trade USDC for ETH",
      amounts: [
        {
          assetId: "usdc",
          symbol: "USDC",
          decimals: 6,
          amountBaseUnits: "1234567",
          direction: "spend",
        },
      ],
      warnings: [],
      createdAt: "2026-09-08T05:00:00.000Z",
      expiresAt: "2026-09-08T05:10:00.000Z",
    },
    status: "confirmed",
    transactionHash: HASH,
    createdAt: "2026-09-08T05:00:00.000Z",
    updatedAt: "2026-09-08T05:03:00.000Z",
    ...overrides,
  };
}

function withdrawalOperation(): RecentMoneyActionOperation {
  return baseOperation({
    action: {
      ...baseOperation().action,
      kind: "savings-withdraw",
      title: "Withdraw USDC from Morpho",
      amounts: [
        {
          assetId: "eip155:8453/erc20:vault",
          symbol: "vault shares",
          decimals: 18,
          amountBaseUnits: "999999",
          direction: "spend",
          estimated: true,
        },
        {
          assetId: "usdc",
          symbol: "USDC",
          decimals: 6,
          amountBaseUnits: "1234567",
          direction: "receive",
        },
      ],
    },
  });
}

describe("operation transaction details", () => {
  test("derives status, kind, and presentation amounts from stored summary fields", () => {
    const details = presentOperationDetails(baseOperation());

    expect(details.title).toBe("Trade USDC for ETH");
    expect(details.rows).toContainEqual({ label: "Status", value: "Confirmed" });
    expect(details.rows).toContainEqual({ label: "Type", value: "Trade" });
    expect(details.rows).toContainEqual({ label: "You spend", value: "1.234567 USDC" });
    expect(details.rows).toContainEqual({ label: "Network", value: "Base (8453)" });
    expect(details.explorer).toEqual({
      href: `https://basescan.org/tx/${HASH}`,
      label: "View on explorer",
      title: "View the transaction on BaseScan",
    });
  });

  test("distinguishes spend and receive directions with shared presentation formatting", () => {
    const details = presentOperationDetails(
      baseOperation({
        action: {
          ...baseOperation().action,
          amounts: [
            {
              assetId: "usdc",
              symbol: "USDC",
              decimals: 6,
              amountBaseUnits: "500000",
              direction: "spend",
            },
            {
              assetId: "eth",
              symbol: "ETH",
              decimals: 18,
              amountBaseUnits: "1",
              direction: "receive",
              estimated: true,
            },
          ],
        },
      }),
    );

    expect(details.rows).toContainEqual({ label: "You spend", value: "0.5 USDC" });
    expect(details.rows).toContainEqual({
      label: "You receive",
      value: "Estimated 0.000000000000000001 ETH",
    });
  });

  test("orders exact underlying USDC before estimated vault shares for withdrawals", () => {
    const details = presentOperationDetails(withdrawalOperation());

    const receiveIndex = details.rows.findIndex(
      (row) => row.label === "You receive" && row.value === "1.234567 USDC",
    );
    const spendIndex = details.rows.findIndex(
      (row) => row.label === "You spend" && row.value === "Estimated 0.000000000000999999 vault shares",
    );
    expect(receiveIndex).toBeGreaterThan(-1);
    expect(spendIndex).toBeGreaterThan(receiveIndex);
    expect(primaryOperationAmount(withdrawalOperation())?.symbol).toBe("USDC");
  });

  test("only links the explorer for a real transaction hash", () => {
    expect(presentOperationDetails(baseOperation({ transactionHash: undefined })).explorer).toBeNull();
    expect(presentOperationDetails(baseOperation({ transactionHash: "b".repeat(64) as `0x${string}` })).explorer).toBeNull();
    expect(presentOperationDetails(baseOperation({ transactionHash: "0xabc" as `0x${string}` })).explorer).toBeNull();
  });

  test("renders compound Borrow identity from structured metadata without parsing the title", () => {
    const details = presentOperationDetails(baseOperation({
      action: {
        ...baseOperation().action,
        kind: "repay",
        title: "Opaque stored label",
        metadata: {
          product: "borrow",
          operation: "close-position",
          marketId: `0x${"12".repeat(32)}`,
          loanAsset: { id: "loan", symbol: "USDC" },
          collateralAsset: { id: "collateral", symbol: "cbBTC" },
          projectedHealthFactorWad: null,
          projectedLiquidationPriceRaw: null,
          borrowAprWad: "0",
          source: { blockNumber: "1", blockHash: `0x${"ab".repeat(32)}`, blockTimestamp: "1" },
        },
      },
    }));
    expect(details.rows).toContainEqual({ label: "Type", value: "Close position" });
    expect(details.rows).toContainEqual({ label: "Market", value: "cbBTC / USDC" });
  });

  test("uses cash-out presentation metadata and omits an unavailable handle on withdrawal", () => {
    const metadata = {
      product: "cashout" as const,
      providerId: "peer",
      providerName: "Peer",
      environment: "production" as const,
      platform: "cashapp",
      platformLabel: "Cash App",
      currency: "USD",
      approximateFiatAmount: "1",
      etaSeconds: null,
      minConversionRate: "1",
      intentAmountRange: { min: "1000000", max: "1000000" },
      estimateAsOf: "2026-09-14T12:00:00.000Z",
      escrow: "0x777777779d229cdF3110e9de47943791c26300Ef" as const,
    };
    const deposit = presentOperationDetails(baseOperation({ action: { ...baseOperation().action, metadata: { ...metadata, operation: "deposit", canonicalHandle: "alice" } } }));
    expect(deposit.rows).toContainEqual({ label: "Payout app", value: "Cash App" });
    expect(deposit.rows).toContainEqual({ label: "Payout handle", value: "alice" });
    expect(deposit.rows).not.toContainEqual(expect.objectContaining({ label: "Escrow" }));

    const withdrawal = presentOperationDetails(baseOperation({ action: { ...baseOperation().action, metadata: { ...metadata, operation: "withdraw", depositId: "0xescrow_7" } } }));
    expect(withdrawal.rows).not.toContainEqual(expect.objectContaining({ label: "Payout handle" }));
    expect(withdrawal.rows).not.toContainEqual(expect.objectContaining({ label: "Approximate receive" }));
  });

  test("labels every stored action kind without parsing the title", () => {
    expect(labelForMoneyActionKind("send")).toBe("Send");
    expect(labelForMoneyActionKind("cash-out")).toBe("Cash out");
    expect(labelForMoneyActionKind("cash-out-withdraw")).toBe("Withdraw cash-out");
    expect(labelForMoneyActionKind("savings-deposit")).toBe("Deposit to Save");
    expect(labelForMoneyActionKind("savings-withdraw")).toBe("Withdraw from Save");
    expect(labelForMoneyActionKind("trade")).toBe("Trade");
    expect(labelForMoneyActionKind("supply-collateral")).toBe("Add collateral");
    expect(labelForMoneyActionKind("borrow")).toBe("Borrow");
    expect(labelForMoneyActionKind("repay")).toBe("Repay");
    expect(labelForMoneyActionKind("withdraw-collateral")).toBe("Withdraw collateral");
  });

  test("labels the four derived statuses plus client dispatch outcomes", () => {
    expect(labelForOperationStatus("pending")).toBe("Pending");
    expect(labelForOperationStatus("unknown")).toBe("Outcome unknown");
    expect(labelForOperationStatus("confirmed")).toBe("Confirmed");
    expect(labelForOperationStatus("failed")).toBe("Failed");
    expect(labelForOperationStatus("rejected")).toBe("Rejected");
    expect(labelForOperationStatus("submitted")).toBe("Submitted");
  });
});

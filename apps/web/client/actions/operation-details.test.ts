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
      label: "View on BaseScan",
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

  test("labels every stored action kind without parsing the title", () => {
    expect(labelForMoneyActionKind("send")).toBe("Send");
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

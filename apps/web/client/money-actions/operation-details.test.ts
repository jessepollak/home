import { describe, expect, test } from "bun:test";
import {
  labelForMoneyActionKind,
  labelForOperationStatus,
  presentOperationDetails,
  primaryOperationAmount,
} from "./operation-details";
import type { RecentMoneyActionOperation } from "./recent-operations";

const WALLET = "0x1111111111111111111111111111111111111111" as const;
const TARGET = "0x2222222222222222222222222222222222222222" as const;
const RECIPIENT = "0x3333333333333333333333333333333333333333" as const;
const USDC_TOKEN = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const HASH = `0x${"a".repeat(64)}` as const;

function baseOperation(overrides: Partial<RecentMoneyActionOperation> = {}): RecentMoneyActionOperation {
  return {
    action: {
      id: "11111111-1111-4111-8111-111111111111",
      reviewHash: "b".repeat(64),
      owner: {
        subject: "subject-a",
        address: WALLET,
        chainId: 8453,
        accountProvider: "cdp-embedded",
      },
      kind: "swap",
      title: "Swap USDC for ETH",
      calls: [{ to: TARGET, data: "0x", value: "0" }],
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
    attemptCount: 1,
    transactionHash: HASH,
    createdAt: "2026-09-08T05:00:00.000Z",
    updatedAt: "2026-09-08T05:03:00.000Z",
    ...overrides,
  };
}

function sendOperation(): RecentMoneyActionOperation {
  const recipientWord = RECIPIENT.slice(2).padStart(64, "0");
  const amountWord = BigInt(1234567).toString(16).padStart(64, "0");
  return baseOperation({
    action: {
      ...baseOperation().action,
      kind: "send",
      title: "Send USDC",
      calls: [{ to: USDC_TOKEN, data: `0xa9059cbb${recipientWord}${amountWord}`, value: "0" }],
    },
  });
}

function withdrawalOperation(): RecentMoneyActionOperation {
  return baseOperation({
    action: {
      ...baseOperation().action,
      kind: "save-withdraw",
      title: "Withdraw USDC from Morpho",
      calls: [{ to: TARGET, data: "0x", value: "0" }],
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
  test("derives status, kind, exact amounts, and targets from structured fields", () => {
    const details = presentOperationDetails(baseOperation());

    expect(details.title).toBe("Swap USDC for ETH");
    expect(details.rows).toContainEqual({ label: "Status", value: "Confirmed" });
    expect(details.rows).toContainEqual({ label: "Type", value: "Swap" });
    expect(details.rows).toContainEqual({
      label: "You spend",
      value: "1.234567 USDC",
    });
    expect(details.rows).toContainEqual({
      label: "Target",
      value: "0x2222…222222",
      title: TARGET,
    });
    expect(details.rows).toContainEqual({
      label: "Network",
      value: "Base (8453)",
    });
    expect(details.explorer).toEqual({
      href: `https://basescan.org/tx/${HASH}`,
      label: "View on BaseScan",
      title: "View the transaction on BaseScan",
    });
  });

  test("decodes the ERC-20 send recipient from calldata instead of the token contract", () => {
    const details = presentOperationDetails(sendOperation());

    expect(details.title).toBe("Send USDC");
    expect(details.rows).toContainEqual({
      label: "To",
      value: "0x3333…333333",
      title: RECIPIENT,
    });
    expect(details.rows.some((row) => row.label === "Target")).toBe(false);
  });

  test("distinguishes spend and receive directions and preserves exact precision", () => {
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

    expect(details.rows).toContainEqual({
      label: "You spend",
      value: "0.5 USDC",
    });
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
    expect(
      presentOperationDetails(
        baseOperation({ transactionHash: undefined }),
      ).explorer,
    ).toBeNull();
    expect(
      presentOperationDetails(baseOperation({ transactionHash: "b".repeat(64) as `0x${string}` }))
        .explorer,
    ).toBeNull();
    expect(
      presentOperationDetails(baseOperation({ transactionHash: "0xabc" as `0x${string}` }))
        .explorer,
    ).toBeNull();
  });

  test("labels every supported kind without parsing the title", () => {
    expect(labelForMoneyActionKind("send")).toBe("Send");
    expect(labelForMoneyActionKind("save-deposit")).toBe("Deposit to Save");
    expect(labelForMoneyActionKind("save-withdraw")).toBe("Withdraw from Save");
    expect(labelForMoneyActionKind("swap")).toBe("Swap");
    expect(labelForMoneyActionKind("supply-collateral")).toBe("Supply collateral");
    expect(labelForMoneyActionKind("borrow")).toBe("Borrow");
    expect(labelForMoneyActionKind("repay")).toBe("Repay");
    expect(labelForMoneyActionKind("withdraw-collateral")).toBe("Withdraw collateral");
  });

  test("preserves pending and confirmed meanings", () => {
    expect(labelForOperationStatus("submitting")).toBe("Wallet submission unresolved");
    expect(labelForOperationStatus("submitted")).toBe("Submitted");
    expect(labelForOperationStatus("included")).toBe("Included");
    expect(labelForOperationStatus("confirmed")).toBe("Confirmed");
    expect(labelForOperationStatus("unknown")).toBe("Outcome unknown");
  });
});

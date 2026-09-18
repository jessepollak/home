import { describe, expect, test } from "bun:test";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import { readSavingsPreparedReview } from "./review";

const ADDRESS = "0x1111111111111111111111111111111111111111" as const;
const VAULT = "0x2222222222222222222222222222222222222222" as const;
const HASH = `0x${"ab".repeat(32)}` as `0x${string}`;

function action(operation: "deposit" | "withdraw"): PreparedMoneyAction {
  const deposit = operation === "deposit";
  return {
    id: "action-1",
    kind: deposit ? "savings-deposit" : "savings-withdraw",
    title: "Save",
    calls: [],
    warnings: ["not parsed"],
    createdAt: "2026-09-17T18:00:00.000Z",
    expiresAt: "2026-09-17T18:05:00.000Z",
    owner: {
      subject: "owner",
      address: ADDRESS,
      chainId: 8453,
      accountProvider: "cdp-embedded",
    },
    amounts: [
      {
        assetId: "usdc",
        symbol: "USDC",
        decimals: 6,
        amountBaseUnits: "5000000",
        direction: deposit ? "spend" : "receive",
      },
      {
        assetId: "vault",
        symbol: "vault shares",
        decimals: 18,
        amountBaseUnits: "4900000000000000000",
        direction: deposit ? "receive" : "spend",
        estimated: true,
      },
    ],
    metadata: {
      product: "savings",
      operation,
      vaultAddress: VAULT,
      vaultName: "Configured USDC vault",
      network: { name: "Base", chainId: 8453 },
      feeWad: "100000000000000000",
      limitBaseUnits: "9000000",
      previewSharesBaseUnits: "4900000000000000000",
      shareDecimals: 18,
      exchangeConstraint: deposit
        ? "deposit-preview-no-minimum-shares"
        : "withdraw-exact-assets-or-revert",
      discoveryRate: {
        status: "stale",
        netApy: "0.041",
        fetchedAt: "2026-09-17T17:50:00.000Z",
        stateAsOf: "2026-09-17T17:45:00.000Z",
      },
      source: {
        blockNumber: "123",
        blockHash: HASH,
        blockTimestamp: "1789677600",
      },
    },
  };
}

describe("savings prepared review", () => {
  test("reads decision facts for both exact-USDC operations without warning parsing", () => {
    for (const operation of ["deposit", "withdraw"] as const) {
      expect(readSavingsPreparedReview(action(operation))).toMatchObject({
        operation,
        network: { name: "Base", chainId: 8453 },
        feeWad: "100000000000000000",
        exactUsdcBaseUnits: "5000000",
        previewSharesBaseUnits: "4900000000000000000",
        discoveryRate: { status: "stale", netApy: "0.041" },
      });
    }
  });

  test("rejects malformed or inconsistent server facts", () => {
    const malformed = action("deposit");
    malformed.metadata = {
      ...malformed.metadata!,
      previewSharesBaseUnits: "1",
    } as typeof malformed.metadata;
    expect(readSavingsPreparedReview(malformed)).toBeNull();
    expect(readSavingsPreparedReview({
      ...action("withdraw"),
      metadata: undefined,
    })).toBeNull();
  });

  test("does not infer missing discovery facts from warnings", () => {
    const unavailable = action("deposit");
    unavailable.warnings = ["Current APY: 99%"];
    unavailable.metadata = {
      ...unavailable.metadata!,
      discoveryRate: {
        status: "unavailable",
        netApy: null,
        fetchedAt: null,
        stateAsOf: null,
      },
    } as typeof unavailable.metadata;
    expect(readSavingsPreparedReview(unavailable)?.discoveryRate).toEqual({
      status: "unavailable",
      netApy: null,
      fetchedAt: null,
      stateAsOf: null,
    });
  });
});

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
          ? "deposit-preview-no-minimum-shares"
          : "withdraw-exact-assets-or-revert",
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

  test("drops malformed savings metadata instead of restoring untrusted review facts", () => {
    const value = pendingSavings("deposit");
    value.summary.metadata.source.blockHash = "0x1234";

    const parsed = parsePendingActionResponse(value, ID, session);

    expect(parsed).not.toBeNull();
    expect(parsed?.metadata).toBeUndefined();
  });
});

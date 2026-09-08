import { describe, expect, test } from "bun:test";
import type { VerifiedAccountSession } from "@/features/account/session-types";
import {
  dedupeRecentMoneyActions,
  parseRecentMoneyActions,
  type RecentMoneyActionOperation,
} from "./recent-operations";

const session: VerifiedAccountSession = {
  user: { subject: "subject-a" },
  smartAccount: { address: "0x1111111111111111111111111111111111111111", chainId: 8453 },
  accountProvider: "cdp-embedded",
};
const transactionHash = `0x${"a".repeat(64)}` as const;

function operation(address = session.smartAccount!.address): RecentMoneyActionOperation {
  return {
    action: {
      id: "11111111-1111-4111-8111-111111111111",
      reviewHash: "b".repeat(64),
      owner: { subject: "subject-a", address, chainId: 8453, accountProvider: "cdp-embedded" },
      kind: "send",
      title: "Send USDC",
      calls: [{ to: "0x2222222222222222222222222222222222222222", data: "0x", value: "0" }],
      amounts: [{ assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "1", direction: "spend" }],
      warnings: ["Network fee shown by wallet."],
      createdAt: "2026-09-08T05:00:00.000Z",
      expiresAt: "2026-09-08T05:10:00.000Z",
    },
    status: "confirmed",
    attemptCount: 1,
    transactionHash,
    createdAt: "2026-09-08T05:00:00.000Z",
    updatedAt: "2026-09-08T05:02:00.000Z",
  };
}

describe("recent Home operation activity", () => {
  test("accepts only the full verified owner tuple", () => {
    expect(parseRecentMoneyActions({ operations: [operation()] }, session)).toHaveLength(1);
    expect(parseRecentMoneyActions({ operations: [operation("0x3333333333333333333333333333333333333333")] }, session)).toEqual([]);
  });

  test("deduplicates a Home operation after indexed activity exposes the same transaction hash", () => {
    expect(dedupeRecentMoneyActions([operation()], new Set())).toHaveLength(1);
    expect(dedupeRecentMoneyActions([operation()], new Set([transactionHash]))).toEqual([]);
  });

  test("keeps an unresolved send without submission refs and accepts compact ISO timestamps", () => {
    const unresolved = {
      ...operation(),
      status: "submitting" as const,
      attemptCount: 1,
      transactionHash: "",
      userOperationHash: "",
      createdAt: "2026-09-08T05:00:00Z",
      updatedAt: "2026-09-08T05:02:00Z",
    };
    const parsed = parseRecentMoneyActions({ operations: [unresolved] }, session);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.status).toBe("submitting");
    expect(parsed[0]?.transactionHash).toBeUndefined();
  });
});

import { describe, expect, test } from "bun:test";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
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

function operation(): RecentMoneyActionOperation {
  return parseRecentMoneyActions({ actions: [row()] }, session)[0]!;
}

describe("recent Home action activity", () => {
  test("accepts only the full verified owner tuple", () => {
    expect(parseRecentMoneyActions({ actions: [row()] }, session)).toHaveLength(1);
    expect(parseRecentMoneyActions({ actions: [row("0x3333333333333333333333333333333333333333")] }, session)).toEqual([]);
  });

  test("deduplicates a Home action after indexed activity exposes the same transaction hash", () => {
    expect(dedupeRecentMoneyActions([operation()], new Set())).toHaveLength(1);
    expect(dedupeRecentMoneyActions([operation()], new Set([transactionHash]))).toEqual([]);
  });

  test("keeps pending rows without transaction hashes and rejects non-derived statuses", () => {
    const pending = { ...row(undefined, "pending"), transactionHash: undefined };
    const parsed = parseRecentMoneyActions({ actions: [pending] }, session);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.status).toBe("pending");
    expect(parsed[0]?.transactionHash).toBeUndefined();
    expect(parseRecentMoneyActions({ actions: [{ ...row(), status: "rejected" }] }, session)).toEqual([]);
  });
});

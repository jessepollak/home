import { describe, expect, test } from "bun:test";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { ActivityResponseError, parseActivityPage } from "./parse";
import type { ActivityPage } from "./types";

const WALLET = "0x1111111111111111111111111111111111111111" as const;
const OTHER = "0x2222222222222222222222222222222222222222" as const;
const TO = "2026-09-07T12:00:00.000Z";
const session: VerifiedAccountSession = {
  user: { subject: "subject-a" },
  smartAccount: { address: WALLET, chainId: 8453 },
  accountProvider: "cdp-embedded",
};

function validPage(): ActivityPage {
  return {
    walletAddress: WALLET,
    chainId: 8453,
    recordedOperations: "available",
    window: { from: "2026-08-07T12:00:00.000Z", to: TO },
    transfers: [
      {
        id: "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913:event-2",
        logId: "event-2",
        chainId: 8453,
        assetId: "usdc",
        tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        tokenSymbol: "USDC",
        tokenDecimals: 6,
        walletAddress: WALLET,
        fromAddress: OTHER,
        toAddress: WALLET,
        direction: "incoming",
        amountBaseUnits: "1000001",
        blockNumber: "20",
        blockHash: `0x${"b".repeat(64)}`,
        transactionHash: `0x${"d".repeat(64)}`,
        logIndex: "2",
        blockTimestamp: "2026-09-07T11:00:00.000Z",
      },
      {
        id: "8453:0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf:event-1",
        logId: "event-1",
        chainId: 8453,
        assetId: "cbbtc",
        tokenAddress: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
        tokenSymbol: "cbBTC",
        tokenDecimals: 8,
        walletAddress: WALLET,
        fromAddress: WALLET,
        toAddress: OTHER,
        direction: "outgoing",
        amountBaseUnits: "1",
        blockNumber: "19",
        blockHash: `0x${"a".repeat(64)}`,
        transactionHash: `0x${"c".repeat(64)}`,
        logIndex: "1",
        blockTimestamp: "2026-09-06T11:00:00.000Z",
      },
    ],
    nextCursor: "cursor",
    source: {
      provider: "cdp-sql",
      cached: false,
      stale: false,
      executionTimestamp: "2026-09-07T11:59:00.000Z",
      executionTimeMs: 2,
      fetchedAt: TO,
    },
  };
}

describe("activity response parser", () => {
  test("accepts lossless scoped transfers in strict keyset order", () => {
    const page = parseActivityPage(validPage(), session, TO);
    expect(page.transfers.map((transfer) => transfer.amountBaseUnits)).toEqual([
      "1000001",
      "1",
    ]);
    expect(page.transfers.map((transfer) => transfer.direction)).toEqual([
      "incoming",
      "outgoing",
    ]);
  });

  test("accepts the explicit recorded-operations degradation marker", () => {
    const parsed = parseActivityPage(
      { ...validPage(), recordedOperations: "unavailable" },
      session,
      TO,
    );
    expect(parsed.recordedOperations).toBe("unavailable");

    expect(() =>
      parseActivityPage(
        { ...validPage(), recordedOperations: "failed" },
        session,
        TO,
      ),
    ).toThrow(ActivityResponseError);
  });

  test("accepts an unknown contract with honest null metadata", () => {
    const base = validPage();
    const unknownAddress = "0x4444444444444444444444444444444444444444";
    const unknown = {
      ...base.transfers[0],
      id: `8453:${unknownAddress}:unknown-log`,
      logId: "unknown-log",
      assetId: null,
      tokenAddress: unknownAddress,
      tokenSymbol: null,
      tokenDecimals: null,
    };
    const parsed = parseActivityPage(
      { ...base, transfers: [unknown], nextCursor: null },
      session,
      TO,
    );
    expect(parsed.transfers[0]).toMatchObject({
      assetId: null,
      tokenAddress: unknownAddress,
      tokenSymbol: null,
      tokenDecimals: null,
      amountBaseUnits: "1000001",
    });
  });

  test("rejects another wallet, forged token metadata, invalid direction, duplicate rows, and unstable windows", () => {
    const base = validPage();
    const cases: unknown[] = [
      { ...base, walletAddress: OTHER },
      {
        ...base,
        transfers: [{ ...base.transfers[0], tokenSymbol: "FAKE" }],
      },
      {
        ...base,
        transfers: [{ ...base.transfers[0], direction: "outgoing" }],
      },
      {
        ...base,
        transfers: [base.transfers[0], base.transfers[0]],
      },
      {
        ...base,
        window: { ...base.window, to: "2026-09-07T11:59:59.000Z" },
      },
    ];

    for (const value of cases) {
      expect(() => parseActivityPage(value, session, TO)).toThrow(
        ActivityResponseError,
      );
    }
  });

  test("rejects malformed amounts and rows outside the bounded window", () => {
    const base = validPage();
    expect(() =>
      parseActivityPage(
        {
          ...base,
          transfers: [{ ...base.transfers[0], amountBaseUnits: "1.5" }],
        },
        session,
        TO,
      ),
    ).toThrow(ActivityResponseError);
    expect(() =>
      parseActivityPage(
        {
          ...base,
          transfers: [{ ...base.transfers[0], amountBaseUnits: 1 }],
        },
        session,
        TO,
      ),
    ).toThrow(ActivityResponseError);
    expect(() =>
      parseActivityPage(
        {
          ...base,
          transfers: [{ ...base.transfers[0], blockTimestamp: TO }],
        },
        session,
        TO,
      ),
    ).toThrow(ActivityResponseError);
  });
});

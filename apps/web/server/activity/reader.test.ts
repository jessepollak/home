import { describe, expect, test } from "bun:test";
import { activityAssets } from "@/shared/activity/types";
import type { BaseErc20TransferPage } from "@/server/chain-data/types";
import { createActivityReader } from "./reader";

const WALLET = "0x1111111111111111111111111111111111111111" as const;
const TO = "2026-09-07T12:00:00.000Z";

describe("recent activity reader", () => {
  test("requests a stable bounded 31-day page for the reviewed asset allowlist", async () => {
    let received: Parameters<Parameters<typeof createActivityReader>[0]>[0] | undefined;
    const signal = new AbortController().signal;
    const result: BaseErc20TransferPage = {
      transfers: [],
      nextCursor: "next-page",
      source: {
        provider: "cdp-sql",
        cached: true,
        stale: false,
        executionTimestamp: TO,
        executionTimeMs: 4,
        fetchedAt: TO,
      },
    };
    const reader = createActivityReader(async (input) => {
      received = input;
      return result;
    });

    const page = await reader(
      { address: WALLET, chainId: 8453, verification: "session-smart-account" },
      { to: TO, cursor: "cursor-a" },
      signal,
    );

    expect(received).toEqual({
      verifiedWalletAddress: WALLET,
      assetIds: activityAssets.map((asset) => asset.id),
      from: "2026-08-07T12:00:00.000Z",
      to: TO,
      limit: 25,
      cursor: "cursor-a",
      cacheMaxAgeMs: 15_000,
      staleAfterMs: 60_000,
      signal,
    });
    expect(page.window).toEqual({
      from: "2026-08-07T12:00:00.000Z",
      to: TO,
    });
    expect(page.nextCursor).toBe("next-page");
  });

  test("advances the underlying source cursor without shifting the fixed activity window", async () => {
    const received: Array<Parameters<Parameters<typeof createActivityReader>[0]>[0]> = [];
    const reader = createActivityReader(async (input) => {
      received.push(input);
      return {
        transfers: [],
        nextCursor: input.cursor === null ? "source-page-2" : null,
        source: {
          provider: "cdp-sql",
          cached: false,
          stale: false,
          executionTimestamp: TO,
          executionTimeMs: 1,
          fetchedAt: TO,
        },
      };
    });
    const account = {
      address: WALLET,
      chainId: 8453,
      verification: "session-smart-account",
    } as const;

    const first = await reader(account, { to: TO, cursor: null });
    const second = await reader(account, {
      to: TO,
      cursor: first.nextCursor,
    });

    expect(first.nextCursor).toBe("source-page-2");
    expect(second.nextCursor).toBeNull();
    expect(received.map(({ from, to, cursor, limit }) => ({
      from,
      to,
      cursor,
      limit,
    }))).toEqual([
      {
        from: "2026-08-07T12:00:00.000Z",
        to: TO,
        cursor: null,
        limit: 25,
      },
      {
        from: "2026-08-07T12:00:00.000Z",
        to: TO,
        cursor: "source-page-2",
        limit: 25,
      },
    ]);
  });
});

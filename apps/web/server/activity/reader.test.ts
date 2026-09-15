import { describe, expect, test } from "bun:test";
import { activityAssets } from "@/shared/activity/types";
import type {
  BaseErc20Transfer,
  BaseErc20TransferPage,
} from "@/server/chain-data/types";
import { createActivityReader } from "./reader";

const WALLET = "0x1111111111111111111111111111111111111111" as const;
const OTHER = "0x2222222222222222222222222222222222222222" as const;
const UNKNOWN = "0x4444444444444444444444444444444444444444" as const;
const TO = "2026-09-07T12:00:00.000Z";

function incomingTransfer(
  tokenAddress: `0x${string}`,
  logId: string,
  logIndex: string,
): BaseErc20Transfer {
  return {
    id: `8453:${tokenAddress.toLowerCase()}:${logId}`,
    logId,
    chainId: 8453,
    assetId: null,
    tokenAddress: tokenAddress.toLowerCase() as `0x${string}`,
    walletAddress: WALLET,
    fromAddress: OTHER,
    toAddress: WALLET,
    direction: "incoming",
    amountBaseUnits: "1",
    blockNumber: "20",
    blockHash: `0x${"b".repeat(64)}`,
    transactionHash: `0x${"a".repeat(64)}`,
    logIndex,
    blockTimestamp: "2026-09-07T11:00:00.000Z",
  };
}

function transferPage(
  transfers: BaseErc20Transfer[],
  nextCursor: string | null,
): BaseErc20TransferPage {
  return {
    transfers,
    nextCursor,
    source: {
      provider: "cdp-sql",
      cached: false,
      stale: false,
      executionTimestamp: TO,
      executionTimeMs: 1,
      fetchedAt: TO,
    },
  };
}

describe("recent activity reader", () => {
  test("requests one stable bounded page for the reviewed asset contracts", async () => {
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
      assetIds: [],
      includeUnknownAssets: true,
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

  test("resolves identity by contract and preserves unknown contract quantities", async () => {
    const usdc = activityAssets.find((asset) => asset.id === "usdc")!;
    const cbbtc = activityAssets.find((asset) => asset.id === "cbbtc")!;
    const zora = "0x1111111111166b7fe7bd91427724b487980afc69" as const;
    const unknown = "0x4444444444444444444444444444444444444444" as const;
    const transactionHash = `0x${"a".repeat(64)}` as const;
    const makeTransfer = (
      tokenAddress: `0x${string}`,
      logId: string,
      logIndex: string,
      amountBaseUnits: string,
    ) => ({
      id: `8453:${tokenAddress.toLowerCase()}:${logId}`,
      logId,
      chainId: 8453 as const,
      assetId: null,
      tokenAddress: tokenAddress.toLowerCase() as `0x${string}`,
      walletAddress: WALLET,
      fromAddress: "0x2222222222222222222222222222222222222222" as const,
      toAddress: WALLET,
      direction: "incoming" as const,
      amountBaseUnits,
      blockNumber: "20",
      blockHash: `0x${"b".repeat(64)}` as const,
      transactionHash,
      logIndex,
      blockTimestamp: "2026-09-07T11:00:00.000Z",
    });
    const reader = createActivityReader(
      async () => ({
        transfers: [
          makeTransfer(usdc.tokenAddress, "usdc-log", "4", "1000001"),
          makeTransfer(cbbtc.tokenAddress, "btc-log", "3", "123456789"),
          makeTransfer(zora, "zora-log", "2", "1000000000000000001"),
          makeTransfer(unknown, "unknown-log", "1", "999999999999999999"),
        ],
        nextCursor: null,
        source: {
          provider: "cdp-sql",
          cached: false,
          stale: false,
          executionTimestamp: TO,
          executionTimeMs: 1,
          fetchedAt: TO,
        },
      }),
      async (addresses) => {
        expect(addresses).toContain(zora);
        return {
          metadata: new Map([
            [usdc.tokenAddress.toLowerCase(), { assetId: "usdc", tokenSymbol: "USDC", tokenDecimals: 6 }],
            [cbbtc.tokenAddress.toLowerCase(), { assetId: "cbbtc", tokenSymbol: "cbBTC", tokenDecimals: 8 }],
            [zora, { assetId: null, tokenSymbol: "ZORA", tokenDecimals: 18 }],
            [unknown, { assetId: null, tokenSymbol: null, tokenDecimals: null }],
          ]),
          nftLikeContracts: new Set(),
        };
      },
    );

    const page = await reader(
      { address: WALLET, chainId: 8453, verification: "session-smart-account" },
      { to: TO, cursor: null },
    );

    expect(page.transfers.map(({ assetId, tokenSymbol, tokenDecimals, amountBaseUnits, logId }) => ({
      assetId, tokenSymbol, tokenDecimals, amountBaseUnits, logId,
    }))).toEqual([
      { assetId: "usdc", tokenSymbol: "USDC", tokenDecimals: 6, amountBaseUnits: "1000001", logId: "usdc-log" },
      { assetId: "cbbtc", tokenSymbol: "cbBTC", tokenDecimals: 8, amountBaseUnits: "123456789", logId: "btc-log" },
      { assetId: null, tokenSymbol: "ZORA", tokenDecimals: 18, amountBaseUnits: "1000000000000000001", logId: "zora-log" },
      { assetId: null, tokenSymbol: null, tokenDecimals: null, amountBaseUnits: "999999999999999999", logId: "unknown-log" },
    ]);
    expect(new Set(page.transfers.map((transfer) => transfer.id)).size).toBe(4);
    expect(new Set(page.transfers.map((transfer) => transfer.transactionHash)).size).toBe(1);
  });

  test("drops NFT-like contracts without changing the source cursor", async () => {
    const keep = "0x5555555555555555555555555555555555555555" as const;
    const reader = createActivityReader(
      async () => transferPage([
        incomingTransfer(UNKNOWN, "nft-like", "2"),
        incomingTransfer(keep, "keep", "1"),
      ], "source-next"),
      async () => ({
        metadata: new Map([
          [UNKNOWN, { assetId: null, tokenSymbol: null, tokenDecimals: null }],
          [keep, { assetId: null, tokenSymbol: "KEEP", tokenDecimals: 18 }],
        ]),
        nftLikeContracts: new Set([UNKNOWN]),
      }),
    );

    const page = await reader(
      { address: WALLET, chainId: 8453, verification: "session-smart-account" },
      { to: TO, cursor: null },
    );
    expect(page.transfers.map(({ logId }) => logId)).toEqual(["keep"]);
    expect(page.nextCursor).toBe("source-next");
  });

  test("retains registry and unknown rows when metadata resolution throws", async () => {
    const usdc = activityAssets.find((asset) => asset.id === "usdc")!;
    const reader = createActivityReader(
      async () => transferPage([
        incomingTransfer(usdc.tokenAddress, "usdc", "2"),
        incomingTransfer(UNKNOWN, "unknown", "1"),
      ], null),
      async () => {
        throw new Error("configured RPC is not Base mainnet");
      },
    );

    const page = await reader(
      { address: WALLET, chainId: 8453, verification: "session-smart-account" },
      { to: TO, cursor: null },
    );
    expect(page.transfers.map(({ assetId, tokenSymbol, tokenDecimals }) => ({
      assetId,
      tokenSymbol,
      tokenDecimals,
    }))).toEqual([
      { assetId: "usdc", tokenSymbol: "USDC", tokenDecimals: 6 },
      { assetId: null, tokenSymbol: null, tokenDecimals: null },
    ]);
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

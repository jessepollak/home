import { describe, expect, test } from "bun:test";
import {
  createCdpAddressHistory,
  createCdpAddressHistoryFromEnv,
  createCdpAddressHistoryTransport,
  decodeCdpAddressHistoryCursor,
  encodeCdpAddressHistoryCursor,
  type CdpAddressHistoryCursor,
  type CdpAddressHistoryRequest,
  type CdpAddressHistoryTransport,
} from "./cdp-address-history";
import { ChainDataError, type ChainDataErrorCode } from "./errors";

const OWNER = "0x1111111111111111111111111111111111111111" as const;
const OTHER = "0x2222222222222222222222222222222222222222" as const;
const THIRD = "0x3333333333333333333333333333333333333333" as const;
const TOKEN = "0x4444444444444444444444444444444444444444" as const;
const KNOWN_TOKEN = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;
const FROM = "2026-08-07T12:00:00.000Z";
const TO = "2026-09-07T12:00:00.000Z";
const UINT256_OVERFLOW = (BigInt(1) << BigInt(256)).toString();

function hash(character: string): `0x${string}` {
  return `0x${character.repeat(64)}`;
}

function tokenTransfer(overrides: Record<string, unknown> = {}) {
  return {
    tokenAddress: TOKEN,
    fromAddress: OTHER,
    toAddress: OWNER,
    value: "1",
    transactionIndex: "1",
    transactionHash: hash("a"),
    logIndex: "1",
    blockHash: hash("b"),
    blockNumber: "100",
    ...overrides,
  };
}

function transaction(options: {
  block?: string;
  index?: string;
  transactionHash?: `0x${string}`;
  blockHash?: `0x${string}`;
  timestamp?: string;
  status?: string;
  transfers?: unknown[];
} = {}) {
  const transactionHash = options.transactionHash ?? hash("a");
  const blockHash = options.blockHash ?? hash("b");
  const block = options.block ?? "100";
  return {
    name: `networks/base-mainnet/indexers/default/transactions/${transactionHash}`,
    hash: transactionHash,
    blockHash,
    blockHeight: block,
    status: options.status ?? "CONFIRMED",
    ethereum: {
      index: options.index ?? "1",
      blockTimestamp: options.timestamp ?? "2026-09-07T11:00:00Z",
      tokenTransfers: options.transfers ?? [
        tokenTransfer({
          transactionIndex: options.index ?? "1",
          transactionHash,
          blockHash,
          blockNumber: block,
        }),
      ],
    },
  };
}

function page(addressTransactions: unknown[], nextPageToken?: string) {
  return {
    addressTransactions,
    ...(nextPageToken === undefined ? {} : { nextPageToken }),
  };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    verifiedWalletAddress: OWNER,
    assetIds: [],
    includeUnknownAssets: true,
    from: FROM,
    to: TO,
    limit: 25,
    cursor: null,
    ...overrides,
  };
}

function queuedTransport(results: unknown[]) {
  const requests: CdpAddressHistoryRequest[] = [];
  const transport: CdpAddressHistoryTransport = {
    async listAddressTransactions(request) {
      requests.push(request);
      const result = results.shift();
      if (result instanceof Error) throw result;
      if (result === undefined) throw new Error("Unexpected provider call");
      return result;
    },
  };
  return { transport, requests };
}

function history(transport: CdpAddressHistoryTransport) {
  return createCdpAddressHistory({
    assets: [{ id: "usdc", chainId: 8453, address: KNOWN_TOKEN }],
    transport,
    now: () => new Date(TO),
    clock: () => 100,
  });
}

async function expectCode(promise: Promise<unknown>, code: ChainDataErrorCode) {
  try {
    await promise;
    throw new Error("Expected request to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(ChainDataError);
    expect(error).toMatchObject({ code });
  }
}

function transactionsForBlocks(blocks: readonly number[]): unknown[] {
  return blocks.map((block) => {
    const transactionHash = `0x${block.toString(16).padStart(64, "0")}` as const;
    const blockHash = hash(block % 2 === 0 ? "b" : "c");
    return transaction({
      block: String(block),
      transactionHash,
      blockHash,
      timestamp: new Date(new Date(TO).getTime() - (200 - block) * 1_000).toISOString(),
      transfers: [tokenTransfer({
        transactionHash,
        blockHash,
        blockNumber: String(block),
        logIndex: "1",
      })],
    });
  });
}

describe("CDP Address History transfers", () => {
  test("normalizes arbitrary incoming, outgoing, and self ERC-20 rows", async () => {
    const transactionHash = hash("a");
    const blockHash = hash("b");
    const { transport, requests } = queuedTransport([
      page([transaction({
        transactionHash,
        blockHash,
        transfers: [
          tokenTransfer({ transactionHash, blockHash, logIndex: "1" }),
          tokenTransfer({ transactionHash, blockHash, logIndex: "3", fromAddress: OWNER, toAddress: OTHER, value: "2" }),
          tokenTransfer({ transactionHash, blockHash, logIndex: "2", fromAddress: OWNER, toAddress: OWNER, value: "3", tokenAddress: KNOWN_TOKEN }),
        ],
      })]),
    ]);

    const result = await history(transport).listTransfers(
      input({ verifiedWalletAddress: OWNER.toUpperCase().replace("0X", "0x") }),
    );

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ address: OWNER, pageSize: "100" });
    expect(Object.hasOwn(requests[0]!, "pageToken")).toBe(false);
    expect(result.transfers.map(({ direction, amountBaseUnits, assetId, logIndex }) => ({
      direction,
      amountBaseUnits,
      assetId,
      logIndex,
    }))).toEqual([
      { direction: "outgoing", amountBaseUnits: "2", assetId: null, logIndex: "3" },
      { direction: "self", amountBaseUnits: "3", assetId: "usdc", logIndex: "2" },
      { direction: "incoming", amountBaseUnits: "1", assetId: null, logIndex: "1" },
    ]);
    expect(result.transfers[0]?.id).toBe(
      `8453:${TOKEN}:${transactionHash}:3`,
    );
    expect(result.source).toEqual({
      provider: "cdp-address-history",
      cached: false,
      stale: false,
      executionTimestamp: TO,
      executionTimeMs: 0,
      fetchedAt: TO,
    });
  });

  test("skips explicit NFTs, other typed NFTs, non-owner legs, and non-confirmed transactions", async () => {
    const nftRows = [
      tokenTransfer({ erc721: { tokenId: "1" }, value: "" }),
      tokenTransfer({ erc1155: { tokenId: "2" }, value: "" }),
      tokenTransfer({ erc3525: { tokenId: "3" }, value: "" }),
      tokenTransfer({ type: "nft", value: "" }),
      tokenTransfer({ futureTokenSubtype: { tokenId: "4" }, value: "" }),
    ];
    const nonOwner = tokenTransfer({ fromAddress: OTHER, toAddress: THIRD, value: "not-validated" });
    const pending = { ...transaction({ status: "PENDING" }), ethereum: undefined };
    const { transport } = queuedTransport([
      page([
        transaction({
          transfers: [
            ...nftRows,
            nonOwner,
            tokenTransfer({ futureScalarMetadata: "accepted" }),
          ],
        }),
        pending,
      ]),
    ]);

    const result = await history(transport).listTransfers(input());
    expect(result.transfers).toHaveLength(1);
    expect(result.transfers[0]?.amountBaseUnits).toBe("1");
  });

  test("normalizes RFC3339 timestamps to ISO milliseconds", async () => {
    const { transport } = queuedTransport([
      page([transaction({ timestamp: "2026-09-07T12:30:45.123456+02:00" })]),
    ]);
    const result = await history(transport).listTransfers(input());
    expect(result.transfers[0]?.blockTimestamp).toBe("2026-09-07T10:30:45.123Z");
  });

  test("rejects malformed and out-of-range fields on owner-scoped ERC-20 rows", async () => {
    const cases: Array<Record<string, unknown>> = [
      { tokenAddress: "0x1234" },
      { fromAddress: "not-an-address" },
      { transactionHash: hash("g") },
      { blockHash: "0x1234" },
      { blockNumber: "01" },
      { logIndex: 1 },
      { value: "1.5" },
      { value: UINT256_OVERFLOW },
    ];
    for (const overrides of cases) {
      const { transport } = queuedTransport([
        page([transaction({ transfers: [tokenTransfer(overrides)] })]),
      ]);
      await expectCode(history(transport).listTransfers(input()), "invalid-response");
    }
  });

  test("requires confirmed transaction identity and Ethereum history fields", async () => {
    const confirmed = transaction();
    const cases = [
      { ...confirmed, hash: undefined },
      { ...confirmed, blockHash: undefined },
      { ...confirmed, blockHeight: undefined },
      { ...confirmed, blockHeight: UINT256_OVERFLOW },
      { ...confirmed, ethereum: { tokenTransfers: [] } },
      { ...confirmed, ethereum: { index: "01", blockTimestamp: TO, tokenTransfers: [] } },
      { ...confirmed, ethereum: { index: "1", blockTimestamp: TO } },
    ];
    for (const invalid of cases) {
      const { transport } = queuedTransport([page([invalid])]);
      await expectCode(history(transport).listTransfers(input()), "invalid-response");
    }
  });

  test("requires each eligible owner transfer to match its parent transaction index", async () => {
    const { transport } = queuedTransport([
      page([transaction({
        index: "2",
        transfers: [tokenTransfer({ transactionIndex: "1" })],
      })]),
    ]);
    await expectCode(history(transport).listTransfers(input()), "invalid-response");
  });
});

describe("CDP Address History cursors and paging", () => {
  test("round-trips strict versioned cursors and rejects tampering or oversize input", () => {
    const cursor: CdpAddressHistoryCursor = {
      version: 1,
      pageToken: "provider-page",
      lastEmittedKey: {
        blockNumber: "100",
        transactionHash: hash("a"),
        logIndex: "3",
        tokenAddress: TOKEN,
      },
    };
    const encoded = encodeCdpAddressHistoryCursor(cursor);
    expect(decodeCdpAddressHistoryCursor(encoded)).toEqual(cursor);

    const tampered = Buffer.from(JSON.stringify({ ...cursor, version: 2 }), "utf8").toString("base64url");
    expect(() => decodeCdpAddressHistoryCursor(tampered)).toThrow(ChainDataError);
    const extraField = Buffer.from(JSON.stringify({ ...cursor, offset: 1 }), "utf8").toString("base64url");
    expect(() => decodeCdpAddressHistoryCursor(extraField)).toThrow(ChainDataError);
    expect(() => decodeCdpAddressHistoryCursor(`${encoded}+`)).toThrow(ChainDataError);
    expect(() => decodeCdpAddressHistoryCursor("a".repeat(4097))).toThrow(ChainDataError);
    expect(() => encodeCdpAddressHistoryCursor({
      ...cursor,
      pageToken: "p".repeat(2049),
    })).toThrow(ChainDataError);
  });

  test("refetches the source page so a head insertion cannot duplicate or skip prior rows", async () => {
    const original = transactionsForBlocks(
      Array.from({ length: 30 }, (_, index) => 130 - index),
    );
    const inserted = transactionsForBlocks([131])[0]!;
    const { transport, requests } = queuedTransport([
      page(original),
      page([inserted, ...original]),
    ]);
    const lister = history(transport);

    const first = await lister.listTransfers(input());
    const second = await lister.listTransfers(input({ cursor: first.nextCursor }));

    expect(first.transfers).toHaveLength(25);
    expect(second.transfers).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.transfers, ...second.transfers].map(({ id }) => id)).size).toBe(30);
    expect([...first.transfers, ...second.transfers].map(({ blockNumber }) => blockNumber)).toEqual(
      Array.from({ length: 30 }, (_, index) => String(130 - index)),
    );
    expect(requests).toHaveLength(2);
    expect(Object.hasOwn(requests[1]!, "pageToken")).toBe(false);
  });

  test("paginates a split block by chain-log order when hash order contradicts transaction index", async () => {
    const highHash = hash("f");
    const lowHash = hash("a");
    const laterTransaction = transaction({
      block: "100",
      index: "2",
      transactionHash: lowHash,
      transfers: [tokenTransfer({
        transactionIndex: "2",
        transactionHash: lowHash,
        blockNumber: "100",
        logIndex: "2",
      })],
    });
    const earlierTransaction = transaction({
      block: "100",
      index: "1",
      transactionHash: highHash,
      transfers: [tokenTransfer({
        transactionIndex: "1",
        transactionHash: highHash,
        blockNumber: "100",
        logIndex: "1",
      })],
    });
    const { transport, requests } = queuedTransport([
      page([laterTransaction], "page-2"),
      page([laterTransaction], "page-2"),
      page([earlierTransaction]),
    ]);
    const lister = history(transport);

    const first = await lister.listTransfers(input({ limit: 1 }));
    const second = await lister.listTransfers(input({ limit: 1, cursor: first.nextCursor }));

    expect(first.transfers.map(({ transactionHash }) => transactionHash)).toEqual([lowHash]);
    expect(second.transfers.map(({ transactionHash }) => transactionHash)).toEqual([highHash]);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.transfers, ...second.transfers].map(({ id }) => id)).size).toBe(2);
    expect(requests.map(({ pageToken }) => pageToken ?? null)).toEqual([
      null,
      null,
      "page-2",
    ]);
  });

  test("rejects provider chain-position violations within or across source pages", async () => {
    const low = transaction({ block: "99" });
    const high = transaction({ block: "100" });
    const sameBlockEarlier = transaction({
      block: "100",
      index: "1",
      transactionHash: hash("f"),
    });
    const sameBlockLater = transaction({
      block: "100",
      index: "2",
      transactionHash: hash("a"),
    });
    for (const results of [
      [page([low, high])],
      [page([sameBlockEarlier, sameBlockLater])],
      [page([high], "page-2"), page([high])],
    ]) {
      const { transport } = queuedTransport(results);
      await expectCode(history(transport).listTransfers(input()), "invalid-response");
    }
  });

  test("requires monotonic block time before using the cutoff", async () => {
    const newerBlock = transaction({
      block: "101",
      timestamp: "2026-09-07T10:00:00Z",
      transactionHash: hash("f"),
      transfers: [],
    });
    const olderBlockWithNewerTime = transaction({
      block: "100",
      timestamp: "2026-09-07T11:00:00Z",
      transactionHash: hash("a"),
      transfers: [],
    });
    const { transport } = queuedTransport([
      page([newerBlock, olderBlockWithNewerTime], "older"),
    ]);
    await expectCode(history(transport).listTransfers(input()), "invalid-response");
  });

  test("stops at an observed descending cutoff and at provider exhaustion", async () => {
    const old = transaction({ timestamp: "2026-08-07T11:59:59Z" });
    const cutoff = queuedTransport([page([old], "older")]);
    const cutoffResult = await history(cutoff.transport).listTransfers(input());
    expect(cutoffResult).toMatchObject({ transfers: [], nextCursor: null });
    expect(cutoff.requests).toHaveLength(1);

    const exhausted = queuedTransport([page([])]);
    const exhaustedResult = await history(exhausted.transport).listTransfers(input());
    expect(exhaustedResult).toMatchObject({ transfers: [], nextCursor: null });
  });

  test("bounds sparse scans at three calls and returns an advancing empty cursor", async () => {
    const sparse = (block: string) => transaction({
      block,
      transfers: [tokenTransfer({
        blockNumber: block,
        fromAddress: OTHER,
        toAddress: THIRD,
      })],
    });
    const { transport, requests } = queuedTransport([
      page([sparse("103")], "page-2"),
      page([sparse("102")], "page-3"),
      page([sparse("101")], "page-4"),
    ]);

    const result = await history(transport).listTransfers(input());
    expect(requests).toHaveLength(3);
    expect(result.transfers).toEqual([]);
    expect(result.nextCursor).not.toBeNull();
    expect(decodeCdpAddressHistoryCursor(result.nextCursor!)).toEqual({
      version: 1,
      pageToken: "page-4",
      lastEmittedKey: null,
    });
  });
});

describe("CDP Address History errors and configuration", () => {
  test.each([
    [3, "invalid-input"],
    [4, "timed-out"],
    [7, "payment-required"],
    [8, "rate-limited"],
    [14, "upstream-error"],
    [16, "unauthorized"],
    [429, "rate-limited"],
  ] as const)("maps result status code %d to %s", async (providerCode, expected) => {
    const { transport } = queuedTransport([{ code: providerCode, message: "private provider detail" }]);
    await expectCode(history(transport).listTransfers(input()), expected);
  });

  test("maps top-level JSON-RPC and HTTP failures without leaking provider details", async () => {
    const rpcCases = [
      [3, "invalid-input"],
      [4, "timed-out"],
      [7, "payment-required"],
      [8, "rate-limited"],
      [14, "upstream-error"],
      [16, "unauthorized"],
      [-32602, "invalid-input"],
      [-32005, "rate-limited"],
      [429, "rate-limited"],
    ] as const;
    for (const [rpcCode, expected] of rpcCases) {
      const transport = createCdpAddressHistoryTransport({
        rpcUrl: "https://api.developer.coinbase.com/rpc/v1/base/test-key",
        fetch: async (_input, init) => {
          const body = JSON.parse(String(init?.body)) as { id: number };
          return Response.json({
            jsonrpc: "2.0",
            id: body.id,
            error: { code: rpcCode, message: "SECRET provider detail" },
          });
        },
      });
      try {
        await transport.listAddressTransactions({ address: OWNER, pageSize: "100" });
        throw new Error("Expected request to fail");
      } catch (error) {
        expect(error).toMatchObject({ code: expected });
        expect((error as Error).message).not.toContain("SECRET");
      }
    }

    const httpCases = [
      [400, "invalid-input"],
      [401, "unauthorized"],
      [403, "unauthorized"],
      [402, "payment-required"],
      [408, "timed-out"],
      [504, "timed-out"],
      [429, "rate-limited"],
      [500, "upstream-error"],
    ] as const;
    for (const [status, expected] of httpCases) {
      const transport = createCdpAddressHistoryTransport({
        rpcUrl: "https://api.developer.coinbase.com/rpc/v1/base/test-key",
        fetch: async () => new Response("SECRET provider detail", { status }),
      });
      await expectCode(
        transport.listAddressTransactions({ address: OWNER, pageSize: "100" }),
        expected,
      );
    }
  });

  test("enforces the bounded local timeout", async () => {
    const transport = createCdpAddressHistoryTransport({
      rpcUrl: "https://api.developer.coinbase.com/rpc/v1/base/test-key",
      timeoutMs: 1,
      fetch: async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        }),
    });
    await expectCode(
      transport.listAddressTransactions({ address: OWNER, pageSize: "100" }),
      "timed-out",
    );
    expect(() => createCdpAddressHistoryTransport({
      rpcUrl: "https://api.developer.coinbase.com/rpc/v1/base/test-key",
      timeoutMs: 10_001,
    })).toThrow(ChainDataError);
  });

  test("maps malformed JSON and transport errors to existing typed failures", async () => {
    const malformed = createCdpAddressHistoryTransport({
      rpcUrl: "https://api.developer.coinbase.com/rpc/v1/base/test-key",
      fetch: async () => new Response("not json"),
    });
    await expectCode(
      malformed.listAddressTransactions({ address: OWNER, pageSize: "100" }),
      "invalid-response",
    );

    const unavailable = createCdpAddressHistoryTransport({
      rpcUrl: "https://api.developer.coinbase.com/rpc/v1/base/test-key",
      fetch: async () => {
        throw new Error("private transport failure");
      },
    });
    await expectCode(
      unavailable.listAddressTransactions({ address: OWNER, pageSize: "100" }),
      "upstream-error",
    );
  });

  test("requires an explicitly configured CDP Node Base RPC URL", () => {
    expect(() => createCdpAddressHistoryFromEnv({})).toThrow(ChainDataError);
    expect(() => createCdpAddressHistoryFromEnv({
      BASE_RPC_URL: "https://mainnet.base.org",
    })).toThrow(ChainDataError);
    expect(() => createCdpAddressHistoryFromEnv({
      BASE_RPC_URL: "https://rpc.example.com",
    })).toThrow(ChainDataError);
    expect(() => createCdpAddressHistoryFromEnv({
      BASE_RPC_URL: "https://api.developer.coinbase.com/rpc/v1/base/test-key",
    })).not.toThrow();
  });
});

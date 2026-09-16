import { describe, expect, test } from "bun:test";
import {
  createCdpAddressHistory,
  createCdpAddressHistoryFromEnv,
  createCdpAddressHistoryTransport,
  decodeCdpAddressHistoryCursor,
  encodeCdpAddressHistoryCursor,
  type CdpAddressHistoryCursor,
  type CdpAddressHistoryFetch,
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
const FAKE_API_KEY_ID = "test-key-id";
const FAKE_API_KEY_SECRET = "test-key-secret";
const FAKE_JWT = "signed.jwt.value";

function hash(character: string): `0x${string}` {
  return `0x${character.repeat(64)}`;
}

function tokenTransfer(overrides: Record<string, unknown> = {}) {
  return {
    contract_address: TOKEN,
    from_address: OTHER,
    log_index: 1,
    to_address: OWNER,
    token_transfer_type: "erc20",
    value: "1",
    ...overrides,
  };
}

function transaction(options: {
  block?: string;
  index?: unknown;
  transactionHash?: `0x${string}`;
  blockHash?: `0x${string}`;
  timestamp?: string;
  status?: string;
  networkId?: string;
  transfers?: unknown[];
} = {}) {
  const transactionHash = options.transactionHash ?? hash("a");
  const blockHash = options.blockHash ?? hash("b");
  return {
    block_hash: blockHash,
    block_height: options.block ?? "100",
    status: options.status ?? "complete",
    transaction_hash: transactionHash,
    network_id: options.networkId ?? "base-mainnet",
    content: {
      block_timestamp: options.timestamp ?? "2026-09-07T11:00:00Z",
      hash: transactionHash,
      index: options.index ?? 1,
      token_transfers: options.transfers ?? [tokenTransfer()],
    },
  };
}

function page(data: unknown[], nextPage?: string) {
  return {
    data,
    has_more: nextPage !== undefined,
    next_page: nextPage ?? "",
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

function restTransport(overrides: {
  fetch?: CdpAddressHistoryFetch;
  generateJwt?: (options: Parameters<NonNullable<Parameters<typeof createCdpAddressHistoryTransport>[0]["generateJwt"]>>[0]) => Promise<string>;
  timeoutMs?: number;
} = {}) {
  return createCdpAddressHistoryTransport({
    apiKeyId: FAKE_API_KEY_ID,
    apiKeySecret: FAKE_API_KEY_SECRET,
    generateJwt: overrides.generateJwt ?? (async () => FAKE_JWT),
    fetch: overrides.fetch,
    timeoutMs: overrides.timeoutMs,
  });
}

async function capturedError(promise: Promise<unknown>): Promise<ChainDataError> {
  try {
    await promise;
    throw new Error("Expected request to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(ChainDataError);
    return error as ChainDataError;
  }
}

async function expectCode(promise: Promise<unknown>, code: ChainDataErrorCode) {
  expect(await capturedError(promise)).toMatchObject({ code });
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
      transfers: [tokenTransfer()],
    });
  });
}

describe("CDP Address History REST transport", () => {
  test("signs the exact fixed GET path and sends bounded REST pagination", async () => {
    const jwtOptions: unknown[] = [];
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const transport = restTransport({
      generateJwt: async (options) => {
        jwtOptions.push(options);
        return FAKE_JWT;
      },
      fetch: (async (request, init) => {
        calls.push({ url: String(request), init });
        return Response.json(page([]));
      }) as typeof fetch,
    });
    const mixedCaseOwner = OWNER.toUpperCase().replace("0X", "0x") as typeof OWNER;

    await transport.listAddressTransactions({
      address: mixedCaseOwner,
      pageSize: "100",
    });
    await transport.listAddressTransactions({
      address: mixedCaseOwner,
      pageSize: "100",
      pageToken: "next/page+=token",
    });

    const requestPath = `/platform/v1/networks/base-mainnet/addresses/${OWNER}/transactions`;
    expect(jwtOptions).toEqual([
      {
        apiKeyId: FAKE_API_KEY_ID,
        apiKeySecret: FAKE_API_KEY_SECRET,
        requestMethod: "GET",
        requestHost: "api.cdp.coinbase.com",
        requestPath,
        expiresIn: 120,
      },
      {
        apiKeyId: FAKE_API_KEY_ID,
        apiKeySecret: FAKE_API_KEY_SECRET,
        requestMethod: "GET",
        requestHost: "api.cdp.coinbase.com",
        requestPath,
        expiresIn: 120,
      },
    ]);
    expect(calls.map(({ url }) => url)).toEqual([
      `https://api.cdp.coinbase.com${requestPath}?limit=100`,
      `https://api.cdp.coinbase.com${requestPath}?limit=100&page=next%2Fpage%2B%3Dtoken`,
    ]);
    for (const { url, init } of calls) {
      expect(init?.method).toBe("GET");
      expect(init?.cache).toBe("no-store");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(Object.fromEntries(new Headers(init?.headers).entries())).toEqual({
        accept: "application/json",
        authorization: `Bearer ${FAKE_JWT}`,
      });
      expect(url).not.toContain(FAKE_API_KEY_ID);
      expect(url).not.toContain(FAKE_API_KEY_SECRET);
      expect(JSON.stringify(init?.headers)).not.toContain(FAKE_API_KEY_SECRET);
    }
  });

  test("maps JWT failures to redacted not-configured errors", async () => {
    let fetchCalls = 0;
    for (const generateJwt of [
      async () => {
        throw new Error(`private ${FAKE_API_KEY_SECRET}`);
      },
      async () => "",
      async () => "jwt with whitespace",
    ]) {
      const transport = restTransport({
        generateJwt,
        fetch: async () => {
          fetchCalls += 1;
          return Response.json(page([]));
        },
      });
      const error = await capturedError(
        transport.listAddressTransactions({ address: OWNER, pageSize: "100" }),
      );
      expect(error.code).toBe("not-configured");
      expect(error.message).not.toContain(FAKE_API_KEY_SECRET);
      expect(error.cause).toBeUndefined();
    }
    expect(fetchCalls).toBe(0);
  });

  test("maps HTTP failures without reading or retaining provider bodies", async () => {
    const cases = [
      [400, "invalid-input"],
      [401, "unauthorized"],
      [403, "unauthorized"],
      [402, "payment-required"],
      [408, "timed-out"],
      [504, "timed-out"],
      [429, "rate-limited"],
      [404, "upstream-error"],
      [500, "upstream-error"],
    ] as const;
    for (const [status, code] of cases) {
      const transport = restTransport({
        fetch: async () => new Response(`private body ${FAKE_API_KEY_SECRET}`, { status }),
      });
      const error = await capturedError(
        transport.listAddressTransactions({ address: OWNER, pageSize: "100" }),
      );
      expect(error).toMatchObject({ code, status });
      expect(error.message).not.toContain("private body");
      expect(error.message).not.toContain(FAKE_API_KEY_SECRET);
      expect(error.cause).toBeUndefined();
    }
  });

  test("maps malformed JSON, fetch failures, aborts, and local timeouts", async () => {
    const malformed = restTransport({
      fetch: async () => new Response("not json"),
    });
    await expectCode(
      malformed.listAddressTransactions({ address: OWNER, pageSize: "100" }),
      "invalid-response",
    );

    const unavailable = restTransport({
      fetch: async () => {
        throw new Error(`private transport failure ${FAKE_API_KEY_SECRET}`);
      },
    });
    const unavailableError = await capturedError(
      unavailable.listAddressTransactions({ address: OWNER, pageSize: "100" }),
    );
    expect(unavailableError).toMatchObject({ code: "upstream-error" });
    expect(unavailableError.cause).toBeUndefined();
    expect(unavailableError.message).not.toContain(FAKE_API_KEY_SECRET);

    const timeout = restTransport({
      timeoutMs: 1,
      fetch: (_input, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        });
      }),
    });
    await expectCode(
      timeout.listAddressTransactions({ address: OWNER, pageSize: "100" }),
      "timed-out",
    );

    let abortedFetchCalls = 0;
    const caller = new AbortController();
    caller.abort();
    const aborted = restTransport({
      fetch: async () => {
        abortedFetchCalls += 1;
        return Response.json(page([]));
      },
    });
    await expectCode(
      aborted.listAddressTransactions({
        address: OWNER,
        pageSize: "100",
        signal: caller.signal,
      }),
      "timed-out",
    );
    expect(abortedFetchCalls).toBe(0);

    const duringJwtController = new AbortController();
    const abortedDuringJwt = restTransport({
      generateJwt: async () => {
        duringJwtController.abort();
        return FAKE_JWT;
      },
      fetch: async () => {
        abortedFetchCalls += 1;
        return Response.json(page([]));
      },
    });
    await expectCode(
      abortedDuringJwt.listAddressTransactions({
        address: OWNER,
        pageSize: "100",
        signal: duringJwtController.signal,
      }),
      "timed-out",
    );
    expect(abortedFetchCalls).toBe(0);
  });

  test("requires project API credentials and bounded transport options", () => {
    const configuredEnv = {
      CDP_API_KEY_ID: FAKE_API_KEY_ID,
      CDP_API_KEY_SECRET: FAKE_API_KEY_SECRET,
      BASE_RPC_URL: "https://mainnet.base.org",
    };
    expect(() => createCdpAddressHistoryFromEnv({})).toThrow(ChainDataError);
    expect(() => createCdpAddressHistoryFromEnv({
      CDP_API_KEY_ID: FAKE_API_KEY_ID,
    })).toThrow(ChainDataError);
    expect(() => createCdpAddressHistoryFromEnv({
      CDP_API_KEY_SECRET: FAKE_API_KEY_SECRET,
    })).toThrow(ChainDataError);
    expect(() => createCdpAddressHistoryFromEnv(configuredEnv, {
      generateJwt: async () => FAKE_JWT,
      fetch: async () => Response.json(page([])),
    })).not.toThrow();
    expect(() => createCdpAddressHistoryTransport({
      apiKeyId: FAKE_API_KEY_ID,
      apiKeySecret: FAKE_API_KEY_SECRET,
      timeoutMs: 10_001,
    })).toThrow(ChainDataError);
  });
});

describe("CDP Address History REST transfers", () => {
  test("maps snake_case parent and ERC-20 rows into exact transfer identities", async () => {
    const transactionHash = hash("a");
    const blockHash = hash("b");
    const { transport, requests } = queuedTransport([
      page([transaction({
        transactionHash,
        blockHash,
        transfers: [
          tokenTransfer({ log_index: 1 }),
          tokenTransfer({ log_index: 3, from_address: OWNER, to_address: OTHER, value: "2" }),
          tokenTransfer({ log_index: 2, from_address: OWNER, to_address: OWNER, value: "3", contract_address: KNOWN_TOKEN }),
        ],
      })]),
    ]);

    const result = await history(transport).listTransfers(
      input({ verifiedWalletAddress: OWNER.toUpperCase().replace("0X", "0x") }),
    );

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ address: OWNER, pageSize: "100" });
    expect(Object.hasOwn(requests[0]!, "pageToken")).toBe(false);
    expect(result.transfers.map(({
      direction,
      amountBaseUnits,
      assetId,
      logIndex,
      transactionHash: mappedTransactionHash,
      blockHash: mappedBlockHash,
      blockNumber,
    }) => ({
      direction,
      amountBaseUnits,
      assetId,
      logIndex,
      transactionHash: mappedTransactionHash,
      blockHash: mappedBlockHash,
      blockNumber,
    }))).toEqual([
      { direction: "outgoing", amountBaseUnits: "2", assetId: null, logIndex: "3", transactionHash, blockHash, blockNumber: "100" },
      { direction: "self", amountBaseUnits: "3", assetId: "usdc", logIndex: "2", transactionHash, blockHash, blockNumber: "100" },
      { direction: "incoming", amountBaseUnits: "1", assetId: null, logIndex: "1", transactionHash, blockHash, blockNumber: "100" },
    ]);
    expect(result.transfers[0]?.id).toBe(`8453:${TOKEN}:${transactionHash}:3`);
    expect(result.source).toEqual({
      provider: "cdp-address-history",
      cached: false,
      stale: false,
      executionTimestamp: TO,
      executionTimeMs: 0,
      fetchedAt: TO,
    });
  });

  test("accepts only exact erc20 and omits NFT, unknown, missing, and non-owner rows", async () => {
    const rows = [
      tokenTransfer({ token_transfer_type: "erc721", value: "not-validated" }),
      tokenTransfer({ token_transfer_type: "erc1155", value: "not-validated" }),
      tokenTransfer({ token_transfer_type: "unknown", value: "not-validated" }),
      tokenTransfer({ token_transfer_type: "ERC20", value: "not-validated" }),
      tokenTransfer({ token_transfer_type: undefined, value: "not-validated" }),
      tokenTransfer({ from_address: OTHER, to_address: THIRD, value: "not-validated" }),
      tokenTransfer({ future_scalar_metadata: "accepted" }),
    ];
    const pending = { ...transaction({ status: "pending" }), content: undefined };
    const confirmedSpelling = { ...transaction({ status: "confirmed" }), content: undefined };
    const { transport } = queuedTransport([
      page([transaction({ transfers: rows }), pending, confirmedSpelling]),
    ]);

    const result = await history(transport).listTransfers(input());
    expect(result.transfers).toHaveLength(1);
    expect(result.transfers[0]?.amountBaseUnits).toBe("1");
  });

  test("requires exact Base mainnet network and a string status", async () => {
    for (const invalid of [
      transaction({ networkId: "base" }),
      transaction({ networkId: "BASE-MAINNET" }),
      { ...transaction(), network_id: undefined },
      { ...transaction(), status: 1 },
    ]) {
      const { transport } = queuedTransport([page([invalid])]);
      await expectCode(history(transport).listTransfers(input()), "invalid-response");
    }
  });

  test("normalizes RFC3339 timestamps and safe numeric indices", async () => {
    const { transport } = queuedTransport([
      page([transaction({
        index: 0,
        timestamp: "2026-09-07T12:30:45.123456+02:00",
        transfers: [tokenTransfer({ log_index: Number.MAX_SAFE_INTEGER })],
      })]),
    ]);
    const result = await history(transport).listTransfers(input());
    expect(result.transfers[0]?.blockTimestamp).toBe("2026-09-07T10:30:45.123Z");
    expect(result.transfers[0]?.logIndex).toBe(String(Number.MAX_SAFE_INTEGER));
  });

  test("rejects unsafe, negative, fractional, non-finite, and non-numeric indices", async () => {
    const invalidIndices: unknown[] = [
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
      "1",
    ];
    for (const invalidIndex of invalidIndices) {
      const transactionIndex = queuedTransport([
        page([transaction({ index: invalidIndex })]),
      ]);
      await expectCode(
        history(transactionIndex.transport).listTransfers(input()),
        "invalid-response",
      );

      const logIndex = queuedTransport([
        page([transaction({ transfers: [tokenTransfer({ log_index: invalidIndex })] })]),
      ]);
      await expectCode(
        history(logIndex.transport).listTransfers(input()),
        "invalid-response",
      );
    }
  });

  test("rejects malformed and out-of-range owner-scoped ERC-20 fields", async () => {
    const cases: Array<Record<string, unknown>> = [
      { contract_address: "0x1234" },
      { from_address: "not-an-address" },
      { to_address: "not-an-address" },
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

  test("requires completed parent identity and content hash agreement", async () => {
    const completed = transaction();
    const cases = [
      { ...completed, transaction_hash: undefined },
      { ...completed, transaction_hash: hash("g") },
      { ...completed, block_hash: undefined },
      { ...completed, block_height: undefined },
      { ...completed, block_height: "01" },
      { ...completed, block_height: UINT256_OVERFLOW },
      { ...completed, content: undefined },
      { ...completed, content: { ...completed.content, hash: hash("c") } },
      { ...completed, content: { ...completed.content, block_timestamp: undefined } },
    ];
    for (const invalid of cases) {
      const { transport } = queuedTransport([page([invalid])]);
      await expectCode(history(transport).listTransfers(input()), "invalid-response");
    }
  });

  test("accepts omitted or null token transfers but rejects present non-arrays", async () => {
    const completed = transaction();
    const contentWithoutTransfers: Record<string, unknown> = { ...completed.content };
    delete contentWithoutTransfers.token_transfers;

    for (const content of [
      contentWithoutTransfers,
      { ...completed.content, token_transfers: null },
    ]) {
      const { transport } = queuedTransport([page([{ ...completed, content }])]);
      await expect(history(transport).listTransfers(input())).resolves.toMatchObject({
        transfers: [],
        nextCursor: null,
      });
    }

    const { transport } = queuedTransport([
      page([{ ...completed, content: { ...completed.content, token_transfers: "invalid" } }]),
    ]);
    await expectCode(history(transport).listTransfers(input()), "invalid-response");
  });

  test("fails closed on malformed participants but skips valid non-owner legs before value parsing", async () => {
    const malformedParticipant = queuedTransport([
      page([transaction({
        transfers: [tokenTransfer({ from_address: "malformed", to_address: OWNER })],
      })]),
    ]);
    await expectCode(
      history(malformedParticipant.transport).listTransfers(input()),
      "invalid-response",
    );

    const nonOwner = queuedTransport([
      page([transaction({
        transfers: [tokenTransfer({
          from_address: OTHER,
          to_address: THIRD,
          contract_address: "malformed",
          log_index: "malformed",
          value: "malformed",
        })],
      })]),
    ]);
    await expect(history(nonOwner.transport).listTransfers(input())).resolves.toMatchObject({
      transfers: [],
      nextCursor: null,
    });
  });

  test("strictly validates the REST envelope and continuation consistency", async () => {
    const invalidPages: unknown[] = [
      null,
      {},
      { data: "not-an-array", has_more: false, next_page: "" },
      { data: Array.from({ length: 101 }, () => ({})), has_more: false, next_page: "" },
      { data: [], has_more: "false", next_page: "" },
      { data: [], has_more: true },
      { data: [], has_more: true, next_page: "" },
      { data: [], has_more: true, next_page: "p".repeat(2049) },
      { data: [], has_more: true, next_page: "bad\npage" },
      { data: [], has_more: false, next_page: "unexpected" },
      { data: [], has_more: false, next_page: 1 },
    ];
    for (const invalidPage of invalidPages) {
      const { transport } = queuedTransport([invalidPage]);
      await expectCode(history(transport).listTransfers(input()), "invalid-response");
    }

    for (const exhaustedPage of [
      { data: [], has_more: false },
      { data: [], has_more: false, next_page: null },
      { data: [], has_more: false, next_page: "" },
    ]) {
      const { transport } = queuedTransport([exhaustedPage]);
      await expect(history(transport).listTransfers(input())).resolves.toMatchObject({
        transfers: [],
        nextCursor: null,
      });
    }
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
      index: 2,
      transactionHash: lowHash,
      transfers: [tokenTransfer({ log_index: 2 })],
    });
    const earlierTransaction = transaction({
      block: "100",
      index: 1,
      transactionHash: highHash,
      transfers: [tokenTransfer({ log_index: 1 })],
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

  test("rejects provider chain-position violations within or across REST pages", async () => {
    const low = transaction({ block: "99" });
    const high = transaction({ block: "100" });
    const sameBlockEarlier = transaction({
      block: "100",
      index: 1,
      transactionHash: hash("f"),
    });
    const sameBlockLater = transaction({
      block: "100",
      index: 2,
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
      transfers: [tokenTransfer({ from_address: OTHER, to_address: THIRD })],
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

import { describe, expect, test } from "bun:test";
import { activityAssets } from "@/shared/activity/types";
import {
  buildBaseErc20TransferQuery,
  createBaseErc20TransferHistory,
  decodeTransferCursor,
  encodeTransferCursor,
} from "./base-erc20-transfers";
import { ChainDataError } from "./errors";
import { BASE_TRANSFER_SCAN_WINDOW_MS } from "./base-transfer-window";
import type { BaseErc20Asset, CdpSqlTransport } from "./types";

const WALLET = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";
const TOKEN = "0x3333333333333333333333333333333333333333";
const TX_A = `0x${"a".repeat(64)}` as const;
const TX_B = `0x${"b".repeat(64)}` as const;
const BLOCK = `0x${"c".repeat(64)}` as const;
const NOW = new Date("2026-09-07T12:00:00.000Z");
const assets = [
  { id: "verified-usdc", chainId: 8453, address: TOKEN },
] as const satisfies readonly BaseErc20Asset[];

function input(overrides: Record<string, unknown> = {}) {
  return {
    verifiedWalletAddress: WALLET,
    assetIds: ["verified-usdc"],
    from: "2026-09-01T00:00:00.000Z",
    to: "2026-09-07T12:00:00.000Z",
    ...overrides,
  };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    log_id: "base:event:1",
    block_number: "18446744073709551615",
    block_hash: BLOCK,
    source_timestamp: "2026-09-07T11:59:00.000Z",
    transaction_hash: TX_A,
    log_index: "4294967295",
    token_address: TOKEN,
    from_address: OTHER,
    to_address: WALLET,
    amount_base_units: "115792089237316195423570985008687907853269984665640564039457584007913129639935",
    ...overrides,
  };
}

function transportFor(result: unknown[]): CdpSqlTransport {
  return {
    async run() {
      return {
        result,
        metadata: {
          cached: true,
          executionTimestamp: "2026-09-07T11:58:00.000Z",
          executionTimeMs: 12,
          rowCount: result.length,
        },
      };
    },
  };
}

describe("Base ERC20 transfer query", () => {
  test("constructs a bounded, scoped, re-org-aware fixed template", () => {
    const { sql } = buildBaseErc20TransferQuery(input(), assets, NOW);

    expect(sql).toContain("FROM base.events");
    expect(sql).toContain("GROUP BY log_id, address");
    expect(sql).toContain("any(toString(parameters['from'])) AS from_address");
    expect(sql).toContain("any(toString(parameters['to'])) AS to_address");
    expect(sql).toContain("any(toString(parameters['value'])) AS amount_base_units");
    expect(sql).not.toContain("topics");
    expect(sql).not.toContain("parameter_types");
    expect(sql).toContain("WHERE net_action > 0");
    expect(sql).not.toMatch(/\bHAVING\b/);
    expect(sql).toContain(
      `lower(toString(parameters['from'])) = '${WALLET}'`,
    );
    expect(sql).toContain(
      `lower(toString(parameters['to'])) = '${WALLET}'`,
    );
    expect(sql).toContain(`address IN ('${TOKEN}')`);
    expect(sql).not.toContain("lower(toString(address))");
    expect(sql).not.toMatch(/GROUP BY log_id[\s\S]*LIMIT 10000/);
    expect(sql).toMatch(/LIMIT 51$/);
    expect(sql).toContain("any(block_number) AS block_number_numeric");
    expect(sql).toContain("any(log_index) AS log_index_numeric");
    expect(sql).toContain("any(block_timestamp) AS event_timestamp");
    expect(sql).toContain("formatDateTime(event_timestamp,");
    expect(sql).not.toContain("any(block_timestamp) AS block_timestamp");
    expect(sql).toContain(
      "ORDER BY block_number_numeric DESC, log_index_numeric DESC, transaction_hash DESC, token_address DESC, log_id DESC",
    );
    expect(sql).not.toContain("ORDER BY block_number DESC");
    expect(sql).toContain("LIMIT 51");
    expect(sql).not.toContain("SELECT *");
  });

  test("can query every wallet-scoped ERC-20 contract without a token fallback", () => {
    const { sql } = buildBaseErc20TransferQuery(
      input({ includeUnknownAssets: true }),
      assets,
      NOW,
    );
    expect(sql).not.toContain("address IN (");
    expect(sql).toContain(
      `lower(toString(parameters['from'])) = '${WALLET}'`,
    );
    expect(sql).toContain(
      `lower(toString(parameters['to'])) = '${WALLET}'`,
    );
  });

  test("rejects address injection and non-allowlisted assets", () => {
    expect(() =>
      buildBaseErc20TransferQuery(
        input({ verifiedWalletAddress: `${WALLET}' OR 1=1 --` }),
        assets,
        NOW,
      ),
    ).toThrow(ChainDataError);
    expect(() =>
      buildBaseErc20TransferQuery(
        input({ assetIds: ["verified-usdc') OR 1=1 --"] }),
        assets,
        NOW,
      ),
    ).toThrow("Requested asset is not allowlisted");
  });

  test("rejects invalid-checksum wallet addresses and malformed response hashes", async () => {
    expect(() => buildBaseErc20TransferQuery(
      input({ verifiedWalletAddress: "0xAbcdef0123456789abcdef0123456789abcdef01" }),
      assets,
      NOW,
    )).toThrow(ChainDataError);

    const history = createBaseErc20TransferHistory({
      assets,
      transport: transportFor([row({ transaction_hash: `0x${"g".repeat(64)}` })]),
      now: () => NOW,
    });
    await expect(history.listTransfers(input())).rejects.toMatchObject({
      code: "invalid-response",
    });
  });

  test("enforces page, time, future, and cache bounds", () => {
    expect(() =>
      buildBaseErc20TransferQuery(input({ limit: 201 }), assets, NOW),
    ).toThrow("page size");
    expect(() =>
      buildBaseErc20TransferQuery(
        input({ from: "2026-07-01T00:00:00Z" }),
        assets,
        NOW,
      ),
    ).toThrow("seven days");
    expect(() =>
      buildBaseErc20TransferQuery(
        input({ to: "2026-09-08T00:00:00Z" }),
        assets,
        NOW,
      ),
    ).toThrow("future");
    expect(() =>
      buildBaseErc20TransferQuery(input({ cacheMaxAgeMs: 499 }), assets, NOW),
    ).toThrow("cache age");
  });

  test("Home all-contract activity stays CoinbaSeQL-safe and returns an empty page", async () => {
    const productionAssets = activityAssets.map((asset) => ({
      id: asset.id,
      chainId: 8453 as const,
      address: asset.tokenAddress,
    }));
    const from = "2026-08-07T12:00:00.000Z";
    const request = {
      verifiedWalletAddress: WALLET,
      assetIds: [],
      includeUnknownAssets: true,
      from,
      to: "2026-09-07T12:00:00.000Z",
      limit: 25,
    } as const;
    const { sql } = buildBaseErc20TransferQuery({ ...request, from: new Date(NOW.getTime() - BASE_TRANSFER_SCAN_WINDOW_MS).toISOString() }, productionAssets, NOW);

    expect(productionAssets.length).toBeGreaterThan(20);
    expect(sql.length).toBeLessThanOrEqual(10_000);
    expect(sql).not.toContain("address IN (");
    expect(sql).not.toContain("lower(toString(address))");
    expect(sql).toContain("WHERE net_action > 0");
    expect(sql).not.toMatch(/\bHAVING\b/);
    expect(sql).not.toMatch(/GROUP BY log_id[\s\S]*LIMIT 10000/);
    expect(sql.match(/LIMIT (\d+)\s*$/)?.[1]).toBe("26");

    const history = createBaseErc20TransferHistory({
      assets: productionAssets,
      transport: transportFor([]),
      now: () => NOW,
    });
    const page = await history.listTransfers(request);
    expect(page.transfers).toEqual([]);
    expect(page.nextCursor).not.toBeNull();
  });
});

describe("Base ERC20 transfer adapter", () => {
  test("forwards the caller abort signal to the SQL transport", async () => {
    const controller = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    const history = createBaseErc20TransferHistory({
      assets,
      transport: {
        async run(request) {
          receivedSignal = request.signal;
          return transportFor([]).run(request);
        },
      },
      now: () => NOW,
    });

    await history.listTransfers(input({ signal: controller.signal }));
    expect(receivedSignal).toBe(controller.signal);
  });

  test("preserves uint256 and index values as strings and marks stale cached data", async () => {
    const history = createBaseErc20TransferHistory({
      assets,
      transport: transportFor([row()]),
      now: () => NOW,
    });

    const page = await history.listTransfers(input({ staleAfterMs: 60_000 }));

    expect(page.transfers[0]?.amountBaseUnits).toBe(
      "115792089237316195423570985008687907853269984665640564039457584007913129639935",
    );
    expect(page.transfers[0]?.blockNumber).toBe("18446744073709551615");
    expect(page.transfers[0]?.logIndex).toBe("4294967295");
    expect(page.transfers[0]?.direction).toBe("incoming");
    expect(page.transfers[0]?.logId).toBe("base:event:1");
    expect(page.transfers[0]?.id).toBe(
      `8453:${TOKEN}:base:event:1`,
    );
    expect(page.source.cached).toBe(true);
    expect(page.source.stale).toBe(true);
    expect(page.source.executionTimestamp).toBe("2026-09-07T11:58:00.000Z");
  });

  test("creates a deterministic keyset cursor from the final returned row", async () => {
    const history = createBaseErc20TransferHistory({
      assets,
      transport: transportFor([
        row({ log_id: "base:event:2", transaction_hash: TX_B, log_index: "2" }),
        row({ log_id: "base:event:1", transaction_hash: TX_A, log_index: "1" }),
      ]),
      now: () => NOW,
    });

    const page = await history.listTransfers(input({ limit: 1 }));
    expect(page.transfers).toHaveLength(1);
    expect(page.nextCursor).not.toBeNull();
    expect(decodeTransferCursor(page.nextCursor!)).toEqual({
      blockNumber: "18446744073709551615",
      transactionHash: TX_B,
      logIndex: "2",
      tokenAddress: TOKEN,
      logId: "base:event:2",
    });

    const { sql } = buildBaseErc20TransferQuery(
      input({ cursor: page.nextCursor }),
      assets,
      NOW,
    );
    expect(sql).toContain(
      "block_number_numeric < toUInt64('18446744073709551615')",
    );
    const blockCursor = "block_number_numeric = toUInt64('18446744073709551615')";
    expect(sql).toContain("log_index_numeric < toUInt32('2')");
    expect(sql).toContain(
      `${blockCursor} AND log_index_numeric = toUInt32('2') AND transaction_hash < '${TX_B}'`,
    );
    expect(sql.indexOf("log_index_numeric < toUInt32('2')")).toBeLessThan(
      sql.indexOf(`transaction_hash < '${TX_B}'`),
    );
  });

  test("paginates numeric log indexes 100, 10, and 9 without lexical gaps", async () => {
    const sourceRows = [
      row({ log_id: "synthetic:9", log_index: "9" }),
      row({ log_id: "synthetic:100", log_index: "100" }),
      row({ log_id: "synthetic:10", log_index: "10" }),
    ];
    const transport: CdpSqlTransport = {
      async run(request) {
        expect(request.sql).toContain(
          "ORDER BY block_number_numeric DESC, log_index_numeric DESC, transaction_hash DESC, token_address DESC, log_id DESC",
        );
        const cursorIndex = request.sql.match(
          /log_index_numeric < toUInt32\('(\d+)'\)/,
        )?.[1];
        const providerLimit = Number(request.sql.match(/LIMIT (\d+)$/)?.[1]);
        const result = sourceRows
          .filter(
            (candidate) =>
              cursorIndex === undefined ||
              BigInt(String(candidate.log_index)) < BigInt(cursorIndex),
          )
          .sort((left, right) =>
            BigInt(String(left.log_index)) > BigInt(String(right.log_index))
              ? -1
              : BigInt(String(left.log_index)) < BigInt(String(right.log_index))
                ? 1
                : 0,
          )
          .slice(0, providerLimit);
        return {
          result,
          metadata: {
            cached: false,
            executionTimestamp: "2026-09-07T11:58:00.000Z",
            executionTimeMs: 1,
            rowCount: result.length,
          },
        };
      },
    };
    const history = createBaseErc20TransferHistory({
      assets,
      transport,
      now: () => NOW,
    });

    const first = await history.listTransfers(input({ limit: 1 }));
    const second = await history.listTransfers(
      input({ limit: 1, cursor: first.nextCursor }),
    );
    const third = await history.listTransfers(
      input({ limit: 1, cursor: second.nextCursor }),
    );

    expect(first.transfers.map((transfer) => transfer.logIndex)).toEqual(["100"]);
    expect(second.transfers.map((transfer) => transfer.logIndex)).toEqual(["10"]);
    expect(third.transfers.map((transfer) => transfer.logIndex)).toEqual(["9"]);
    expect(first.nextCursor).not.toBeNull();
    expect(second.nextCursor).not.toBeNull();
    expect(third.nextCursor).toBeNull();
  });

  test("accepts documented string log IDs consistently in rows and cursors", async () => {
    const logId = "synthetic/log id'with+chars";
    const history = createBaseErc20TransferHistory({
      assets,
      transport: transportFor([
        row({ log_id: logId, log_index: "10" }),
        row({ log_id: "extra-row", log_index: "9" }),
      ]),
      now: () => NOW,
    });

    const page = await history.listTransfers(input({ limit: 1 }));
    expect(decodeTransferCursor(page.nextCursor!).logId).toBe(logId);
    const { sql } = buildBaseErc20TransferQuery(
      input({ cursor: page.nextCursor }),
      assets,
      NOW,
    );
    expect(sql).toContain("log_id < 'synthetic/log id''with+chars'");
  });

  test("rejects oversized serialized cursors at both boundaries", () => {
    expect(() => decodeTransferCursor("a".repeat(4097))).toThrow(ChainDataError);
    expect(() => encodeTransferCursor({
      blockNumber: "1".repeat(4096), transactionHash: TX_A,
      logIndex: "1", tokenAddress: TOKEN, logId: "synthetic",
    })).toThrow(ChainDataError);
  });

  test("rejects numeric uint256 values before they can lose precision", async () => {
    const history = createBaseErc20TransferHistory({
      assets,
      transport: transportFor([row({ amount_base_units: 9007199254740992 })]),
      now: () => NOW,
    });

    await expect(history.listTransfers(input())).rejects.toMatchObject({
      code: "invalid-response",
    });
  });

  test("keeps the accepted decoded-parameter query shape", () => {
    const { sql } = buildBaseErc20TransferQuery(input({ limit: 1 }), assets, NOW);

    expect(sql).toContain("parameters['from']");
    expect(sql).toContain("parameters['to']");
    expect(sql).toContain("parameters['value']");
    expect(sql).not.toContain("topics");
    expect(sql).not.toContain("parameter_types");
    expect(sql).not.toContain("arrayFilter");
    expect(sql).toMatch(/LIMIT 2$/);
  });

  test("bounds a large synthetic history to one source request and exact contract cursor", async () => {
    let requests = 0;
    const history = createBaseErc20TransferHistory({
      assets,
      transport: {
        async run() {
          requests += 1;
          return transportFor(
            Array.from({ length: 201 }, (_, index) =>
              row({
                log_id: `synthetic:${index}`,
                log_index: String(201 - index),
              }),
            ),
          ).run({ sql: "fixture" });
        },
      },
      now: () => NOW,
    });

    const page = await history.listTransfers(input({ limit: 200 }));

    expect(requests).toBe(1);
    expect(page.transfers).toHaveLength(200);
    expect(page.transfers.every((transfer) => transfer.tokenAddress === TOKEN)).toBe(true);
    expect(decodeTransferCursor(page.nextCursor!)).toMatchObject({
      tokenAddress: TOKEN,
      logId: "synthetic:199",
    });
  });

  test("drops present unclassified decoded amounts only in all-contract mode", async () => {
    const rows = [
      row({ log_id: "valid", amount_base_units: "42", log_index: "4" }),
      row({ log_id: "null", amount_base_units: null, log_index: "3" }),
      row({ log_id: "empty", amount_base_units: "", log_index: "2" }),
      row({ log_id: "non-decimal", amount_base_units: "1.5", log_index: "1" }),
    ];
    const history = createBaseErc20TransferHistory({
      assets,
      transport: transportFor(rows),
      now: () => NOW,
    });

    const page = await history.listTransfers(input({
      assetIds: [],
      includeUnknownAssets: true,
    }));
    expect(page.transfers.map(({ logId, amountBaseUnits }) => ({ logId, amountBaseUnits }))).toEqual([
      { logId: "valid", amountBaseUnits: "42" },
    ]);
    expect(page.droppedRowCount).toBe(3);

    for (const amount of [null, "", "1.5"]) {
      const strict = createBaseErc20TransferHistory({
        assets,
        transport: transportFor([row({ amount_base_units: amount })]),
        now: () => NOW,
      });
      await expect(strict.listTransfers(input())).rejects.toMatchObject({
        code: "invalid-response",
      });
    }
  });

  test("rejects a missing amount response key in all-contract mode", async () => {
    const missingAmount = row({ log_id: "missing" });
    delete (missingAmount as { amount_base_units?: unknown }).amount_base_units;
    const history = createBaseErc20TransferHistory({
      assets,
      transport: transportFor([missingAmount]),
      now: () => NOW,
    });

    await expect(history.listTransfers(input({
      assetIds: [],
      includeUnknownAssets: true,
    }))).rejects.toMatchObject({ code: "invalid-response" });
  });

  test("uses the last limited source row for cursors even when rows are dropped", async () => {
    const allDropped = Array.from({ length: 26 }, (_, index) =>
      row({
        log_id: `drop:${index}`,
        log_index: String(26 - index),
        amount_base_units: null,
      }),
    );
    const history = createBaseErc20TransferHistory({
      assets,
      transport: transportFor(allDropped),
      now: () => NOW,
    });
    const page = await history.listTransfers(input({
      assetIds: [],
      includeUnknownAssets: true,
      limit: 25,
    }));
    expect(page.transfers).toEqual([]);
    expect(page.droppedRowCount).toBe(25);
    expect(decodeTransferCursor(page.nextCursor!)).toMatchObject({
      logId: "drop:24",
      logIndex: "2",
    });

    const lastDropped = createBaseErc20TransferHistory({
      assets,
      transport: transportFor([
        row({ log_id: "visible", log_index: "3", amount_base_units: "1" }),
        row({ log_id: "last-dropped", log_index: "2", amount_base_units: null }),
        row({ log_id: "lookahead", log_index: "1", amount_base_units: "1" }),
      ]),
      now: () => NOW,
    });
    const second = await lastDropped.listTransfers(input({
      assetIds: [],
      includeUnknownAssets: true,
      limit: 2,
    }));
    expect(second.transfers.map(({ logId }) => logId)).toEqual(["visible"]);
    expect(decodeTransferCursor(second.nextCursor!)).toMatchObject({
      logId: "last-dropped",
      logIndex: "2",
    });
  });

  test("preserves an unknown contract as unknown when explicitly requested", async () => {
    const unknownToken = "0x5555555555555555555555555555555555555555";
    const history = createBaseErc20TransferHistory({
      assets,
      transport: transportFor([row({ token_address: unknownToken })]),
      now: () => NOW,
    });

    const page = await history.listTransfers(
      input({ includeUnknownAssets: true }),
    );
    expect(page.transfers[0]).toMatchObject({
      id: `8453:${unknownToken}:base:event:1`,
      logId: "base:event:1",
      assetId: null,
      tokenAddress: unknownToken,
      amountBaseUnits: "115792089237316195423570985008687907853269984665640564039457584007913129639935",
    });
  });

  test("keeps wallet identity in the query cache key", () => {
    const otherWallet = "0x9999999999999999999999999999999999999999";
    const first = buildBaseErc20TransferQuery(
      input({ includeUnknownAssets: true }), assets, NOW,
    ).sql;
    const second = buildBaseErc20TransferQuery(
      input({ verifiedWalletAddress: otherWallet, includeUnknownAssets: true }),
      assets,
      NOW,
    ).sql;
    expect(first).not.toBe(second);
    expect(first).toContain(WALLET);
    expect(second).toContain(otherWallet);
  });

  test("rejects rows outside the verified wallet or asset scope", async () => {
    const unscopedWallet = createBaseErc20TransferHistory({
      assets,
      transport: transportFor([
        row({
          from_address: OTHER,
          to_address: "0x4444444444444444444444444444444444444444",
        }),
      ]),
      now: () => NOW,
    });
    await expect(unscopedWallet.listTransfers(input())).rejects.toMatchObject({
      code: "invalid-response",
    });
    await expect(unscopedWallet.listTransfers(input({
      assetIds: [],
      includeUnknownAssets: true,
    }))).rejects.toMatchObject({ code: "invalid-response" });

    const malformedEnvelope = createBaseErc20TransferHistory({
      assets,
      transport: transportFor([row({ token_address: "not-an-address" })]),
      now: () => NOW,
    });
    await expect(malformedEnvelope.listTransfers(input({
      assetIds: [],
      includeUnknownAssets: true,
    }))).rejects.toMatchObject({ code: "invalid-response" });

    const unscopedAsset = createBaseErc20TransferHistory({
      assets,
      transport: transportFor([
        row({ token_address: "0x5555555555555555555555555555555555555555" }),
      ]),
      now: () => NOW,
    });
    await expect(unscopedAsset.listTransfers(input())).rejects.toMatchObject({
      code: "invalid-response",
    });
  });

  test("empty official CDP envelope is an empty page, not invalid-response", async () => {
    const history = createBaseErc20TransferHistory({
      assets,
      transport: {
        async run() {
          return {
            result: [],
            metadata: { rowCount: 0 },
          } as never;
        },
      },
      now: () => NOW,
    });

    const page = await history.listTransfers(input());
    expect(page.transfers).toEqual([]);
    expect(page.nextCursor).toBeNull();
    expect(page.source.cached).toBe(false);
    expect(page.source.executionTimeMs).toBe(0);
  });

  test("rejects invalid metadata and mismatched row counts", async () => {
    const history = createBaseErc20TransferHistory({
      assets,
      transport: {
        async run() {
          return {
            result: [row()],
            schema: { columns: [] },
            metadata: {
              cached: false,
              executionTimestamp: "not-a-date",
              executionTimeMs: 1,
              rowCount: 0,
            },
          };
        },
      },
      now: () => NOW,
    });

    await expect(history.listTransfers(input())).rejects.toMatchObject({
      code: "invalid-response",
    });
  });
});


describe("bounded transfer time pagination", () => {
  const start = "2026-08-07T12:00:00.000Z";
  const request = () => input({ from: start, includeUnknownAssets: true, assetIds: [], limit: 1 });

  function scan(sql: string) {
    const times = [...sql.matchAll(/block_timestamp (?:>=|<) parseDateTime64BestEffort\('([^']+)'\)/g)].map((match) => match[1] ?? "");
    expect(times).toHaveLength(2);
    const from = times[0];
    const to = times[1];
    if (!from || !to) throw new Error("Missing scan bounds.");
    expect(Date.parse(to) - Date.parse(from)).toBeLessThanOrEqual(BASE_TRANSFER_SCAN_WINDOW_MS);
    return { from, to };
  }

  test("the SQL builder rejects an oversized scan even with a one-row limit", () => {
    expect(() => buildBaseErc20TransferQuery(request(), assets, NOW)).toThrow("seven days");
  });

  test("quiet wallets traverse adjacent empty chunks to the full history boundary with one query per page", async () => {
    const bounds: { from: string; to: string }[] = [];
    const history = createBaseErc20TransferHistory({ assets, now: () => NOW, transport: {
      async run({ sql }) { bounds.push(scan(sql)); return transportFor([]).run({ sql }); },
    } });
    let cursor: string | null = null;
    const seen = new Set<string>();
    do {
      const before = bounds.length;
      const page = await history.listTransfers({ ...request(), cursor });
      expect(bounds.length).toBe(before + 1);
      expect(page.transfers).toEqual([]);
      cursor = page.nextCursor;
      if (cursor) { expect(seen.has(cursor)).toBe(false); seen.add(cursor); }
      expect(bounds.length).toBeLessThanOrEqual(Math.ceil((NOW.getTime() - Date.parse(start)) / BASE_TRANSFER_SCAN_WINDOW_MS));
    } while (cursor);
    expect(bounds[0]?.to).toBe(NOW.toISOString());
    expect(bounds.at(-1)?.from).toBe(start);
    for (let i = 1; i < bounds.length; i++) expect(bounds[i]?.to).toBe(bounds[i - 1]?.from);
  });

  test("row pagination stays in its chunk and resets the row cursor when crossing a time boundary", async () => {
    const reads: { sql: string; from: string; to: string }[] = [];
    const newest = row({ block_number: "300", log_index: "3", log_id: "newest" });
    const second = row({ block_number: "299", log_index: "2", log_id: "second" });
    const olderTime = new Date(NOW.getTime() - BASE_TRANSFER_SCAN_WINDOW_MS - 1000).toISOString();
    const older = row({ block_number: "200", log_index: "1", log_id: "older", source_timestamp: olderTime });
    const history = createBaseErc20TransferHistory({ assets, now: () => NOW, transport: {
      async run({ sql }) {
        reads.push({ sql, ...scan(sql) });
        const result = reads.length === 1 ? [newest, second] : reads.length === 2 ? [second] : reads.length === 3 ? [older] : [];
        return transportFor(result).run({ sql });
      },
    } });
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await history.listTransfers({ ...request(), cursor });
      ids.push(...page.transfers.map((transfer) => transfer.logId));
      cursor = page.nextCursor;
      expect(reads.length).toBeLessThan(10);
    } while (cursor);
    expect(ids).toEqual(["newest", "second", "older"]);
    expect(reads[1]?.from).toBe(reads[0]?.from);
    expect(reads[1]?.sql).toContain("block_number_numeric < toUInt64('300')");
    expect(reads[2]?.to).toBe(reads[1]?.from);
    expect(reads[2]?.sql).not.toContain("block_number_numeric < toUInt64");
  });

  test("window cursors reject owner, time, token-scope and malformed-position changes before a provider call", async () => {
    let calls = 0;
    const history = createBaseErc20TransferHistory({ assets, now: () => NOW, transport: {
      async run({ sql }) { calls++; return transportFor([]).run({ sql }); },
    } });
    const page = await history.listTransfers(request());
    const cursor = page.nextCursor;
    if (cursor === null) throw new Error("Missing window continuation.");
    for (const change of [
      { verifiedWalletAddress: OTHER }, { from: "2026-08-08T12:00:00.000Z" },
      { to: "2026-09-07T11:00:00.000Z" }, { includeUnknownAssets: false, assetIds: ["verified-usdc"] },
    ]) {
      await expect(history.listTransfers({ ...request(), ...change, cursor })).rejects.toMatchObject({ code: "invalid-input" });
    }
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    for (const change of [{ scanTo: start }, { scanTo: "2026-09-06T12:00:00.000Z" }, { rowCursor: "invalid" }, { legacyCursor: "invalid" }, { scanVersion: 2 }]) {
      const invalid = Buffer.from(JSON.stringify({ ...value, ...change })).toString("base64url");
      await expect(history.listTransfers({ ...request(), cursor: invalid })).rejects.toMatchObject({ code: "invalid-input" });
    }
    expect(calls).toBe(1);
  });


  test("legacy row cursors remain an ordering ceiling across empty newer chunks during deployment skew", async () => {
    const legacy = encodeTransferCursor({ blockNumber: "100", logIndex: "1", transactionHash: TX_A, tokenAddress: TOKEN, logId: "previous" });
    const queries: string[] = [];
    const history = createBaseErc20TransferHistory({ assets, now: () => NOW, transport: {
      async run({ sql }) { queries.push(sql); return transportFor([]).run({ sql }); },
    } });
    let cursor: string | null = legacy;
    do {
      const page = await history.listTransfers({ ...request(), cursor });
      cursor = page.nextCursor;
      expect(queries.length).toBeLessThan(10);
    } while (cursor);
    expect(queries.length).toBeGreaterThan(1);
    for (const sql of queries) expect(sql).toContain("block_number_numeric < toUInt64('100')");
  });

  test("an older-chunk rejection remains a failure and retries the same bounded query", async () => {
    const queries: string[] = [];
    const history = createBaseErc20TransferHistory({ assets, now: () => NOW, transport: {
      async run({ sql }) {
        queries.push(sql);
        if (queries.length === 2) throw new ChainDataError("upstream-error", "Unavailable.", { status: 400 });
        return transportFor([]).run({ sql });
      },
    } });
    const first = await history.listTransfers(request());
    await expect(history.listTransfers({ ...request(), cursor: first.nextCursor })).rejects.toMatchObject({ code: "upstream-error" });
    const retried = await history.listTransfers({ ...request(), cursor: first.nextCursor });
    expect(queries[2]).toBe(queries[1]);
    expect(retried.nextCursor).not.toBe(first.nextCursor);
  });
});


test("a quiet wallet automatically reaches a transfer older than thirty days without widening SQL scans", async () => {
  const olderAt = "2026-07-20T12:00:00.000Z";
  let calls = 0;
  const history = createBaseErc20TransferHistory({ assets, now: () => NOW, transport: {
    async run({ sql }) {
      calls++;
      const times = [...sql.matchAll(/block_timestamp (?:>=|<) parseDateTime64BestEffort\('([^']+)'\)/g)].map((match) => Date.parse(match[1] ?? ""));
      const from = times[0];
    const to = times[1];
    if (from === undefined || to === undefined) throw new Error("Missing scan bounds.");
      expect(to - from).toBeLessThanOrEqual(BASE_TRANSFER_SCAN_WINDOW_MS);
      return transportFor(Date.parse(olderAt) >= from && Date.parse(olderAt) < to
        ? [row({ source_timestamp: olderAt })] : []).run({ sql });
    },
  } });
  const request = input({ from: "2023-01-01T00:00:00.000Z", includeUnknownAssets: true, assetIds: [] });
  let cursor: string | null = null;
  let found = false;
  do {
    const page = await history.listTransfers({ ...request, cursor });
    found = page.transfers.some((transfer) => transfer.blockTimestamp === olderAt);
    cursor = page.nextCursor;
    expect(calls).toBeLessThan(10);
  } while (!found && cursor);
  expect(found).toBe(true);
  expect(calls).toBeGreaterThan(4);
});

import { describe, expect, test } from "bun:test";
import { portfolioVaults } from "@/config/portfolio-assets";
import { ChainDataError } from "@/server/chain-data/errors";
import type { CdpSqlTransport } from "@/server/chain-data/types";
import { createHistoryTransferSource } from "./sql-transfers";
import type { HexAddress } from "./types";

const WALLET = `0x${"a".repeat(40)}` as HexAddress;
const OTHER = `0x${"b".repeat(40)}` as HexAddress;
const TOKEN = `0x${"c".repeat(40)}` as HexAddress;
const DAY = 86_400_000;
const fromTime = new Date("2025-01-01T00:00:00.000Z");
const toTime = new Date(fromTime.getTime() + 365 * DAY);
const input = (overrides: Partial<Parameters<ReturnType<typeof createHistoryTransferSource>["listChanges"]>[0]> = {}) => ({
  address: WALLET,
  fromBlockExclusive: BigInt(100),
  toBlockInclusive: BigInt(3750),
  fromTime,
  toTime,
  ...overrides,
});

function row(overrides: Record<string, unknown> = {}) {
  return {
    block_number: "101",
    source_timestamp: "2025-01-01T00:00:01.000Z",
    log_index: "0",
    token_address: TOKEN,
    from_address: OTHER,
    to_address: WALLET,
    amount_base_units: "115792089237316195423570985008687907853269984665640564039457584007913129639935",
    ...overrides,
  };
}

function transportFor(rows: unknown[]): CdpSqlTransport {
  return { async run() { return { result: rows, metadata: { cached: false, executionTimestamp: toTime.toISOString(), executionTimeMs: 0, rowCount: rows.length } }; } };
}

function timeBounds(sql: string): [number, number] {
  const times = [...sql.matchAll(/parseDateTime64BestEffort\('([^']+)'\)/g)];
  if (times.length !== 2) throw new Error("missing timestamp bounds");
  return [new Date(times[0]![1]!).getTime() + 3_600_000, new Date(times[1]![1]!).getTime() - 3_600_000];
}

async function failureCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    throw new Error("expected failure");
  } catch (error) {
    expect(error).toBeInstanceOf(ChainDataError);
    return (error as ChainDataError).code;
  }
}

describe("history transfer SQL source", () => {
  test("maps inbound, outbound, self-transfer and vault share, sorted and deduplicated", async () => {
    const vault = portfolioVaults[0]!.address;
    const rows = [
      row({ block_number: "103", log_index: "3", from_address: WALLET, to_address: OTHER, amount_base_units: "5" }),
      row({ block_number: "102", log_index: "2", from_address: WALLET, to_address: WALLET, amount_base_units: "8" }),
      row({ block_number: "101", log_index: "0", token_address: vault.toUpperCase().replace("0X", "0x"), amount_base_units: "3" }),
      row({ block_number: "101", log_index: "0", token_address: vault, amount_base_units: "3" }),
    ];
    const seen: string[] = [];
    const signal = new AbortController().signal;
    const source = createHistoryTransferSource({ transport: {
      async run(request) { seen.push(request.sql); expect(request.signal).toBe(signal); return transportFor(rows).run(request); },
    } });
    const result = await source.listChanges(input({ signal, toTime: new Date(fromTime.getTime() + DAY) }));
    expect(result.queries).toBe(1);
    expect(result.windows).toBe(1);
    expect(result.changes.map((change) => [change.blockNumber, change.logIndex, change.delta, change.asset.kind])).toEqual([
      [BigInt(101), 0, BigInt(3), "vault-share"], [BigInt(102), 2, BigInt(0), "erc20"], [BigInt(103), 3, -BigInt(5), "erc20"],
    ]);
    expect(result.changes[0]!.txHash).toBeNull();
    expect(result.changes[0]!.blockTime.toISOString()).toBe("2025-01-01T00:00:01.000Z");
    expect(seen[0]).toContain("FROM base.transfers");
    expect(seen[0]).toContain("sum(if(action = 'added', 1, -1)) AS net_action");
    expect(seen[0]).toContain("GROUP BY block_number, log_index, lower(token_address), lower(from_address), lower(to_address), toString(value)");
    expect(seen[0]).toContain("WHERE net_action > 0");
    expect(seen[0]).not.toMatch(/\bblock_number\s*(?:[<>]=?|=|BETWEEN\b|IN\b)/i);
    expect(seen[0]).not.toContain("transaction_hash");
    expect(timeBounds(seen[0]!)).toEqual([fromTime.getTime(), fromTime.getTime() + DAY]);
  });

  test.each([
    ["amount", row({ amount_base_units: "8" })],
    ["sender", row({ from_address: `0x${"d".repeat(40)}`, amount_base_units: "5" })],
  ])("rejects conflicting surviving transfers with a different %s at the same token and log position", async (_kind, conflicting) => {
    const source = createHistoryTransferSource({ transport: transportFor([
      row({ amount_base_units: "5" }),
      conflicting,
    ]) });
    expect(await failureCode(source.listChanges(input({ toTime: new Date(fromTime.getTime() + DAY) })))).toBe("invalid-response");
  });

  test.each([
    ["non-object", null],
    ["bad token", row({ token_address: "0x1" })],
    ["bad sender", row({ from_address: "0x1" })],
    ["bad recipient", row({ to_address: "0x1" })],
    ["other wallet", row({ from_address: OTHER, to_address: OTHER })],
    ["negative value", row({ amount_base_units: "-1" })],
    ["overflow value", row({ amount_base_units: (BigInt(1) << BigInt(256)).toString() })],
    ["numeric value", row({ amount_base_units: 5 })],
    ["missing value", row({ amount_base_units: undefined })],
    ["fractional index", row({ log_index: "0.5" })],
    ["numeric index", row({ log_index: 1 })],
    ["bad timestamp", row({ source_timestamp: "yesterday" })],
  ])("rejects %s rather than losing rows", async (_name, bad) => {
    const source = createHistoryTransferSource({ transport: transportFor([bad]) });
    expect(await failureCode(source.listChanges(input()))).toBe("invalid-response");
  });

  test("drops rows outside the requested block range even when their timestamps overlap", async () => {
    const source = createHistoryTransferSource({ transport: transportFor([
      row({ block_number: "100" }), row({ block_number: "3751" }), row({ block_number: "101" }),
    ]) });
    const result = await source.listChanges(input({ toTime: new Date(fromTime.getTime() + DAY) }));
    expect(result.changes.map((change) => change.blockNumber)).toEqual([BigInt(101)]);
    expect(result.changes[0]!.txHash).toBeNull();
  });

  test("queries 31-day-or-shorter windows that tile a year without a whole-year attempt", async () => {
    const requested: [number, number][] = [];
    const source = createHistoryTransferSource({ transport: {
      async run(request) {
        const [start, end] = timeBounds(request.sql);
        requested.push([start, end]);
        const startBlock = 100 + ((start - fromTime.getTime()) / DAY) * 10;
        const endBlock = 100 + ((end - fromTime.getTime()) / DAY) * 10;
        const source_timestamp = new Date(end - 1000).toISOString();
        return transportFor([row({ block_number: String(startBlock), source_timestamp }),
          row({ block_number: String(endBlock), source_timestamp })]).run(request);
      },
    } });
    const result = await source.listChanges(input());
    expect(result).toMatchObject({ queries: 12, windows: 12 });
    expect(result.changes.map((change) => change.blockNumber)).toEqual(requested.map(([, end]) =>
      BigInt(100 + ((end - fromTime.getTime()) / DAY) * 10)));
    expect(requested[0]![0]).toBe(fromTime.getTime());
    expect(requested.at(-1)![1]).toBe(toTime.getTime());
    expect(requested.every(([start, end], i) => end > start && end - start <= 31 * DAY &&
      (i === 0 || start === requested[i - 1]![1]))).toBe(true);
    expect(requested.slice(0, -1).every(([start, end]) => end - start === 31 * DAY)).toBe(true);
  });

  test("splits a row-overflow window and tiles its time bounds", async () => {
    const requested: [number, number][] = [];
    const source = createHistoryTransferSource({ maxRows: 1, transport: {
      async run(request) {
        requested.push(timeBounds(request.sql));
        return transportFor(requested.length === 1 ? [row(), row()] : []).run(request);
      },
    } });
    const result = await source.listChanges(input({ toTime: new Date(fromTime.getTime() + 8 * DAY) }));
    expect(result).toMatchObject({ queries: 3, windows: 2, changes: [] });
    expect(requested).toEqual([
      [fromTime.getTime(), fromTime.getTime() + 8 * DAY],
      [fromTime.getTime(), fromTime.getTime() + 4 * DAY],
      [fromTime.getTime() + 4 * DAY, fromTime.getTime() + 8 * DAY],
    ]);
  });

  test.each([undefined, 50_000])("splits a provider-truncated 50,000-row page with maxRows %s", async (maxRows) => {
    const requested: string[] = [];
    const cappedPage = Array(50_000).fill(row());
    const source = createHistoryTransferSource({ maxRows, transport: {
      async run(request) {
        requested.push(request.sql);
        return transportFor(requested.length === 1 ? cappedPage : []).run(request);
      },
    } });
    const result = await source.listChanges(input({ toTime: new Date(fromTime.getTime() + 8 * DAY) }));
    expect(requested[0]).toContain(`LIMIT ${maxRows === undefined ? 50_000 : 50_001}`);
    expect(result).toEqual({ changes: [], queries: 3, windows: 2 });
  });
  test("splits a page whose declared row count exceeds the rows it returned", async () => {
    const requested: string[] = [];
    const truncated = { result: [row()], metadata: { cached: false, executionTimestamp: toTime.toISOString(), executionTimeMs: 0, rowCount: 5_000 } };
    const source = createHistoryTransferSource({ transport: {
      async run(request) {
        requested.push(request.sql);
        return requested.length === 1 ? truncated as never : transportFor([]).run(request);
      },
    } });
    const result = await source.listChanges(input({ toTime: new Date(fromTime.getTime() + 8 * DAY) }));
    expect(requested.length).toBe(3);
    expect(result.windows).toBe(2);
  });


  test.each([400, 413])("splits provider %s scan caps while preserving time bounds", async (status) => {
    const requested: [number, number][] = [];
    const source = createHistoryTransferSource({ transport: {
      async run(request) {
        requested.push(timeBounds(request.sql));
        if (requested.length === 1) throw new ChainDataError("upstream-error", "scan cap", { status });
        return transportFor([]).run(request);
      },
    } });
    const result = await source.listChanges(input({ toTime: new Date(fromTime.getTime() + 8 * DAY) }));
    expect(result).toMatchObject({ queries: 3, windows: 2, changes: [] });
    expect(requested).toEqual([
      [fromTime.getTime(), fromTime.getTime() + 8 * DAY],
      [fromTime.getTime(), fromTime.getTime() + 4 * DAY],
      [fromTime.getTime() + 4 * DAY, fromTime.getTime() + 8 * DAY],
    ]);
  });

  test.each([new ChainDataError("upstream-error", "fixture", { status: 422 }), new ChainDataError("unauthorized", "fixture")])(
    "does not retry unrelated error %s", async (error) => {
      let attempts = 0;
      const failing = createHistoryTransferSource({ transport: { async run() { attempts++; throw error; } } });
      expect(await failureCode(failing.listChanges(input()))).toBe(error.code);
      expect(attempts).toBe(1);
    },
  );

  test("halves a failing window to one day with no gaps", async () => {
    const range = input({ fromBlockExclusive: BigInt(0), toBlockInclusive: BigInt(32), toTime: new Date(fromTime.getTime() + 8 * DAY) });
    const successful: [number, number][] = [];
    let attempts = 0;
    const source = createHistoryTransferSource({ transport: {
      async run(request) {
        const pair = timeBounds(request.sql);
        attempts++;
        if (pair[1] - pair[0] > DAY) throw new ChainDataError("timed-out", "fixture");
        successful.push(pair);
        return transportFor([]).run(request);
      },
    } });
    const result = await source.listChanges(range);
    expect(result).toMatchObject({ queries: 15, windows: 8, changes: [] });
    expect(attempts).toBe(15);
    expect(successful).toEqual(Array.from({ length: 8 }, (_, i) => [fromTime.getTime() + i * DAY, fromTime.getTime() + (i + 1) * DAY]));
    attempts = 0;
    const failing = createHistoryTransferSource({ transport: { async run() { attempts++; throw new ChainDataError("timed-out", "fixture"); } } });
    expect(await failureCode(failing.listChanges(range))).toBe("timed-out");
    expect(attempts).toBe(4);
  });

  test("rejects unsafe interpolation and respects empty block ranges", async () => {
    let calls = 0;
    const source = createHistoryTransferSource({ transport: { async run(request) { calls++; return transportFor([]).run(request); } } });
    expect(await failureCode(source.listChanges(input({ address: `${WALLET}'` as HexAddress })))).toBe("invalid-input");
    expect(await failureCode(source.listChanges(input({ fromTime: new Date(NaN) })))).toBe("invalid-input");
    expect(await source.listChanges(input({ toBlockInclusive: BigInt(100) }))).toEqual({ changes: [], queries: 0, windows: 0 });
    expect(calls).toBe(0);
  });
});

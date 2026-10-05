import { expect, test } from "bun:test";
import {
  buildBaseErc20TransferQuery,
  createBaseErc20TransferHistory,
} from "../../apps/web/server/chain-data/base-erc20-transfers";
import type { BaseErc20Asset } from "../../apps/web/server/chain-data/types";

const WALLET = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";
const TOKEN = "0x3333333333333333333333333333333333333333";
const NOW = new Date("2026-09-07T12:00:00.000Z");
const assets = [
  { id: "test-token", chainId: 8453, address: TOKEN },
] as const satisfies readonly BaseErc20Asset[];
const input = {
  verifiedWalletAddress: WALLET,
  assetIds: ["test-token"],
  from: "2026-09-01T00:00:00.000Z",
  to: NOW.toISOString(),
};

function event(logId: string, action: string | number, overrides = {}) {
  return {
    log_id: logId,
    block_number: "10",
    block_hash: `0x${"c".repeat(64)}`,
    block_timestamp: "2026-09-07 11:59:00.000000",
    transaction_hash: `0x${"a".repeat(64)}`,
    log_index: 2,
    address: TOKEN,
    event_signature: "Transfer(address,address,uint256)",
    parameters: { from: OTHER, to: WALLET, value: "123456789012345678901234567890" },
    action,
    ...overrides,
  };
}

async function execute(sql: string, rows: ReturnType<typeof event>[], actionType = "String") {
  const process = Bun.spawn(["python3", `${import.meta.dir}/clickhouse.py`], {
    stdin: new Response(JSON.stringify({ sql, rows, actionType })),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (exitCode !== 0) throw new Error(stderr);
  return JSON.parse(stdout) as Record<string, unknown>[];
}

for (const [name, actionType, added, removed] of [
  ["named strings", "String", "added", "removed"],
  ["numeric strings", "String", "1", "-1"],
  ["numeric actions", "Int8", 1, -1],
  ["enum actions", "Enum8('removed'=-1,'added'=1)", "added", "removed"],
] as const) {
  test(`generated query cancels removals and retains re-additions with ${name}`, async () => {
    const rows = [
      event("active", added),
      event("gone", added, { block_number: "99" }),
      event("gone", removed, { block_number: "99" }),
      event("readded", added, { log_index: 10 }),
      event("readded", removed, { log_index: 10 }),
      event("readded", added, { log_index: 10 }),
      event("orphan-removed", removed, { block_number: "98" }),
    ];
    const { sql } = buildBaseErc20TransferQuery(input, assets, NOW);
    const result = await execute(sql, rows, actionType);
    expect(result.map((row) => row.log_id)).toEqual(["readded", "active"]);
    expect(result[0]).toEqual({
      log_id: "readded",
      block_number: "10",
      block_hash: `0x${"c".repeat(64)}`,
      source_timestamp: "2026-09-07T11:59:00.000000Z",
      transaction_hash: `0x${"a".repeat(64)}`,
      log_index: "10",
      token_address: TOKEN,
      from_address: OTHER,
      to_address: WALLET,
      amount_base_units: "123456789012345678901234567890",
    });
  }, 15_000);
}

test("generated query scopes rows and paginates after cancellation in numeric order", async () => {
  const rows = [
    event("active", "added"),
    event("readded", "added", { log_index: 10 }),
    event("readded", "removed", { log_index: 10 }),
    event("readded", "added", { log_index: 10 }),
    event("oldest", "added", { block_number: "9" }),
    event("gone", "added", { block_number: "99" }),
    event("gone", "removed", { block_number: "99" }),
    event("other-token", "added", { block_number: "90", address: OTHER }),
    event("other-wallet", "added", { block_number: "90", parameters: { from: OTHER, to: OTHER, value: "1" } }),
    event("before-window", "added", { block_number: "90", block_timestamp: "2026-08-31 23:59:59" }),
    event("end-boundary", "added", { block_number: "90", block_timestamp: "2026-09-07 12:00:00" }),
    event("other-event", "added", { block_number: "90", event_signature: "Approval(address,address,uint256)" }),
  ];
  const history = createBaseErc20TransferHistory({
    assets,
    now: () => NOW,
    transport: {
      async run({ sql }) {
        const result = await execute(sql, rows);
        return {
          result,
          metadata: { cached: false, executionTimestamp: NOW.toISOString(), executionTimeMs: 1, rowCount: result.length },
        };
      },
    },
  });
  const first = await history.listTransfers({ ...input, limit: 1 });
  expect(first.transfers.map((row) => row.logId)).toEqual(["readded"]);
  expect(first.transfers[0]?.direction).toBe("incoming");
  expect(first.transfers[0]?.amountBaseUnits).toBe("123456789012345678901234567890");
  expect(first.nextCursor).not.toBeNull();
  const second = await history.listTransfers({ ...input, limit: 1, cursor: first.nextCursor! });
  expect(second.transfers.map((row) => row.logId)).toEqual(["active"]);
  expect(second.nextCursor).not.toBeNull();
  const third = await history.listTransfers({ ...input, limit: 1, cursor: second.nextCursor! });
  expect(third.transfers.map((row) => row.logId)).toEqual(["oldest"]);
  expect(third.nextCursor).toBeNull();
}, 30_000);

test("generated query continues pagination after a truncated SQL response", async () => {
  const rows = [
    event("newest", "added", { log_index: 10 }),
    event("middle", "added"),
    event("oldest", "added", { block_number: "9" }),
  ];
  let firstCall = true;
  const history = createBaseErc20TransferHistory({
    assets,
    now: () => NOW,
    transport: {
      async run({ sql }) {
        const result = await execute(sql, rows);
        const pageRows = firstCall ? result.slice(0, 1) : result;
        firstCall = false;
        return {
          result: pageRows,
          metadata: { cached: false, executionTimestamp: NOW.toISOString(), executionTimeMs: 1, rowCount: result.length },
        };
      },
    },
  });
  const first = await history.listTransfers({ ...input, limit: 10 });
  expect(first.transfers.map((row) => row.logId)).toEqual(["newest"]);
  expect(first.nextCursor).not.toBeNull();
  const second = await history.listTransfers({ ...input, limit: 10, cursor: first.nextCursor! });
  expect(second.transfers.map((row) => row.logId)).toEqual(["middle", "oldest"]);
  expect(second.nextCursor).toBeNull();
}, 30_000);

test("generated query rejects unknown actions instead of returning empty history", async () => {
  const { sql } = buildBaseErc20TransferQuery(input, assets, NOW);
  await expect(execute(sql, [event("unknown", "unexpected")])).rejects.toThrow("Cannot parse");
}, 15_000);

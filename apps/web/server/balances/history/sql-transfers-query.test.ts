import { expect, test } from "bun:test";
import { createHistoryTransferSource } from "./sql-transfers";
import type { HexAddress } from "./types";

test("filters transfer rows by source columns instead of aggregate output aliases", async () => {
  const address = `0x${"a".repeat(40)}` as HexAddress;
  const source = createHistoryTransferSource({ transport: {
    async run({ sql }) {
      expect(sql).toContain("FROM base.transfers AS transfer_rows");
      expect(sql).toContain(`transfer_rows.from_address = '${address}' OR transfer_rows.to_address = '${address}'`);
      expect(sql).toContain("lower(from_address) AS sender_key");
      expect(sql).toContain("lower(to_address) AS recipient_key");
      expect(sql).toContain("GROUP BY block_number, log_index, lower(token_address), lower(from_address), lower(to_address), toString(value)");
      return { result: [], metadata: { cached: false, executionTimestamp: new Date().toISOString(), executionTimeMs: 0, rowCount: 0 } };
    },
  } });
  expect(await source.listChanges({ address, fromBlockExclusive: BigInt(100), toBlockInclusive: BigInt(200),
    fromTime: new Date("2025-01-01T00:00:00Z"), toTime: new Date("2025-01-02T00:00:00Z") }))
    .toEqual({ changes: [], queries: 1, windows: 1 });
});

test("removed transfer variant does not cancel the surviving replacement value", async () => {
  const address = `0x${"a".repeat(40)}` as HexAddress;
  const other = `0x${"b".repeat(40)}` as HexAddress;
  const events = [
    { action: "added", amount: "5" },
    { action: "removed", amount: "5" },
    { action: "added", amount: "8" },
  ];
  const token = `0x${"c".repeat(40)}` as HexAddress;
  const source = createHistoryTransferSource({ transport: {
    async run({ sql }) {
      expect(sql).toContain("sum(if(action = 'added', 1, -1)) AS net_action");
      expect(sql).toContain("GROUP BY block_number, log_index, lower(token_address), lower(from_address), lower(to_address), toString(value)");
      expect(sql).toContain("WHERE net_action > 0");
      const netByAmount = new Map<string, number>();
      for (const event of events) {
        netByAmount.set(event.amount, (netByAmount.get(event.amount) ?? 0) + (event.action === "added" ? 1 : -1));
      }
      return {
        result: [...netByAmount].filter(([, net]) => net > 0).map(([amount]) => ({
          block_number: "101", log_index: "0", source_timestamp: "2025-01-01T00:00:01.000Z",
          token_address: token, from_address: other, to_address: address, amount_base_units: amount,
        })),
        metadata: { cached: false, executionTimestamp: "2025-01-01T00:00:00.000Z", executionTimeMs: 0, rowCount: 1 },
      };
    },
  } });
  const result = await source.listChanges({ address, fromBlockExclusive: BigInt(100), toBlockInclusive: BigInt(200),
    fromTime: new Date("2025-01-01T00:00:00Z"), toTime: new Date("2025-01-02T00:00:00Z") });
  expect(result.changes.map((change) => change.delta)).toEqual([BigInt(8)]);
});

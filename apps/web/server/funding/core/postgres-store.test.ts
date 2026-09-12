import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

test("funding_orders migration locks reservation, provider order, receipt, and terminal instruction invariants", async () => {
  const sql = await readFile(resolve(import.meta.dir, "../migrations/002_funding_provider_seam.sql"), "utf8");
  expect(sql).toContain("UNIQUE (account_provider, owner_subject, intent_digest)");
  expect(sql).toContain("UNIQUE (provider_id, provider_order_id)");
  expect(sql).toContain("UNIQUE (transaction_hash, log_index)");
  expect(sql).toContain("OR instructions IS NULL");
});

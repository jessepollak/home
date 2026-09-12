import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

test("funding_orders migration locks reservation, provider order, receipt, and terminal instruction invariants", async () => {
  const sql = await readFile(resolve(import.meta.dir, "../migrations/002_funding_provider_seam.sql"), "utf8");
  expect(sql).toContain("Candidate-only #301 clean-install migration");
  expect(sql).toContain("UNIQUE (account_provider, owner_subject, intent_digest)");
  expect(sql).toContain("UNIQUE (provider_id, provider_order_id)");
  expect(sql).toContain("UNIQUE (transaction_hash, log_index)");
  expect(sql).toContain("quote_token text NOT NULL");
  expect(sql).toContain("provider_transaction_hash text");
  expect(sql).toContain("state = 'received' OR transaction_hash IS NULL");
  expect(sql).toContain("prevent_funding_receipt_mutation");
  expect(sql).toContain("OR instructions IS NULL");
});

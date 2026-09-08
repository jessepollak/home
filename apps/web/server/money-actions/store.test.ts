import { describe } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PostgresMoneyActionStore } from "./postgres-store";
import { createFakePostgresExecutor, createNeonSqlExecutor } from "./postgres-sql";
import { describeMoneyActionStore } from "./store-contract";
import { MemoryMoneyActionStore } from "./store";

describe("durable money action claims", () => {
  describeMoneyActionStore("MemoryMoneyActionStore", () => new MemoryMoneyActionStore());

  describeMoneyActionStore(
    "PostgresMoneyActionStore",
    () => new PostgresMoneyActionStore(createFakePostgresExecutor()),
  );

  const liveUrl = process.env.MONEY_ACTION_PG_TEST_URL?.trim();
  if (liveUrl) {
    describeMoneyActionStore("PostgresMoneyActionStore (live)", () => {
      return new PostgresMoneyActionStore(createNeonSqlExecutor(liveUrl));
    });
  }
});

// `bun test` does not provide Node's `node:sqlite`. The local adapter is still
// covered by `scripts/probe-money-actions-sqlite.mjs` and by this suite when
// tests run under Node 22.13+.
try {
  const { SqliteMoneyActionStore } = await import("./sqlite-store.node");
  describe("durable money action claims (sqlite)", () => {
    describeMoneyActionStore("SqliteMoneyActionStore", () => {
      const directory = mkdtempSync(join(tmpdir(), "home-money-actions-"));
      return new SqliteMoneyActionStore(join(directory, "test.sqlite"));
    });
  });
} catch {
  // bun test / runtimes without node:sqlite
}

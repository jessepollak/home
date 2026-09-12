import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  dropMoneyActionLegacyTables,
  MONEY_ACTION_LEGACY_DROP_CONFIRMATION,
  MONEY_ACTION_LEGACY_DROP_SQL,
  MONEY_ACTION_SINGLE_ROW_RUNTIME_CONTRACT,
  preflightMoneyActionLegacyTableCleanup,
  type MoneyActionLegacyCleanupEvidence,
} from "./legacy-table-cleanup";
import type { SqlExecutor } from "./postgres-sql";

const neverQuery: SqlExecutor = {
  query() {
    throw new Error("validation unexpectedly reached PostgreSQL");
  },
  transaction() {
    throw new Error("validation unexpectedly reached PostgreSQL");
  },
};

function evidence(): MoneyActionLegacyCleanupEvidence {
  return {
    deploymentRevision: "315b9e43204de64303586231bf58e3b508949abf",
    deploymentReference: "https://github.com/jessepollak/home/issues/314#issuecomment-314001",
    deployedAt: "2026-09-12T05:00:00.000Z",
    observedThrough: "2026-09-12T06:00:00.000Z",
    legacyReadCount: 0,
    legacyWriteCount: 0,
    runtimeContract: MONEY_ACTION_SINGLE_ROW_RUNTIME_CONTRACT,
  };
}

test("operator-only drop SQL matches migration 005 and has no permissive fallback", () => {
  const file = readFileSync(
    resolve(import.meta.dir, "migrations", "005_drop_legacy_money_action_tables.sql"),
    "utf8",
  );
  expect(file.replace(/^--.*$/gm, "").trim()).toBe(MONEY_ACTION_LEGACY_DROP_SQL.trim());
  expect(MONEY_ACTION_LEGACY_DROP_SQL).not.toContain("IF EXISTS");
  expect(MONEY_ACTION_LEGACY_DROP_SQL).not.toContain("CASCADE");
  expect(MONEY_ACTION_LEGACY_DROP_SQL).not.toContain("money_action_operations");
  expect(readFileSync(resolve(import.meta.dir, "migrate.ts"), "utf8"))
    .not.toContain("005_drop_legacy_money_action_tables");
});

test("preflight rejects missing deployment and zero-use evidence before touching PostgreSQL", async () => {
  await expect(preflightMoneyActionLegacyTableCleanup(neverQuery, {
    ...evidence(),
    deploymentRevision: "not-a-revision",
  })).rejects.toThrow("exact 40-character deployed revision");
  await expect(preflightMoneyActionLegacyTableCleanup(neverQuery, {
    ...evidence(),
    deploymentReference: "https://example.com/deployment",
  })).rejects.toThrow("#314 issue comment URL");
  await expect(preflightMoneyActionLegacyTableCleanup(neverQuery, {
    ...evidence(),
    legacyReadCount: 1,
  } as unknown as MoneyActionLegacyCleanupEvidence)).rejects.toThrow(
    "zero observed legacy reads and writes",
  );
  await expect(preflightMoneyActionLegacyTableCleanup(neverQuery, {
    ...evidence(),
    runtimeContract: "legacy-attempt-runtime",
  } as unknown as MoneyActionLegacyCleanupEvidence)).rejects.toThrow(
    "#313 single-row runtime contract",
  );
});

test("drop rejects absent separate approval, exact confirmation, and reviewed counts", async () => {
  const counts = {
    operationRows: "10",
    attemptStateRows: "2",
    attemptEvidenceRows: "3",
    dataMigrationRows: "1",
  };
  await expect(dropMoneyActionLegacyTables(neverQuery, evidence(), {
    approvalReference: "https://github.com/jessepollak/home/issues/314#issuecomment-314002",
    backupReference: "https://github.com/jessepollak/home/issues/314#issuecomment-314003",
    confirmation: "wrong" as typeof MONEY_ACTION_LEGACY_DROP_CONFIRMATION,
    expectedCounts: counts,
  })).rejects.toThrow("drop confirmation is missing");
  await expect(dropMoneyActionLegacyTables(neverQuery, evidence(), {
    approvalReference: "https://github.com/jessepollak/home/issues/314#issuecomment-314002",
    backupReference: "https://github.com/jessepollak/home/issues/314#issuecomment-314003",
    confirmation: MONEY_ACTION_LEGACY_DROP_CONFIRMATION,
    expectedCounts: { ...counts, attemptEvidenceRows: "03" },
  })).rejects.toThrow("expected attemptEvidenceRows is not a canonical count");
});

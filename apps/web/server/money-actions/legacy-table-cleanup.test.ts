import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  dropMoneyActionLegacyTables,
  MONEY_ACTION_LEGACY_DROP_CONFIRMATION,
  MONEY_ACTION_LEGACY_DROP_SQL_TEMPLATE,
  MONEY_ACTION_SINGLE_ROW_RUNTIME_CONTRACT,
  moneyActionLegacyCleanupFailureReason,
  preflightMoneyActionLegacyTableCleanup,
  type MoneyActionLegacyCleanupEvidence,
  type MoneyActionLegacyCleanupIdentity,
  type MoneyActionLegacyDropApproval,
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
    databaseName: "home_test",
    schemaName: "public",
    deploymentRevision: "315b9e43204de64303586231bf58e3b508949abf",
    deploymentReference: "https://api.github.com/repos/jessepollak/home/issues/comments/314001",
    deployedAt: "2026-09-12T05:00:00.000Z",
    observedThrough: "2026-09-12T06:00:00.000Z",
    legacyReadCount: 0,
    legacyWriteCount: 0,
    runtimeContract: MONEY_ACTION_SINGLE_ROW_RUNTIME_CONTRACT,
  };
}

function identity(): MoneyActionLegacyCleanupIdentity {
  return {
    databaseName: "home_test",
    databaseOid: "16384",
    schemaName: "public",
    schemaOid: "2200",
    tableOids: {
      moneyActionOperations: "16385",
      moneyActionAttemptStates: "16386",
      moneyActionAttemptEvidence: "16387",
      moneyActionDataMigrations: "16388",
    },
  };
}

function approval(): MoneyActionLegacyDropApproval {
  return {
    approvalReference: "https://api.github.com/repos/jessepollak/home/issues/comments/314002",
    backupReference: "https://api.github.com/repos/jessepollak/home/issues/comments/314003",
    confirmation: MONEY_ACTION_LEGACY_DROP_CONFIRMATION,
    expectedIdentity: identity(),
    expectedCounts: {
      operationRows: "10",
      attemptStateRows: "2",
      attemptEvidenceRows: "3",
      dataMigrationRows: "1",
    },
  };
}

test("operator-only drop template matches migration 005 and schema-qualifies every target", () => {
  const file = readFileSync(
    resolve(import.meta.dir, "migrations", "005_drop_legacy_money_action_tables.sql"),
    "utf8",
  );
  expect(file.replace(/^--.*$/gm, "").trim()).toBe(MONEY_ACTION_LEGACY_DROP_SQL_TEMPLATE.trim());
  expect(MONEY_ACTION_LEGACY_DROP_SQL_TEMPLATE).not.toContain("IF EXISTS");
  expect(MONEY_ACTION_LEGACY_DROP_SQL_TEMPLATE).not.toContain("CASCADE");
  expect(MONEY_ACTION_LEGACY_DROP_SQL_TEMPLATE).not.toContain('DROP TABLE "money_action');
  expect(readFileSync(resolve(import.meta.dir, "migrate.ts"), "utf8"))
    .not.toContain("005_drop_legacy_money_action_tables");
});

test("preflight rejects missing identity, deployment, and zero-use evidence before PostgreSQL", async () => {
  await expect(preflightMoneyActionLegacyTableCleanup(neverQuery, {
    ...evidence(),
    schemaName: "unsafe-schema",
  })).rejects.toThrow("schema name is invalid");
  await expect(preflightMoneyActionLegacyTableCleanup(neverQuery, {
    ...evidence(),
    deploymentRevision: "not-a-revision",
  })).rejects.toThrow("exact 40-character deployed revision");
  for (const deploymentReference of [
    "https://api.github.com/repos/jessepollak/home/issues/comments/314001?token=secret",
    "https://api.github.com/repos/jessepollak/home/issues/comments/314001#fragment",
    "https://user:secret@api.github.com/repos/jessepollak/home/issues/comments/314001",
    "https://github.com/jessepollak/home/issues/314#issuecomment-314001",
  ]) {
    await expect(preflightMoneyActionLegacyTableCleanup(neverQuery, {
      ...evidence(),
      deploymentReference,
    })).rejects.toThrow("canonical GitHub comment URL");
  }
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

test("drop rejects absent or mismatched approval, exact confirmation, identity, and counts", async () => {
  await expect(dropMoneyActionLegacyTables(neverQuery, evidence(), {
    ...approval(),
    approvalReference: "",
  })).rejects.toThrow("canonical GitHub comment URL");
  await expect(dropMoneyActionLegacyTables(neverQuery, evidence(), {
    ...approval(),
    confirmation: "wrong" as typeof MONEY_ACTION_LEGACY_DROP_CONFIRMATION,
  })).rejects.toThrow("drop confirmation is missing");
  await expect(dropMoneyActionLegacyTables(neverQuery, evidence(), {
    ...approval(),
    expectedIdentity: { ...identity(), schemaName: "other" },
  })).rejects.toThrow("identity does not match deployment evidence");
  await expect(dropMoneyActionLegacyTables(neverQuery, evidence(), {
    ...approval(),
    expectedCounts: { ...approval().expectedCounts, attemptEvidenceRows: "03" },
  })).rejects.toThrow("expected attemptEvidenceRows is not a canonical count");
});

test("CLI failure reasons never include arbitrary provider text or credentials", () => {
  const arbitrary = new Error("provider failed for postgresql://user:secret@example.test/home");
  expect(moneyActionLegacyCleanupFailureReason(arbitrary)).toBe("database-operation-failed");
  expect(moneyActionLegacyCleanupFailureReason({ code: "55P03", message: arbitrary.message }))
    .toBe("database-lock-timeout");
  expect(moneyActionLegacyCleanupFailureReason({ sqlState: "2BP01", detail: arbitrary.message }))
    .toBe("database-dependency-blocked");
});

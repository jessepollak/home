import "server-only";

import {
  dropMoneyActionLegacyTables,
  MONEY_ACTION_LEGACY_DROP_CONFIRMATION,
  MONEY_ACTION_SINGLE_ROW_RUNTIME_CONTRACT,
  moneyActionLegacyCleanupFailureReason,
  preflightMoneyActionLegacyTableCleanup,
  type MoneyActionLegacyCleanupCounts,
  type MoneyActionLegacyCleanupEvidence,
  type MoneyActionLegacyCleanupIdentity,
  type MoneyActionLegacyDropApproval,
} from "./legacy-table-cleanup";
import { createNeonSqlExecutor } from "./postgres-sql";

const ALLOWED_ARGUMENTS = new Set([
  "mode",
  "database-name",
  "schema-name",
  "deployed-revision",
  "deployment-evidence",
  "deployed-at",
  "observed-through",
  "legacy-read-count",
  "legacy-write-count",
  "runtime-contract",
  "jesse-approval",
  "backup-evidence",
  "confirm",
  "expect-database-oid",
  "expect-schema-oid",
  "expect-operation-table-oid",
  "expect-attempt-state-table-oid",
  "expect-attempt-evidence-table-oid",
  "expect-data-migration-table-oid",
  "expect-operation-rows",
  "expect-attempt-state-rows",
  "expect-attempt-evidence-rows",
  "expect-data-migration-rows",
]);

const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.error("money-action legacy cleanup status=failed reason=missing-database-url");
  process.exit(1);
}

let argumentsByName: Map<string, string>;
try {
  argumentsByName = parseArguments(process.argv.slice(2));
} catch (error) {
  console.error(`money-action legacy cleanup status=failed reason=${argumentFailureReason(error)}`);
  process.exit(1);
}
const mode = argumentsByName.get("mode") ?? "preflight";
if (mode !== "preflight" && mode !== "drop") {
  console.error("money-action legacy cleanup status=failed reason=invalid-mode");
  process.exit(1);
}

let evidence: MoneyActionLegacyCleanupEvidence;
let approval: MoneyActionLegacyDropApproval | undefined;
try {
  evidence = {
    databaseName: requiredArgument(argumentsByName, "database-name"),
    schemaName: requiredArgument(argumentsByName, "schema-name"),
    deploymentRevision: requiredArgument(argumentsByName, "deployed-revision"),
    deploymentReference: requiredArgument(argumentsByName, "deployment-evidence"),
    deployedAt: requiredArgument(argumentsByName, "deployed-at"),
    observedThrough: requiredArgument(argumentsByName, "observed-through"),
    legacyReadCount: zeroArgument(argumentsByName, "legacy-read-count"),
    legacyWriteCount: zeroArgument(argumentsByName, "legacy-write-count"),
    runtimeContract: requiredArgument(argumentsByName, "runtime-contract") as typeof MONEY_ACTION_SINGLE_ROW_RUNTIME_CONTRACT,
  };
  if (mode === "drop") {
    approval = {
      approvalReference: requiredArgument(argumentsByName, "jesse-approval"),
      backupReference: requiredArgument(argumentsByName, "backup-evidence"),
      confirmation: requiredArgument(argumentsByName, "confirm") as typeof MONEY_ACTION_LEGACY_DROP_CONFIRMATION,
      expectedIdentity: expectedIdentity(argumentsByName, evidence),
      expectedCounts: expectedCounts(argumentsByName),
    };
  }
} catch (error) {
  console.error(`money-action legacy cleanup status=failed reason=${argumentFailureReason(error)}`);
  process.exit(1);
}

const executor = createNeonSqlExecutor(url);
let result: Awaited<ReturnType<typeof preflightMoneyActionLegacyTableCleanup>> | undefined;
let failureReason: string | undefined;
try {
  result = mode === "preflight"
    ? await preflightMoneyActionLegacyTableCleanup(executor, evidence)
    : await dropMoneyActionLegacyTables(executor, evidence, approval!);
} catch (error) {
  failureReason = moneyActionLegacyCleanupFailureReason(error);
}
try {
  await executor.dispose?.();
} catch {
  failureReason ??= "database-cleanup-failed";
}
if (failureReason) {
  console.error(`money-action legacy cleanup status=failed reason=${failureReason}`);
  process.exitCode = 1;
} else {
  console.log(JSON.stringify(result));
}

function parseArguments(values: string[]): Map<string, string> {
  const parsed = new Map<string, string>();
  for (const value of values) {
    const match = /^--([a-z][a-z0-9-]*)=(.*)$/.exec(value);
    const name = match?.[1];
    if (!match || !name || !ALLOWED_ARGUMENTS.has(name) || parsed.has(name)) {
      throw new Error("invalid-or-duplicate-argument");
    }
    parsed.set(name, match[2]!);
  }
  return parsed;
}

function requiredArgument(values: Map<string, string>, name: string): string {
  const value = values.get(name);
  if (!value) throw new Error(`missing-${name}`);
  return value;
}

function zeroArgument(values: Map<string, string>, name: string): 0 {
  if (requiredArgument(values, name) !== "0") throw new Error(`${name}-must-be-zero`);
  return 0;
}

function expectedIdentity(
  values: Map<string, string>,
  evidence: MoneyActionLegacyCleanupEvidence,
): MoneyActionLegacyCleanupIdentity {
  return {
    databaseName: evidence.databaseName,
    databaseOid: requiredArgument(values, "expect-database-oid"),
    schemaName: evidence.schemaName,
    schemaOid: requiredArgument(values, "expect-schema-oid"),
    tableOids: {
      moneyActionOperations: requiredArgument(values, "expect-operation-table-oid"),
      moneyActionAttemptStates: requiredArgument(values, "expect-attempt-state-table-oid"),
      moneyActionAttemptEvidence: requiredArgument(values, "expect-attempt-evidence-table-oid"),
      moneyActionDataMigrations: requiredArgument(values, "expect-data-migration-table-oid"),
    },
  };
}

function expectedCounts(values: Map<string, string>): MoneyActionLegacyCleanupCounts {
  return {
    operationRows: requiredArgument(values, "expect-operation-rows"),
    attemptStateRows: requiredArgument(values, "expect-attempt-state-rows"),
    attemptEvidenceRows: requiredArgument(values, "expect-attempt-evidence-rows"),
    dataMigrationRows: requiredArgument(values, "expect-data-migration-rows"),
  };
}

function argumentFailureReason(error: unknown): string {
  return error instanceof Error && /^[a-z0-9-]+$/.test(error.message)
    ? error.message
    : "invalid-arguments";
}

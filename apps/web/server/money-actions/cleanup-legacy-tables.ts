import "server-only";

import {
  dropMoneyActionLegacyTables,
  MONEY_ACTION_LEGACY_DROP_CONFIRMATION,
  MONEY_ACTION_SINGLE_ROW_RUNTIME_CONTRACT,
  preflightMoneyActionLegacyTableCleanup,
  type MoneyActionLegacyCleanupCounts,
  type MoneyActionLegacyCleanupEvidence,
} from "./legacy-table-cleanup";
import { createNeonSqlExecutor } from "./postgres-sql";

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
try {
  evidence = {
    deploymentRevision: requiredArgument(argumentsByName, "deployed-revision"),
    deploymentReference: requiredArgument(argumentsByName, "deployment-evidence"),
    deployedAt: requiredArgument(argumentsByName, "deployed-at"),
    observedThrough: requiredArgument(argumentsByName, "observed-through"),
    legacyReadCount: zeroArgument(argumentsByName, "legacy-read-count"),
    legacyWriteCount: zeroArgument(argumentsByName, "legacy-write-count"),
    runtimeContract: requiredArgument(argumentsByName, "runtime-contract") as typeof MONEY_ACTION_SINGLE_ROW_RUNTIME_CONTRACT,
  };
} catch (error) {
  console.error(`money-action legacy cleanup status=failed reason=${argumentFailureReason(error)}`);
  process.exit(1);
}

const executor = createNeonSqlExecutor(url);
try {
  const result = mode === "preflight"
    ? await preflightMoneyActionLegacyTableCleanup(executor, evidence)
    : await dropMoneyActionLegacyTables(executor, evidence, {
        approvalReference: requiredArgument(argumentsByName, "jesse-approval"),
        backupReference: requiredArgument(argumentsByName, "backup-evidence"),
        confirmation: requiredArgument(argumentsByName, "confirm") as typeof MONEY_ACTION_LEGACY_DROP_CONFIRMATION,
        expectedCounts: expectedCounts(argumentsByName),
      });
  console.log(JSON.stringify(result));
} catch (error) {
  const reason = error instanceof Error ? error.message : "unknown failure";
  console.error(`money-action legacy cleanup status=failed reason=${JSON.stringify(reason)}`);
  process.exitCode = 1;
} finally {
  await executor.dispose?.();
}

function parseArguments(values: string[]): Map<string, string> {
  const parsed = new Map<string, string>();
  for (const value of values) {
    const match = /^--([a-z][a-z0-9-]*)=(.*)$/.exec(value);
    if (!match || parsed.has(match[1]!)) throw new Error("invalid-or-duplicate-argument");
    parsed.set(match[1]!, match[2]!);
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

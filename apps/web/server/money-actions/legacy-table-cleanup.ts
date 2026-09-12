import "server-only";

import type { SqlExecutor } from "./postgres-sql";

export const MONEY_ACTION_LEGACY_DROP_SQL = `DROP TABLE money_action_attempt_evidence;
DROP TABLE money_action_attempt_states;
DROP TABLE money_action_data_migrations;
`;

export const moneyActionLegacyDropStatements = MONEY_ACTION_LEGACY_DROP_SQL
  .replace(/^--.*$/gm, "")
  .split(";")
  .map((statement) => statement.trim())
  .filter((statement) => statement.length > 0);

export const MONEY_ACTION_LEGACY_DROP_CONFIRMATION =
  "DROP_LEGACY_MONEY_ACTION_TABLES_ISSUE_314";
export const MONEY_ACTION_SINGLE_ROW_RUNTIME_CONTRACT =
  "money_action_operations-only-v1";

const REQUIRED_TABLES = [
  "money_action_operations",
  "money_action_attempt_states",
  "money_action_attempt_evidence",
  "money_action_data_migrations",
] as const;

const REQUIRED_OPERATION_COLUMNS = new Map([
  ["id", ["text", "NO"]],
  ["review_hash", ["text", "NO"]],
  ["subject", ["text", "NO"]],
  ["address", ["text", "NO"]],
  ["chain_id", ["integer", "NO"]],
  ["account_provider", ["text", "NO"]],
  ["action_json", ["text", "NO"]],
  ["status", ["text", "NO"]],
  ["attempt_count", ["integer", "NO"]],
  ["claimed_at", ["text", "YES"]],
  ["submission_id", ["text", "YES"]],
  ["transaction_hash", ["text", "YES"]],
  ["user_operation_hash", ["text", "YES"]],
  ["verified_execution_key", ["text", "YES"]],
  ["abandoned_at", ["text", "YES"]],
  ["created_at", ["text", "NO"]],
  ["updated_at", ["text", "NO"]],
] as const);

const REQUIRED_INDEX_DEFINITIONS = [
  {
    kind: "verified_execution_key",
    columns: "(verified_execution_key)",
    predicate: "verified_execution_key is not null",
  },
  {
    kind: "submission_id",
    columns: "(subject, address, chain_id, account_provider, submission_id)",
    predicate: "submission_id is not null",
  },
  {
    kind: "user_operation_hash",
    columns: "(subject, address, chain_id, account_provider, lower(user_operation_hash))",
    predicate: "user_operation_hash is not null",
  },
] as const;

export type MoneyActionLegacyCleanupEvidence = Readonly<{
  deploymentRevision: string;
  deploymentReference: string;
  deployedAt: string;
  observedThrough: string;
  legacyReadCount: 0;
  legacyWriteCount: 0;
  runtimeContract: typeof MONEY_ACTION_SINGLE_ROW_RUNTIME_CONTRACT;
}>;

export type MoneyActionLegacyCleanupCounts = Readonly<{
  operationRows: string;
  attemptStateRows: string;
  attemptEvidenceRows: string;
  dataMigrationRows: string;
}>;

export type MoneyActionLegacyDropApproval = Readonly<{
  approvalReference: string;
  backupReference: string;
  confirmation: typeof MONEY_ACTION_LEGACY_DROP_CONFIRMATION;
  expectedCounts: MoneyActionLegacyCleanupCounts;
}>;

export type MoneyActionLegacyCleanupReport = Readonly<{
  status: "ready" | "dropped";
  deploymentRevision: string;
  deploymentReference: string;
  deployedAt: string;
  observedThrough: string;
  counts: MoneyActionLegacyCleanupCounts;
}>;

type TableRow = Record<(typeof REQUIRED_TABLES)[number], string | null>;
type ColumnRow = { column_name: string; data_type: string; is_nullable: string };
type IndexRow = { indexdef: string; indisunique: boolean; indisvalid: boolean; indisready: boolean };
type CountsRow = {
  operation_rows: string | number | bigint;
  attempt_state_rows: string | number | bigint;
  attempt_evidence_rows: string | number | bigint;
  data_migration_rows: string | number | bigint;
};

export async function preflightMoneyActionLegacyTableCleanup(
  executor: SqlExecutor,
  evidence: MoneyActionLegacyCleanupEvidence,
): Promise<MoneyActionLegacyCleanupReport> {
  validateEvidence(evidence);
  return executor.transaction(async (transaction) => {
    await beginCleanupTransaction(transaction);
    await assertCleanupPrerequisites(transaction);
    return report("ready", evidence, await readCounts(transaction));
  });
}

export async function dropMoneyActionLegacyTables(
  executor: SqlExecutor,
  evidence: MoneyActionLegacyCleanupEvidence,
  approval: MoneyActionLegacyDropApproval,
): Promise<MoneyActionLegacyCleanupReport> {
  validateEvidence(evidence);
  validateApproval(approval);
  return executor.transaction(async (transaction) => {
    await beginCleanupTransaction(transaction);
    await transaction.query(
      "LOCK TABLE money_action_operations, money_action_attempt_states, money_action_attempt_evidence, money_action_data_migrations IN ACCESS EXCLUSIVE MODE",
    );
    await assertCleanupPrerequisites(transaction);
    const before = await readCounts(transaction);
    assertExpectedCounts(before, approval.expectedCounts);

    for (const statement of moneyActionLegacyDropStatements) {
      await transaction.query(statement);
    }

    await assertLegacyTablesDropped(transaction);
    const afterOperationRows = await readOperationCount(transaction);
    if (afterOperationRows !== before.operationRows) {
      throw new Error("money-action legacy cleanup verification failed: operation row count changed");
    }
    await assertEvidenceIndexes(transaction);
    return report("dropped", evidence, before);
  });
}

function validateEvidence(evidence: MoneyActionLegacyCleanupEvidence): void {
  if (!/^[0-9a-f]{40}$/.test(evidence.deploymentRevision)) {
    throw new Error("money-action legacy cleanup requires an exact 40-character deployed revision");
  }
  validateIssueEvidenceReference(evidence.deploymentReference, "deployment");
  const deployedAt = parseTimestamp(evidence.deployedAt, "deployment");
  const observedThrough = parseTimestamp(evidence.observedThrough, "observation");
  if (observedThrough <= deployedAt) {
    throw new Error("money-action legacy cleanup observation must end after deployment");
  }
  if (evidence.legacyReadCount !== 0 || evidence.legacyWriteCount !== 0) {
    throw new Error("money-action legacy cleanup requires zero observed legacy reads and writes");
  }
  if (evidence.runtimeContract !== MONEY_ACTION_SINGLE_ROW_RUNTIME_CONTRACT) {
    throw new Error("money-action legacy cleanup requires the #313 single-row runtime contract");
  }
}

function validateApproval(approval: MoneyActionLegacyDropApproval): void {
  validateIssueEvidenceReference(approval.approvalReference, "approval");
  validateIssueEvidenceReference(approval.backupReference, "backup");
  if (approval.confirmation !== MONEY_ACTION_LEGACY_DROP_CONFIRMATION) {
    throw new Error("money-action legacy cleanup drop confirmation is missing");
  }
  for (const [name, count] of Object.entries(approval.expectedCounts)) {
    if (!isCanonicalCount(count)) {
      throw new Error(`money-action legacy cleanup expected ${name} is not a canonical count`);
    }
  }
}

function validateIssueEvidenceReference(value: string, kind: string): void {
  if (value.length > 500) throw new Error(`money-action legacy cleanup ${kind} reference is too long`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`money-action legacy cleanup ${kind} reference must be an #314 issue comment URL`);
  }
  if (url.protocol !== "https:"
    || url.username
    || url.password
    || url.hostname !== "github.com"
    || url.pathname !== "/jessepollak/home/issues/314"
    || !/^#issuecomment-\d+$/.test(url.hash)) {
    throw new Error(`money-action legacy cleanup ${kind} reference must be an #314 issue comment URL`);
  }
}

function parseTimestamp(value: string, kind: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    throw new Error(`money-action legacy cleanup ${kind} timestamp must be UTC ISO-8601`);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`money-action legacy cleanup ${kind} timestamp is invalid`);
  }
  return timestamp;
}

async function beginCleanupTransaction(transaction: SqlExecutor): Promise<void> {
  await transaction.query("SET LOCAL lock_timeout = '5s'");
  await transaction.query("SET LOCAL statement_timeout = '60s'");
  await transaction.query(
    "SELECT pg_advisory_xact_lock(hashtext($1))",
    ["home_money_action_legacy_cleanup_v1"],
  );
}

async function assertCleanupPrerequisites(transaction: SqlExecutor): Promise<void> {
  await assertRequiredTables(transaction);
  await assertOperationSchema(transaction);
  await assertEvidenceIndexes(transaction);
}

async function assertRequiredTables(transaction: SqlExecutor): Promise<void> {
  const tables = await transaction.query<TableRow>(`
    SELECT
      to_regclass('money_action_operations')::text AS money_action_operations,
      to_regclass('money_action_attempt_states')::text AS money_action_attempt_states,
      to_regclass('money_action_attempt_evidence')::text AS money_action_attempt_evidence,
      to_regclass('money_action_data_migrations')::text AS money_action_data_migrations
  `.trim());
  if (tables.rows.length !== 1) {
    throw new Error("money-action legacy cleanup table preflight returned an unexpected result");
  }
  const row = tables.rows[0]!;
  const missing = REQUIRED_TABLES.filter((table) => row[table] === null);
  if (missing.length > 0) {
    throw new Error(`money-action legacy cleanup missing required tables: ${missing.join(", ")}`);
  }
}

async function assertOperationSchema(transaction: SqlExecutor): Promise<void> {
  const columns = await transaction.query<ColumnRow>(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'money_action_operations'
    ORDER BY ordinal_position
  `.trim());
  const actual = new Map(columns.rows.map((row) => [row.column_name, [row.data_type, row.is_nullable]]));
  const mismatches: string[] = [];
  for (const [name, expected] of REQUIRED_OPERATION_COLUMNS) {
    const value = actual.get(name);
    if (!value || value[0] !== expected[0] || value[1] !== expected[1]) mismatches.push(name);
  }
  if (mismatches.length > 0) {
    throw new Error(`money-action legacy cleanup operation schema mismatch: ${mismatches.join(", ")}`);
  }
}

async function assertEvidenceIndexes(transaction: SqlExecutor): Promise<void> {
  const indexes = await transaction.query<IndexRow>(`
    SELECT pg_get_indexdef(i.indexrelid) AS indexdef,
           i.indisunique, i.indisvalid, i.indisready
    FROM pg_index i
    JOIN pg_class table_class ON table_class.oid = i.indrelid
    JOIN pg_namespace table_namespace ON table_namespace.oid = table_class.relnamespace
    WHERE table_namespace.nspname = current_schema()
      AND table_class.relname = 'money_action_operations'
  `.trim());
  const validDefinitions = indexes.rows
    .filter((row) => row.indisunique && row.indisvalid && row.indisready)
    .map((row) => normalizeIndexDefinition(row.indexdef));
  const missing = REQUIRED_INDEX_DEFINITIONS.filter(({ columns, predicate }) =>
    !validDefinitions.some((definition) =>
      definition.includes(` ${columns} where (${predicate})`)
      || definition.includes(` ${columns} where ${predicate}`),
    ),
  ).map(({ kind }) => kind);
  if (missing.length > 0) {
    throw new Error(`money-action legacy cleanup missing required unique index definitions: ${missing.join(", ")}`);
  }
}

function normalizeIndexDefinition(value: string): string {
  return value
    .toLowerCase()
    .replaceAll('"', "")
    .replace(/\s+/g, " ")
    .replace(/ using btree /, " ")
    .trim();
}

async function readCounts(transaction: SqlExecutor): Promise<MoneyActionLegacyCleanupCounts> {
  const result = await transaction.query<CountsRow>(`
    SELECT
      (SELECT COUNT(*) FROM money_action_operations)::text AS operation_rows,
      (SELECT COUNT(*) FROM money_action_attempt_states)::text AS attempt_state_rows,
      (SELECT COUNT(*) FROM money_action_attempt_evidence)::text AS attempt_evidence_rows,
      (SELECT COUNT(*) FROM money_action_data_migrations)::text AS data_migration_rows
  `.trim());
  if (result.rows.length !== 1) {
    throw new Error("money-action legacy cleanup count preflight returned an unexpected result");
  }
  const row = result.rows[0]!;
  return {
    operationRows: normalizeCount(row.operation_rows),
    attemptStateRows: normalizeCount(row.attempt_state_rows),
    attemptEvidenceRows: normalizeCount(row.attempt_evidence_rows),
    dataMigrationRows: normalizeCount(row.data_migration_rows),
  };
}

async function readOperationCount(transaction: SqlExecutor): Promise<string> {
  const result = await transaction.query<{ operation_rows: string | number | bigint }>(
    "SELECT COUNT(*)::text AS operation_rows FROM money_action_operations",
  );
  if (result.rows.length !== 1) {
    throw new Error("money-action legacy cleanup operation verification returned an unexpected result");
  }
  return normalizeCount(result.rows[0]!.operation_rows);
}

function normalizeCount(value: string | number | bigint): string {
  const normalized = String(value);
  if (!isCanonicalCount(normalized)) {
    throw new Error("money-action legacy cleanup database returned a non-canonical count");
  }
  return normalized;
}

function isCanonicalCount(value: string): boolean {
  return /^(?:0|[1-9]\d*)$/.test(value);
}

function assertExpectedCounts(
  actual: MoneyActionLegacyCleanupCounts,
  expected: MoneyActionLegacyCleanupCounts,
): void {
  const changed = (Object.keys(actual) as Array<keyof MoneyActionLegacyCleanupCounts>)
    .filter((key) => actual[key] !== expected[key]);
  if (changed.length > 0) {
    throw new Error(`money-action legacy cleanup counts changed since reviewed preflight: ${changed.join(", ")}`);
  }
}

async function assertLegacyTablesDropped(transaction: SqlExecutor): Promise<void> {
  const result = await transaction.query<{
    attempt_states: string | null;
    attempt_evidence: string | null;
    data_migrations: string | null;
  }>(`
    SELECT
      to_regclass('money_action_attempt_states')::text AS attempt_states,
      to_regclass('money_action_attempt_evidence')::text AS attempt_evidence,
      to_regclass('money_action_data_migrations')::text AS data_migrations
  `.trim());
  const row = result.rows[0];
  if (result.rows.length !== 1 || !row
    || row.attempt_states !== null
    || row.attempt_evidence !== null
    || row.data_migrations !== null) {
    throw new Error("money-action legacy cleanup verification failed: legacy tables remain");
  }
}

function report(
  status: MoneyActionLegacyCleanupReport["status"],
  evidence: MoneyActionLegacyCleanupEvidence,
  counts: MoneyActionLegacyCleanupCounts,
): MoneyActionLegacyCleanupReport {
  return {
    status,
    deploymentRevision: evidence.deploymentRevision,
    deploymentReference: evidence.deploymentReference,
    deployedAt: evidence.deployedAt,
    observedThrough: evidence.observedThrough,
    counts,
  };
}

import "server-only";

import type { SqlExecutor } from "./postgres-sql";

const OPERATION_TABLE = "money_action_operations" as const;
const LEGACY_TABLES = [
  "money_action_attempt_evidence",
  "money_action_attempt_states",
  "money_action_data_migrations",
] as const;
const REQUIRED_TABLES = [OPERATION_TABLE, ...LEGACY_TABLES] as const;

type RequiredTable = (typeof REQUIRED_TABLES)[number];

export const MONEY_ACTION_LEGACY_DROP_SQL_TEMPLATE = `DROP TABLE "__REVIEWED_SCHEMA__"."money_action_attempt_evidence";
DROP TABLE "__REVIEWED_SCHEMA__"."money_action_attempt_states";
DROP TABLE "__REVIEWED_SCHEMA__"."money_action_data_migrations";
`;

export const MONEY_ACTION_LEGACY_DROP_CONFIRMATION =
  "DROP_LEGACY_MONEY_ACTION_TABLES_ISSUE_314";
export const MONEY_ACTION_SINGLE_ROW_RUNTIME_CONTRACT =
  "money_action_operations-only-v1";

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
  databaseName: string;
  schemaName: string;
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

export type MoneyActionLegacyCleanupIdentity = Readonly<{
  databaseName: string;
  databaseOid: string;
  schemaName: string;
  schemaOid: string;
  tableOids: Readonly<{
    moneyActionOperations: string;
    moneyActionAttemptStates: string;
    moneyActionAttemptEvidence: string;
    moneyActionDataMigrations: string;
  }>;
}>;

export type MoneyActionLegacyDropApproval = Readonly<{
  approvalReference: string;
  backupReference: string;
  confirmation: typeof MONEY_ACTION_LEGACY_DROP_CONFIRMATION;
  expectedIdentity: MoneyActionLegacyCleanupIdentity;
  expectedCounts: MoneyActionLegacyCleanupCounts;
}>;

export type MoneyActionLegacyCleanupReport = Readonly<{
  status: "ready" | "dropped";
  deploymentRevision: string;
  deploymentReference: string;
  deployedAt: string;
  observedThrough: string;
  identity: MoneyActionLegacyCleanupIdentity;
  counts: MoneyActionLegacyCleanupCounts;
}>;

export type MoneyActionLegacyCleanupErrorCode =
  | "invalid-database-name"
  | "invalid-schema-name"
  | "invalid-deployed-revision"
  | "invalid-deployment-reference"
  | "invalid-deployment-timestamp"
  | "invalid-observation-timestamp"
  | "observation-before-deployment"
  | "legacy-use-observed"
  | "runtime-contract-mismatch"
  | "invalid-approval-reference"
  | "invalid-backup-reference"
  | "drop-confirmation-missing"
  | "invalid-expected-identity"
  | "invalid-expected-count"
  | "database-identity-mismatch"
  | "schema-identity-mismatch"
  | "table-metadata-mismatch"
  | "operation-schema-mismatch"
  | "evidence-index-mismatch"
  | "count-result-invalid"
  | "count-drift"
  | "drop-verification-failed";

export class MoneyActionLegacyCleanupError extends Error {
  constructor(
    readonly code: MoneyActionLegacyCleanupErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "MoneyActionLegacyCleanupError";
  }
}

export function moneyActionLegacyCleanupFailureReason(error: unknown): string {
  if (error instanceof MoneyActionLegacyCleanupError) return error.code;
  if (!error || typeof error !== "object") return "database-operation-failed";
  const value = error as { code?: unknown; errno?: unknown; sqlState?: unknown };
  const sqlState = [value.code, value.errno, value.sqlState]
    .find((candidate) => typeof candidate === "string" && /^[0-9A-Z]{5}$/.test(candidate)) as string | undefined;
  if (sqlState === "55P03" || sqlState === "57014") return "database-lock-timeout";
  if (sqlState === "2BP01") return "database-dependency-blocked";
  if (sqlState === "42P01") return "database-object-missing";
  if (sqlState === "42501") return "database-permission-denied";
  if (sqlState?.startsWith("08")) return "database-unavailable";
  return "database-operation-failed";
}

type DatabaseSchemaRow = {
  database_name: string;
  database_oid: string | number | bigint;
  schema_name: string;
  schema_oid: string | number | bigint;
};
type TableMetadataRow = {
  table_name: string;
  table_oid: string | number | bigint;
  relkind: string;
};
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
    await beginCleanupTransaction(transaction, true);
    const identity = await resolveDatabaseSchemaIdentity(transaction, evidence);
    await lockRequiredTablesForInspection(transaction, identity.schemaName);
    const lockedIdentity = await resolveLockedTableIdentity(transaction, identity);
    await assertOperationSchema(transaction, lockedIdentity);
    await assertEvidenceIndexes(transaction, lockedIdentity);
    const counts = await readCounts(transaction, lockedIdentity.schemaName);
    return report("ready", evidence, lockedIdentity, counts);
  });
}

export async function dropMoneyActionLegacyTables(
  executor: SqlExecutor,
  evidence: MoneyActionLegacyCleanupEvidence,
  approval: MoneyActionLegacyDropApproval,
): Promise<MoneyActionLegacyCleanupReport> {
  validateEvidence(evidence);
  validateApproval(approval, evidence);
  return executor.transaction(async (transaction) => {
    await beginCleanupTransaction(transaction, false);
    const identity = await resolveDatabaseSchemaIdentity(transaction, evidence);
    assertExpectedIdentity(identity, approval.expectedIdentity, false);
    await lockRequiredTablesForDrop(transaction, identity.schemaName);
    const lockedIdentity = await resolveLockedTableIdentity(transaction, identity);
    assertExpectedIdentity(lockedIdentity, approval.expectedIdentity, true);
    await assertOperationSchema(transaction, lockedIdentity);
    await assertEvidenceIndexes(transaction, lockedIdentity);

    // Re-read both locked catalog identities and counts as the final pre-DROP
    // operations. ACCESS EXCLUSIVE locks prevent a concurrent writer or DDL
    // operation from changing the reviewed target after these checks.
    const finalIdentity = await resolveLockedTableIdentity(transaction, identity);
    assertExpectedIdentity(finalIdentity, approval.expectedIdentity, true);
    const before = await readCounts(transaction, finalIdentity.schemaName);
    assertExpectedCounts(before, approval.expectedCounts);

    for (const statement of legacyDropStatements(finalIdentity.schemaName)) {
      await transaction.query(statement);
    }

    await assertLegacyTablesDropped(transaction, finalIdentity);
    const afterOperationRows = await readOperationCount(transaction, finalIdentity.schemaName);
    if (afterOperationRows !== before.operationRows) {
      fail("drop-verification-failed", "money-action legacy cleanup verification failed: operation row count changed");
    }
    await assertEvidenceIndexes(transaction, finalIdentity);
    return report("dropped", evidence, finalIdentity, before);
  });
}

function validateEvidence(evidence: MoneyActionLegacyCleanupEvidence): void {
  validateDatabaseName(evidence.databaseName);
  validateSchemaName(evidence.schemaName);
  if (!/^[0-9a-f]{40}$/.test(evidence.deploymentRevision)) {
    fail("invalid-deployed-revision", "money-action legacy cleanup requires an exact 40-character deployed revision");
  }
  validateGitHubCommentReference(evidence.deploymentReference, "deployment");
  const deployedAt = parseTimestamp(evidence.deployedAt, "deployment");
  const observedThrough = parseTimestamp(evidence.observedThrough, "observation");
  if (observedThrough <= deployedAt) {
    fail("observation-before-deployment", "money-action legacy cleanup observation must end after deployment");
  }
  if (evidence.legacyReadCount !== 0 || evidence.legacyWriteCount !== 0) {
    fail("legacy-use-observed", "money-action legacy cleanup requires zero observed legacy reads and writes");
  }
  if (evidence.runtimeContract !== MONEY_ACTION_SINGLE_ROW_RUNTIME_CONTRACT) {
    fail("runtime-contract-mismatch", "money-action legacy cleanup requires the #313 single-row runtime contract");
  }
}

function validateApproval(
  approval: MoneyActionLegacyDropApproval,
  evidence: MoneyActionLegacyCleanupEvidence,
): void {
  validateGitHubCommentReference(approval.approvalReference, "approval");
  validateGitHubCommentReference(approval.backupReference, "backup");
  if (approval.confirmation !== MONEY_ACTION_LEGACY_DROP_CONFIRMATION) {
    fail("drop-confirmation-missing", "money-action legacy cleanup drop confirmation is missing");
  }
  validateIdentityShape(approval.expectedIdentity);
  if (approval.expectedIdentity.databaseName !== evidence.databaseName
    || approval.expectedIdentity.schemaName !== evidence.schemaName) {
    fail("invalid-expected-identity", "money-action legacy cleanup approval identity does not match deployment evidence");
  }
  for (const [name, count] of Object.entries(approval.expectedCounts)) {
    if (!isCanonicalOidOrCount(count)) {
      fail("invalid-expected-count", `money-action legacy cleanup expected ${name} is not a canonical count`);
    }
  }
}

function validateDatabaseName(value: string): void {
  if (!/^[a-zA-Z0-9_.-]{1,63}$/.test(value)) {
    fail("invalid-database-name", "money-action legacy cleanup database name is invalid");
  }
}

function validateSchemaName(value: string): void {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(value)) {
    fail("invalid-schema-name", "money-action legacy cleanup schema name is invalid");
  }
}

function validateGitHubCommentReference(value: string, kind: "deployment" | "approval" | "backup"): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    fail(referenceErrorCode(kind), `money-action legacy cleanup ${kind} reference must be a canonical GitHub comment URL`);
  }
  if (url.protocol !== "https:"
    || url.username
    || url.password
    || url.hostname !== "api.github.com"
    || url.port
    || url.href !== value
    || url.search
    || url.hash
    || !/^\/repos\/jessepollak\/home\/issues\/comments\/[1-9]\d*$/.test(url.pathname)) {
    fail(referenceErrorCode(kind), `money-action legacy cleanup ${kind} reference must be a canonical GitHub comment URL`);
  }
}

function referenceErrorCode(kind: "deployment" | "approval" | "backup"):
  "invalid-deployment-reference" | "invalid-approval-reference" | "invalid-backup-reference" {
  if (kind === "deployment") return "invalid-deployment-reference";
  if (kind === "approval") return "invalid-approval-reference";
  return "invalid-backup-reference";
}

function parseTimestamp(value: string, kind: "deployment" | "observation"): number {
  const code = kind === "deployment" ? "invalid-deployment-timestamp" : "invalid-observation-timestamp";
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    fail(code, `money-action legacy cleanup ${kind} timestamp must be UTC ISO-8601`);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    fail(code, `money-action legacy cleanup ${kind} timestamp is invalid`);
  }
  return timestamp;
}

function validateIdentityShape(identity: MoneyActionLegacyCleanupIdentity): void {
  validateDatabaseName(identity.databaseName);
  validateSchemaName(identity.schemaName);
  const values = [
    identity.databaseOid,
    identity.schemaOid,
    identity.tableOids.moneyActionOperations,
    identity.tableOids.moneyActionAttemptStates,
    identity.tableOids.moneyActionAttemptEvidence,
    identity.tableOids.moneyActionDataMigrations,
  ];
  if (values.some((value) => !isCanonicalPositiveOid(value))) {
    fail("invalid-expected-identity", "money-action legacy cleanup approval identity is invalid");
  }
}

async function beginCleanupTransaction(transaction: SqlExecutor, readOnly: boolean): Promise<void> {
  if (readOnly) await transaction.query("SET LOCAL transaction_read_only = on");
  await transaction.query("SET LOCAL lock_timeout = '5s'");
  await transaction.query("SET LOCAL statement_timeout = '60s'");
  await transaction.query("SET LOCAL search_path = pg_catalog");
  await transaction.query(
    "SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext($1))",
    ["home_money_action_legacy_cleanup_v2"],
  );
}

async function resolveDatabaseSchemaIdentity(
  transaction: SqlExecutor,
  evidence: MoneyActionLegacyCleanupEvidence,
): Promise<MoneyActionLegacyCleanupIdentity> {
  const result = await transaction.query<DatabaseSchemaRow>(`
    SELECT database_row.datname AS database_name,
           database_row.oid::text AS database_oid,
           schema_row.nspname AS schema_name,
           schema_row.oid::text AS schema_oid
    FROM pg_catalog.pg_database database_row
    JOIN pg_catalog.pg_namespace schema_row ON schema_row.nspname = $1
    WHERE database_row.datname = pg_catalog.current_database()
  `.trim(), [evidence.schemaName]);
  const row = result.rows[0];
  if (result.rows.length !== 1 || !row || row.database_name !== evidence.databaseName) {
    fail("database-identity-mismatch", "money-action legacy cleanup database identity does not match reviewed evidence");
  }
  return {
    databaseName: row.database_name,
    databaseOid: normalizePositiveOid(row.database_oid),
    schemaName: row.schema_name,
    schemaOid: normalizePositiveOid(row.schema_oid),
    tableOids: emptyTableOids(),
  };
}

async function lockRequiredTablesForInspection(transaction: SqlExecutor, schemaName: string): Promise<void> {
  for (const table of REQUIRED_TABLES) {
    await transaction.query(`SELECT 1 FROM ${qualifiedTable(schemaName, table)} LIMIT 0`);
  }
}

async function lockRequiredTablesForDrop(transaction: SqlExecutor, schemaName: string): Promise<void> {
  const tables = REQUIRED_TABLES.map((table) => qualifiedTable(schemaName, table)).join(", ");
  await transaction.query(`LOCK TABLE ${tables} IN ACCESS EXCLUSIVE MODE`);
}

async function resolveLockedTableIdentity(
  transaction: SqlExecutor,
  identity: MoneyActionLegacyCleanupIdentity,
): Promise<MoneyActionLegacyCleanupIdentity> {
  const result = await transaction.query<TableMetadataRow>(`
    SELECT table_row.relname AS table_name,
           table_row.oid::text AS table_oid,
           table_row.relkind
    FROM pg_catalog.pg_class table_row
    WHERE table_row.relnamespace = $1::oid
      AND table_row.relname IN (
        'money_action_operations',
        'money_action_attempt_states',
        'money_action_attempt_evidence',
        'money_action_data_migrations'
      )
    ORDER BY table_row.relname
  `.trim(), [identity.schemaOid]);
  const rows = new Map(result.rows.map((row) => [row.table_name, row]));
  const invalid = REQUIRED_TABLES.filter((name) => {
    const row = rows.get(name);
    return !row || row.relkind !== "r" || !isCanonicalPositiveOid(String(row.table_oid));
  });
  if (rows.size !== REQUIRED_TABLES.length || invalid.length > 0) {
    fail("table-metadata-mismatch", `money-action legacy cleanup required ordinary table mismatch: ${invalid.join(", ")}`);
  }
  return {
    ...identity,
    tableOids: {
      moneyActionOperations: normalizePositiveOid(rows.get("money_action_operations")!.table_oid),
      moneyActionAttemptStates: normalizePositiveOid(rows.get("money_action_attempt_states")!.table_oid),
      moneyActionAttemptEvidence: normalizePositiveOid(rows.get("money_action_attempt_evidence")!.table_oid),
      moneyActionDataMigrations: normalizePositiveOid(rows.get("money_action_data_migrations")!.table_oid),
    },
  };
}

async function assertOperationSchema(
  transaction: SqlExecutor,
  identity: MoneyActionLegacyCleanupIdentity,
): Promise<void> {
  const columns = await transaction.query<ColumnRow>(`
    SELECT column_row.column_name, column_row.data_type, column_row.is_nullable
    FROM information_schema.columns column_row
    WHERE column_row.table_schema = $1 AND column_row.table_name = 'money_action_operations'
    ORDER BY column_row.ordinal_position
  `.trim(), [identity.schemaName]);
  const actual = new Map(columns.rows.map((row) => [row.column_name, [row.data_type, row.is_nullable]]));
  const mismatches: string[] = [];
  for (const [name, expected] of REQUIRED_OPERATION_COLUMNS) {
    const value = actual.get(name);
    if (!value || value[0] !== expected[0] || value[1] !== expected[1]) mismatches.push(name);
  }
  if (mismatches.length > 0) {
    fail("operation-schema-mismatch", `money-action legacy cleanup operation schema mismatch: ${mismatches.join(", ")}`);
  }
}

async function assertEvidenceIndexes(
  transaction: SqlExecutor,
  identity: MoneyActionLegacyCleanupIdentity,
): Promise<void> {
  const indexes = await transaction.query<IndexRow>(`
    SELECT pg_catalog.pg_get_indexdef(index_row.indexrelid) AS indexdef,
           index_row.indisunique, index_row.indisvalid, index_row.indisready
    FROM pg_catalog.pg_index index_row
    WHERE index_row.indrelid = $1::oid
  `.trim(), [identity.tableOids.moneyActionOperations]);
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
    fail("evidence-index-mismatch", `money-action legacy cleanup missing required unique index definitions: ${missing.join(", ")}`);
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

async function readCounts(
  transaction: SqlExecutor,
  schemaName: string,
): Promise<MoneyActionLegacyCleanupCounts> {
  const operationTable = qualifiedTable(schemaName, "money_action_operations");
  const attemptStates = qualifiedTable(schemaName, "money_action_attempt_states");
  const attemptEvidence = qualifiedTable(schemaName, "money_action_attempt_evidence");
  const dataMigrations = qualifiedTable(schemaName, "money_action_data_migrations");
  const result = await transaction.query<CountsRow>(`
    SELECT
      (SELECT COUNT(*) FROM ${operationTable})::text AS operation_rows,
      (SELECT COUNT(*) FROM ${attemptStates})::text AS attempt_state_rows,
      (SELECT COUNT(*) FROM ${attemptEvidence})::text AS attempt_evidence_rows,
      (SELECT COUNT(*) FROM ${dataMigrations})::text AS data_migration_rows
  `.trim());
  if (result.rows.length !== 1) {
    fail("count-result-invalid", "money-action legacy cleanup count preflight returned an unexpected result");
  }
  const row = result.rows[0]!;
  return {
    operationRows: normalizeCount(row.operation_rows),
    attemptStateRows: normalizeCount(row.attempt_state_rows),
    attemptEvidenceRows: normalizeCount(row.attempt_evidence_rows),
    dataMigrationRows: normalizeCount(row.data_migration_rows),
  };
}

async function readOperationCount(transaction: SqlExecutor, schemaName: string): Promise<string> {
  const result = await transaction.query<{ operation_rows: string | number | bigint }>(
    `SELECT COUNT(*)::text AS operation_rows FROM ${qualifiedTable(schemaName, OPERATION_TABLE)}`,
  );
  if (result.rows.length !== 1) {
    fail("count-result-invalid", "money-action legacy cleanup operation verification returned an unexpected result");
  }
  return normalizeCount(result.rows[0]!.operation_rows);
}

function normalizeCount(value: string | number | bigint): string {
  const normalized = String(value);
  if (!isCanonicalOidOrCount(normalized)) {
    fail("count-result-invalid", "money-action legacy cleanup database returned a non-canonical count");
  }
  return normalized;
}

function normalizePositiveOid(value: string | number | bigint): string {
  const normalized = String(value);
  if (!isCanonicalPositiveOid(normalized)) {
    fail("table-metadata-mismatch", "money-action legacy cleanup database returned an invalid object identity");
  }
  return normalized;
}

function isCanonicalOidOrCount(value: string): boolean {
  return /^(?:0|[1-9]\d*)$/.test(value);
}

function isCanonicalPositiveOid(value: string): boolean {
  return /^[1-9]\d*$/.test(value);
}

function assertExpectedCounts(
  actual: MoneyActionLegacyCleanupCounts,
  expected: MoneyActionLegacyCleanupCounts,
): void {
  const changed = (Object.keys(actual) as Array<keyof MoneyActionLegacyCleanupCounts>)
    .filter((key) => actual[key] !== expected[key]);
  if (changed.length > 0) {
    fail("count-drift", `money-action legacy cleanup counts changed since reviewed preflight: ${changed.join(", ")}`);
  }
}

function assertExpectedIdentity(
  actual: MoneyActionLegacyCleanupIdentity,
  expected: MoneyActionLegacyCleanupIdentity,
  includeTables: boolean,
): void {
  const baseMatches = actual.databaseName === expected.databaseName
    && actual.databaseOid === expected.databaseOid
    && actual.schemaName === expected.schemaName
    && actual.schemaOid === expected.schemaOid;
  const tablesMatch = !includeTables
    || (Object.keys(actual.tableOids) as Array<keyof MoneyActionLegacyCleanupIdentity["tableOids"]>)
      .every((key) => actual.tableOids[key] === expected.tableOids[key]);
  if (!baseMatches || !tablesMatch) {
    fail("database-identity-mismatch", "money-action legacy cleanup database or schema identity changed since reviewed preflight");
  }
}

async function assertLegacyTablesDropped(
  transaction: SqlExecutor,
  identity: MoneyActionLegacyCleanupIdentity,
): Promise<void> {
  const result = await transaction.query<{ table_name: string }>(`
    SELECT table_row.relname AS table_name
    FROM pg_catalog.pg_class table_row
    WHERE table_row.relnamespace = $1::oid
      AND table_row.relname IN (
        'money_action_attempt_states',
        'money_action_attempt_evidence',
        'money_action_data_migrations'
      )
  `.trim(), [identity.schemaOid]);
  if (result.rows.length !== 0) {
    fail("drop-verification-failed", "money-action legacy cleanup verification failed: legacy tables remain");
  }
}

function legacyDropStatements(schemaName: string): string[] {
  return LEGACY_TABLES.map((table) => `DROP TABLE ${qualifiedTable(schemaName, table)}`);
}

function qualifiedTable(schemaName: string, tableName: RequiredTable): string {
  return `${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)}`;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function emptyTableOids(): MoneyActionLegacyCleanupIdentity["tableOids"] {
  return {
    moneyActionOperations: "0",
    moneyActionAttemptStates: "0",
    moneyActionAttemptEvidence: "0",
    moneyActionDataMigrations: "0",
  };
}

function report(
  status: MoneyActionLegacyCleanupReport["status"],
  evidence: MoneyActionLegacyCleanupEvidence,
  identity: MoneyActionLegacyCleanupIdentity,
  counts: MoneyActionLegacyCleanupCounts,
): MoneyActionLegacyCleanupReport {
  return {
    status,
    deploymentRevision: evidence.deploymentRevision,
    deploymentReference: evidence.deploymentReference,
    deployedAt: evidence.deployedAt,
    observedThrough: evidence.observedThrough,
    identity,
    counts,
  };
}

function fail(code: MoneyActionLegacyCleanupErrorCode, message: string): never {
  throw new MoneyActionLegacyCleanupError(code, message);
}

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { PreparedMoneyAction } from "../../../apps/web/shared/money-actions/types";
import {
  homeProviderRequestKey,
  type PreparedActionRevision,
} from "../../../apps/web/server/money-actions/attempt-commands";
import { createTrustedVerifiedObservation } from "../../../apps/web/server/money-actions/attempt-store";
import {
  createPostgresAttemptStoreResourceWithExecutor,
} from "../../../apps/web/server/money-actions/postgres-store";
import type { AttemptStoreResource } from "../../../apps/web/server/money-actions/attempt-store";
import type {
  SqlExecutor,
  SqlQueryResult,
} from "../../../apps/web/server/money-actions/postgres-sql";
import { createBunPostgresExecutor } from "../bun-postgres-executor";

const databaseUrl = process.env.MONEY_ACTION_PG_TEST_URL?.trim();
const CLEANUP_TIMEOUT_MS = 2_000;
const TEST_TIMEOUT_MS = 20_000;

if (!databaseUrl) {
  test.skip("real PostgreSQL runtime fault gates require MONEY_ACTION_PG_TEST_URL", () => {});
} else {
  describe("real PostgreSQL money-action runtime fault gates", () => {
    test("runtime faults roll back operation, attempt state, and evidence reservations before a clean retry", async () => {
      await withPostgresFixture(databaseUrl, "runtime_fault", async (fixture) => {
        const setup = await fixture.openResource();
        const raw = fixture.openExecutor();

        for (const [index, faultPoint] of (["operation-update", "reservation-delete"] as const satisfies readonly FaultPoint[]).entries()) {
          const item = attemptFixture(401 + index);
          const claimed = await issueAndClaim(setup, item);
          const before = await rawAttemptRows(raw, item.action.id);
          let armed = true;
          let injected = false;
          const failing = await fixture.openResource(async (phase, text, run) => {
            const result = await run();
            if (armed && matchesFaultPoint(faultPoint, text)) {
              armed = false;
              injected = true;
              throw new Error(`injected runtime fault after ${faultPoint}`);
            }
            return result;
          });
          const command = evidenceCommand(item, claimed.attempt.attemptId, `fault-${faultPoint}`);

          let fault: unknown;
          try {
            await failing.store.recordProviderEvidence(command, item.evidenceAt);
          } catch (error) {
            fault = error;
          }
          expect(String(fault)).toContain(`injected runtime fault after ${faultPoint}`);
          expect(injected).toBe(true);
          expect(await rawAttemptRows(raw, item.action.id)).toEqual(before);

          const retry = await fixture.openResource();
          expect(await retry.store.recordProviderEvidence(command, item.evidenceAt)).toMatchObject({
            ok: true,
            value: { disposition: "recorded" },
          });
          expect(await retry.store.getAttemptStoreSnapshot(item.owner, item.action.id)).toMatchObject({
            ok: true,
            value: { attempts: [{ attemptVersion: 2, evidence: [{}] }] },
          });
          expect(await raw.query<{ attempt_count: number }>(
            "SELECT attempt_count FROM money_action_operations WHERE id = $1",
            [item.action.id],
          )).toMatchObject({ rows: [{ attempt_count: 1 }], rowCount: 1 });
        }
      });
    }, TEST_TIMEOUT_MS);

    test("independent evidence contenders have one version winner and a stale verification cannot project", async () => {
      await withPostgresFixture(databaseUrl, "evidence_race", async (fixture) => {
        const setup = await fixture.openResource();
        const item = attemptFixture(410);
        const claimed = await issueAndClaim(setup, item);
        const duplicateBarrier = new ExplicitBarrier(2, "duplicate evidence contenders");
        let raceArmed = false;
        const contender = async () => fixture.openResource(async (_phase, text, run) => {
          if (raceArmed && isAttemptRowLock(text)) await duplicateBarrier.reach();
          return run();
        });
        const [first, second] = await Promise.all([contender(), contender()]);
        raceArmed = true;
        const firstWrite = first.store.recordProviderEvidence(
          evidenceCommand(item, claimed.attempt.attemptId, "duplicate-a"),
          item.evidenceAt,
        );
        const secondWrite = second.store.recordProviderEvidence(
          evidenceCommand(item, claimed.attempt.attemptId, "duplicate-b"),
          item.evidenceAt,
        );
        try {
          await duplicateBarrier.waitUntilReached();
        } finally {
          duplicateBarrier.release();
        }
        const duplicateResults = await Promise.all([firstWrite, secondWrite]);
        expect(duplicateResults.map((result) => result.ok ? result.value.disposition : "error").sort()).toEqual([
          "duplicate",
          "recorded",
        ]);
        const recorded = duplicateResults.find(
          (result) => result.ok && result.value.disposition === "recorded",
        );
        if (!recorded?.ok || recorded.value.disposition !== "recorded") throw new Error("evidence race had no winner");

        const conflictingEvidence = {
          ...item.evidence,
          value: `0x${"e".repeat(64)}` as `0x${string}`,
        };
        expect(await second.store.recordProviderEvidence({
          ...evidenceCommand(item, claimed.attempt.attemptId, "conflicting-upload"),
          evidence: conflictingEvidence,
        }, "2026-09-12T16:00:03.000Z")).toMatchObject({
          ok: true,
          value: { disposition: "conflict" },
        });
        expect(await setup.store.getAttemptStoreSnapshot(item.owner, item.action.id)).toMatchObject({
          ok: true,
          value: { attempts: [{ attemptVersion: 2, evidence: [{}] }] },
        });

        const staleObservation = createTrustedVerifiedObservation({
          owner: item.owner,
          actionId: item.action.id,
          attemptId: claimed.attempt.attemptId,
          expectedAttemptVersion: 2,
          expectedDispatchVersion: 1,
          expectedEvidence: { evidence: recorded.value.evidence, comparison: "exact-recorded-fact" },
          verificationLookup: item.evidence,
          verifiedExecution: { chainId: 8453, kind: "user-operation", hash: item.evidence.value },
          result: {
            kind: "confirmed",
            transactionHash: `0x${"f".repeat(64)}` as `0x${string}`,
            verifiedExecution: true,
          },
          observedAt: "2026-09-12T16:00:05.000Z",
        });
        const staleBarrier = new ExplicitBarrier(1, "stale verified application");
        let staleArmed = true;
        const staleClient = await fixture.openResource(async (_phase, text, run) => {
          if (staleArmed && isAttemptRowLock(text)) {
            staleArmed = false;
            await staleBarrier.reach();
          }
          return run();
        });
        const staleApply = staleClient.store.applyVerifiedObservation(staleObservation);
        const newerEvidence = {
          kind: "provider-status" as const,
          handle: item.evidence,
          observedAt: "2026-09-12T16:00:04.000Z",
          payload: "pending" as const,
        };
        try {
          await staleBarrier.waitUntilReached();
          expect(await first.store.recordProviderEvidence({
            owner: item.owner,
            actionId: item.action.id,
            attemptId: claimed.attempt.attemptId,
            dispatchVersion: 1,
            evidence: newerEvidence,
            provenance: {
              source: "provider-status-lookup",
              observedAt: newerEvidence.observedAt,
              locator: item.evidence,
            },
            writeIdempotencyKey: "newer-status",
          }, newerEvidence.observedAt)).toMatchObject({ ok: true, value: { disposition: "recorded" } });
        } finally {
          staleBarrier.release();
        }
        expect(await staleApply).toMatchObject({
          ok: false,
          dispatchAuthority: "none",
          error: { code: "attempt-version-mismatch" },
        });

        const snapshot = await setup.store.getAttemptStoreSnapshot(item.owner, item.action.id);
        expect(snapshot).toMatchObject({
          ok: true,
          value: {
            attempts: [{
              attemptVersion: 3,
              evidence: [{}, {}],
              reconciliation: { kind: "authorized-no-evidence" },
            }],
          },
        });
        const raw = fixture.openExecutor();
        expect(await raw.query(
          "SELECT status, transaction_hash, verified_execution_key FROM money_action_operations WHERE id = $1",
          [item.action.id],
        )).toMatchObject({
          rows: [{ status: "submitted", transaction_hash: null, verified_execution_key: null }],
          rowCount: 1,
        });
        expect(await raw.query(
          "SELECT verified_execution_key FROM money_action_attempt_states WHERE action_id = $1",
          [item.action.id],
        )).toMatchObject({ rows: [{ verified_execution_key: null }], rowCount: 1 });
      });
    }, TEST_TIMEOUT_MS);

    test("attempt-path sensitive overlays fail closed on loss and expiry and never renew a committed dispatch", async () => {
      await withPostgresFixture(databaseUrl, "sensitive_overlay", async (fixture) => {
        const issuer = await fixture.openResource();
        const fresh = await fixture.openResource();
        const raw = fixture.openExecutor();

        const lost = sensitiveAttemptFixture(420);
        expect(await issuer.store.issueAttemptAction({
          durableAction: lost.durable,
          transientSensitivePayload: { action: lost.sensitive, expiresAt: "2026-09-20T00:00:00.000Z" },
        })).toMatchObject({ ok: true, value: { disposition: "issued" } });
        expect(await fresh.store.claimDispatch(lost.claim, lost.claimedAt)).toMatchObject({
          ok: false,
          dispatchAuthority: "none",
          error: { code: "sensitive-payload-unavailable" },
        });
        await expectPreparedWithoutCalldata(raw, lost.durable.id, lost.calldata);

        const expired = sensitiveAttemptFixture(421);
        expect(await issuer.store.issueAttemptAction({
          durableAction: expired.durable,
          transientSensitivePayload: { action: expired.sensitive, expiresAt: "2026-09-12T16:00:00.500Z" },
        })).toMatchObject({ ok: true, value: { disposition: "issued" } });
        expect(await issuer.store.claimDispatch(expired.claim, expired.claimedAt)).toMatchObject({
          ok: false,
          dispatchAuthority: "none",
          error: { code: "sensitive-payload-unavailable" },
        });
        await expectPreparedWithoutCalldata(raw, expired.durable.id, expired.calldata);

        const committed = sensitiveAttemptFixture(422);
        expect(await issuer.store.issueAttemptAction({
          durableAction: committed.durable,
          transientSensitivePayload: { action: committed.sensitive, expiresAt: "2026-09-20T00:00:00.000Z" },
        })).toMatchObject({ ok: true, value: { disposition: "issued" } });
        const claimBarrier = new ExplicitBarrier(2, "sensitive dispatch contenders");
        let claimRaceArmed = false;
        const dispatching = await fixture.openResource(async (_phase, text, run) => {
          if (claimRaceArmed && isAttemptRowLock(text)) await claimBarrier.reach();
          return run();
        });
        expect(await dispatching.store.issueAttemptAction({
          durableAction: committed.durable,
          transientSensitivePayload: { action: committed.sensitive, expiresAt: "2026-09-20T00:00:00.000Z" },
        })).toMatchObject({ ok: true, value: { disposition: "existing" } });
        const missing = await fixture.openResource(async (_phase, text, run) => {
          if (claimRaceArmed && isAttemptRowLock(text)) await claimBarrier.reach();
          return run();
        });
        claimRaceArmed = true;
        const dispatchClaim = dispatching.store.claimDispatch(committed.claim, committed.claimedAt);
        const missingClaim = missing.store.claimDispatch(committed.claim, committed.claimedAt);
        try {
          await claimBarrier.waitUntilReached();
        } finally {
          claimBarrier.release();
        }
        expect(await dispatchClaim).toMatchObject({
          ok: true,
          value: { disposition: "dispatch", action: { calls: [{ data: committed.calldata }] } },
        });
        const missingOutcome = await missingClaim;
        if (missingOutcome.ok) {
          expect(missingOutcome).toMatchObject({
            value: { disposition: "recover", authorization: "none", action: { calls: [{ data: "0x" }] } },
          });
        } else {
          expect(missingOutcome).toMatchObject({
            dispatchAuthority: "none",
            error: { code: "sensitive-payload-unavailable" },
          });
        }
        expect(await missing.store.claimDispatch(committed.claim, committed.claimedAt)).toMatchObject({
          ok: true,
          value: { disposition: "recover", action: { calls: [{ data: "0x" }] } },
        });
        expect(await dispatching.store.claimDispatch(committed.claim, committed.claimedAt)).toMatchObject({
          ok: true,
          value: { disposition: "recover" },
        });
        const renewal = await fixture.openResource();
        expect(await renewal.store.issueAttemptAction({
          durableAction: committed.durable,
          transientSensitivePayload: { action: committed.sensitive, expiresAt: "2026-09-20T00:00:00.000Z" },
        })).toMatchObject({ ok: true, value: { disposition: "existing" } });
        expect(await renewal.store.claimDispatch(committed.claim, committed.claimedAt)).toMatchObject({
          ok: true,
          value: { disposition: "recover" },
        });

        const durableRows = await raw.query<{ action_json: string; state_json: string }>(`
          SELECT operation.action_json, state.state_json
          FROM money_action_operations operation
          JOIN money_action_attempt_states state ON state.action_id = operation.id
          WHERE operation.id IN ($1, $2, $3)
          ORDER BY operation.id
        `.trim(), [lost.durable.id, expired.durable.id, committed.durable.id]);
        expect(durableRows.rowCount).toBe(3);
        for (const row of durableRows.rows) {
          expect(row.action_json).not.toContain("0xdeadbeef");
          expect(row.state_json).not.toContain("0xdeadbeef");
        }
        expect(await raw.query(
          "SELECT status, attempt_count FROM money_action_operations WHERE id = $1",
          [committed.durable.id],
        )).toMatchObject({ rows: [{ status: "submitting", attempt_count: 1 }], rowCount: 1 });
      });
    }, TEST_TIMEOUT_MS);
  });
}

type FaultPoint = "operation-update" | "reservation-delete";
type QueryHook = (
  phase: "query",
  text: string,
  run: () => Promise<SqlQueryResult<unknown>>,
) => Promise<SqlQueryResult<unknown>>;

class ExplicitBarrier {
  private reached = 0;
  private readonly ready = deferred<void>();
  private readonly released = deferred<void>();

  constructor(private readonly participants: number, private readonly label: string) {}

  async reach(): Promise<void> {
    this.reached += 1;
    if (this.reached === this.participants) this.ready.resolve();
    await this.released.promise;
  }

  waitUntilReached(): Promise<void> {
    return bounded(this.ready.promise, TEST_TIMEOUT_MS / 2, `${this.label} barrier`);
  }

  release(): void {
    this.released.resolve();
  }
}

class PostgresFixture {
  private readonly clients: Bun.SQL[] = [];
  private readonly resources: AttemptStoreResource[] = [];

  constructor(readonly schema: string) {}

  openExecutor(hook?: QueryHook): SqlExecutor {
    const client = new Bun.SQL(databaseUrl!);
    this.clients.push(client);
    const executor = createBunPostgresExecutor(client, this.schema);
    return hook ? hookedExecutor(executor, hook) : executor;
  }

  async openResource(hook?: QueryHook): Promise<AttemptStoreResource> {
    const resource = createPostgresAttemptStoreResourceWithExecutor(this.openExecutor(hook));
    this.resources.push(resource);
    await resource.init();
    return resource;
  }

  async dispose(admin: Bun.SQL): Promise<void> {
    const errors: unknown[] = [];
    const resourceResults = await Promise.allSettled(this.resources.map((resource, index) => bounded(
      Promise.resolve().then(() => resource.dispose()),
      CLEANUP_TIMEOUT_MS,
      `resource ${index + 1} cleanup`,
    )));
    for (const result of resourceResults) if (result.status === "rejected") errors.push(result.reason);
    const closeResults = await Promise.allSettled(this.clients.map((client, index) => bounded(
      client.close({ timeout: CLEANUP_TIMEOUT_MS / 1_000 }),
      CLEANUP_TIMEOUT_MS,
      `client ${index + 1} cleanup`,
    )));
    for (const result of closeResults) if (result.status === "rejected") errors.push(result.reason);
    try {
      await bounded(admin.begin(async (transaction) => {
        await transaction.unsafe(`SET LOCAL lock_timeout = '${CLEANUP_TIMEOUT_MS}ms'`);
        await transaction.unsafe(`SET LOCAL statement_timeout = '${CLEANUP_TIMEOUT_MS}ms'`);
        await transaction.unsafe(`DROP SCHEMA IF EXISTS "${this.schema}" CASCADE`);
      }), CLEANUP_TIMEOUT_MS, "fixture schema cleanup");
    } catch (error) {
      errors.push(error);
    }
    if (errors.length > 0) throw new AggregateError(errors, "PostgreSQL runtime-fault fixture cleanup failed");
  }
}

async function withPostgresFixture<Result>(
  url: string,
  label: string,
  run: (fixture: PostgresFixture) => Promise<Result>,
): Promise<Result> {
  const admin = new Bun.SQL(url);
  const schema = `delivery_${label}_${process.pid}_${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
  const fixture = new PostgresFixture(schema);
  let primaryError: unknown;
  let result: Result | undefined;
  try {
    await admin.unsafe(`CREATE SCHEMA "${schema}"`);
    result = await run(fixture);
  } catch (error) {
    primaryError = error;
  }
  const cleanupErrors: unknown[] = [];
  try {
    await fixture.dispose(admin);
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    await bounded(admin.close({ timeout: CLEANUP_TIMEOUT_MS / 1_000 }), CLEANUP_TIMEOUT_MS, "admin client cleanup");
  } catch (error) {
    cleanupErrors.push(error);
  }
  if (primaryError !== undefined && cleanupErrors.length > 0) {
    throw new AggregateError([primaryError, ...cleanupErrors], "PostgreSQL runtime-fault test and cleanup failed");
  }
  if (primaryError !== undefined) throw primaryError;
  if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, "PostgreSQL runtime-fault cleanup failed");
  return result as Result;
}

function hookedExecutor(base: SqlExecutor, hook: QueryHook): SqlExecutor {
  return {
    async query<Row = Record<string, unknown>>(text: string, values: unknown[] = []) {
      return await hook("query", text, () => base.query<unknown>(text, values)) as SqlQueryResult<Row>;
    },
    transaction<Result>(run: (transaction: SqlExecutor) => Promise<Result>) {
      return base.transaction((transaction) => run(hookedExecutor(transaction, hook)));
    },
  };
}

function matchesFaultPoint(point: FaultPoint, text: string): boolean {
  if (point === "operation-update") return /^UPDATE money_action_operations SET\s+action_json/.test(text);
  return text === "DELETE FROM money_action_attempt_evidence WHERE action_id = $1";
}

function isAttemptRowLock(text: string): boolean {
  return text.includes("FROM money_action_operations WHERE id = $1 FOR UPDATE");
}

function attemptFixture(number: number) {
  const owner = ownerFor(number);
  const id = `a0000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
  const issuedAt = "2026-09-12T16:00:00.000Z";
  const claimedAt = "2026-09-12T16:00:01.000Z";
  const evidenceAt = "2026-09-12T16:00:02.000Z";
  const action: PreparedActionRevision = {
    id,
    revision: 1,
    reviewHash: String.fromCharCode(97 + (number % 6)).repeat(64),
    owner,
    kind: "send",
    title: "Send USDC",
    calls: [{ to: "0x9999999999999999999999999999999999999999", data: "0x", value: "0" }],
    amounts: [],
    warnings: [],
    createdAt: issuedAt,
    expiresAt: "2099-01-01T00:00:00.000Z",
  };
  const evidence = {
    kind: "user-operation-hash" as const,
    provider: "cdp-embedded" as const,
    value: `0x${String((number % 8) + 1).repeat(64)}` as `0x${string}`,
  };
  return {
    owner,
    action,
    evidence,
    issuedAt,
    claimedAt,
    evidenceAt,
    claim: {
      owner,
      actionId: id,
      reviewHash: action.reviewHash,
      expectedActionRevision: 1 as const,
      provider: "cdp-embedded" as const,
      providerRequestKey: homeProviderRequestKey({ provider: "cdp-embedded", actionId: id }),
    },
  };
}

function sensitiveAttemptFixture(number: number) {
  const base = attemptFixture(number);
  const calldata = "0xdeadbeef" as const;
  const dataHash = createHash("sha256").update(calldata).digest("hex");
  const sensitive: PreparedActionRevision = {
    ...base.action,
    kind: "swap",
    quoteId: `quote-${number}`,
    sensitivePayload: true,
    calls: [{
      to: "0x9999999999999999999999999999999999999999",
      data: calldata,
      dataHash,
      value: "0",
    }],
  };
  const durable: PreparedActionRevision = {
    ...sensitive,
    calls: sensitive.calls.map((call) => ({ ...call, data: "0x" as const })),
  };
  return { ...base, sensitive, durable, calldata };
}

function ownerFor(number: number) {
  return {
    subject: `postgres-runtime-owner-${number}`,
    address: `0x${String((number % 8) + 1).repeat(40)}` as `0x${string}`,
    chainId: 8453 as const,
    accountProvider: "cdp-embedded" as const,
  };
}

async function issueAndClaim(resource: AttemptStoreResource, item: ReturnType<typeof attemptFixture>) {
  expect(await resource.store.issueAttemptAction({ durableAction: item.action })).toMatchObject({
    ok: true,
    value: { disposition: "issued" },
  });
  const claimed = await resource.store.claimDispatch(item.claim, item.claimedAt);
  if (!claimed.ok || claimed.value.disposition !== "dispatch") throw new Error("fixture did not dispatch");
  return claimed.value;
}

function evidenceCommand(
  item: ReturnType<typeof attemptFixture>,
  attemptId: string,
  writeIdempotencyKey: string,
) {
  return {
    owner: item.owner,
    actionId: item.action.id,
    attemptId,
    dispatchVersion: 1,
    evidence: item.evidence,
    provenance: { source: "provider-return" as const, observedAt: item.evidenceAt },
    writeIdempotencyKey,
  };
}

async function rawAttemptRows(executor: SqlExecutor, actionId: string) {
  const [operation, state, evidence] = await Promise.all([
    executor.query(
      "SELECT status, attempt_count, submission_id, transaction_hash, user_operation_hash, verified_execution_key, updated_at FROM money_action_operations WHERE id = $1",
      [actionId],
    ),
    executor.query("SELECT state_json, verified_execution_key FROM money_action_attempt_states WHERE action_id = $1", [actionId]),
    executor.query("SELECT evidence_key, action_id FROM money_action_attempt_evidence WHERE action_id = $1 ORDER BY evidence_key", [actionId]),
  ]);
  return { operation, state, evidence };
}

async function expectPreparedWithoutCalldata(
  executor: SqlExecutor,
  actionId: string,
  calldata: string,
): Promise<void> {
  const result = await executor.query<{ action_json: string; state_json: string; status: string; attempt_count: number }>(`
    SELECT operation.action_json, state.state_json, operation.status, operation.attempt_count
    FROM money_action_operations operation
    JOIN money_action_attempt_states state ON state.action_id = operation.id
    WHERE operation.id = $1
  `.trim(), [actionId]);
  expect(result).toMatchObject({ rows: [{ status: "prepared", attempt_count: 0 }], rowCount: 1 });
  expect(result.rows[0]?.action_json).not.toContain(calldata);
  expect(result.rows[0]?.state_json).not.toContain(calldata);
}

async function bounded<Result>(promise: Promise<Result>, timeoutMs: number, label: string): Promise<Result> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function deferred<Value>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

import { afterAll, describe, expect, test } from "bun:test";
import type { PreparedMoneyAction } from "../../../apps/web/shared/money-actions/types";
import {
  homeProviderRequestKey,
  type PreparedActionRevision,
} from "../../../apps/web/server/money-actions/attempt-commands";
import { evidenceUniquenessKey } from "../../../apps/web/server/money-actions/attempt-store-core";
import { createTrustedVerifiedObservation } from "../../../apps/web/server/money-actions/attempt-store";
import {
  createPostgresAttemptStoreResourceWithExecutor,
  PostgresMoneyActionStore,
} from "../../../apps/web/server/money-actions/postgres-store";
import {
  applyMoneyActionPostgresSchema,
  moneyActionQueries,
  type SqlExecutor,
} from "../../../apps/web/server/money-actions/postgres-sql";
import { describeMoneyActionStore } from "../../../apps/web/server/money-actions/store-contract";
import { createBunPostgresExecutor } from "../bun-postgres-executor";

const databaseUrl = process.env.MONEY_ACTION_PG_TEST_URL?.trim();

if (!databaseUrl) {
  test.skip("real PostgreSQL store contract requires MONEY_ACTION_PG_TEST_URL", () => {});
} else {
  describe("real PostgreSQL money action contract", () => {
    const admin = new Bun.SQL(databaseUrl);
    const sharedPool = new Bun.SQL(databaseUrl);
    const schemas: string[] = [];
    let fixtureNumber = 0;

    function schemaName(label: string): string {
      fixtureNumber += 1;
      return `delivery_${label}_${process.pid}_${fixtureNumber}_${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
    }

    async function createSchema(label: string): Promise<string> {
      const schema = schemaName(label);
      await admin.unsafe(`CREATE SCHEMA "${schema}"`);
      schemas.push(schema);
      return schema;
    }

    function executor(schema: string, client = sharedPool): SqlExecutor {
      return createBunPostgresExecutor(client, schema);
    }

    describeMoneyActionStore("PostgresMoneyActionStore (PostgreSQL 14)", async () => {
      const schema = await createSchema("legacy");
      return new PostgresMoneyActionStore(executor(schema));
    });

    test("independent PostgreSQL resources recover concurrent issue and claim winners", async () => {
      const schema = await createSchema("claim");
      const first = createPostgresAttemptStoreResourceWithExecutor(executor(schema));
      const second = createPostgresAttemptStoreResourceWithExecutor(executor(schema));
      await Promise.all([first.init(), second.init()]);
      const item = attemptFixture(100);
      const issued = await Promise.all([
        first.store.issueAttemptAction({ durableAction: item.action }),
        second.store.issueAttemptAction({ durableAction: item.action }),
      ]);
      expect(issued.map((outcome) => outcome.ok ? outcome.value.disposition : "error").sort()).toEqual([
        "existing",
        "issued",
      ]);
      const wrongOwner = { ...item.owner, subject: "other-subject" };
      expect(await first.store.claimDispatch({ ...item.claim, owner: wrongOwner }, item.claimedAt)).toMatchObject({
        ok: false,
        dispatchAuthority: "none",
        error: { code: "owner-mismatch" },
      });
      const claims = await Promise.all([
        first.store.claimDispatch(item.claim, item.claimedAt),
        second.store.claimDispatch(item.claim, item.claimedAt),
      ]);
      expect(claims.map((outcome) => outcome.ok ? outcome.value.disposition : "error").sort()).toEqual([
        "dispatch",
        "recover",
      ]);
      if (!claims[0]!.ok || !claims[1]!.ok || !claims[0]!.value.attempt || !claims[1]!.value.attempt) {
        throw new Error("PostgreSQL claims did not return attempts");
      }
      expect(claims[0]!.value.attempt.attemptId).toBe(claims[1]!.value.attempt.attemptId);
      await Promise.all([first.dispose(), second.dispose()]);
    });

    test("legacy and attempt writes share one case-normalized canonical reservation", async () => {
      const schema = await createSchema("reservation");
      const resource = createPostgresAttemptStoreResourceWithExecutor(executor(schema));
      await resource.init();
      const first = attemptFixture(101);
      const firstClaim = await issueAndClaim(resource.store, first);
      const uppercaseHash = `0x${"A".repeat(64)}` as const;
      expect(await resource.store.recordProviderEvidence({
        owner: first.owner,
        actionId: first.action.id,
        attemptId: firstClaim.attempt.attemptId,
        dispatchVersion: 1,
        evidence: { kind: "user-operation-hash", provider: "cdp-embedded", value: uppercaseHash },
        provenance: { source: "provider-return", observedAt: first.evidenceAt },
        writeIdempotencyKey: "attempt-uppercase",
      }, first.evidenceAt)).toMatchObject({ ok: true, value: { disposition: "recorded" } });
      expect((await resource.store.get(first.owner, first.action.id))?.userOperationHash).toBe(
        uppercaseHash.toLowerCase() as `0x${string}`,
      );

      const legacy = legacyAction(102, first.owner);
      await resource.store.issue(legacy);
      await resource.store.claim(first.owner, legacy.id, legacy.reviewHash, first.claimedAt);
      expect(await resource.store.recordSubmission(first.owner, legacy.id, {
        userOperationHash: uppercaseHash.toLowerCase() as `0x${string}`,
      }, first.evidenceAt)).toBeNull();

      const legacySource = legacyAction(103, first.owner);
      const legacyHash = `0x${"B".repeat(64)}` as const;
      await resource.store.issue(legacySource);
      await resource.store.claim(first.owner, legacySource.id, legacySource.reviewHash, first.claimedAt);
      expect(await resource.store.recordSubmission(first.owner, legacySource.id, {
        userOperationHash: legacyHash,
      }, first.evidenceAt)).toMatchObject({ userOperationHash: legacyHash.toLowerCase() });

      const second = attemptFixture(104, first.owner);
      const secondClaim = await issueAndClaim(resource.store, second);
      expect(await resource.store.recordProviderEvidence({
        owner: first.owner,
        actionId: second.action.id,
        attemptId: secondClaim.attempt.attemptId,
        dispatchVersion: 1,
        evidence: {
          kind: "user-operation-hash",
          provider: "cdp-embedded",
          value: legacyHash.toLowerCase() as `0x${string}`,
        },
        provenance: { source: "provider-return", observedAt: second.evidenceAt },
        writeIdempotencyKey: "legacy-reservation-conflict",
      }, second.evidenceAt)).toMatchObject({ ok: false, error: { code: "conflicting-evidence" } });
      await resource.dispose();
    });

    test("verified terminal outcomes remain monotonic through attempt and legacy reconciliation", async () => {
      const schema = await createSchema("terminal");
      const resource = createPostgresAttemptStoreResourceWithExecutor(executor(schema));
      await resource.init();
      const item = attemptFixture(105);
      const claimed = await issueAndClaim(resource.store, item);
      const userOperationHash = `0x${"c".repeat(64)}` as const;
      const transactionHash = `0x${"d".repeat(64)}` as const;
      const recorded = await resource.store.recordProviderEvidence({
        owner: item.owner,
        actionId: item.action.id,
        attemptId: claimed.attempt.attemptId,
        dispatchVersion: 1,
        evidence: { kind: "user-operation-hash", provider: "cdp-embedded", value: userOperationHash },
        provenance: { source: "provider-return", observedAt: item.evidenceAt },
        writeIdempotencyKey: "terminal-evidence",
      }, item.evidenceAt);
      if (!recorded.ok || recorded.value.disposition !== "recorded") throw new Error("evidence was not recorded");
      const observation = createTrustedVerifiedObservation({
        owner: item.owner,
        actionId: item.action.id,
        attemptId: claimed.attempt.attemptId,
        expectedAttemptVersion: 2,
        expectedDispatchVersion: 1,
        expectedEvidence: { evidence: recorded.value.evidence, comparison: "exact-recorded-fact" },
        verificationLookup: { kind: "user-operation-hash", provider: "cdp-embedded", value: userOperationHash },
        verifiedExecution: { chainId: 8453, kind: "user-operation", hash: userOperationHash },
        result: { kind: "confirmed", transactionHash, verifiedExecution: true },
        observedAt: item.verifiedAt,
      });
      const applied = await resource.store.applyVerifiedObservation(observation);
      if (!applied.ok || applied.value.kind === "conflict") throw new Error("verified observation failed");
      expect(await resource.store.reconcileAttempt({
        owner: item.owner,
        actionId: item.action.id,
        attemptId: claimed.attempt.attemptId,
        expectedAttemptVersion: applied.value.attempt.attemptVersion,
        lookup: { kind: "none", reason: "reference-free-ambiguous" },
      })).toMatchObject({
        ok: true,
        value: { kind: "unchanged", attempt: { reconciliation: { kind: "confirmed" } } },
      });
      expect(await resource.store.updateStatus(item.owner, item.action.id, "unknown", item.afterVerifiedAt)).toBeNull();
      expect((await resource.store.get(item.owner, item.action.id))?.status).toBe("confirmed");
      await resource.dispose();
    });

    test("provider status advances monotonically on real PostgreSQL", async () => {
      const schema = await createSchema("status");
      const resource = createPostgresAttemptStoreResourceWithExecutor(executor(schema));
      await resource.init();
      const item = attemptFixture(112);
      const claimed = await issueAndClaim(resource.store, item);
      await resource.store.recordProviderEvidence({
        owner: item.owner,
        actionId: item.action.id,
        attemptId: claimed.attempt.attemptId,
        dispatchVersion: 1,
        evidence: item.evidence,
        provenance: { source: "provider-return", observedAt: item.evidenceAt },
        writeIdempotencyKey: "status-handle",
      }, item.evidenceAt);
      for (const [payload, observedAt] of [
        ["pending", "2026-09-12T16:00:03.000Z"],
        ["confirmed", "2026-09-12T16:00:04.000Z"],
      ] as const) {
        const evidence = { kind: "provider-status" as const, handle: item.evidence, observedAt, payload };
        expect(await resource.store.recordProviderEvidence({
          owner: item.owner,
          actionId: item.action.id,
          attemptId: claimed.attempt.attemptId,
          dispatchVersion: 1,
          evidence,
          provenance: { source: "provider-status-lookup", observedAt, locator: item.evidence },
          writeIdempotencyKey: `status-${payload}`,
        }, observedAt)).toMatchObject({ ok: true, value: { disposition: "recorded" } });
      }
      expect(await resource.store.getAttemptStoreSnapshot(item.owner, item.action.id)).toMatchObject({
        ok: true,
        value: { attempts: [{ attemptVersion: 4, evidence: [{}, {}, {}] }] },
      });
      await resource.dispose();
    });

    test("tampered verified observations fail inside the real PostgreSQL apply transaction", async () => {
      const schema = await createSchema("tamper");
      const resource = createPostgresAttemptStoreResourceWithExecutor(executor(schema));
      await resource.init();
      const item = attemptFixture(113);
      const claimed = await issueAndClaim(resource.store, item);
      const recorded = await resource.store.recordProviderEvidence({
        owner: item.owner,
        actionId: item.action.id,
        attemptId: claimed.attempt.attemptId,
        dispatchVersion: 1,
        evidence: item.evidence,
        provenance: { source: "provider-return", observedAt: item.evidenceAt },
        writeIdempotencyKey: "tamper-evidence",
      }, item.evidenceAt);
      if (!recorded.ok || recorded.value.disposition !== "recorded") throw new Error("evidence was not recorded");
      const transactionHash = `0x${"a".repeat(64)}` as const;
      const observation = createTrustedVerifiedObservation({
        owner: item.owner,
        actionId: item.action.id,
        attemptId: claimed.attempt.attemptId,
        expectedAttemptVersion: 2,
        expectedDispatchVersion: 1,
        expectedEvidence: { evidence: recorded.value.evidence, comparison: "exact-recorded-fact" },
        verificationLookup: { kind: "user-operation-hash", provider: "cdp-embedded", value: item.evidence.value },
        verifiedExecution: { chainId: 8453, kind: "user-operation", hash: item.evidence.value },
        result: { kind: "confirmed", transactionHash, verifiedExecution: true },
        observedAt: item.verifiedAt,
      });
      expect(await resource.store.applyVerifiedObservation({
        ...observation,
        verificationLookup: {
          kind: "user-operation-hash",
          provider: "cdp-embedded",
          value: `0x${"b".repeat(64)}`,
        },
      })).toMatchObject({ ok: false, error: { code: "invalid-command" } });
      expect(await resource.store.get(item.owner, item.action.id)).toMatchObject({ status: "submitted" });
      await resource.dispose();
    });

    test("legacy verified terminals fence conflicting attempt outcomes and execution keys", async () => {
      const schema = await createSchema("terminal_fence");
      const resource = createPostgresAttemptStoreResourceWithExecutor(executor(schema));
      await resource.init();
      const item = attemptFixture(114);
      const claimed = await issueAndClaim(resource.store, item);
      const userOperationHash = `0x${"c".repeat(64)}` as const;
      const transactionHash = `0x${"d".repeat(64)}` as const;
      const recorded = await resource.store.recordProviderEvidence({
        owner: item.owner,
        actionId: item.action.id,
        attemptId: claimed.attempt.attemptId,
        dispatchVersion: 1,
        evidence: { kind: "user-operation-hash", provider: "cdp-embedded", value: userOperationHash },
        provenance: { source: "provider-return", observedAt: item.evidenceAt },
        writeIdempotencyKey: "legacy-terminal-evidence",
      }, item.evidenceAt);
      if (!recorded.ok || recorded.value.disposition !== "recorded") throw new Error("evidence was not recorded");
      await resource.store.recordSubmission(item.owner, item.action.id, { transactionHash }, item.evidenceAt);
      expect(await resource.store.updateStatus(item.owner, item.action.id, "confirmed", item.verifiedAt, {
        verifiedExecution: { chainId: 8453, kind: "user-operation", hash: userOperationHash },
      })).toMatchObject({ status: "confirmed" });
      const conflicting = createTrustedVerifiedObservation({
        owner: item.owner,
        actionId: item.action.id,
        attemptId: claimed.attempt.attemptId,
        expectedAttemptVersion: 2,
        expectedDispatchVersion: 1,
        expectedEvidence: { evidence: recorded.value.evidence, comparison: "exact-recorded-fact" },
        verificationLookup: { kind: "user-operation-hash", provider: "cdp-embedded", value: userOperationHash },
        verifiedExecution: { chainId: 8453, kind: "user-operation", hash: userOperationHash },
        result: { kind: "failed", transactionHash, verifiedExecution: true },
        observedAt: item.afterVerifiedAt,
      });
      expect(await resource.store.applyVerifiedObservation(conflicting)).toMatchObject({
        ok: false,
        error: { code: "verified-execution-conflict" },
      });
      expect(await resource.store.get(item.owner, item.action.id)).toMatchObject({ status: "confirmed" });
      expect(await resource.store.getAttemptStoreSnapshot(item.owner, item.action.id)).toMatchObject({
        ok: true,
        value: { attempts: [{ reconciliation: { kind: "confirmed", transactionHash } }] },
      });

      const replacement = attemptFixture(115);
      const replacementClaim = await issueAndClaim(resource.store, replacement);
      const replacementEvidence = await resource.store.recordProviderEvidence({
        owner: replacement.owner,
        actionId: replacement.action.id,
        attemptId: replacementClaim.attempt.attemptId,
        dispatchVersion: 1,
        evidence: { kind: "transaction-hash", chainId: 8453, value: `0x${"e".repeat(64)}` },
        provenance: { source: "verified-receipt", observedAt: replacement.evidenceAt },
        writeIdempotencyKey: "replacement-execution",
      }, replacement.evidenceAt);
      if (!replacementEvidence.ok || replacementEvidence.value.disposition !== "recorded") {
        throw new Error("replacement evidence was not recorded");
      }
      expect(await resource.store.applyVerifiedObservation(createTrustedVerifiedObservation({
        owner: replacement.owner,
        actionId: replacement.action.id,
        attemptId: replacementClaim.attempt.attemptId,
        expectedAttemptVersion: 2,
        expectedDispatchVersion: 1,
        expectedEvidence: { evidence: replacementEvidence.value.evidence, comparison: "exact-recorded-fact" },
        verificationLookup: { kind: "transaction-hash", chainId: 8453, value: `0x${"e".repeat(64)}` },
        verifiedExecution: { chainId: 8453, kind: "user-operation", hash: userOperationHash },
        result: { kind: "confirmed", transactionHash: `0x${"e".repeat(64)}`, verifiedExecution: true },
        observedAt: replacement.verifiedAt,
      }))).toMatchObject({ ok: false, error: { code: "verified-execution-conflict" } });
      await resource.dispose();
    });

    test("competing legacy and attempt reservations leave no partial loser writes", async () => {
      const schema = await createSchema("reservation_rollback");
      const first = createPostgresAttemptStoreResourceWithExecutor(executor(schema));
      const second = createPostgresAttemptStoreResourceWithExecutor(executor(schema));
      await Promise.all([first.init(), second.init()]);
      const item = attemptFixture(116);
      const attemptClaim = await issueAndClaim(first.store, item);
      const legacy = legacyAction(116, item.owner);
      await second.store.issue(legacy);
      await second.store.claim(item.owner, legacy.id, legacy.reviewHash, item.claimedAt);
      const sharedHash = `0x${"f".repeat(64)}` as const;
      const legacyTransaction = `0x${"1".repeat(64)}` as const;
      const [attemptWrite, legacyWrite] = await Promise.all([
        first.store.recordProviderEvidence({
          owner: item.owner,
          actionId: item.action.id,
          attemptId: attemptClaim.attempt.attemptId,
          dispatchVersion: 1,
          evidence: { kind: "user-operation-hash", provider: "cdp-embedded", value: sharedHash },
          provenance: { source: "provider-return", observedAt: item.evidenceAt },
          writeIdempotencyKey: "competing-attempt",
        }, item.evidenceAt),
        second.store.recordSubmission(item.owner, legacy.id, {
          userOperationHash: sharedHash,
          transactionHash: legacyTransaction,
        }, item.evidenceAt),
      ]);
      expect(Number(attemptWrite.ok) + Number(legacyWrite !== null)).toBe(1);
      if (!legacyWrite) {
        expect(await second.store.get(item.owner, legacy.id)).toMatchObject({
          status: "submitting",
          transactionHash: undefined,
          userOperationHash: undefined,
        });
      }

      const reserved = attemptFixture(117, item.owner);
      await issueAndClaim(first.store, reserved);
      const forcedHash = `0x${"2".repeat(64)}` as const;
      const forcedKey = evidenceUniquenessKey(item.owner, {
        kind: "user-operation-hash",
        provider: "cdp-embedded",
        value: forcedHash,
      });
      if (!forcedKey) throw new Error("expected a provider evidence reservation key");
      await executor(schema).query(moneyActionQueries.reserveEvidence, [forcedKey, reserved.action.id]);
      const rollback = legacyAction(117, item.owner);
      const rollbackSubmission = "Rollback-Opaque-Submission";
      await second.store.issue(rollback);
      await second.store.claim(item.owner, rollback.id, rollback.reviewHash, item.claimedAt);
      expect(await second.store.recordSubmission(item.owner, rollback.id, {
        submissionId: rollbackSubmission,
        userOperationHash: forcedHash,
        transactionHash: `0x${"3".repeat(64)}`,
      }, item.evidenceAt)).toBeNull();
      expect(await second.store.get(item.owner, rollback.id)).toMatchObject({
        status: "submitting",
        submissionId: undefined,
        transactionHash: undefined,
        userOperationHash: undefined,
      });
      const retry = legacyAction(118, item.owner);
      await second.store.issue(retry);
      await second.store.claim(item.owner, retry.id, retry.reviewHash, item.claimedAt);
      expect(await second.store.recordSubmission(item.owner, retry.id, {
        submissionId: rollbackSubmission,
      }, item.afterVerifiedAt)).toMatchObject({ submissionId: rollbackSubmission });
      await Promise.all([first.dispose(), second.dispose()]);
    });

    test("release and evidence races preserve both facts across independent PostgreSQL connections", async () => {
      const schema = await createSchema("race");
      const first = createPostgresAttemptStoreResourceWithExecutor(executor(schema));
      const second = createPostgresAttemptStoreResourceWithExecutor(executor(schema));
      await Promise.all([first.init(), second.init()]);
      const item = attemptFixture(106);
      const claimed = await issueAndClaim(first.store, item);
      const [evidence, release] = await Promise.all([
        first.store.recordProviderEvidence({
          owner: item.owner,
          actionId: item.action.id,
          attemptId: claimed.attempt.attemptId,
          dispatchVersion: 1,
          evidence: item.evidence,
          provenance: { source: "provider-return", observedAt: item.evidenceAt },
          writeIdempotencyKey: "race-evidence",
        }, item.evidenceAt),
        second.store.releaseAttemptAdmission({
          owner: item.owner,
          actionId: item.action.id,
          attemptId: claimed.attempt.attemptId,
          policyVersion: "owner-release-v1",
          reason: "owner-request",
        }, item.releasedAt),
      ]);
      expect(evidence.ok).toBe(true);
      expect(release.ok).toBe(true);
      expect(await first.store.getAttemptStoreSnapshot(item.owner, item.action.id)).toMatchObject({
        ok: true,
        value: {
          attempts: [{
            evidence: [{ evidence: item.evidence }],
            admission: { state: "released" },
            ownerResolution: { kind: "abandoned" },
          }],
        },
      });
      await Promise.all([first.dispose(), second.dispose()]);
    });

    test("restart after committed lost responses recovers the same attempt and evidence", async () => {
      const schema = await createSchema("restart");
      const item = attemptFixture(107);
      const firstClient = new Bun.SQL(databaseUrl);
      let firstDisposals = 0;
      const firstExecutor = disposableExecutor(firstClient, schema, () => { firstDisposals += 1; });
      const first = createPostgresAttemptStoreResourceWithExecutor(firstExecutor);
      await first.init();
      await first.store.issueAttemptAction({ durableAction: item.action });
      const lostClaim = await first.store.claimDispatch(item.claim, item.claimedAt);
      if (!lostClaim.ok || !lostClaim.value.attempt) throw new Error("lost claim did not commit");
      const attemptId = lostClaim.value.attempt.attemptId;
      await first.dispose();
      await first.dispose();
      expect(firstDisposals).toBe(1);

      const secondClient = new Bun.SQL(databaseUrl);
      const second = createPostgresAttemptStoreResourceWithExecutor(disposableExecutor(secondClient, schema));
      await second.init();
      expect(await second.store.claimDispatch(item.claim, item.claimedAt)).toMatchObject({
        ok: true,
        value: { disposition: "recover", attempt: { attemptId } },
      });
      await second.store.recordProviderEvidence({
        owner: item.owner,
        actionId: item.action.id,
        attemptId,
        dispatchVersion: 1,
        evidence: item.evidence,
        provenance: { source: "provider-return", observedAt: item.evidenceAt },
        writeIdempotencyKey: "lost-evidence-response",
      }, item.evidenceAt);
      await second.dispose();

      const thirdClient = new Bun.SQL(databaseUrl);
      const third = createPostgresAttemptStoreResourceWithExecutor(disposableExecutor(thirdClient, schema));
      await third.init();
      expect(await third.store.recordProviderEvidence({
        owner: item.owner,
        actionId: item.action.id,
        attemptId,
        dispatchVersion: 1,
        evidence: item.evidence,
        provenance: { source: "provider-return", observedAt: item.evidenceAt },
        writeIdempotencyKey: "lost-evidence-retry",
      }, item.evidenceAt)).toMatchObject({ ok: true, value: { disposition: "duplicate" } });
      await third.dispose();
      expect(await third.store.getAttemptStoreSnapshot(item.owner, item.action.id)).toMatchObject({
        ok: false,
        error: { code: "resource-disposed" },
      });
    });

    test("legacy migration backfills raw unreserved uppercase rows without reopening dispatch", async () => {
      const schema = await createSchema("migration");
      const item = attemptFixture(108);
      const rawExecutor = executor(schema);
      await applyMoneyActionPostgresSchema(rawExecutor);
      const prepared = legacyAction(108, item.owner);
      await insertRawLegacyOperation(rawExecutor, prepared, {
        status: "unknown",
        claimedAt: item.claimedAt,
        updatedAt: item.evidenceAt,
      });
      const referenced = legacyAction(110, item.owner);
      const legacyHash = `0x${"E".repeat(64)}` as const;
      await insertRawLegacyOperation(rawExecutor, referenced, {
        status: "submitted",
        claimedAt: item.claimedAt,
        userOperationHash: legacyHash,
        updatedAt: item.evidenceAt,
      });
      expect(await rawExecutor.query("SELECT evidence_key FROM money_action_attempt_evidence")).toMatchObject({
        rows: [],
      });

      const resource = createPostgresAttemptStoreResourceWithExecutor(executor(schema));
      await resource.init();
      expect(await resource.store.getAttemptStoreSnapshot(item.owner, prepared.id)).toMatchObject({
        ok: true,
        value: { attempts: [{ attemptId: `legacy:${prepared.id}:1`, reconciliation: { kind: "ambiguous" } }] },
      });
      expect(await resource.store.claimDispatch({
        ...item.claim,
        actionId: prepared.id,
        reviewHash: prepared.reviewHash,
        providerRequestKey: homeProviderRequestKey({ provider: "cdp-embedded", actionId: prepared.id }),
      }, item.afterVerifiedAt)).toMatchObject({
        ok: true,
        value: { disposition: "recover", authorization: "none" },
      });
      expect(await resource.store.get(item.owner, prepared.id)).toMatchObject({ status: "unknown", attemptCount: 1 });
      expect(await resource.store.get(item.owner, referenced.id)).toMatchObject({
        status: "submitted",
        attemptCount: 1,
        userOperationHash: legacyHash.toLowerCase(),
      });
      expect(await resource.store.getAttemptStoreSnapshot(item.owner, referenced.id)).toMatchObject({
        ok: true,
        value: { attempts: [{ attemptId: `legacy:${referenced.id}:1`, evidence: [] }] },
      });
      expect((await rawExecutor.query("SELECT evidence_key FROM money_action_attempt_evidence")).rows).toHaveLength(1);
      const collision = attemptFixture(111, item.owner);
      const collisionClaim = await issueAndClaim(resource.store, collision);
      expect(await resource.store.recordProviderEvidence({
        owner: item.owner,
        actionId: collision.action.id,
        attemptId: collisionClaim.attempt.attemptId,
        dispatchVersion: 1,
        evidence: {
          kind: "user-operation-hash",
          provider: "cdp-embedded",
          value: legacyHash.toLowerCase() as `0x${string}`,
        },
        provenance: { source: "provider-return", observedAt: collision.evidenceAt },
        writeIdempotencyKey: "migrated-reference-collision",
      }, collision.evidenceAt)).toMatchObject({ ok: false, error: { code: "conflicting-evidence" } });
      await resource.dispose();
    });

    test("process-local sensitive swap overlays fail closed across store instances", async () => {
      const schema = await createSchema("overlay");
      const issuing = new PostgresMoneyActionStore(executor(schema));
      const other = new PostgresMoneyActionStore(executor(schema));
      const item = attemptFixture(109);
      const sensitive: PreparedMoneyAction = {
        ...legacyAction(109, item.owner),
        kind: "swap",
        calls: [{
          to: "0x9999999999999999999999999999999999999999",
          data: "0x1234",
          dataHash: "f".repeat(64),
          value: "0",
        }],
        sensitivePayload: true,
        quoteId: "quote-109",
      };
      const durable: PreparedMoneyAction = {
        ...sensitive,
        calls: sensitive.calls.map((call) => ({ ...call, data: "0x" as const })),
      };
      await issuing.issue(durable, { sensitiveAction: sensitive, sensitivePayloadExpiresAt: item.expiresAt });
      await expect(other.claim(item.owner, durable.id, durable.reviewHash, item.claimedAt)).resolves.toBeNull();
      expect((await other.get(item.owner, durable.id))?.status).toBe("prepared");
      await expect(issuing.claim(item.owner, durable.id, durable.reviewHash, item.claimedAt)).resolves.toMatchObject({
        disposition: "dispatch",
        action: { calls: [{ data: "0x1234" }] },
      });
    });

    test("missing explicit PostgreSQL schemas fail closed before table creation", async () => {
      const missing = schemaName("missing");
      const resource = createPostgresAttemptStoreResourceWithExecutor(
        createBunPostgresExecutor(sharedPool, missing),
      );
      await expect(resource.init()).rejects.toThrow(`PostgreSQL schema ${missing} does not exist`);
      await resource.dispose();
    });

    afterAll(async () => {
      for (const schema of schemas) await admin.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await sharedPool.close();
      await admin.close();
    });
  });
}

function attemptFixture(number: number, ownerOverride?: ReturnType<typeof ownerFor>) {
  const owner = ownerOverride ?? ownerFor(number);
  const id = `a0000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
  const issuedAt = "2026-09-12T16:00:00.000Z";
  const claimedAt = "2026-09-12T16:00:01.000Z";
  const evidenceAt = "2026-09-12T16:00:02.000Z";
  const releasedAt = "2026-09-12T16:00:03.000Z";
  const verifiedAt = "2026-09-12T16:00:04.000Z";
  const afterVerifiedAt = "2026-09-12T16:00:05.000Z";
  const expiresAt = "2026-09-12T16:10:00.000Z";
  const action: PreparedActionRevision = {
    ...legacyAction(number, owner),
    id,
    createdAt: issuedAt,
    expiresAt,
    revision: 1,
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
    releasedAt,
    verifiedAt,
    afterVerifiedAt,
    expiresAt,
    claim: {
      owner,
      actionId: id,
      reviewHash: action.reviewHash,
      expectedActionRevision: 1,
      provider: "cdp-embedded" as const,
      providerRequestKey: homeProviderRequestKey({ provider: "cdp-embedded", actionId: id }),
    },
  };
}

function ownerFor(number: number) {
  return {
    subject: `postgres-owner-${number}`,
    address: `0x${String((number % 8) + 1).repeat(40)}` as `0x${string}`,
    chainId: 8453 as const,
    accountProvider: "cdp-embedded" as const,
  };
}

function legacyAction(number: number, owner = ownerFor(number)): PreparedMoneyAction {
  return {
    id: `b0000000-0000-4000-8000-${String(number).padStart(12, "0")}`,
    reviewHash: String.fromCharCode(97 + (number % 6)).repeat(64),
    owner,
    kind: "send",
    title: "Send USDC",
    calls: [{ to: "0x9999999999999999999999999999999999999999", data: "0x", value: "0" }],
    amounts: [],
    warnings: [],
    createdAt: "2026-09-12T16:00:00.000Z",
    expiresAt: "2026-09-12T16:10:00.000Z",
  };
}

async function issueAndClaim(
  store: ReturnType<typeof createPostgresAttemptStoreResourceWithExecutor>["store"],
  item: ReturnType<typeof attemptFixture>,
) {
  await store.issueAttemptAction({ durableAction: item.action });
  const claimed = await store.claimDispatch(item.claim, item.claimedAt);
  if (!claimed.ok || claimed.value.disposition !== "dispatch") throw new Error("fixture did not dispatch");
  return claimed.value;
}

async function insertRawLegacyOperation(
  executor: SqlExecutor,
  action: PreparedMoneyAction,
  input: Readonly<{
    status: "unknown" | "submitted";
    claimedAt: string;
    updatedAt: string;
    userOperationHash?: `0x${string}`;
  }>,
): Promise<void> {
  await executor.query(moneyActionQueries.insert, [
    action.id,
    action.reviewHash,
    action.owner.subject,
    action.owner.address.toLowerCase(),
    action.owner.chainId,
    action.owner.accountProvider,
    JSON.stringify(action),
    action.createdAt,
    action.createdAt,
  ]);
  await executor.query(`
    UPDATE money_action_operations
    SET status = $1, attempt_count = 1, claimed_at = $2,
        user_operation_hash = $3, updated_at = $4
    WHERE id = $5
  `.trim(), [
    input.status,
    input.claimedAt,
    input.userOperationHash ?? null,
    input.updatedAt,
    action.id,
  ]);
}

function disposableExecutor(client: Bun.SQL, schema: string, onDispose: () => void = () => {}): SqlExecutor {
  const base = createBunPostgresExecutor(client, schema);
  return {
    ...base,
    async dispose() {
      onDispose();
      await client.close();
    },
  };
}

import { afterAll, describe, expect, test } from "bun:test";
import type { PreparedMoneyAction } from "../../../apps/web/features/money-actions/types";
import {
  homeProviderRequestKey,
  type PreparedActionRevision,
} from "../../../apps/web/server/money-actions/attempt-commands";
import { createTrustedVerifiedObservation } from "../../../apps/web/server/money-actions/attempt-store";
import {
  createPostgresAttemptStoreResourceWithExecutor,
  PostgresMoneyActionStore,
} from "../../../apps/web/server/money-actions/postgres-store";
import type { SqlExecutor } from "../../../apps/web/server/money-actions/postgres-sql";
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

    test("legacy migration preserves unresolved identities and never reopens dispatch", async () => {
      const schema = await createSchema("migration");
      const item = attemptFixture(108);
      const legacy = new PostgresMoneyActionStore(executor(schema));
      const prepared = legacyAction(108, item.owner);
      await legacy.issue(prepared);
      await legacy.claim(item.owner, prepared.id, prepared.reviewHash, item.claimedAt);
      await legacy.updateStatus(item.owner, prepared.id, "unknown", item.evidenceAt);
      const referenced = legacyAction(110, item.owner);
      const legacyHash = `0x${"E".repeat(64)}` as const;
      await legacy.issue(referenced);
      await legacy.claim(item.owner, referenced.id, referenced.reviewHash, item.claimedAt);
      await legacy.recordSubmission(item.owner, referenced.id, { userOperationHash: legacyHash }, item.evidenceAt);

      const resource = createPostgresAttemptStoreResourceWithExecutor(executor(schema));
      await resource.init();
      expect(await resource.store.getAttemptStoreSnapshot(item.owner, prepared.id)).toMatchObject({
        ok: true,
        value: { attempts: [{ attemptId: `legacy:${prepared.id}:1`, reconciliation: { kind: "ambiguous" } }] },
      });
      expect(await resource.store.claimDispatch({ ...item.claim, actionId: prepared.id, reviewHash: prepared.reviewHash,
        providerRequestKey: homeProviderRequestKey({ provider: "cdp-embedded", actionId: prepared.id }) }, item.afterVerifiedAt)).toMatchObject({
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
        value: {
          attempts: [{ attemptId: `legacy:${referenced.id}:1`, evidence: [] }],
        },
      });
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

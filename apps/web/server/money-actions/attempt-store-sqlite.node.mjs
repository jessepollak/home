import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { homeProviderRequestKey } from "./attempt-commands.ts";
import { evidenceUniquenessKey } from "./attempt-store-core.ts";
import { createTrustedVerifiedObservation } from "./attempt-store.ts";
import {
  createSqliteAttemptStoreResource,
  isSqliteUniqueViolation,
  SqliteMoneyActionStore,
} from "./sqlite-store.node.ts";

function fixture(number) {
  const owner = {
    subject: `attempt-owner-${number}`,
    address: `0x${String((number % 8) + 1).repeat(40)}`,
    chainId: 8453,
    accountProvider: "cdp-embedded",
  };
  const action = {
    id: `a0000000-0000-4000-8000-${String(number).padStart(12, "0")}`,
    reviewHash: String.fromCharCode(97 + (number % 6)).repeat(64),
    owner,
    kind: "send",
    title: "Send USDC",
    calls: [{ to: "0x9999999999999999999999999999999999999999", data: "0x", value: "0" }],
    amounts: [],
    warnings: [],
    createdAt: "2026-09-11T03:00:00.000Z",
    expiresAt: "2026-09-11T03:10:00.000Z",
    revision: 1,
  };
  return {
    owner,
    action,
    claim: {
      owner,
      actionId: action.id,
      reviewHash: action.reviewHash,
      expectedActionRevision: 1,
      provider: "cdp-embedded",
      providerRequestKey: homeProviderRequestKey({ provider: "cdp-embedded", actionId: action.id }),
    },
    evidence: {
      kind: "user-operation-hash",
      provider: "cdp-embedded",
      value: `0x${String(((number + 3) % 8) + 1).repeat(64)}`,
    },
  };
}

async function withSqlite(run) {
  const directory = mkdtempSync(join(tmpdir(), "home-attempt-store-"));
  const filename = join(directory, "attempts.sqlite");
  try {
    await run(filename);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

async function issueAndClaim(store, item) {
  assert.equal((await store.issueAttemptAction({ durableAction: item.action })).value.disposition, "issued");
  const claimed = await store.claimDispatch(item.claim, "2026-09-11T03:00:01.000Z");
  assert.equal(claimed.ok, true);
  assert.equal(claimed.value.disposition, "dispatch");
  return claimed.value;
}

test("SQLite resource lifecycle fails closed and disposal is idempotent", async () => {
  await withSqlite(async (filename) => {
    const resource = createSqliteAttemptStoreResource({ backend: "sqlite", filename });
    const item = fixture(1);
    assert.equal((await resource.store.getAttemptStoreSnapshot(item.owner, item.action.id)).error.code, "resource-not-initialized");
    await resource.init();
    await resource.dispose();
    await resource.dispose();
    assert.equal((await resource.store.getAttemptStoreSnapshot(item.owner, item.action.id)).error.code, "resource-disposed");
  });
});

test("independent SQLite connections grant one dispatch and recover the same attempt", async () => {
  await withSqlite(async (filename) => {
    const first = createSqliteAttemptStoreResource({ backend: "sqlite", filename });
    const second = createSqliteAttemptStoreResource({ backend: "sqlite", filename });
    await Promise.all([first.init(), second.init()]);
    try {
      const item = fixture(2);
      await first.store.issueAttemptAction({ durableAction: item.action });
      const claims = await Promise.all([
        first.store.claimDispatch(item.claim, "2026-09-11T03:00:01.000Z"),
        second.store.claimDispatch(item.claim, "2026-09-11T03:00:01.000Z"),
      ]);
      assert.deepEqual(claims.map((claim) => claim.value.disposition).sort(), ["dispatch", "recover"]);
      assert.equal(claims[0].value.attempt.attemptId, claims[1].value.attempt.attemptId);
      assert.equal(claims[0].value.attempt.attemptVersion, 1);
    } finally {
      await Promise.all([first.dispose(), second.dispose()]);
    }
  });
});

test("SQLite evidence is idempotent, slot-conflicting, durable, and versioned only for new facts", async () => {
  await withSqlite(async (filename) => {
    const resource = createSqliteAttemptStoreResource({ backend: "sqlite", filename });
    await resource.init();
    const item = fixture(3);
    const claimed = await issueAndClaim(resource.store, item);
    const command = {
      owner: item.owner,
      actionId: item.action.id,
      attemptId: claimed.attempt.attemptId,
      dispatchVersion: claimed.dispatchVersion,
      evidence: item.evidence,
      provenance: { source: "provider-return", observedAt: "2026-09-11T03:00:02.000Z" },
      writeIdempotencyKey: "write-3",
    };
    assert.equal((await resource.store.recordProviderEvidence(command, "2026-09-11T03:00:02.000Z")).value.disposition, "recorded");
    assert.equal((await resource.store.recordProviderEvidence({ ...command, writeIdempotencyKey: "write-3-retry" }, "2026-09-11T03:00:02.000Z")).value.disposition, "duplicate");
    const conflict = await resource.store.recordProviderEvidence({
      ...command,
      evidence: { ...item.evidence, value: `0x${"f".repeat(64)}` },
      writeIdempotencyKey: "write-3-conflict",
    }, "2026-09-11T03:00:03.000Z");
    assert.deepEqual(conflict.value.disposition, "conflict");
    assert.equal((await resource.store.getAttemptStoreSnapshot(item.owner, item.action.id)).value.attempts[0].attemptVersion, 2);
    await resource.dispose();

    const reopened = createSqliteAttemptStoreResource({ backend: "sqlite", filename });
    await reopened.init();
    assert.equal((await reopened.store.getAttemptStoreSnapshot(item.owner, item.action.id)).value.attempts[0].evidence.length, 1);
    await reopened.dispose();
  });
});

test("SQLite release/evidence races preserve both and accept late evidence", async () => {
  await withSqlite(async (filename) => {
    const resource = createSqliteAttemptStoreResource({ backend: "sqlite", filename });
    await resource.init();
    const item = fixture(4);
    const claimed = await issueAndClaim(resource.store, item);
    const evidenceCommand = {
      owner: item.owner,
      actionId: item.action.id,
      attemptId: claimed.attempt.attemptId,
      dispatchVersion: 1,
      evidence: item.evidence,
      provenance: { source: "provider-return", observedAt: "2026-09-11T03:00:02.000Z" },
      writeIdempotencyKey: "write-4",
    };
    const releaseCommand = {
      owner: item.owner,
      actionId: item.action.id,
      attemptId: claimed.attempt.attemptId,
      policyVersion: "owner-release-v1",
      reason: "owner-request",
    };
    const outcomes = await Promise.all([
      resource.store.recordProviderEvidence(evidenceCommand, "2026-09-11T03:00:02.000Z"),
      resource.store.releaseAttemptAdmission(releaseCommand, "2026-09-11T03:00:03.000Z"),
    ]);
    assert.equal(outcomes.every((outcome) => outcome.ok), true);
    const late = await resource.store.recordProviderEvidence({
      ...evidenceCommand,
      evidence: { kind: "transaction-hash", chainId: 8453, value: `0x${"e".repeat(64)}` },
      provenance: { source: "verified-receipt", observedAt: "2026-09-11T03:00:04.000Z" },
      writeIdempotencyKey: "write-4-late",
    }, "2026-09-11T03:00:04.000Z");
    assert.equal(late.value.disposition, "recorded");
    const attempt = (await resource.store.getAttemptStoreSnapshot(item.owner, item.action.id)).value.attempts[0];
    assert.equal(attempt.admission.state, "released");
    assert.equal(attempt.ownerResolution.kind, "abandoned");
    assert.equal(attempt.evidence.length, 2);
    await resource.dispose();
  });
});

test("SQLite init losslessly backfills legacy terminal rows and keeps them non-dispatchable", async () => {
  await withSqlite(async (filename) => {
    const item = fixture(6);
    const legacy = new SqliteMoneyActionStore(filename);
    const legacyAction = { ...item.action };
    delete legacyAction.revision;
    await legacy.issue(legacyAction);
    await legacy.claim(item.owner, item.action.id, item.action.reviewHash, "2026-09-11T03:00:01.000Z");
    await legacy.recordSubmission(item.owner, item.action.id, {
      userOperationHash: item.evidence.value,
    }, "2026-09-11T03:00:02.000Z");
    await legacy.updateStatus(item.owner, item.action.id, "confirmed", "2026-09-11T03:00:03.000Z", {
      verifiedExecution: { chainId: 8453, kind: "user-operation", hash: item.evidence.value },
    });
    legacy.close();

    const resource = createSqliteAttemptStoreResource({ backend: "sqlite", filename });
    await resource.init();
    const snapshot = await resource.store.getAttemptStoreSnapshot(item.owner, item.action.id);
    assert.equal(snapshot.value.attempts[0].attemptId, `legacy:${item.action.id}:1`);
    assert.equal(snapshot.value.attempts[0].dispatch.phase, "closed");
    const claim = await resource.store.claimDispatch(item.claim, "2026-09-11T03:00:04.000Z");
    assert.equal(claim.value.disposition, "terminal");
    assert.equal(claim.value.authorization, "none");
    await resource.dispose();
  });
});

test("SQLite transactionally rejects stale observations and reserves verified execution identity", async () => {
  await withSqlite(async (filename) => {
    const resource = createSqliteAttemptStoreResource({ backend: "sqlite", filename });
    await resource.init();
    const item = fixture(5);
    const claimed = await issueAndClaim(resource.store, item);
    const command = {
      owner: item.owner,
      actionId: item.action.id,
      attemptId: claimed.attempt.attemptId,
      dispatchVersion: 1,
      evidence: item.evidence,
      provenance: { source: "provider-return", observedAt: "2026-09-11T03:00:02.000Z" },
      writeIdempotencyKey: "write-5",
    };
    const first = await resource.store.recordProviderEvidence(command, "2026-09-11T03:00:02.000Z");
    await resource.store.recordProviderEvidence({
      ...command,
      evidence: { kind: "transaction-hash", chainId: 8453, value: `0x${"d".repeat(64)}` },
      provenance: { source: "verified-receipt", observedAt: "2026-09-11T03:00:03.000Z" },
      writeIdempotencyKey: "write-5-newer",
    }, "2026-09-11T03:00:03.000Z");
    const observation = createTrustedVerifiedObservation({
      owner: item.owner,
      actionId: item.action.id,
      attemptId: claimed.attempt.attemptId,
      expectedAttemptVersion: 2,
      expectedDispatchVersion: 1,
      expectedEvidence: { evidence: first.value.evidence, comparison: "exact-recorded-fact" },
      verificationLookup: { kind: "user-operation-hash", provider: "cdp-embedded", value: item.evidence.value },
      verifiedExecution: { chainId: 8453, kind: "user-operation", hash: item.evidence.value },
      result: { kind: "confirmed", transactionHash: `0x${"d".repeat(64)}`, verifiedExecution: true },
      observedAt: "2026-09-11T03:00:04.000Z",
    });
    const stale = await resource.store.applyVerifiedObservation(observation);
    assert.equal(stale.error.code, "attempt-version-mismatch");
    const snapshot = await resource.store.getAttemptStoreSnapshot(item.owner, item.action.id);
    assert.equal(snapshot.value.attempts[0].reconciliation.kind, "authorized-no-evidence");
    await resource.dispose();
  });
});


test("SQLite revalidates trusted observation binding inside the apply transaction", async () => {
  await withSqlite(async (filename) => {
    const resource = createSqliteAttemptStoreResource({ backend: "sqlite", filename });
    await resource.init();
    const item = fixture(10);
    const claimed = await issueAndClaim(resource.store, item);
    const recorded = await resource.store.recordProviderEvidence({
      owner: item.owner,
      actionId: item.action.id,
      attemptId: claimed.attempt.attemptId,
      dispatchVersion: 1,
      evidence: item.evidence,
      provenance: { source: "provider-return", observedAt: "2026-09-11T03:00:02.000Z" },
      writeIdempotencyKey: "binding-write",
    }, "2026-09-11T03:00:02.000Z");
    const transactionHash = `0x${"d".repeat(64)}`;
    const trusted = createTrustedVerifiedObservation({
      owner: item.owner,
      actionId: item.action.id,
      attemptId: claimed.attempt.attemptId,
      expectedAttemptVersion: 2,
      expectedDispatchVersion: 1,
      expectedEvidence: { evidence: recorded.value.evidence, comparison: "exact-recorded-fact" },
      verificationLookup: { kind: "user-operation-hash", provider: "cdp-embedded", value: item.evidence.value },
      verifiedExecution: { chainId: 8453, kind: "user-operation", hash: item.evidence.value },
      result: { kind: "confirmed", transactionHash, verifiedExecution: true },
      observedAt: "2026-09-11T03:00:03.000Z",
    });
    const tampered = {
      ...trusted,
      verificationLookup: {
        kind: "user-operation-hash",
        provider: "cdp-embedded",
        value: `0x${"e".repeat(64)}`,
      },
      verifiedExecution: { chainId: 8453, kind: "user-operation", hash: `0x${"f".repeat(64)}` },
    };
    const rejected = await resource.store.applyVerifiedObservation(tampered);
    assert.equal(rejected.error.code, "invalid-command");
    assert.equal((await resource.store.get(item.owner, item.action.id)).status, "submitted");
    await resource.dispose();
  });
});

test("SQLite keeps verified execution reservations permanent and globally unique", async () => {
  await withSqlite(async (filename) => {
    const resource = createSqliteAttemptStoreResource({ backend: "sqlite", filename });
    await resource.init();
    const first = fixture(11);
    const claimed = await issueAndClaim(resource.store, first);
    const transactionHash = `0x${"a".repeat(64)}`;
    const recorded = await resource.store.recordProviderEvidence({
      owner: first.owner,
      actionId: first.action.id,
      attemptId: claimed.attempt.attemptId,
      dispatchVersion: 1,
      evidence: { kind: "transaction-hash", chainId: 8453, value: transactionHash },
      provenance: { source: "verified-receipt", observedAt: "2026-09-11T03:00:02.000Z" },
      writeIdempotencyKey: "permanent-tx",
    }, "2026-09-11T03:00:02.000Z");
    const userOperationOne = `0x${"b".repeat(64)}`;
    const firstObservation = createTrustedVerifiedObservation({
      owner: first.owner,
      actionId: first.action.id,
      attemptId: claimed.attempt.attemptId,
      expectedAttemptVersion: 2,
      expectedDispatchVersion: 1,
      expectedEvidence: { evidence: recorded.value.evidence, comparison: "exact-recorded-fact" },
      verificationLookup: { kind: "transaction-hash", chainId: 8453, value: transactionHash },
      verifiedExecution: { chainId: 8453, kind: "user-operation", hash: userOperationOne },
      result: { kind: "confirmed", transactionHash, verifiedExecution: true },
      observedAt: "2026-09-11T03:00:03.000Z",
    });
    assert.equal((await resource.store.applyVerifiedObservation(firstObservation)).value.kind, "projected");
    assert.equal((await resource.store.applyVerifiedObservation(firstObservation)).value.kind, "unchanged");

    const replacement = createTrustedVerifiedObservation({
      ...firstObservation,
      expectedAttemptVersion: 3,
      verifiedExecution: { chainId: 8453, kind: "user-operation", hash: `0x${"c".repeat(64)}` },
    });
    assert.equal((await resource.store.applyVerifiedObservation(replacement)).error.code, "verified-execution-conflict");

    const second = fixture(12);
    const secondClaim = await issueAndClaim(resource.store, second);
    const secondTransaction = `0x${"d".repeat(64)}`;
    const secondEvidence = await resource.store.recordProviderEvidence({
      owner: second.owner,
      actionId: second.action.id,
      attemptId: secondClaim.attempt.attemptId,
      dispatchVersion: 1,
      evidence: { kind: "transaction-hash", chainId: 8453, value: secondTransaction },
      provenance: { source: "verified-receipt", observedAt: "2026-09-11T03:00:04.000Z" },
      writeIdempotencyKey: "permanent-second-tx",
    }, "2026-09-11T03:00:04.000Z");
    const reused = createTrustedVerifiedObservation({
      owner: second.owner,
      actionId: second.action.id,
      attemptId: secondClaim.attempt.attemptId,
      expectedAttemptVersion: 2,
      expectedDispatchVersion: 1,
      expectedEvidence: { evidence: secondEvidence.value.evidence, comparison: "exact-recorded-fact" },
      verificationLookup: { kind: "transaction-hash", chainId: 8453, value: secondTransaction },
      verifiedExecution: { chainId: 8453, kind: "user-operation", hash: userOperationOne },
      result: { kind: "confirmed", transactionHash: secondTransaction, verifiedExecution: true },
      observedAt: "2026-09-11T03:00:05.000Z",
    });
    assert.equal((await resource.store.applyVerifiedObservation(reused)).error.code, "verified-execution-conflict");
    await resource.dispose();
  });
});

test("SQLite legacy references remain unknown-provenance reservations for attempt writes", async () => {
  await withSqlite(async (filename) => {
    const resource = createSqliteAttemptStoreResource({ backend: "sqlite", filename });
    await resource.init();
    const legacyItem = fixture(13);
    const legacyAction = { ...legacyItem.action };
    delete legacyAction.revision;
    await resource.store.issue(legacyAction);
    await resource.store.claim(legacyItem.owner, legacyAction.id, legacyAction.reviewHash, "2026-09-11T03:00:01.000Z");
    await resource.store.recordSubmission(legacyItem.owner, legacyAction.id, {
      userOperationHash: legacyItem.evidence.value,
    }, "2026-09-11T03:00:02.000Z");
    const migrated = await resource.store.getAttemptStoreSnapshot(legacyItem.owner, legacyAction.id);
    const legacyAttempt = migrated.value.attempts[0];
    const sameActionConflict = await resource.store.recordProviderEvidence({
      owner: legacyItem.owner,
      actionId: legacyAction.id,
      attemptId: legacyAttempt.attemptId,
      dispatchVersion: 1,
      evidence: { ...legacyItem.evidence, value: `0x${"f".repeat(64)}` },
      provenance: { source: "provider-return", observedAt: "2026-09-11T03:00:03.000Z" },
      writeIdempotencyKey: "legacy-conflict",
    }, "2026-09-11T03:00:03.000Z");
    assert.equal(sameActionConflict.error.code, "conflicting-evidence");

    const modern = fixture(14);
    modern.owner = legacyItem.owner;
    modern.action.owner = legacyItem.owner;
    modern.claim.owner = legacyItem.owner;
    const modernClaim = await issueAndClaim(resource.store, modern);
    const crossActionConflict = await resource.store.recordProviderEvidence({
      owner: legacyItem.owner,
      actionId: modern.action.id,
      attemptId: modernClaim.attempt.attemptId,
      dispatchVersion: 1,
      evidence: legacyItem.evidence,
      provenance: { source: "provider-return", observedAt: "2026-09-11T03:00:04.000Z" },
      writeIdempotencyKey: "legacy-cross-action",
    }, "2026-09-11T03:00:04.000Z");
    assert.equal(crossActionConflict.error.code, "conflicting-evidence");
    assert.equal(migrated.value.attempts[0].evidence.length, 0);
    await resource.dispose();
  });
});

test("SQLite deduplicates handle reservations and accepts monotonic provider status", async () => {
  await withSqlite(async (filename) => {
    const resource = createSqliteAttemptStoreResource({ backend: "sqlite", filename });
    await resource.init();
    const item = fixture(15);
    const claimed = await issueAndClaim(resource.store, item);
    const base = {
      owner: item.owner,
      actionId: item.action.id,
      attemptId: claimed.attempt.attemptId,
      dispatchVersion: 1,
    };
    await resource.store.recordProviderEvidence({
      ...base,
      evidence: item.evidence,
      provenance: { source: "provider-return", observedAt: "2026-09-11T03:00:02.000Z" },
      writeIdempotencyKey: "status-handle",
    }, "2026-09-11T03:00:02.000Z");
    const pending = {
      kind: "provider-status",
      handle: item.evidence,
      observedAt: "2026-09-11T03:00:03.000Z",
      payload: "pending",
    };
    assert.equal((await resource.store.recordProviderEvidence({
      ...base,
      evidence: pending,
      provenance: { source: "provider-status-lookup", observedAt: pending.observedAt, locator: item.evidence },
      writeIdempotencyKey: "status-pending",
    }, pending.observedAt)).value.disposition, "recorded");
    const confirmed = { ...pending, observedAt: "2026-09-11T03:00:04.000Z", payload: "confirmed" };
    assert.equal((await resource.store.recordProviderEvidence({
      ...base,
      evidence: confirmed,
      provenance: { source: "provider-status-lookup", observedAt: confirmed.observedAt, locator: item.evidence },
      writeIdempotencyKey: "status-confirmed",
    }, confirmed.observedAt)).value.disposition, "recorded");
    assert.equal((await resource.store.getAttemptStoreSnapshot(item.owner, item.action.id)).value.attempts[0].attemptVersion, 4);
    await resource.dispose();
  });
});

test("SQLite reconciliation preserves verified terminal outcomes", async () => {
  await withSqlite(async (filename) => {
    const resource = createSqliteAttemptStoreResource({ backend: "sqlite", filename });
    await resource.init();
    const item = fixture(16);
    const claimed = await issueAndClaim(resource.store, item);
    const recorded = await resource.store.recordProviderEvidence({
      owner: item.owner,
      actionId: item.action.id,
      attemptId: claimed.attempt.attemptId,
      dispatchVersion: 1,
      evidence: item.evidence,
      provenance: { source: "provider-return", observedAt: "2026-09-11T03:00:02.000Z" },
      writeIdempotencyKey: "terminal-evidence",
    }, "2026-09-11T03:00:02.000Z");
    const transactionHash = `0x${"e".repeat(64)}`;
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
      observedAt: "2026-09-11T03:00:03.000Z",
    });
    const applied = await resource.store.applyVerifiedObservation(observation);
    const reconciled = await resource.store.reconcileAttempt({
      owner: item.owner,
      actionId: item.action.id,
      attemptId: claimed.attempt.attemptId,
      expectedAttemptVersion: applied.value.attempt.attemptVersion,
      lookup: { kind: "recorded-user-operation-hash", userOperationHash: item.evidence.value },
    });
    assert.equal(reconciled.value.kind, "unchanged");
    assert.equal(reconciled.value.attempt.reconciliation.kind, "confirmed");
    await resource.dispose();
  });
});

test("SQLite serializes legacy and attempt APIs without event-loop lock blocking", async () => {
  await withSqlite(async (filename) => {
    const first = createSqliteAttemptStoreResource({ backend: "sqlite", filename });
    const second = createSqliteAttemptStoreResource({ backend: "sqlite", filename });
    await Promise.all([first.init(), second.init()]);
    const item = fixture(17);
    await first.store.issueAttemptAction({ durableAction: item.action });
    const started = Date.now();
    const [attemptClaim, legacyClaim] = await Promise.all([
      first.store.claimDispatch(item.claim, "2026-09-11T03:00:01.000Z"),
      second.store.claim(item.owner, item.action.id, item.action.reviewHash, "2026-09-11T03:00:02.000Z"),
    ]);
    assert.deepEqual(
      [attemptClaim.value.disposition, legacyClaim.disposition].sort(),
      ["dispatch", "recover"],
    );
    assert.ok(Date.now() - started < 1_000);
    await Promise.all([first.dispose(), second.dispose()]);
  });
});

test("evidence keys are SQL-safe and SQLite recognizes real primary-key errors", async () => {
  const item = fixture(18);
  const key = evidenceUniquenessKey(item.owner, item.evidence);
  assert.equal(key.includes("\u0000"), false);
  assert.equal(Array.isArray(JSON.parse(key)), true);
  await withSqlite(async (filename) => {
    const database = new DatabaseSync(filename);
    database.exec("CREATE TABLE unique_probe (id TEXT PRIMARY KEY)");
    database.prepare("INSERT INTO unique_probe (id) VALUES (?)").run("same");
    let duplicate;
    try {
      database.prepare("INSERT INTO unique_probe (id) VALUES (?)").run("same");
    } catch (error) {
      duplicate = error;
    } finally {
      database.close();
    }
    assert.equal(isSqliteUniqueViolation(duplicate), true);
  });
});

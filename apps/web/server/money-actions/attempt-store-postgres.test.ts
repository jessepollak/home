import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { homeProviderRequestKey, type PreparedActionRevision } from "./attempt-commands";
import { evidenceUniquenessKey } from "./attempt-store-core";
import { createTrustedVerifiedObservation } from "./attempt-store";
import { createPostgresAttemptStoreResourceWithExecutor } from "./postgres-store";
import { createFakePostgresExecutor } from "./postgres-sql";

function fixture(number: number) {
  const owner = {
    subject: `postgres-attempt-owner-${number}`,
    address: `0x${String((number % 8) + 1).repeat(40)}` as `0x${string}`,
    chainId: 8453 as const,
    accountProvider: "cdp-embedded" as const,
  };
  const action: PreparedActionRevision = {
    id: `b0000000-0000-4000-8000-${String(number).padStart(12, "0")}`,
    reviewHash: "a".repeat(64),
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
      provider: "cdp-embedded" as const,
      providerRequestKey: homeProviderRequestKey({ provider: "cdp-embedded", actionId: action.id }),
    },
  };
}

async function issueAndClaim(
  store: ReturnType<typeof createPostgresAttemptStoreResourceWithExecutor>["store"],
  item: ReturnType<typeof fixture>,
) {
  await store.issueAttemptAction({ durableAction: item.action });
  const claimed = await store.claimDispatch(item.claim, "2026-09-11T03:00:01.000Z");
  if (!claimed.ok || claimed.value.disposition !== "dispatch") throw new Error("fixture did not dispatch");
  return claimed.value;
}

test("PostgreSQL attempt adapter binds lifecycle, claim CAS, evidence, and legacy projection", async () => {
  const resource = createPostgresAttemptStoreResourceWithExecutor(createFakePostgresExecutor());
  const item = fixture(1);
  expect(await resource.store.issueAttemptAction({ durableAction: item.action })).toMatchObject({
    ok: false,
    error: { code: "resource-not-initialized" },
  });
  await resource.init();
  expect(await resource.store.issueAttemptAction({ durableAction: item.action })).toMatchObject({
    ok: true,
    value: { disposition: "issued" },
  });
  const [first, second] = await Promise.all([
    resource.store.claimDispatch(item.claim, "2026-09-11T03:00:01.000Z"),
    resource.store.claimDispatch(item.claim, "2026-09-11T03:00:01.000Z"),
  ]);
  expect([first, second].map((claim) => claim.ok ? claim.value.disposition : "error").sort()).toEqual(["dispatch", "recover"]);
  if (!first.ok || !second.ok || !first.value.attempt || !second.value.attempt) throw new Error("claims failed");
  expect(first.value.attempt.attemptId).toBe(second.value.attempt.attemptId);

  const dispatch = first.value.disposition === "dispatch" ? first.value : second.value;
  if (dispatch.disposition !== "dispatch") throw new Error("dispatch missing");
  const hash = `0x${"d".repeat(64)}` as const;
  expect(await resource.store.recordProviderEvidence({
    owner: item.owner,
    actionId: item.action.id,
    attemptId: dispatch.attempt.attemptId,
    dispatchVersion: dispatch.dispatchVersion,
    evidence: { kind: "user-operation-hash", provider: "cdp-embedded", value: hash },
    provenance: { source: "provider-return", observedAt: "2026-09-11T03:00:02.000Z" },
    writeIdempotencyKey: "postgres-write-1",
  }, "2026-09-11T03:00:02.000Z")).toMatchObject({ ok: true, value: { disposition: "recorded" } });
  expect(await resource.store.get(item.owner, item.action.id)).toMatchObject({
    status: "submitted",
    userOperationHash: hash,
    attemptCount: 1,
  });
  await resource.dispose();
  expect(await resource.store.getAttemptStoreSnapshot(item.owner, item.action.id)).toMatchObject({
    ok: false,
    error: { code: "resource-disposed" },
  });
});


test("PostgreSQL issuance is conflict-safe and evidence keys are text-safe", async () => {
  const resource = createPostgresAttemptStoreResourceWithExecutor(createFakePostgresExecutor());
  await resource.init();
  const item = fixture(20);
  const outcomes = await Promise.all([
    resource.store.issueAttemptAction({ durableAction: item.action }),
    resource.store.issueAttemptAction({ durableAction: item.action }),
  ]);
  expect(outcomes.map((outcome) => outcome.ok ? outcome.value.disposition : "error").sort()).toEqual(["existing", "issued"]);
  const key = evidenceUniquenessKey(item.owner, {
    kind: "user-operation-hash",
    provider: "cdp-embedded",
    value: `0x${"a".repeat(64)}`,
  });
  expect(key).not.toContain("\u0000");
  expect(JSON.parse(key!)).toBeArray();
  const source = readFileSync(new URL("./postgres-store.ts", import.meta.url), "utf8");
  expect(source).toContain("ON CONFLICT (id) DO NOTHING");
  await resource.dispose();
});

test("fake PostgreSQL matches reservation uniqueness and provider-status advancement", async () => {
  const executor = createFakePostgresExecutor();
  const resource = createPostgresAttemptStoreResourceWithExecutor(executor);
  await resource.init();
  const item = fixture(21);
  const claimed = await issueAndClaim(resource.store, item);
  const handle = {
    kind: "user-operation-hash" as const,
    provider: "cdp-embedded" as const,
    value: `0x${"b".repeat(64)}` as const,
  };
  await resource.store.recordProviderEvidence({
    owner: item.owner,
    actionId: item.action.id,
    attemptId: claimed.attempt.attemptId,
    dispatchVersion: 1,
    evidence: handle,
    provenance: { source: "provider-return", observedAt: "2026-09-11T03:00:02.000Z" },
    writeIdempotencyKey: "pg-status-handle",
  }, "2026-09-11T03:00:02.000Z");
  for (const [payload, observedAt] of [["pending", "2026-09-11T03:00:03.000Z"], ["confirmed", "2026-09-11T03:00:04.000Z"]] as const) {
    const evidence = { kind: "provider-status" as const, handle, observedAt, payload };
    expect(await resource.store.recordProviderEvidence({
      owner: item.owner,
      actionId: item.action.id,
      attemptId: claimed.attempt.attemptId,
      dispatchVersion: 1,
      evidence,
      provenance: { source: "provider-status-lookup", observedAt, locator: handle },
      writeIdempotencyKey: `pg-status-${payload}`,
    }, observedAt)).toMatchObject({ ok: true, value: { disposition: "recorded" } });
  }
  expect(await executor.query(
    "INSERT INTO money_action_attempt_evidence (evidence_key, action_id) VALUES ($1, $2)",
    ["duplicate-probe", item.action.id],
  )).toMatchObject({ rowCount: 1 });
  await expect(executor.query(
    "INSERT INTO money_action_attempt_evidence (evidence_key, action_id) VALUES ($1, $2)",
    ["duplicate-probe", item.action.id],
  )).rejects.toMatchObject({ code: "23505" });
  await resource.dispose();
});

test("fake PostgreSQL rejects tampered apply bindings and preserves terminal reservations", async () => {
  const resource = createPostgresAttemptStoreResourceWithExecutor(createFakePostgresExecutor());
  await resource.init();
  const item = fixture(22);
  const claimed = await issueAndClaim(resource.store, item);
  const transactionHash = `0x${"c".repeat(64)}` as const;
  const recorded = await resource.store.recordProviderEvidence({
    owner: item.owner,
    actionId: item.action.id,
    attemptId: claimed.attempt.attemptId,
    dispatchVersion: 1,
    evidence: { kind: "transaction-hash", chainId: 8453, value: transactionHash },
    provenance: { source: "verified-receipt", observedAt: "2026-09-11T03:00:02.000Z" },
    writeIdempotencyKey: "pg-verified-tx",
  }, "2026-09-11T03:00:02.000Z");
  if (!recorded.ok || recorded.value.disposition !== "recorded") throw new Error("evidence failed");
  const executionHash = `0x${"d".repeat(64)}` as const;
  const observation = createTrustedVerifiedObservation({
    owner: item.owner,
    actionId: item.action.id,
    attemptId: claimed.attempt.attemptId,
    expectedAttemptVersion: 2,
    expectedDispatchVersion: 1,
    expectedEvidence: { evidence: recorded.value.evidence, comparison: "exact-recorded-fact" },
    verificationLookup: { kind: "transaction-hash", chainId: 8453, value: transactionHash },
    verifiedExecution: { chainId: 8453, kind: "user-operation", hash: executionHash },
    result: { kind: "confirmed", transactionHash, verifiedExecution: true },
    observedAt: "2026-09-11T03:00:03.000Z",
  });
  expect(await resource.store.applyVerifiedObservation({
    ...observation,
    verificationLookup: { kind: "transaction-hash", chainId: 8453, value: `0x${"e".repeat(64)}` },
  })).toMatchObject({ ok: false, error: { code: "invalid-command" } });
  const applied = await resource.store.applyVerifiedObservation(observation);
  expect(applied).toMatchObject({ ok: true, value: { kind: "projected", result: { kind: "confirmed" } } });
  if (!applied.ok || applied.value.kind === "conflict") throw new Error("apply failed");
  expect(await resource.store.reconcileAttempt({
    owner: item.owner,
    actionId: item.action.id,
    attemptId: claimed.attempt.attemptId,
    expectedAttemptVersion: applied.value.attempt.attemptVersion,
    lookup: { kind: "recorded-transaction-hash", transactionHash },
  })).toMatchObject({ ok: true, value: { kind: "unchanged", attempt: { reconciliation: { kind: "confirmed" } } } });
  expect(await resource.store.applyVerifiedObservation(createTrustedVerifiedObservation({
    ...observation,
    expectedAttemptVersion: applied.value.attempt.attemptVersion,
    verifiedExecution: { chainId: 8453, kind: "user-operation", hash: `0x${"f".repeat(64)}` },
  }))).toMatchObject({ ok: false, error: { code: "verified-execution-conflict" } });
  await resource.dispose();
});

test("explicit PostgreSQL schemas are existence-checked and never fall back to public", () => {
  const source = readFileSync(new URL("./postgres-sql.ts", import.meta.url), "utf8");
  expect(source).toContain('SELECT 1 FROM pg_namespace WHERE nspname = $1');
  expect(source).toContain('SET LOCAL search_path TO ${schema}`');
  expect(source).not.toContain('SET LOCAL search_path TO ${schema}, public');
});


test("fake PostgreSQL enforces legacy reference reservations without creating evidence provenance", async () => {
  const resource = createPostgresAttemptStoreResourceWithExecutor(createFakePostgresExecutor());
  await resource.init();
  const legacy = fixture(23);
  const legacyAction = structuredClone(legacy.action) as Omit<typeof legacy.action, "revision"> & { revision?: number };
  delete legacyAction.revision;
  await resource.store.issue(legacyAction);
  await resource.store.claim(legacy.owner, legacyAction.id, legacyAction.reviewHash, "2026-09-11T03:00:01.000Z");
  const legacyHash = `0x${"a".repeat(64)}` as const;
  await resource.store.recordSubmission(legacy.owner, legacyAction.id, {
    userOperationHash: legacyHash,
  }, "2026-09-11T03:00:02.000Z");
  const snapshot = await resource.store.getAttemptStoreSnapshot(legacy.owner, legacyAction.id);
  if (!snapshot.ok) throw new Error("legacy migration failed");
  expect(snapshot.value.attempts[0]?.evidence).toEqual([]);
  expect(await resource.store.recordProviderEvidence({
    owner: legacy.owner,
    actionId: legacyAction.id,
    attemptId: snapshot.value.attempts[0]!.attemptId,
    dispatchVersion: 1,
    evidence: { kind: "user-operation-hash", provider: "cdp-embedded", value: `0x${"b".repeat(64)}` },
    provenance: { source: "provider-return", observedAt: "2026-09-11T03:00:03.000Z" },
    writeIdempotencyKey: "pg-legacy-same-action",
  }, "2026-09-11T03:00:03.000Z")).toMatchObject({ ok: false, error: { code: "conflicting-evidence" } });

  const modernBase = fixture(24);
  const modern = {
    ...modernBase,
    owner: legacy.owner,
    action: { ...modernBase.action, owner: legacy.owner },
    claim: { ...modernBase.claim, owner: legacy.owner },
  };
  const claimed = await issueAndClaim(resource.store, modern);
  expect(await resource.store.recordProviderEvidence({
    owner: legacy.owner,
    actionId: modern.action.id,
    attemptId: claimed.attempt.attemptId,
    dispatchVersion: 1,
    evidence: { kind: "user-operation-hash", provider: "cdp-embedded", value: legacyHash },
    provenance: { source: "provider-return", observedAt: "2026-09-11T03:00:04.000Z" },
    writeIdempotencyKey: "pg-legacy-cross-action",
  }, "2026-09-11T03:00:04.000Z")).toMatchObject({ ok: false, error: { code: "conflicting-evidence" } });
  await resource.dispose();
});

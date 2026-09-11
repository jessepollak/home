import { expect, test } from "bun:test";
import { homeProviderRequestKey, type PreparedActionRevision } from "./attempt-commands";
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

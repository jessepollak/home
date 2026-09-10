import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteMoneyActionStore } from "../apps/web/server/money-actions/sqlite-store.node.ts";

const directory = mkdtempSync(join(tmpdir(), "home-money-actions-"));
try {
  const store = new SqliteMoneyActionStore(join(directory, "operations.sqlite"));
  const owner = { subject: "subject-probe", address: "0x1111111111111111111111111111111111111111", chainId: 8453, accountProvider: "cdp-embedded" };
  const action = {
    id: "11111111-1111-4111-8111-111111111111",
    reviewHash: "a".repeat(64),
    owner,
    kind: "send",
    title: "Send USDC",
    calls: [{ to: "0x2222222222222222222222222222222222222222", data: "0x", value: "1" }],
    amounts: [{ assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "1", direction: "spend" }],
    warnings: ["probe"],
    createdAt: "2026-09-08T05:00:00.000Z",
    expiresAt: "2026-09-08T05:10:00.000Z",
  };
  await store.issue(action);
  const first = await store.claim(owner, action.id, action.reviewHash, "2026-09-08T05:01:00.000Z");
  const second = await store.claim(owner, action.id, action.reviewHash, "2026-09-08T05:01:01.000Z");
  assert.equal(first.disposition, "dispatch");
  assert.equal(second.disposition, "recover");
  assert.equal(second.operation.attemptCount, 1);

  const bundledTransactionHash = `0x${"c".repeat(64)}`;
  await store.recordSubmission(
    owner,
    action.id,
    {
      transactionHash: bundledTransactionHash,
      userOperationHash: `0x${"b".repeat(64)}`,
    },
    "2026-09-08T05:01:02.000Z",
  );
  await Promise.all([
    store.updateStatus(owner, action.id, "confirmed", "2026-09-08T05:01:03.000Z", {
      verifiedExecution: {
        chainId: 8453,
        kind: "user-operation",
        hash: `0x${"b".repeat(64)}`,
      },
    }),
    store.updateStatus(owner, action.id, "unknown", "2026-09-08T05:01:04.000Z"),
  ]);
  assert.equal((await store.get(owner, action.id)).status, "confirmed");

  const bundled = { ...action, id: "22222222-2222-4222-8222-222222222222" };
  await store.issue(bundled);
  await store.claim(owner, bundled.id, bundled.reviewHash, "2026-09-08T05:02:00.000Z");
  assert.ok(await store.recordSubmission(
    owner,
    bundled.id,
    {
      transactionHash: bundledTransactionHash,
      userOperationHash: `0x${"d".repeat(64)}`,
    },
    "2026-09-08T05:02:01.000Z",
  ));
  assert.ok(await store.updateStatus(owner, bundled.id, "confirmed", "2026-09-08T05:02:02.000Z", {
    verifiedExecution: {
      chainId: 8453,
      kind: "user-operation",
      hash: `0x${"d".repeat(64)}`,
    },
  }));

  const replay = { ...action, id: "33333333-3333-4333-8333-333333333333" };
  await store.issue(replay);
  await store.claim(owner, replay.id, replay.reviewHash, "2026-09-08T05:03:00.000Z");
  assert.equal(await store.updateStatus(owner, replay.id, "confirmed", "2026-09-08T05:03:01.000Z", {
    verifiedExecution: {
      chainId: 8453,
      kind: "user-operation",
      hash: `0x${"b".repeat(64)}`,
    },
  }), null);
  const abandon = { ...action, id: "44444444-4444-4444-8444-444444444444" };
  await store.issue(abandon);
  await store.claim(owner, abandon.id, abandon.reviewHash, "2026-09-08T05:04:00.000Z");
  const abandoned = await store.releaseAdmission(owner, abandon.id, "2026-09-08T05:04:30.000Z");
  assert.equal(abandoned.status, "submitting");
  assert.equal(abandoned.abandonedAt, "2026-09-08T05:04:30.000Z");
  assert.equal(
    (await store.list(owner, 10, "unresolved-send")).some((operation) => operation.action.id === abandon.id),
    false,
  );
  const lateHash = `0x${"e".repeat(64)}`;
  const lateTx = `0x${"f".repeat(64)}`;
  const attached = await store.recordSubmission(
    owner,
    abandon.id,
    { userOperationHash: lateHash, transactionHash: lateTx },
    "2026-09-08T05:04:40.000Z",
  );
  assert.equal(attached.status, "submitted");
  assert.equal(attached.abandonedAt, "2026-09-08T05:04:30.000Z");
  const reconciled = await store.updateStatus(owner, abandon.id, "confirmed", "2026-09-08T05:04:41.000Z", {
    verifiedExecution: { chainId: 8453, kind: "user-operation", hash: lateHash },
  });
  assert.equal(reconciled.status, "confirmed");
  assert.equal(reconciled.abandonedAt, "2026-09-08T05:04:30.000Z");

  const unknown = { ...action, id: "55555555-5555-4555-8555-555555555555" };
  await store.issue(unknown);
  await store.claim(owner, unknown.id, unknown.reviewHash, "2026-09-08T05:05:00.000Z");
  await store.updateStatus(owner, unknown.id, "unknown", "2026-09-08T05:05:01.000Z");
  const recovered = await store.claim(owner, unknown.id, unknown.reviewHash, "2026-09-08T05:05:02.000Z");
  assert.equal(recovered.disposition, "recover");
  assert.equal(recovered.operation.status, "unknown");
  assert.equal(recovered.operation.abandonedAt, undefined);

  const baseOwner = { ...owner, accountProvider: "base-account" };
  const mixedCaseId = "0xAbCdEf-Provider-ID";
  const baseAction = { ...action, id: "66666666-6666-4666-8666-666666666666", owner: baseOwner };
  await store.issue(baseAction);
  await store.claim(baseOwner, baseAction.id, baseAction.reviewHash, "2026-09-08T05:06:00.000Z");
  assert.equal((await store.recordSubmission(
    baseOwner,
    baseAction.id,
    { submissionId: mixedCaseId },
    "2026-09-08T05:06:01.000Z",
  )).submissionId, mixedCaseId);
  assert.equal((await store.recordSubmission(
    baseOwner,
    baseAction.id,
    { submissionId: mixedCaseId },
    "2026-09-08T05:06:02.000Z",
  )).submissionId, mixedCaseId);
  await store.updateStatus(baseOwner, baseAction.id, "included", "2026-09-08T05:06:03.000Z");
  assert.equal((await store.recordSubmission(
    baseOwner,
    baseAction.id,
    { submissionId: mixedCaseId },
    "2026-09-08T05:06:04.000Z",
  )).status, "included");
  assert.equal(await store.recordSubmission(
    baseOwner,
    baseAction.id,
    { submissionId: mixedCaseId.toLowerCase() },
    "2026-09-08T05:06:05.000Z",
  ), null);

  const terminal = { ...action, id: "77777777-7777-4777-8777-777777777777" };
  await store.issue(terminal);
  await store.claim(owner, terminal.id, terminal.reviewHash, "2026-09-08T05:07:00.000Z");
  await store.updateStatus(owner, terminal.id, "failed", "2026-09-08T05:07:01.000Z", {
    expectedSourceStatus: "submitting",
    requireNoSubmissionReference: true,
  });
  const terminalEvidence = `0x${"9".repeat(64)}`;
  const terminalRecorded = await store.recordSubmission(
    owner,
    terminal.id,
    { userOperationHash: terminalEvidence },
    "2026-09-08T05:07:02.000Z",
  );
  assert.equal(terminalRecorded.status, "failed");
  assert.equal(terminalRecorded.userOperationHash, terminalEvidence);

  console.log("sqlite durable claim, mixed-case handle, included monotonicity, terminal evidence, shared bundle, verified execution race, and admission-release probe passed");
} finally {
  rmSync(directory, { recursive: true, force: true });
}

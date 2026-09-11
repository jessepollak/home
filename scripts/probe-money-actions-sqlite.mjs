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
  await store.recordSubmission(
    owner,
    replay.id,
    {
      transactionHash: `0x${"e".repeat(64)}`,
      userOperationHash: `0x${"f".repeat(64)}`,
    },
    "2026-09-08T05:03:01.000Z",
  );
  assert.equal(await store.updateStatus(owner, replay.id, "confirmed", "2026-09-08T05:03:02.000Z", {
    verifiedExecution: {
      chainId: 8453,
      kind: "user-operation",
      hash: `0x${"b".repeat(64)}`,
    },
  }), null);
  console.log("sqlite durable claim, shared bundle, and verified execution race probe passed");
} finally {
  rmSync(directory, { recursive: true, force: true });
}

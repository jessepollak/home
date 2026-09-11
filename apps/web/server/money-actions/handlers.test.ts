import { describe, expect, test } from "bun:test";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import {
  createClaimMoneyActionHandler,
  createMoneyActionAdmissionReleaseHandler,
  createMoneyActionListHandler,
  createMoneyActionReadHandler,
  createMoneyActionStatusHandler,
  createMoneyActionSubmissionHandler,
} from "./handlers";
import { MemoryMoneyActionStore } from "./store";

const OWNER = {
  subject: "subject-a",
  address: "0x1111111111111111111111111111111111111111",
  chainId: 8453,
  accountProvider: "cdp-embedded",
} as const;
const ID = "11111111-1111-4111-8111-111111111111";
const REVIEW_HASH = "a".repeat(64);
const USER_OPERATION_HASH = `0x${"b".repeat(64)}` as const;
const TRANSACTION_HASH = `0x${"c".repeat(64)}` as const;

function action(): PreparedMoneyAction {
  return {
    id: ID,
    reviewHash: REVIEW_HASH,
    owner: OWNER,
    kind: "send",
    title: "Send ETH",
    calls: [{ to: "0x2222222222222222222222222222222222222222", data: "0x", value: "1" }],
    amounts: [{ assetId: "eth", symbol: "ETH", decimals: 18, amountBaseUnits: "1", direction: "spend" }],
    warnings: ["Network fee shown by wallet."],
    createdAt: "2026-09-08T05:00:00.000Z",
    expiresAt: "2026-09-08T05:10:00.000Z",
  };
}

function request(path: string, body: unknown, provider = "cdp-embedded") {
  return new Request(`https://home.example${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Home-Account-Provider": provider },
    body: JSON.stringify(body),
  });
}

const authorize = async () => Response.json({
  user: { subject: OWNER.subject },
  smartAccount: { address: OWNER.address, chainId: 8453 },
  accountProvider: OWNER.accountProvider,
});
const context = { params: Promise.resolve({ id: ID }) };

describe("money action HTTP lifecycle", () => {
  test("claims once and returns canonical server calls on every same-owner recovery", async () => {
    const store = new MemoryMoneyActionStore();
    await store.issue(action());
    const handler = createClaimMoneyActionHandler({ authorize, store, now: () => new Date("2026-09-08T05:01:00.000Z") });

    const first = await handler(request(`/api/actions/${ID}/claim`, { reviewHash: REVIEW_HASH }), context);
    const second = await handler(request(`/api/actions/${ID}/claim`, { reviewHash: REVIEW_HASH }), context);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect((await first.json()).disposition).toBe("dispatch");
    const recovery = await second.json();
    expect(recovery.disposition).toBe("recover");
    expect(recovery.action.calls).toEqual(action().calls);
    expect(recovery.operation.attemptCount).toBe(1);
  });

  test("runs an injected finalized-action validator before the atomic claim", async () => {
    const store = new MemoryMoneyActionStore();
    await store.issue(action());
    let validated: unknown;
    const handler = createClaimMoneyActionHandler({
      authorize,
      store,
      now: () => new Date("2026-09-08T05:01:00.000Z"),
      validateBeforeClaim: async (input) => {
        validated = input;
      },
    });

    const response = await handler(request(`/api/actions/${ID}/claim`, { reviewHash: REVIEW_HASH }), context);
    expect(response.status).toBe(200);
    expect(validated).toMatchObject({ owner: OWNER, action: action(), now: "2026-09-08T05:01:00.000Z" });

    const deniedStore = new MemoryMoneyActionStore();
    await deniedStore.issue({ ...action(), id: "22222222-2222-4222-8222-222222222222" });
    const denied = createClaimMoneyActionHandler({
      authorize,
      store: deniedStore,
      validateBeforeClaim: async () => { throw new Error("stale quote"); },
    });
    const deniedResponse = await denied(
      request("/api/actions/22222222-2222-4222-8222-222222222222/claim", { reviewHash: REVIEW_HASH }),
      { params: Promise.resolve({ id: "22222222-2222-4222-8222-222222222222" }) },
    );
    expect(deniedResponse.status).toBe(409);
    expect((await deniedStore.get(OWNER, "22222222-2222-4222-8222-222222222222"))?.status).toBe("prepared");

    const recoveredStore = new MemoryMoneyActionStore();
    await recoveredStore.issue(action());
    await recoveredStore.claim(OWNER, ID, REVIEW_HASH, "2026-09-08T05:01:00.000Z");
    let recoveryValidations = 0;
    const recover = createClaimMoneyActionHandler({
      authorize,
      store: recoveredStore,
      validateBeforeClaim: async () => { recoveryValidations += 1; },
    });
    const recoveryResponse = await recover(request(`/api/actions/${ID}/claim`, { reviewHash: REVIEW_HASH }), context);
    expect(recoveryResponse.status).toBe(200);
    expect((await recoveryResponse.json()).disposition).toBe("recover");
    expect(recoveryValidations).toBe(0);
  });

  test("re-reads time after asynchronous pre-dispatch validation", async () => {
    const store = new MemoryMoneyActionStore();
    await store.issue(action());
    const times = [
      new Date("2026-09-08T05:09:59.000Z"),
      new Date("2026-09-08T05:10:01.000Z"),
    ];
    const handler = createClaimMoneyActionHandler({
      authorize,
      store,
      now: () => times.shift() ?? new Date("2026-09-08T05:10:01.000Z"),
      validateBeforeClaim: async () => {},
    });
    const response = await handler(request(`/api/actions/${ID}/claim`, { reviewHash: REVIEW_HASH }), context);
    expect(response.status).toBe(200);
    expect((await response.json()).operation.status).toBe("expired");
    expect((await store.get(OWNER, ID))?.attemptCount).toBe(0);
  });

  test("accepts terminal pre-dispatch outcomes only from the still-reference-free submitting state", async () => {
    const expiredStore = new MemoryMoneyActionStore();
    await expiredStore.issue(action());
    await expiredStore.claim(OWNER, ID, REVIEW_HASH, "2026-09-08T05:01:00.000Z");
    const expire = createMoneyActionStatusHandler({ authorize, store: expiredStore });
    const expiredResponse = await expire(
      request(`/api/actions/${ID}/status`, { status: "expired" }),
      context,
    );
    expect(expiredResponse.status).toBe(200);
    expect((await expiredResponse.json()).operation.status).toBe("expired");

    const store = new MemoryMoneyActionStore();
    await store.issue(action());
    await store.claim(OWNER, ID, REVIEW_HASH, "2026-09-08T05:01:00.000Z");
    await store.updateStatus(OWNER, ID, "unknown", "2026-09-08T05:01:01.000Z");
    const handler = createMoneyActionStatusHandler({ authorize, store });
    const response = await handler(request(`/api/actions/${ID}/status`, { status: "failed" }), context);
    expect(response.status).toBe(404);
    expect((await store.get(OWNER, ID))?.status).toBe("unknown");
  });

  test("does not terminalize reference-free unknown on Check status recover", async () => {
    const store = new MemoryMoneyActionStore();
    await store.issue(action());
    await store.claim(OWNER, ID, REVIEW_HASH, "2026-09-08T05:01:00.000Z");
    await store.updateStatus(OWNER, ID, "unknown", "2026-09-08T05:01:01.000Z");
    const recover = createClaimMoneyActionHandler({
      authorize,
      store,
      now: () => new Date("2026-09-08T05:02:00.000Z"),
    });
    const recovered = await recover(request(`/api/actions/${ID}/claim`, { reviewHash: REVIEW_HASH }), context);
    expect(recovered.status).toBe(200);
    expect((await recovered.json()).operation).toMatchObject({
      status: "unknown",
      attemptCount: 1,
    });
    expect((await store.get(OWNER, ID))?.status).toBe("unknown");
    expect((await store.get(OWNER, ID))?.abandonedAt).toBeUndefined();

    const status = createMoneyActionStatusHandler({ authorize, store });
    const expired = await status(request(`/api/actions/${ID}/status`, { status: "expired" }), context);
    expect(expired.status).toBe(404);
    expect((await store.get(OWNER, ID))?.status).toBe("unknown");
  });

  test("lets the owner release admission while a pending wallet handle can still attach and reconcile", async () => {
    const store = new MemoryMoneyActionStore();
    await store.issue(action());
    await store.claim(OWNER, ID, REVIEW_HASH, "2026-09-08T05:01:00.000Z");
    const list = createMoneyActionListHandler({ authorize, store });
    const blocking = await list(new Request(
      "https://home.example/api/actions/operations?scope=unresolved-send&limit=50",
      { headers: { "X-Home-Account-Provider": OWNER.accountProvider } },
    ));
    expect((await blocking.json()).operations).toHaveLength(1);

    const release = createMoneyActionAdmissionReleaseHandler({
      authorize,
      store,
      now: () => new Date("2026-09-08T05:01:30.000Z"),
    });
    const abandoned = await release(
      request(`/api/actions/${ID}/admission-release`, { reason: "owner-request" }),
      context,
    );
    expect(abandoned.status).toBe(200);
    expect((await abandoned.json()).operation).toMatchObject({
      status: "submitting",
      abandonedAt: "2026-09-08T05:01:30.000Z",
    });
    const released = await list(new Request(
      "https://home.example/api/actions/operations?scope=unresolved-send&limit=50",
      { headers: { "X-Home-Account-Provider": OWNER.accountProvider } },
    ));
    expect((await released.json()).operations).toEqual([]);

    const submit = createMoneyActionSubmissionHandler({
      authorize,
      store,
      now: () => new Date("2026-09-08T05:01:40.000Z"),
      readReceipt: async () => ({ status: "pending", transactionHash: TRANSACTION_HASH }),
    });
    const attached = await submit(request(`/api/actions/${ID}/submission`, {
      userOperationHash: USER_OPERATION_HASH,
      transactionHash: TRANSACTION_HASH,
    }), context);
    expect(attached.status).toBe(200);
    expect((await attached.json()).operation).toMatchObject({
      status: "submitted",
      userOperationHash: USER_OPERATION_HASH,
      transactionHash: TRANSACTION_HASH,
      abandonedAt: "2026-09-08T05:01:30.000Z",
    });

    const read = createMoneyActionReadHandler({
      authorize,
      store,
      now: () => new Date("2026-09-08T05:01:41.000Z"),
      readReceipt: async () => ({
        status: "confirmed",
        success: true,
        transactionHash: TRANSACTION_HASH,
        blockNumber: "1",
        verifiedExecution: {
          chainId: 8453,
          kind: "user-operation",
          hash: USER_OPERATION_HASH,
        },
      }),
    });
    const reconciled = await read(new Request(`https://home.example/api/actions/${ID}`, {
      headers: { "X-Home-Account-Provider": OWNER.accountProvider },
    }), context);
    expect(reconciled.status).toBe(200);
    expect((await reconciled.json()).operation).toMatchObject({
      status: "confirmed",
      abandonedAt: "2026-09-08T05:01:30.000Z",
    });
  });

  test("routes owner release through versioned attempt persistence when available", async () => {
    class AttemptBackedTestStore extends MemoryMoneyActionStore {
      releaseCommands: unknown[] = [];

      async getAttemptStoreSnapshot(owner: typeof OWNER, actionId: string) {
        const operation = await this.get(owner, actionId);
        return operation
          ? {
              ok: true as const,
              value: {
                action: { action: { ...operation.action, revision: 1 as const }, sensitivePayloadStorage: "not-sensitive" as const },
                attempts: [{ attemptId: "attempt-1", attemptVersion: 1 }],
              },
            }
          : { ok: false as const, dispatchAuthority: "none" as const, error: { code: "not-found" as const, retryable: false } };
      }

      async releaseAttemptAdmission(command: { owner: typeof OWNER; actionId: string }, now: string) {
        this.releaseCommands.push(command);
        const operation = await super.releaseAdmission(command.owner, command.actionId, now);
        return operation
          ? {
              ok: true as const,
              value: {
                admission: { state: "released" as const, at: now, policyVersion: "owner-release-v1" },
                ownerResolution: { kind: "abandoned" as const, at: now, reason: "owner-request" as const },
                execution: { kind: "ambiguous" as const },
                lateEvidence: "accepted" as const,
              },
            }
          : { ok: false as const, dispatchAuthority: "none" as const, error: { code: "not-found" as const, retryable: false } };
      }
    }

    const store = new AttemptBackedTestStore();
    await store.issue(action());
    await store.claim(OWNER, ID, REVIEW_HASH, "2026-09-08T05:01:00.000Z");
    const release = createMoneyActionAdmissionReleaseHandler({
      authorize,
      store,
      now: () => new Date("2026-09-08T05:01:30.000Z"),
    });

    const response = await release(
      request(`/api/actions/${ID}/admission-release`, { reason: "owner-request" }),
      context,
    );
    expect(response.status).toBe(200);
    expect(store.releaseCommands).toEqual([{
      owner: OWNER,
      actionId: ID,
      attemptId: "attempt-1",
      policyVersion: "owner-release-v1",
      reason: "owner-request",
    }]);
    expect((await response.json()).operation).toMatchObject({
      status: "submitting",
      abandonedAt: "2026-09-08T05:01:30.000Z",
    });
  });

  test("does not let another owner release admission or see the abandoned send", async () => {
    const store = new MemoryMoneyActionStore();
    await store.issue(action());
    await store.claim(OWNER, ID, REVIEW_HASH, "2026-09-08T05:01:00.000Z");
    const otherAuthorize = async () => Response.json({
      user: { subject: "subject-b" },
      smartAccount: { address: "0x2222222222222222222222222222222222222222", chainId: 8453 },
      accountProvider: OWNER.accountProvider,
    });
    const release = createMoneyActionAdmissionReleaseHandler({
      authorize: otherAuthorize,
      store,
      now: () => new Date("2026-09-08T05:02:00.000Z"),
    });
    const response = await release(
      request(`/api/actions/${ID}/admission-release`, { reason: "owner-request" }),
      context,
    );
    expect(response.status).toBe(404);
    expect((await store.get(OWNER, ID))?.abandonedAt).toBeUndefined();
    expect((await store.get(OWNER, ID))?.status).toBe("submitting");
  });

  test("exposes a validated owner-scoped unresolved-send view without changing ordinary history", async () => {
    const store = new MemoryMoneyActionStore();
    await store.issue(action());
    await store.claim(OWNER, ID, REVIEW_HASH, "2026-09-08T05:01:00.000Z");
    const nonSend = {
      ...action(),
      id: "22222222-2222-4222-8222-222222222222",
      kind: "save-deposit" as const,
      title: "Deposit USDC",
    };
    await store.issue(nonSend);
    await store.claim(OWNER, nonSend.id, nonSend.reviewHash, "2026-09-08T05:02:00.000Z");
    const handler = createMoneyActionListHandler({ authorize, store });

    const scoped = await handler(new Request(
      "https://home.example/api/actions/operations?scope=unresolved-send&limit=50",
      { headers: { "X-Home-Account-Provider": OWNER.accountProvider } },
    ));
    expect(scoped.status).toBe(200);
    expect(await scoped.json()).toMatchObject({
      scope: "unresolved-send",
      operations: [{ action: { id: ID, kind: "send", owner: OWNER }, status: "submitting" }],
    });

    const ordinary = await handler(new Request(
      "https://home.example/api/actions/operations?limit=1",
      { headers: { "X-Home-Account-Provider": OWNER.accountProvider } },
    ));
    expect(ordinary.status).toBe(200);
    const ordinaryBody = await ordinary.json();
    expect(ordinaryBody.scope).toBeUndefined();
    expect(ordinaryBody.operations).toHaveLength(1);
    expect(ordinaryBody.operations[0].action.id).toBe(nonSend.id);
  });

  test("hides pre-chain Rejected from ordinary Activity history without deleting store records", async () => {
    const store = new MemoryMoneyActionStore();
    const rejected = { ...action(), id: "33333333-3333-4333-8333-333333333333", title: "Withdraw USDC from Morpho" };
    const expired = { ...action(), id: "44444444-4444-4444-8444-444444444444", title: "Send USDC" };
    const failedPrepare = { ...action(), id: "55555555-5555-4555-8555-555555555555", title: "Deposit USDC" };
    const failedOnchain = { ...action(), id: "66666666-6666-4666-8666-666666666666", title: "Send ETH" };
    const confirmed = { ...action(), id: "77777777-7777-4777-8777-777777777777", title: "Send USDC" };
    await store.issue(rejected);
    await store.claim(OWNER, rejected.id, rejected.reviewHash, "2026-09-08T05:01:00.000Z");
    await store.updateStatus(OWNER, rejected.id, "rejected", "2026-09-08T05:01:10.000Z", {
      expectedSourceStatus: "submitting",
      requireNoSubmissionReference: true,
    });
    await store.issue(expired);
    await store.claim(OWNER, expired.id, expired.reviewHash, "2026-09-08T05:02:00.000Z");
    await store.updateStatus(OWNER, expired.id, "expired", "2026-09-08T05:02:10.000Z", {
      expectedSourceStatus: "submitting",
      requireNoSubmissionReference: true,
    });
    await store.issue(failedPrepare);
    await store.claim(OWNER, failedPrepare.id, failedPrepare.reviewHash, "2026-09-08T05:03:00.000Z");
    await store.updateStatus(OWNER, failedPrepare.id, "failed", "2026-09-08T05:03:10.000Z", {
      expectedSourceStatus: "submitting",
      requireNoSubmissionReference: true,
    });
    await store.issue(failedOnchain);
    await store.claim(OWNER, failedOnchain.id, failedOnchain.reviewHash, "2026-09-08T05:04:00.000Z");
    await store.recordSubmission(OWNER, failedOnchain.id, { userOperationHash: USER_OPERATION_HASH }, "2026-09-08T05:04:05.000Z");
    await store.updateStatus(OWNER, failedOnchain.id, "failed", "2026-09-08T05:04:10.000Z");
    await store.issue(confirmed);
    await store.claim(OWNER, confirmed.id, confirmed.reviewHash, "2026-09-08T05:05:00.000Z");
    await store.recordSubmission(OWNER, confirmed.id, {
      userOperationHash: `0x${"d".repeat(64)}` as const,
      transactionHash: TRANSACTION_HASH,
    }, "2026-09-08T05:05:05.000Z");
    await store.updateStatus(OWNER, confirmed.id, "confirmed", "2026-09-08T05:05:10.000Z");

    const handler = createMoneyActionListHandler({ authorize, store });
    const response = await handler(new Request(
      "https://home.example/api/actions/operations?limit=20",
      { headers: { "X-Home-Account-Provider": OWNER.accountProvider } },
    ));
    expect(response.status).toBe(200);
    const body = await response.json() as { operations: Array<{ action: { id: string }; status: string }> };
    expect(body.operations.map((operation) => ({ id: operation.action.id, status: operation.status }))).toEqual([
      { id: confirmed.id, status: "confirmed" },
      { id: failedOnchain.id, status: "failed" },
    ]);
    expect(await store.get(OWNER, rejected.id)).toMatchObject({ status: "rejected" });
    expect(await store.get(OWNER, expired.id)).toMatchObject({ status: "expired" });
    expect(await store.get(OWNER, failedPrepare.id)).toMatchObject({ status: "failed" });
    expect((await store.list(OWNER, 20)).map((operation) => operation.status)).toEqual([
      "confirmed",
      "failed",
      "failed",
      "expired",
      "rejected",
    ]);
  });

  test("rejects unknown, duplicate, or out-of-bounds operation selectors after authorization", async () => {
    const handler = createMoneyActionListHandler({ authorize, store: new MemoryMoneyActionStore() });
    for (const query of [
      "scope=all",
      "scope=unresolved-send&scope=unresolved-send",
      "scope=unresolved-send&limit=51",
      "scope=unresolved-send&owner=subject-b",
    ]) {
      const response = await handler(new Request(
        `https://home.example/api/actions/operations?${query}`,
        { headers: { "X-Home-Account-Provider": OWNER.accountProvider } },
      ));
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("INVALID_OPERATIONS_REQUEST");
    }

    const unauthorized = createMoneyActionListHandler({
      authorize: async () => Response.json({ error: "unauthorized" }, { status: 401 }),
      store: new MemoryMoneyActionStore(),
    });
    const response = await unauthorized(new Request(
      "https://home.example/api/actions/operations?scope=all&owner=subject-b",
    ));
    expect(response.status).toBe(401);
  });

  test("preserves mixed-case Base submission IDs byte-for-byte and rejects a case-only retry", async () => {
    const owner = { ...OWNER, accountProvider: "base-account" as const };
    const baseAction = { ...action(), owner };
    const store = new MemoryMoneyActionStore();
    await store.issue(baseAction);
    await store.claim(owner, ID, REVIEW_HASH, "2026-09-08T05:01:00.000Z");
    const baseAuthorize = async () => Response.json({
      user: { subject: owner.subject },
      smartAccount: { address: owner.address, chainId: 8453 },
      accountProvider: owner.accountProvider,
    });
    const handler = createMoneyActionSubmissionHandler({
      authorize: baseAuthorize,
      store,
      now: () => new Date("2026-09-10T05:02:00.000Z"),
      readReceipt: async () => ({ status: "pending", transactionHash: TRANSACTION_HASH }),
    });
    const mixedCase = "0xAbCdEf-Provider-ID";

    const recorded = await handler(request(`/api/actions/${ID}/submission`, {
      submissionId: mixedCase,
    }, "base-account"), context);
    expect(recorded.status).toBe(200);
    expect((await recorded.json()).operation.submissionId).toBe(mixedCase);

    const exactRetry = await handler(request(`/api/actions/${ID}/submission`, {
      submissionId: mixedCase,
    }, "base-account"), context);
    expect(exactRetry.status).toBe(200);
    expect((await exactRetry.json()).operation.submissionId).toBe(mixedCase);

    const conflict = await handler(request(`/api/actions/${ID}/submission`, {
      submissionId: mixedCase.toLowerCase(),
    }, "base-account"), context);
    expect(conflict.status).toBe(409);
    expect((await store.get(owner, ID))?.submissionId).toBe(mixedCase);
  });

  test("keeps terminal state while durably acknowledging late provider evidence", async () => {
    const store = new MemoryMoneyActionStore();
    await store.issue(action());
    await store.claim(OWNER, ID, REVIEW_HASH, "2026-09-08T05:01:00.000Z");
    await store.updateStatus(OWNER, ID, "failed", "2026-09-08T05:01:01.000Z", {
      expectedSourceStatus: "submitting",
      requireNoSubmissionReference: true,
    });
    const handler = createMoneyActionSubmissionHandler({
      authorize,
      store,
      now: () => new Date("2026-09-10T05:02:00.000Z"),
      readReceipt: async () => ({ status: "pending", transactionHash: TRANSACTION_HASH }),
    });
    const response = await handler(request(`/api/actions/${ID}/submission`, {
      userOperationHash: USER_OPERATION_HASH,
    }), context);
    expect(response.status).toBe(200);
    expect((await response.json()).operation).toMatchObject({
      status: "failed",
      userOperationHash: USER_OPERATION_HASH,
    });
  });

  test("binds embedded receipt proof to the verified owner address before confirming", async () => {
    const store = new MemoryMoneyActionStore();
    await store.issue(action());
    await store.claim(OWNER, ID, REVIEW_HASH, "2026-09-08T05:01:00.000Z");
    let proof: unknown;
    const handler = createMoneyActionSubmissionHandler({
      authorize,
      store,
      now: () => new Date("2026-09-08T05:02:00.000Z"),
      readReceipt: async (hash, receivedProof) => {
        expect(hash).toBe(TRANSACTION_HASH);
        proof = receivedProof;
        return {
          status: "confirmed",
          transactionHash: TRANSACTION_HASH,
          blockNumber: "1",
          success: true,
          verifiedExecution: { chainId: 8453, kind: "user-operation", hash: USER_OPERATION_HASH },
        };
      },
    });

    const response = await handler(request(`/api/actions/${ID}/submission`, {
      userOperationHash: USER_OPERATION_HASH,
      transactionHash: TRANSACTION_HASH,
    }), context);
    expect(response.status).toBe(200);
    expect(proof).toEqual({
      accountProvider: "cdp-embedded",
      userOperationHash: USER_OPERATION_HASH,
      sender: OWNER.address,
      expectedCalls: action().calls,
      notBefore: "2026-09-08T05:01:00.000Z",
    });
    expect((await response.json()).operation.status).toBe("confirmed");
  });
});

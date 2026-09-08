import { expect, test } from "bun:test";
import type { PreparedMoneyAction } from "@/features/money-actions/types";
import type { MoneyActionStore } from "./store";

const OWNER = {
  subject: "subject-a",
  address: "0x1111111111111111111111111111111111111111",
  chainId: 8453,
  accountProvider: "cdp-embedded",
} as const;
const OTHER_OWNER = {
  ...OWNER,
  subject: "subject-b",
  address: "0x2222222222222222222222222222222222222222",
} as const;

function action(): PreparedMoneyAction {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    reviewHash: "a".repeat(64),
    owner: OWNER,
    kind: "save-deposit",
    title: "Deposit USDC",
    calls: [
      { to: "0x3333333333333333333333333333333333333333", data: "0x1234", value: "0" },
      { to: "0x4444444444444444444444444444444444444444", data: "0xabcd", value: "0" },
    ],
    amounts: [{ assetId: "base:usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "1000000", direction: "spend" }],
    warnings: ["Approval is capped to exactly 1 USDC."],
    createdAt: "2026-09-08T05:00:00.000Z",
    expiresAt: "2026-09-08T05:10:00.000Z",
  };
}

export function describeMoneyActionStore(
  name: string,
  createStore: () => MoneyActionStore | Promise<MoneyActionStore>,
): void {
  test(`${name} atomically grants one dispatch and makes every refresh recover the same attempt`, async () => {
    const store = await createStore();
    await store.issue(action());

    const claims = await Promise.all([
      store.claim(OWNER, action().id, action().reviewHash, "2026-09-08T05:01:00.000Z"),
      store.claim(OWNER, action().id, action().reviewHash, "2026-09-08T05:01:00.000Z"),
    ]);

    expect(claims.map((claim) => claim?.disposition).sort()).toEqual(["dispatch", "recover"]);
    expect(claims.every((claim) => claim?.operation.attemptCount === 1)).toBe(true);
    const refresh = await store.claim(OWNER, action().id, action().reviewHash, "2026-09-08T05:02:00.000Z");
    expect(refresh).toMatchObject({ disposition: "recover", operation: { status: "submitting", attemptCount: 1 } });
  });

  test(`${name} scopes reads, claims, and submission references to the verified owner tuple`, async () => {
    const store = await createStore();
    await store.issue(action());

    expect(await store.get(OTHER_OWNER, action().id)).toBeNull();
    expect(await store.claim(OTHER_OWNER, action().id, action().reviewHash, "2026-09-08T05:01:00.000Z")).toBeNull();
    expect(await store.list(OTHER_OWNER, 20)).toEqual([]);
    expect(await store.recordSubmission(OTHER_OWNER, action().id, { userOperationHash: `0x${"b".repeat(64)}` }, "2026-09-08T05:01:00.000Z")).toBeNull();
  });

  test(`${name} keeps one immutable submission handle and never authorizes a conflicting resend`, async () => {
    const store = await createStore();
    await store.issue(action());
    await store.claim(OWNER, action().id, action().reviewHash, "2026-09-08T05:01:00.000Z");
    const userOperationHash = `0x${"b".repeat(64)}` as const;
    await store.recordSubmission(OWNER, action().id, { userOperationHash }, "2026-09-08T05:01:01.000Z");

    await expect(store.recordSubmission(OWNER, action().id, { userOperationHash: `0x${"c".repeat(64)}` }, "2026-09-08T05:01:02.000Z")).resolves.toBeNull();
    const refresh = await store.claim(OWNER, action().id, action().reviewHash, "2026-09-08T05:02:00.000Z");
    expect(refresh).toMatchObject({
      disposition: "recover",
      operation: { attemptCount: 1, userOperationHash, status: "submitted" },
    });
  });

  test(`${name} fails closed before dispatch when a sensitive payload overlay is unavailable`, async () => {
    const store = await createStore();
    const sensitive = {
      ...action(),
      sensitivePayload: true as const,
      calls: [{ ...action().calls[0], data: "0x" as const, dataHash: "b".repeat(64) }],
    };
    await store.issue(sensitive);
    await expect(
      store.claim(OWNER, sensitive.id, sensitive.reviewHash, "2026-09-08T05:01:00.000Z"),
    ).resolves.toBeNull();
    expect((await store.get(OWNER, sensitive.id))?.status).toBe("prepared");
  });

  test(`${name} allows verified read reconciliation from unknown while keeping client terminal writes source-bound`, async () => {
    const store = await createStore();
    await store.issue(action());
    await store.claim(OWNER, action().id, action().reviewHash, "2026-09-08T05:01:00.000Z");
    const transactionHash = `0x${"c".repeat(64)}` as const;
    const userOperationHash = `0x${"d".repeat(64)}` as const;
    await store.recordSubmission(OWNER, action().id, { transactionHash, userOperationHash }, "2026-09-08T05:01:01.000Z");
    await store.updateStatus(OWNER, action().id, "unknown", "2026-09-08T05:01:02.000Z");

    await expect(store.updateStatus(
      OWNER,
      action().id,
      "confirmed",
      "2026-09-08T05:01:03.000Z",
      { verifiedExecution: { chainId: 8453, kind: "user-operation", hash: userOperationHash } },
    )).resolves.toMatchObject({ status: "confirmed" });

    const unresolved = { ...action(), id: "22222222-2222-4222-8222-222222222222" };
    await store.issue(unresolved);
    await store.claim(OWNER, unresolved.id, unresolved.reviewHash, "2026-09-08T05:02:00.000Z");
    await store.updateStatus(OWNER, unresolved.id, "unknown", "2026-09-08T05:02:01.000Z");
    await expect(store.updateStatus(OWNER, unresolved.id, "failed", "2026-09-08T05:02:02.000Z", {
      expectedSourceStatus: "submitting",
      requireNoSubmissionReference: true,
    })).resolves.toBeNull();
    expect((await store.get(OWNER, unresolved.id))?.status).toBe("unknown");
  });

  test(`${name} allows distinct account operations in one bundle but reserves proven execution identities`, async () => {
    const store = await createStore();
    const first = action();
    const second = { ...action(), id: "22222222-2222-4222-8222-222222222222" };
    const third = { ...action(), id: "33333333-3333-4333-8333-333333333333" };
    await Promise.all([store.issue(first), store.issue(second), store.issue(third)]);
    await Promise.all([first, second, third].map((item) =>
      store.claim(OWNER, item.id, item.reviewHash, "2026-09-08T05:01:00.000Z")
    ));
    const transactionHash = `0x${"e".repeat(64)}` as const;
    const firstUserOp = `0x${"1".repeat(64)}` as const;
    const secondUserOp = `0x${"2".repeat(64)}` as const;
    await expect(store.recordSubmission(OWNER, first.id, { transactionHash, userOperationHash: firstUserOp }, "2026-09-08T05:01:01.000Z")).resolves.not.toBeNull();
    await expect(store.recordSubmission(OWNER, second.id, { transactionHash, userOperationHash: secondUserOp }, "2026-09-08T05:01:01.000Z")).resolves.not.toBeNull();

    await expect(store.updateStatus(OWNER, first.id, "confirmed", "2026-09-08T05:01:02.000Z", {
      verifiedExecution: { chainId: 8453, kind: "user-operation", hash: firstUserOp },
    })).resolves.toMatchObject({ status: "confirmed" });
    await expect(store.updateStatus(OWNER, second.id, "confirmed", "2026-09-08T05:01:02.000Z", {
      verifiedExecution: { chainId: 8453, kind: "user-operation", hash: secondUserOp },
    })).resolves.toMatchObject({ status: "confirmed" });
    await expect(store.updateStatus(OWNER, third.id, "confirmed", "2026-09-08T05:01:02.000Z", {
      verifiedExecution: { chainId: 8453, kind: "user-operation", hash: firstUserOp },
    })).resolves.toBeNull();
  });

  test(`${name} keeps terminal status and submission references atomic and unique`, async () => {
    const store = await createStore();
    await store.issue(action());
    await store.claim(OWNER, action().id, action().reviewHash, "2026-09-08T05:01:00.000Z");
    const userOperationHash = `0x${"d".repeat(64)}` as const;
    await store.recordSubmission(OWNER, action().id, { userOperationHash }, "2026-09-08T05:01:01.000Z");

    await Promise.all([
      store.updateStatus(OWNER, action().id, "confirmed", "2026-09-08T05:01:02.000Z"),
      store.updateStatus(OWNER, action().id, "unknown", "2026-09-08T05:01:03.000Z"),
    ]);
    expect((await store.get(OWNER, action().id))?.status).toBe("confirmed");
    await expect(
      store.updateStatus(OWNER, action().id, "failed", "2026-09-08T05:01:04.000Z", {
        requireNoSubmissionReference: true,
      }),
    ).resolves.toBeNull();

    const other = { ...action(), id: "22222222-2222-4222-8222-222222222222" };
    await store.issue(other);
    await store.claim(OWNER, other.id, other.reviewHash, "2026-09-08T05:02:00.000Z");
    await expect(
      store.recordSubmission(OWNER, other.id, { userOperationHash }, "2026-09-08T05:02:01.000Z"),
    ).resolves.toBeNull();
  });
}

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

  test(`${name} canonicalizes chain hashes while preserving opaque handles byte-for-byte`, async () => {
    const store = await createStore();
    await store.issue(action());
    await store.claim(OWNER, action().id, action().reviewHash, "2026-09-08T05:01:00.000Z");
    const uppercaseUserOperationHash = `0x${"A".repeat(64)}` as const;
    const uppercaseTransactionHash = `0x${"B".repeat(64)}` as const;
    await expect(store.recordSubmission(OWNER, action().id, {
      userOperationHash: uppercaseUserOperationHash,
      transactionHash: uppercaseTransactionHash,
    }, "2026-09-08T05:01:01.000Z")).resolves.toMatchObject({
      userOperationHash: uppercaseUserOperationHash.toLowerCase(),
      transactionHash: uppercaseTransactionHash.toLowerCase(),
    });
    await expect(store.recordSubmission(OWNER, action().id, {
      userOperationHash: uppercaseUserOperationHash.toLowerCase() as `0x${string}`,
      transactionHash: uppercaseTransactionHash.toLowerCase() as `0x${string}`,
    }, "2026-09-08T05:01:02.000Z")).resolves.not.toBeNull();
  });

  test(`${name} preserves opaque Base submission IDs byte-for-byte on exact retry and rejects case-only conflicts`, async () => {
    const store = await createStore();
    const owner = { ...OWNER, accountProvider: "base-account" as const };
    const baseAction = { ...action(), owner };
    const mixedCase = "0xAbCdEf-Provider-ID";
    await store.issue(baseAction);
    await store.claim(owner, baseAction.id, baseAction.reviewHash, "2026-09-08T05:01:00.000Z");

    await expect(store.recordSubmission(
      owner,
      baseAction.id,
      { submissionId: mixedCase },
      "2026-09-08T05:01:01.000Z",
    )).resolves.toMatchObject({ submissionId: mixedCase, status: "submitted" });
    await expect(store.recordSubmission(
      owner,
      baseAction.id,
      { submissionId: mixedCase },
      "2026-09-08T05:01:02.000Z",
    )).resolves.toMatchObject({ submissionId: mixedCase, status: "submitted" });
    await expect(store.recordSubmission(
      owner,
      baseAction.id,
      { submissionId: mixedCase.toLowerCase() },
      "2026-09-08T05:01:03.000Z",
    )).resolves.toBeNull();
    expect((await store.get(owner, baseAction.id))?.submissionId).toBe(mixedCase);
  });

  test(`${name} does not downgrade included evidence on an exact submission retry`, async () => {
    const store = await createStore();
    await store.issue(action());
    await store.claim(OWNER, action().id, action().reviewHash, "2026-09-08T05:01:00.000Z");
    const userOperationHash = `0x${"7".repeat(64)}` as const;
    await store.recordSubmission(OWNER, action().id, { userOperationHash }, "2026-09-08T05:01:01.000Z");
    await store.updateStatus(OWNER, action().id, "included", "2026-09-08T05:01:02.000Z");

    await expect(store.recordSubmission(
      OWNER,
      action().id,
      { userOperationHash },
      "2026-09-08T05:01:03.000Z",
    )).resolves.toMatchObject({ status: "included", userOperationHash });
  });

  test(`${name} attaches exact late evidence without reopening an already terminal action`, async () => {
    const store = await createStore();
    const neverDispatched = { ...action(), id: "99999999-9999-4999-8999-999999999999" };
    await store.issue(neverDispatched);
    await store.claim(OWNER, neverDispatched.id, neverDispatched.reviewHash, "2026-09-10T05:01:00.000Z");
    await expect(store.recordSubmission(
      OWNER,
      neverDispatched.id,
      { userOperationHash: `0x${"8".repeat(64)}` },
      "2026-09-10T05:01:01.000Z",
    )).resolves.toBeNull();

    await store.issue(action());
    await store.claim(OWNER, action().id, action().reviewHash, "2026-09-08T05:01:00.000Z");
    await store.updateStatus(OWNER, action().id, "failed", "2026-09-08T05:01:01.000Z", {
      expectedSourceStatus: "submitting",
      requireNoSubmissionReference: true,
    });
    const userOperationHash = `0x${"f".repeat(64)}` as const;
    await expect(store.recordSubmission(
      OWNER,
      action().id,
      { userOperationHash },
      "2026-09-08T05:01:02.000Z",
    )).resolves.toMatchObject({ status: "failed", userOperationHash });
    await expect(store.recordSubmission(
      OWNER,
      action().id,
      { userOperationHash },
      "2026-09-08T05:01:03.000Z",
    )).resolves.toMatchObject({ status: "failed", userOperationHash });
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

  test(`${name} releases send admission on owner abandon without terminalizing late evidence`, async () => {
    const store = await createStore();
    const send = { ...action(), kind: "send" as const, title: "Send USDC" };
    await store.issue(send);
    const claimed = await store.claim(OWNER, send.id, send.reviewHash, "2026-09-08T05:01:00.000Z");
    expect(claimed).toMatchObject({
      disposition: "dispatch",
      operation: { status: "submitting", attemptCount: 1 },
    });
    expect(await store.list(OWNER, 10, "unresolved-send")).toHaveLength(1);

    await expect(store.releaseAdmission(OTHER_OWNER, send.id, "2026-09-08T05:01:30.000Z")).resolves.toBeNull();
    expect(await store.get(OTHER_OWNER, send.id)).toBeNull();
    expect((await store.get(OWNER, send.id))?.abandonedAt).toBeUndefined();

    await expect(store.releaseAdmission(OWNER, send.id, "2026-09-08T05:01:30.000Z")).resolves.toMatchObject({
      status: "submitting",
      abandonedAt: "2026-09-08T05:01:30.000Z",
    });
    expect(await store.list(OWNER, 10, "unresolved-send")).toEqual([]);

    const recovered = await store.claim(OWNER, send.id, send.reviewHash, "2026-09-08T05:01:31.000Z");
    expect(recovered).toMatchObject({
      disposition: "recover",
      operation: { status: "submitting", abandonedAt: "2026-09-08T05:01:30.000Z", attemptCount: 1 },
    });

    const userOperationHash = `0x${"e".repeat(64)}` as const;
    const transactionHash = `0x${"c".repeat(64)}` as const;
    await expect(store.recordSubmission(
      OWNER,
      send.id,
      { userOperationHash, transactionHash },
      "2026-09-08T05:01:40.000Z",
    )).resolves.toMatchObject({
      status: "submitted",
      userOperationHash,
      transactionHash,
      abandonedAt: "2026-09-08T05:01:30.000Z",
    });
    await expect(store.updateStatus(OWNER, send.id, "confirmed", "2026-09-08T05:01:41.000Z", {
      verifiedExecution: { chainId: 8453, kind: "user-operation", hash: userOperationHash },
    })).resolves.toMatchObject({
      status: "confirmed",
      abandonedAt: "2026-09-08T05:01:30.000Z",
    });
    expect(await store.list(OWNER, 10, "unresolved-send")).toEqual([]);

    const unknownSend = {
      ...action(),
      id: "55555555-5555-4555-8555-555555555555",
      kind: "send" as const,
      title: "Send USDC",
    };
    await store.issue(unknownSend);
    await store.claim(OWNER, unknownSend.id, unknownSend.reviewHash, "2026-09-08T05:04:00.000Z");
    await store.updateStatus(OWNER, unknownSend.id, "unknown", "2026-09-08T05:04:01.000Z");
    const unknownRecover = await store.claim(
      OWNER,
      unknownSend.id,
      unknownSend.reviewHash,
      "2026-09-08T05:04:02.000Z",
    );
    expect(unknownRecover).toMatchObject({
      disposition: "recover",
      operation: { status: "unknown", attemptCount: 1 },
    });
    expect((await store.get(OWNER, unknownSend.id))?.status).toBe("unknown");
    expect((await store.get(OWNER, unknownSend.id))?.abandonedAt).toBeUndefined();
    expect(await store.list(OWNER, 10, "unresolved-send")).toHaveLength(1);

    await expect(store.releaseAdmission(OWNER, unknownSend.id, "2026-09-08T05:04:03.000Z")).resolves.toMatchObject({
      status: "unknown",
      abandonedAt: "2026-09-08T05:04:03.000Z",
    });
    await expect(store.releaseAdmission(OWNER, unknownSend.id, "2026-09-08T05:04:04.000Z")).resolves.toMatchObject({
      status: "unknown",
      abandonedAt: "2026-09-08T05:04:03.000Z",
    });
    expect(await store.list(OWNER, 10, "unresolved-send")).toEqual([]);

    const prepared = {
      ...action(),
      id: "66666666-6666-4666-8666-666666666666",
      kind: "send" as const,
      title: "Send USDC",
    };
    await store.issue(prepared);
    await expect(store.releaseAdmission(OWNER, prepared.id, "2026-09-08T05:05:00.000Z")).resolves.toBeNull();
    expect((await store.get(OWNER, prepared.id))?.status).toBe("prepared");
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

  test(`${name} filters unresolved sends before applying the bounded history limit`, async () => {
    const store = await createStore();
    const unresolvedSend = {
      ...action(),
      kind: "send" as const,
      title: "Send USDC",
      id: "70000000-0000-4000-8000-000000000000",
    };
    await store.issue(unresolvedSend);
    await store.claim(OWNER, unresolvedSend.id, unresolvedSend.reviewHash, "2026-09-08T05:01:00.000Z");

    const unresolvedNonSend = {
      ...action(),
      id: "70000000-0000-4000-8000-000000000001",
    };
    await store.issue(unresolvedNonSend);
    await store.claim(OWNER, unresolvedNonSend.id, unresolvedNonSend.reviewHash, "2026-09-08T05:02:00.000Z");

    const newerTerminalIds: string[] = [];
    for (let index = 0; index < 51; index += 1) {
      const id = `80000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
      const terminal = { ...action(), id, kind: "send" as const, title: "Send USDC" };
      newerTerminalIds.push(id);
      await store.issue(terminal);
      await store.claim(
        OWNER,
        id,
        terminal.reviewHash,
        `2026-09-08T06:00:${String(index).padStart(2, "0")}.000Z`,
      );
    }

    const ordinaryRecent = await store.list(OWNER, 3);
    expect(ordinaryRecent.map((operation) => operation.action.id)).toEqual(
      newerTerminalIds.slice(-3).reverse(),
    );
    expect(ordinaryRecent.every((operation) => operation.status === "expired")).toBe(true);

    const unresolvedSends = await store.list(OWNER, 10, "unresolved-send");
    expect(unresolvedSends).toHaveLength(1);
    expect(unresolvedSends[0]).toMatchObject({
      action: { id: unresolvedSend.id, kind: "send", owner: OWNER },
      status: "submitting",
    });
    expect(await store.list(OTHER_OWNER, 10, "unresolved-send")).toEqual([]);
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

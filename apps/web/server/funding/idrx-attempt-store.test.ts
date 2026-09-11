import { describe, expect, test } from "bun:test";
import { IDRX_BASE_ADDRESS } from "./idrx";
import {
  MemoryIdrxAttemptStore,
  type IdrxAttemptIntent,
} from "./idrx-attempt-store";

const owner = {
  subject: "subject-a",
  smartAccount: "0x1111111111111111111111111111111111111111" as const,
};
const attemptId = "11111111-1111-4111-8111-111111111111";
const intent: IdrxAttemptIntent = {
  toBeMinted: "20000.50",
  rail: "bank-va",
  channelId: "MANDIRI",
  customerSubject: "subject-a",
  customerName: "JOHN SMITH",
};
const result = {
  presentation: "hosted" as const,
  rail: "qris" as const,
  asset: {
    id: "idrx" as const,
    symbol: "IDRX" as const,
    decimals: 2 as const,
    tokenAddress: IDRX_BASE_ADDRESS,
  },
  network: { name: "Base" as const, chainId: 8453 as const },
  merchantOrderId: "order-1",
  url: "https://checkout.idrx.co/?token=fixture",
  verification: {
    status: "pending" as const,
    boundary: "balance-and-activity" as const,
  },
};

describe("IDRX attempt store contract", () => {
  test("persists immutable intent, remains pending after ambiguity, and recovers completion", async () => {
    const store = new MemoryIdrxAttemptStore();
    expect(await store.begin(owner, attemptId, intent)).toEqual({ status: "new" });
    expect(await store.begin(owner, attemptId, intent)).toEqual({
      status: "pending",
      attemptId,
      intent,
    });
    await store.complete(owner, attemptId, result);
    expect(await store.begin(owner, attemptId, intent)).toEqual({
      status: "completed",
      attemptId,
      intent,
      result,
    });
  });

  test("rejects reuse of an attempt ID with changed amount, rail, channel, or customer", async () => {
    const store = new MemoryIdrxAttemptStore();
    expect(await store.begin(owner, attemptId, intent)).toEqual({ status: "new" });
    for (const changed of [
      { ...intent, toBeMinted: "30000" },
      { ...intent, rail: "qris" as const, channelId: null },
      { ...intent, channelId: "BRI" as const },
      { ...intent, customerName: "JANE SMITH" },
    ]) {
      expect(await store.begin(owner, attemptId, changed)).toEqual({ status: "mismatch" });
    }
  });

  test("finds an unresolved owner attempt after tab loss and blocks a fresh dispatch ID", async () => {
    const store = new MemoryIdrxAttemptStore();
    expect(await store.begin(owner, attemptId, intent)).toEqual({ status: "new" });
    expect(await store.begin(
      owner,
      "22222222-2222-4222-8222-222222222222",
      intent,
    )).toEqual({ status: "pending", attemptId, intent });
  });

  test("releases only the terminal reservation while preserving attempt-ID replay protection", async () => {
    const store = new MemoryIdrxAttemptStore();
    expect(await store.begin(owner, attemptId, intent)).toEqual({ status: "new" });
    await store.complete(owner, attemptId, result);
    await store.release(owner, attemptId, "expired");
    expect(await store.recover(owner)).toEqual({ status: "none" });
    expect(await store.begin(owner, attemptId, intent)).toEqual({
      status: "terminal",
      outcome: "expired",
    });
    expect(await store.begin(
      owner,
      "33333333-3333-4333-8333-333333333333",
      { ...intent, toBeMinted: "30000" },
    )).toEqual({ status: "new" });
  });

  test("does not expose an attempt to another verified owner", async () => {
    const store = new MemoryIdrxAttemptStore();
    expect(await store.begin(owner, attemptId, intent)).toEqual({ status: "new" });
    expect(await store.begin({
      subject: "subject-b",
      smartAccount: "0x2222222222222222222222222222222222222222",
    }, attemptId, { ...intent, customerSubject: "subject-b" })).toEqual({
      status: "mismatch",
    });
  });
});

import { describe, expect, test } from "bun:test";
import { IDRX_BASE_ADDRESS } from "./idrx";
import { MemoryIdrxAttemptStore } from "./idrx-attempt-store";

const owner = {
  subject: "subject-a",
  smartAccount: "0x1111111111111111111111111111111111111111" as const,
};
const attemptId = "11111111-1111-4111-8111-111111111111";
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
  test("claims once, remains pending after ambiguity, and recovers completion", async () => {
    const store = new MemoryIdrxAttemptStore();
    expect(await store.begin(owner, attemptId)).toEqual({ status: "new" });
    expect(await store.begin(owner, attemptId)).toEqual({ status: "pending" });
    await store.complete(owner, attemptId, result);
    expect(await store.begin(owner, attemptId)).toEqual({ status: "completed", result });
  });

  test("does not expose an attempt to another verified owner", async () => {
    const store = new MemoryIdrxAttemptStore();
    expect(await store.begin(owner, attemptId)).toEqual({ status: "new" });
    expect(await store.begin({
      subject: "subject-b",
      smartAccount: "0x2222222222222222222222222222222222222222",
    }, attemptId)).toEqual({ status: "pending" });
  });
});

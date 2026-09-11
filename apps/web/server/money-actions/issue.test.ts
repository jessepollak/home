import { afterEach, describe, expect, test } from "bun:test";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { MoneyActionDraft } from "@/shared/money-actions/types";
import { issueMoneyAction } from "./issue";
import { setMoneyActionStoreForTests } from "./runtime-store";
import { MemoryMoneyActionStore } from "./store";

const session: VerifiedAccountSession = {
  user: { subject: "subject-a" },
  smartAccount: { address: "0x1111111111111111111111111111111111111111", chainId: 8453 },
  accountProvider: "cdp-embedded",
};
const TOKEN = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const SPENDER = "0x3333333333333333333333333333333333333333" as const;

function approval(amount: bigint): `0x${string}` {
  return `0x095ea7b3${SPENDER.slice(2).padStart(64, "0")}${amount.toString(16).padStart(64, "0")}`;
}

function draft(amount = "1000000"): MoneyActionDraft {
  return {
    kind: "save-deposit" as const,
    title: "Deposit USDC",
    calls: [
      {
        to: TOKEN,
        data: approval(BigInt(amount)),
        value: "0",
        approval: { assetId: "usdc", spender: SPENDER },
      },
      { to: SPENDER, data: "0x1234" as const, value: "0" },
    ],
    amounts: [{ assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: amount, direction: "spend" as const }],
    warnings: ["Variable yield."],
    expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  };
}

afterEach(() => setMoneyActionStoreForTests(null));

describe("server-issued money action review plans", () => {
  test("binds exact approval amount and immutable digest to the verified owner", async () => {
    const store = new MemoryMoneyActionStore();
    setMoneyActionStoreForTests(store);
    const action = await issueMoneyAction(session, draft());

    expect(action.owner).toEqual({
      subject: "subject-a",
      address: "0x1111111111111111111111111111111111111111",
      chainId: 8453,
      accountProvider: "cdp-embedded",
    });
    expect(action.reviewHash).toMatch(/^[0-9a-f]{64}$/);
    expect((await store.get(action.owner, action.id))?.action).toEqual(action);
  });

  test("reuses one trusted reserved action identity without resetting its attempt", async () => {
    const store = new MemoryMoneyActionStore();
    setMoneyActionStoreForTests(store);
    const reserved = {
      actionId: "22222222-2222-4222-8222-222222222222",
      createdAt: new Date().toISOString(),
    };
    const reservedDraft = draft();
    const first = await issueMoneyAction(session, reservedDraft, reserved);
    await store.claim(first.owner, first.id, first.reviewHash, new Date().toISOString());
    const retry = await issueMoneyAction(session, reservedDraft, reserved);

    expect(retry).toEqual(first);
    expect(await store.get(first.owner, first.id)).toMatchObject({
      status: "submitting",
      attemptCount: 1,
    });
    await expect(issueMoneyAction(session, {
      ...reservedDraft,
      title: "Different finalized action",
    }, reserved)).rejects.toThrow("duplicate-money-action");
  });

  test("keeps sensitive calldata transient while preserving its durable digest", async () => {
    const store = new MemoryMoneyActionStore();
    setMoneyActionStoreForTests(store);
    const prepared = await issueMoneyAction(session, draft(), {
      sensitivePayloadExpiresAt: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
    });

    expect(prepared.sensitivePayload).toBe(true);
    expect(prepared.calls[0].data).toStartWith("0x095ea7b3");
    expect(prepared.calls[0].dataHash).toMatch(/^[0-9a-f]{64}$/);
    expect((await store.get(prepared.owner, prepared.id))?.action.calls[0].data).toBe("0x");

    const claim = await store.claim(
      prepared.owner,
      prepared.id,
      prepared.reviewHash,
      new Date().toISOString(),
    );
    expect(claim?.action.calls[0].data).toBe(prepared.calls[0].data);
    await store.recordSubmission(
      prepared.owner,
      prepared.id,
      { userOperationHash: `0x${"b".repeat(64)}` },
      new Date().toISOString(),
    );
    expect((await store.get(prepared.owner, prepared.id))?.action.calls[0].data).toBe("0x");
  });

  test("rejects unlimited, mismatched, or cross-asset approval caps before review", async () => {
    setMoneyActionStoreForTests(new MemoryMoneyActionStore());
    const unlimited = draft();
    unlimited.calls[0] = { ...unlimited.calls[0], data: approval((BigInt(1) << BigInt(256)) - BigInt(1)) };
    await expect(issueMoneyAction(session, unlimited)).rejects.toMatchObject({ reason: "invalid-draft" });

    await expect(issueMoneyAction(session, { ...draft(), calls: [
      {
        to: TOKEN,
        data: approval(BigInt(2)),
        value: "0",
        approval: { assetId: "usdc", spender: SPENDER },
      },
      { to: SPENDER, data: "0x1234", value: "0" },
    ] })).rejects.toMatchObject({ reason: "invalid-draft" });

    const crossAsset = draft("1000000000000000000");
    crossAsset.amounts = [
      { assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "1000000", direction: "spend" },
      { assetId: "eth", symbol: "ETH", decimals: 18, amountBaseUnits: "1000000000000000000", direction: "spend" },
    ];
    crossAsset.calls[0] = {
      to: TOKEN,
      data: approval(BigInt("1000000000000000000")),
      value: "0",
      approval: { assetId: "eth", spender: SPENDER },
    };
    await expect(issueMoneyAction(session, crossAsset)).rejects.toMatchObject({ reason: "invalid-draft" });
  });

  test("binds an approval to the reviewed maximum instead of a same-token estimate", async () => {
    setMoneyActionStoreForTests(new MemoryMoneyActionStore());
    const repayAll = draft("1000000");
    repayAll.amounts = [
      { assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "900000", direction: "spend", estimated: true },
      { assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "1000000", direction: "spend", maximum: true },
    ];
    repayAll.calls[0] = { ...repayAll.calls[0], data: approval(BigInt("900000")) };
    await expect(issueMoneyAction(session, repayAll)).rejects.toMatchObject({ reason: "invalid-draft" });

    repayAll.calls[0] = { ...repayAll.calls[0], data: approval(BigInt("1000000")) };
    await expect(issueMoneyAction(session, repayAll)).resolves.toMatchObject({
      amounts: [
        { estimated: true, amountBaseUnits: "900000" },
        { maximum: true, amountBaseUnits: "1000000" },
      ],
    });
  });

  test("normalizes a reviewed maximum spend without treating it as an estimate", async () => {
    setMoneyActionStoreForTests(new MemoryMoneyActionStore());
    const maximum = draft();
    maximum.amounts[0] = { ...maximum.amounts[0], maximum: true };
    const issued = await issueMoneyAction(session, maximum);
    expect(issued.amounts[0].maximum).toBe(true);
    expect("estimated" in issued.amounts[0]).toBe(false);

    maximum.amounts[0] = { ...maximum.amounts[0], estimated: true };
    await expect(issueMoneyAction(session, maximum)).rejects.toMatchObject({ reason: "invalid-draft" });
  });
});

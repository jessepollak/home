import { describe, expect, test } from "bun:test";
import type {
  MoneyActionKind,
  PreparedMoneyAction,
} from "@/features/money-actions/types";
import {
  createClaimMoneyActionHandler,
  type SessionAuthorizer,
} from "@/server/money-actions/handlers";
import { MemoryMoneyActionStore } from "@/server/money-actions/store";
import { createTradePreclaimGate } from "./preclaim";
import { TradeRuntimeCapabilityError } from "./runtime-intent-store";

const OWNER = {
  subject: "trade-user",
  address: "0x1111111111111111111111111111111111111111",
  chainId: 8453,
  accountProvider: "cdp-embedded",
} as const;
const REVIEW_HASH = "a".repeat(64);
const CREATED_AT = "2026-09-09T12:00:00.000Z";
const EXPIRES_AT = "2026-09-09T12:10:00.000Z";
const CLAIMED_AT = "2026-09-09T12:01:00.000Z";

const authorize: SessionAuthorizer = async () => Response.json({
  user: { subject: OWNER.subject },
  smartAccount: { address: OWNER.address, chainId: OWNER.chainId },
  accountProvider: OWNER.accountProvider,
});

function action(kind: MoneyActionKind, id: string): PreparedMoneyAction {
  return {
    id,
    reviewHash: REVIEW_HASH,
    owner: OWNER,
    kind,
    title: `Prepared ${kind}`,
    calls: [{ to: "0x2222222222222222222222222222222222222222", data: "0x", value: "1" }],
    amounts: [{ assetId: "eth", symbol: "ETH", decimals: 18, amountBaseUnits: "1", direction: "spend" }],
    warnings: ["Review before signing."],
    createdAt: CREATED_AT,
    expiresAt: EXPIRES_AT,
    ...(kind === "swap" ? { quoteId: "quote-1" } : {}),
  };
}

function claimRequest(id: string): Request {
  return new Request(`https://home.test/api/actions/${id}/claim`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Home-Account-Provider": OWNER.accountProvider,
    },
    body: JSON.stringify({ reviewHash: REVIEW_HASH }),
  });
}

describe("trade preclaim composition", () => {
  test("send, save, and borrow claims bypass unavailable trade storage and provider initialization", async () => {
    let tradeRuntimeInitializations = 0;
    const validateBeforeClaim = createTradePreclaimGate(async () => {
      tradeRuntimeInitializations += 1;
      throw new TradeRuntimeCapabilityError();
    });
    const cases: Array<{ kind: MoneyActionKind; id: string }> = [
      { kind: "send", id: "11111111-1111-4111-8111-111111111111" },
      { kind: "save-deposit", id: "22222222-2222-4222-8222-222222222222" },
      { kind: "borrow", id: "33333333-3333-4333-8333-333333333333" },
    ];

    for (const item of cases) {
      const store = new MemoryMoneyActionStore();
      await store.issue(action(item.kind, item.id));
      const handler = createClaimMoneyActionHandler({
        authorize,
        store,
        validateBeforeClaim,
        now: () => new Date(CLAIMED_AT),
      });

      const response = await handler(claimRequest(item.id), {
        params: Promise.resolve({ id: item.id }),
      });
      expect(response.status).toBe(200);
      expect((await response.json()).disposition).toBe("dispatch");
      expect((await store.get(OWNER, item.id))?.attemptCount).toBe(1);
    }

    expect(tradeRuntimeInitializations).toBe(0);
  });

  test("swap claims still fail before dispatch when the trade runtime is unavailable", async () => {
    const id = "44444444-4444-4444-8444-444444444444";
    const store = new MemoryMoneyActionStore();
    await store.issue(action("swap", id));
    let tradeRuntimeInitializations = 0;
    const handler = createClaimMoneyActionHandler({
      authorize,
      store,
      validateBeforeClaim: createTradePreclaimGate(async () => {
        tradeRuntimeInitializations += 1;
        throw new TradeRuntimeCapabilityError();
      }),
      now: () => new Date(CLAIMED_AT),
    });

    const response = await handler(claimRequest(id), {
      params: Promise.resolve({ id }),
    });
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("ACTION_PRECONDITION_FAILED");
    expect((await store.get(OWNER, id))?.status).toBe("prepared");
    expect((await store.get(OWNER, id))?.attemptCount).toBe(0);
    expect(tradeRuntimeInitializations).toBe(1);
  });
});

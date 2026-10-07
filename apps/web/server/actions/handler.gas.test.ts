import { afterEach, describe, expect, test } from "bun:test";
import { BORROW_MARKETS } from "@/shared/borrowing/config";
import { requireAddress } from "@/shared/chain/hex";
import { parseConfirmActionResponse } from "@/shared/actions/contracts/confirm";
import type { AccountProvider } from "@/shared/account/session-types";
import type { BorrowMoneyActionMetadata, MoneyActionCall } from "@/shared/money-actions/types";
import { resolveProductOffering } from "@/shared/operator-settings/products";
import { approveCall, borrowCall, repaySharesCall, supplyCollateralCall, withdrawCollateralCall } from "@/server/borrowing/abi";
import { setObservabilityLogWriterForTests } from "@/server/observability/log";
import { createConfirmActionHandler } from "./handler";
import type { ActionRow } from "./store";

const OWNER = "0x1111111111111111111111111111111111111111" as const;
const ID = "11111111-1111-4111-8111-111111111111";
const NOW = "2026-10-07T03:45:00.000Z";
const MARKET = BORROW_MARKETS[0];

function row(operation: "supply-and-borrow" | "close-position", provider: AccountProvider): ActionRow {
  const metadata: BorrowMoneyActionMetadata = {
    product: "borrow", operation, marketId: MARKET.marketId,
    loanAsset: { id: MARKET.loanToken.id, symbol: MARKET.loanToken.symbol },
    collateralAsset: { id: MARKET.collateralToken.id, symbol: MARKET.collateralToken.symbol },
    projectedHealthFactorWad: null, projectedLiquidationPriceRaw: null, borrowAprWad: "0",
    source: { blockNumber: "52277696", blockHash: `0x${"ab".repeat(32)}`, blockTimestamp: "1791344739" },
  };
  const calls = operation === "supply-and-borrow"
    ? [approveCall(MARKET.collateralToken, MARKET.morpho, BigInt(10_370)), supplyCollateralCall(MARKET, BigInt(10_370), OWNER), borrowCall(MARKET, BigInt(5_000_000), OWNER)]
    : [approveCall(MARKET.loanToken, MARKET.morpho, BigInt(5_000_200)), repaySharesCall(MARKET, BigInt(5_000_000), OWNER), withdrawCollateralCall(MARKET, BigInt(10_370), OWNER)];
  return {
    id: ID, owner_key: JSON.stringify(["owner", OWNER, 8453, provider]), account_address: OWNER, provider,
    kind: operation === "supply-and-borrow" ? "borrow" : "repay",
    summary: { title: "Borrow operation", amounts: [], warnings: [], expiresAt: "2026-10-07T03:47:00.000Z", metadata },
    pending: { calls: calls.map((call) => ({ ...call, to: requireAddress(call.to),
      ...(call.approval ? { approval: { ...call.approval, spender: requireAddress(call.approval.spender) } } : {}) })) },
    created_at: NOW, confirmed_at: null, provider_handle: null, transaction_hash: null,
    handle_recorded_at: null, declined_reported_at: null, dispatch_attempt: 0, outcome: null,
    outcome_source: null, settled_at: null, outcome_recorded_at: null,
  };
}

async function confirm(draft: ActionRow, estimate: (calls: readonly MoneyActionCall[], account: `0x${string}`, signal?: AbortSignal) => Promise<bigint>) {
  const stored: MoneyActionCall[][] = [];
  const handler = createConfirmActionHandler({
    authorize: async () => ({ user: { subject: "owner" }, smartAccount: { address: OWNER, chainId: 8453 as const }, accountProvider: draft.provider }),
    now: () => new Date(NOW), markHot: async () => {}, recordConfirmed: async () => {},
    readOffering: async () => resolveProductOffering({ kind: "deployment" }),
    estimateBaseBatch: estimate,
    store: {
      get: async () => draft,
      confirm: async (_owner, _id, calls) => {
        if (!calls) throw new Error("Missing confirmed calls");
        stored.push(calls);
        return { ...draft, pending: { calls }, confirmed_at: NOW };
      },
    },
  });
  const response = await handler(new Request(`https://home.test/api/actions/${ID}/confirm`, {
    method: "POST", headers: { "X-Home-Account-Provider": draft.provider },
  }), { params: Promise.resolve({ id: ID }) });
  const body: unknown = await response.json();
  const parsed = parseConfirmActionResponse(body);
  return { response, parsed, stored };
}

afterEach(() => setObservabilityLogWriterForTests());

describe("Base Account dependent-batch confirm gas", () => {
  test.each(["supply-and-borrow", "close-position"] as const)("estimates the exact ordered %s batch with headroom", async (operation) => {
    const draft = row(operation, "base-account");
    const captured: MoneyActionCall[][] = [];
    const events: string[] = [];
    setObservabilityLogWriterForTests((line) => events.push(line));
    const result = await confirm(draft, async (calls, account, signal) => {
      expect(account).toBe(OWNER);
      expect(signal).toBeInstanceOf(AbortSignal);
      captured.push([...calls]);
      return BigInt(207_391);
    });
    expect(result.response.status).toBe(200);
    expect(result.parsed).toEqual({ calls: draft.pending?.calls, batchGasLimit: "257391" });
    expect(captured).toEqual([draft.pending?.calls]);
    expect(result.stored).toEqual([draft.pending?.calls]);
    expect(events.map((event): unknown => JSON.parse(event))).toContainEqual(expect.objectContaining({ code: "BASE_BATCH_GAS_HINT_APPLIED", outcome: "ok" }));
  });

  test.each(["rejected", "timeout", "over-cap", "negative"])("retains calls and reports unavailable headroom when estimation is %s", async (failure) => {
    const draft = row("supply-and-borrow", "base-account");
    const events: string[] = [];
    setObservabilityLogWriterForTests((line) => events.push(line));
    const result = await confirm(draft, async () => {
      if (failure === "over-cap") return BigInt(2_000_001);
      if (failure === "negative") return BigInt(-1);
      throw failure === "timeout" ? new DOMException("Timed out", "TimeoutError") : new Error("RPC rejected");
    });
    expect(result.response.status).toBe(200);
    expect(result.parsed).toEqual({ calls: draft.pending?.calls });
    expect(result.stored).toEqual([draft.pending?.calls]);
    expect(events.map((event): unknown => JSON.parse(event))).toContainEqual(expect.objectContaining({ code: "BASE_BATCH_GAS_HINT_UNAVAILABLE", outcome: "unavailable" }));
  });

  test("embedded-wallet confirmations preserve calls without invoking the Base estimator", async () => {
    const draft = row("supply-and-borrow", "cdp-embedded");
    let estimates = 0;
    const result = await confirm(draft, async () => { estimates++; throw new Error("Wrong provider"); });
    expect(result.response.status).toBe(200);
    expect(result.parsed).toEqual({ calls: draft.pending?.calls });
    expect(estimates).toBe(0);
  });
});

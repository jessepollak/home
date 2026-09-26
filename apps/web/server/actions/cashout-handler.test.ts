import "server-only";

import { afterEach, describe, expect, jest, test } from "bun:test";
import { createListActionsHandler } from "./handler";
import { actionOwnerKey, type ActionRow, type CashoutOrderRow } from "./store";

const owner = { subject: "owner", address: "0x1111111111111111111111111111111111111111" as const, chainId: 8453 as const, accountProvider: "cdp-embedded" as const };
const timestamp = "2026-09-12T12:00:00.000Z";
const hash = `0x${"ab".repeat(32)}` as const;
const id = "11111111-1111-4111-8111-111111111111";
const row: ActionRow = {
  id, owner_key: actionOwnerKey(owner), provider: "cdp-embedded", kind: "cash-out",
  summary: { title: "Cash out", amounts: [], warnings: [], expiresAt: timestamp },
  pending: null, created_at: timestamp, confirmed_at: timestamp, provider_handle: hash, transaction_hash: hash, handle_recorded_at: timestamp,
  account_address: owner.address, declined_reported_at: null, dispatch_attempt: 0, outcome: null,
  outcome_source: null, settled_at: null, outcome_recorded_at: null,
};
const record: CashoutOrderRow = {
  action_id: id, owner_key: actionOwnerKey(owner), provider_id: "peer", environment: "production", region: "US", deposit_id: "deposit_7",
  deposit_proven: true,
  state: "awaiting-buyer", platform: "cashapp", platform_label: "Cash App", amount_atomic: "2000000", filled_atomic: "500000",
  returned_atomic: "0", remaining_atomic: "1500000", withdrawable: true, eta_seconds: 100,
  created_at: timestamp, updated_at: timestamp, refreshed_at: null, settled_at: null,
};

describe("cash-out Activity projection", () => {
  afterEach(() => jest.useRealTimers());

  test("refreshes cash-outs after a receipt read exhausts its deadline", async () => {
    jest.useFakeTimers();
    let receiptStarted!: () => void;
    const started = new Promise<void>((resolve) => { receiptStarted = resolve; });
    const refreshSignals: AbortSignal[] = [];
    const handler = createListActionsHandler({
      authorize: async () => Response.json({ user: { subject: owner.subject }, smartAccount: { address: owner.address, chainId: 8453 }, accountProvider: owner.accountProvider }),
      store: { list: async () => [row], recordHandle: async () => null, recordOutcome: async () => ({ row, written: false, conflict: false }) },
      readReceipt: async (_hash, signal) => {
        if (!signal) throw new Error("Receipt signal is required.");
        receiptStarted();
        return await new Promise<never>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      },
      refreshCashouts: async ({ signal }) => {
        refreshSignals.push(signal);
        return [record];
      },
    });
    const pending = handler(new Request("https://home.test/api/actions", { headers: { "X-Home-Account-Provider": "cdp-embedded" } }));
    await started;
    void jest.advanceTimersByTime(3_000);
    expect((await pending).status).toBe(200);
    expect(refreshSignals).toHaveLength(1);
    expect(refreshSignals[0]?.aborted).toBe(false);
  });

  test("projects unresolved withdrawals using the dispatch window, handle evidence, and matching deposit", async () => {
    const withdrawal: ActionRow = {
      ...row, id: "22222222-2222-4222-8222-222222222222", kind: "cash-out-withdraw",
      summary: { ...row.summary, metadata: {
        product: "cashout", operation: "withdraw", depositId: "DEPOSIT_7", providerId: "peer", providerName: "Peer",
        environment: "production", platform: "cashapp", platformLabel: "Cash App", currency: "USD",
        approximateFiatAmount: "1.5", minConversionRate: "1", intentAmountRange: { min: "1", max: "2" },
        estimateAsOf: timestamp, escrow: owner.address,
      } },
      confirmed_at: timestamp, provider_handle: null, handle_recorded_at: null, transaction_hash: null,
    };
    let rows: ActionRow[] = [row, withdrawal];
    const handler = (now: string, depositId: string | null = record.deposit_id) => createListActionsHandler({
      authorize: async () => Response.json({ user: { subject: owner.subject }, smartAccount: { address: owner.address, chainId: 8453 }, accountProvider: owner.accountProvider }),
      store: { list: async () => rows, recordHandle: async () => null, recordOutcome: async () => ({ row, written: false, conflict: false }) },
      readReceipt: async () => ({ status: "pending", transactionHash: hash }),
      refreshCashouts: async () => [{ ...record, deposit_id: depositId }],
      now: () => new Date(now),
    });
    const request = () => new Request("https://home.test/api/actions", { headers: { "X-Home-Account-Provider": "cdp-embedded" } });
    const withdrawing = async (now: string, depositId?: string | null) => {
      const response = await handler(now, depositId)(request());
      expect(response.status).toBe(200);
      const body = await response.json() as { actions: Array<{ cashout?: { withdrawing: boolean } }> };
      return body.actions.find((action) => action.cashout)?.cashout?.withdrawing;
    };
    expect(await withdrawing("2026-09-12T12:01:00.000Z")).toBe(true);
    rows = [row, { ...withdrawal, provider_handle: "wallet-handle", handle_recorded_at: timestamp }];
    expect(await withdrawing("2026-09-12T12:16:00.000Z")).toBe(true);
    rows = [row, withdrawal];
    expect(await withdrawing("2026-09-12T12:16:00.000Z")).toBe(false);
    rows = [row, { ...withdrawal, declined_reported_at: timestamp }];
    expect(await withdrawing("2026-09-12T12:01:00.000Z")).toBe(false);
    rows = [row, withdrawal];
    expect(await withdrawing("2026-09-12T12:01:00.000Z", null)).toBe(false);
    expect(await withdrawing("2026-09-12T12:01:00.000Z", "different")).toBe(false);
  });

  test("refreshes after receipt reads and presents only the shared progress fields", async () => {
    const order: string[] = [];
    const handler = createListActionsHandler({
      authorize: async () => Response.json({ user: { subject: owner.subject }, smartAccount: { address: owner.address, chainId: 8453 }, accountProvider: owner.accountProvider }),
      store: { list: async () => [row], recordHandle: async () => null, recordOutcome: async () => ({ row, written: false, conflict: false }) },
      readReceipt: async () => { order.push("receipt"); return { status: "confirmed", transactionHash: hash, blockNumber: "1",
        blockTimestamp: timestamp, finalized: false, userOperations: [{ userOpHash: hash, sender: owner.address, success: true }] }; },
      refreshCashouts: async ({ rows, owner: scopedOwner }) => {
        order.push("refresh");
        expect(rows[0]?.receipt).toBe("confirmed");
        expect(scopedOwner.subject).toBe("owner");
        return [record];
      },
    });
    const response = await handler(new Request("https://home.test/api/actions", { headers: { "X-Home-Account-Provider": "cdp-embedded" } }));
    expect(response.status).toBe(200);
    expect(order).toEqual(["receipt", "refresh"]);
    const body = await response.json() as { actions: Array<{ cashout: unknown }> };
    expect(body.actions[0]?.cashout).toEqual({ version: 1, providerId: "peer", region: "US", depositId: "deposit_7", state: "awaiting-buyer",
      platform: "cashapp", platformLabel: "Cash App", amountAtomic: "2000000", filledAtomic: "500000", returnedAtomic: "0",
      remainingAtomic: "1500000", withdrawable: true, withdrawing: false, etaSeconds: 100, settledAt: null, updatedAt: timestamp });
  });
});

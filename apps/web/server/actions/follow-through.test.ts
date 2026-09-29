import { afterEach, describe, expect, test } from "bun:test";
import { setObservabilityLogWriterForTests } from "@/server/observability/log";
import { createHandleActionHandler } from "./handler";
import { followActionUntilSettled, recheckOpenActions, settleOpenActionsForAccounts, type FollowActionDeps } from "./follow-through";
import { actionOwnerKey, ownerFromActionKey, type ActionRow, type ActionsStore } from "./store";
import type { MoneyActionOwner } from "@/shared/money-actions/types";

const address = "0x1111111111111111111111111111111111111111" as const;
const hash = `0x${"cd".repeat(32)}` as const;
const handle = `0x${"ab".repeat(32)}` as const;
const id = "11111111-1111-4111-8111-111111111111";
const owner = (provider: "base-account" | "cdp-embedded"): MoneyActionOwner => ({ subject: "fixture", address, chainId: 8453, accountProvider: provider });
function fixture(provider: "base-account" | "cdp-embedded"): ActionRow {
  return { id, owner_key: actionOwnerKey(owner(provider)), account_address: address, provider, kind: "send",
    summary: { title: "Send", amounts: [], warnings: [], expiresAt: "2099-01-01T00:00:00.000Z" }, pending: null,
    created_at: new Date("2026-09-28T12:00:00.000Z"), confirmed_at: new Date("2026-09-28T12:00:00.000Z"), provider_handle: null, transaction_hash: null,
    handle_recorded_at: null, declined_reported_at: null, dispatch_attempt: 0, outcome: null, outcome_source: null,
    settled_at: null, outcome_recorded_at: null };
}

function memory(initial: ActionRow) {
  let row = initial;
  const store = {
    get: async () => row,
    recordHandle: async (_owner: MoneyActionOwner, _id: string, input: { providerHandle?: string; transactionHash?: string }) => {
      row = { ...row, provider_handle: row.provider_handle ?? input.providerHandle ?? null,
        transaction_hash: row.transaction_hash ?? input.transactionHash ?? null };
      return row;
    },
    recordReceiptObservation: async (_owner: MoneyActionOwner, _id: string, input: {
      transactionHash: string; blockNumber: string; blockHash: string; outcome: "succeeded" | "reverted";
    }) => {
      row = { ...row, observed_receipt_transaction_hash: input.transactionHash,
        observed_receipt_block_number: input.blockNumber, observed_receipt_block_hash: input.blockHash,
        observed_receipt_outcome: input.outcome };
      return row;
    },
    recordOutcome: async (_owner: MoneyActionOwner, _id: string, input: { outcome: "succeeded" | "reverted" | "not_submitted" }) => {
      row = { ...row, outcome: input.outcome };
      return { row, written: true, conflict: false };
    },
  } as unknown as Pick<ActionsStore, "get" | "recordHandle" | "recordReceiptObservation" | "recordOutcome">;
  return { store, current: () => row };
}

afterEach(() => setObservabilityLogWriterForTests());

describe("server-side action follow-through", () => {
  test("a webhook that checks an unresolved handle records an observed action without exposing its address", async () => {
    const row = { ...fixture("cdp-embedded"), provider_handle: handle };
    const { store } = memory(row);
    const lines: string[] = [];
    setObservabilityLogWriterForTests((line) => { lines.push(line); });
    await settleOpenActionsForAccounts([address], { signal: new AbortController().signal, route: "/api/webhooks/cdp",
      deps: { store: { ...store, listOpenByAccounts: async () => [row] }, resolveHandle: async () => ({ status: "pending" }) },
    });
    expect(lines.map((line) => JSON.parse(line))).toContainEqual(expect.objectContaining({
      kind: "action-reconcile", code: "WEBHOOK_ACTION_OBSERVED", outcome: "skipped",
    }));
    expect(lines.join(" ")).not.toContain(address);
    expect(lines.join(" ")).not.toContain(handle);
  });

  test("a webhook delivery allocates its open-action budget per matched wallet", async () => {
    const second = "0x2222222222222222222222222222222222222222" as const;
    const calls: Array<{ addresses: readonly string[]; total: number; perAccount: number | undefined }> = [];
    setObservabilityLogWriterForTests(() => {});
    const { store } = memory(fixture("cdp-embedded"));
    await settleOpenActionsForAccounts([address, second], { signal: new AbortController().signal, route: "/api/webhooks/cdp", limit: 4,
      deps: { store: { ...store, listOpenByAccounts: async (addresses: readonly string[], _since: Date, total: number, perAccount?: number) => {
        calls.push({ addresses, total, perAccount }); return [];
      } } as unknown as FollowActionDeps["store"] } });

    expect(calls).toEqual([{ addresses: [address, second], total: 8, perAccount: 4 }]);
  });


  test("a delivery follows its matched rows with bounded concurrency instead of serially", async () => {
    const rows = Array.from({ length: 8 }, (_, index) => ({ ...fixture("cdp-embedded"),
      id: `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`, provider_handle: handle }));
    const byId = new Map(rows.map((row) => [row.id, row]));
    const followed: string[] = [];
    let active = 0;
    let peak = 0;
    setObservabilityLogWriterForTests(() => {});
    await settleOpenActionsForAccounts([address], { signal: new AbortController().signal, route: "/api/webhooks/cdp", limit: 8,
      deps: { store: {
        ...memory(rows[0]!).store,
        get: async (_owner: MoneyActionOwner, rowId: string) => {
          active += 1; peak = Math.max(peak, active);
          await Promise.resolve();
          active -= 1;
          return byId.get(rowId) ?? null;
        },
        listOpenByAccounts: async () => rows,
      } as unknown as FollowActionDeps["store"],
      resolveHandle: async (row) => { followed.push(row.id); return { status: "pending" }; } } });

    expect(followed).toHaveLength(rows.length);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThan(rows.length);
  });

  test("a slow row cannot consume another matched wallet's attempt", async () => {
    const slowAddress = "0x2222222222222222222222222222222222222222" as const;
    const fastId = "33333333-3333-4333-8333-333333333333";
    const slowId = "22222222-2222-4222-8222-222222222222";
    const slow = { ...fixture("cdp-embedded"), id: slowId, account_address: slowAddress,
      owner_key: actionOwnerKey({ subject: "fixture", address: slowAddress, chainId: 8453, accountProvider: "cdp-embedded" }),
      provider_handle: handle };
    const fast = { ...fixture("cdp-embedded"), id: fastId, provider_handle: handle };
    const byId = new Map<string, ActionRow>([[slowId, slow], [fastId, fast]]);
    const attempted: string[] = [];
    setObservabilityLogWriterForTests(() => {});
    const store = {
      get: async (_owner: MoneyActionOwner, rowId: string) => byId.get(rowId) ?? null,
      recordHandle: async (_owner: MoneyActionOwner, rowId: string, input: { providerHandle?: string; transactionHash?: string }) => {
        const row = byId.get(rowId);
        if (!row) return null;
        const next = { ...row, provider_handle: row.provider_handle ?? input.providerHandle ?? null,
          transaction_hash: row.transaction_hash ?? input.transactionHash ?? null };
        byId.set(rowId, next);
        return next;
      },
      recordReceiptObservation: async (_owner: MoneyActionOwner, rowId: string, input: {
        transactionHash: string; blockNumber: string; blockHash: string; outcome: "succeeded" | "reverted";
      }) => {
        const row = byId.get(rowId);
        if (!row) return null;
        const next = { ...row, observed_receipt_transaction_hash: input.transactionHash,
          observed_receipt_block_number: input.blockNumber, observed_receipt_block_hash: input.blockHash,
          observed_receipt_outcome: input.outcome };
        byId.set(rowId, next);
        return next;
      },
      recordOutcome: async (_owner: MoneyActionOwner, rowId: string, input: { outcome: "succeeded" | "reverted" | "not_submitted" }) => {
        const row = byId.get(rowId)!;
        const next = { ...row, outcome: input.outcome };
        byId.set(rowId, next);
        return { row: next, written: true, conflict: false };
      },
      listOpenByAccounts: async () => [slow, fast],
    } as unknown as FollowActionDeps["store"];

    await settleOpenActionsForAccounts([slowAddress, address], { signal: new AbortController().signal, route: "/api/webhooks/cdp",
      rowBudgetMs: 20,
      deps: { store,
        resolveHandle: async (row, signal) => {
          attempted.push(row.id);
          if (row.id === slowId) await new Promise<void>((resolve) => {
            if (signal?.aborted) { resolve(); return; }
            signal?.addEventListener("abort", () => resolve(), { once: true });
          });
          return row.id === fastId ? { status: "complete", transactionHash: hash } : { status: "pending" };
        },
        readReceipt: async () => ({ status: "confirmed", transactionHash: hash, blockNumber: "1",
          blockHash: `0x${"ef".repeat(32)}`, blockTimestamp: "2026-09-12T00:00:00.000Z", finalized: true,
          userOperations: [{ userOpHash: handle, sender: address, success: true }] }) } });

    expect(attempted).toContain(fastId);
    expect(byId.get(fastId)).toMatchObject({ outcome: "succeeded" });
    expect(byId.get(slowId)).toMatchObject({ outcome: null, transaction_hash: null });
  }, 5_000);

  test("one row's storage failure does not abandon the other rows", async () => {
    const rows = Array.from({ length: 3 }, (_, index) => ({ ...fixture("cdp-embedded"),
      id: `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`, provider_handle: handle }));
    const byId = new Map(rows.map((row) => [row.id, row]));
    const followed: string[] = [];
    let reads = 0;
    setObservabilityLogWriterForTests(() => {});
    await expect(settleOpenActionsForAccounts([address], { signal: new AbortController().signal, route: "/api/webhooks/cdp",
      deps: { store: {
        ...memory(rows[0]!).store,
        get: async (_owner: MoneyActionOwner, rowId: string) => {
          reads += 1;
          if (reads === 1) throw new Error("storage offline");
          return byId.get(rowId) ?? null;
        },
        listOpenByAccounts: async () => rows,
      } as unknown as FollowActionDeps["store"],
      resolveHandle: async (row) => { followed.push(row.id); return { status: "pending" }; } } })).rejects.toThrow("storage offline");

    expect(followed).toHaveLength(rows.length - 1);
  });

  test("an operator re-check follows its rows with bounded concurrency", async () => {
    const rows = Array.from({ length: 8 }, (_, index) => ({ ...fixture("cdp-embedded"),
      id: `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`, provider_handle: handle }));
    const byId = new Map(rows.map((row) => [row.id, row]));
    let active = 0;
    let peak = 0;
    setObservabilityLogWriterForTests(() => {});
    await recheckOpenActions({ signal: new AbortController().signal, limit: 8, route: "/admin", deps: {
      now: () => 0,
      store: {
        ...memory(rows[0]!).store,
        get: async (_owner: MoneyActionOwner, rowId: string) => {
          active += 1; peak = Math.max(peak, active);
          await Promise.resolve();
          active -= 1;
          return byId.get(rowId) ?? null;
        },
        listOpenForFollowUp: async () => rows,
      } as unknown as FollowActionDeps["store"],
      resolveHandle: async () => ({ status: "pending" }),
    } });

    expect(peak).toBeGreaterThan(1);
  });
  test("an operator re-check follows at most its limit of open actions and rotates through the rest", async () => {
    const rows = Array.from({ length: 12 }, (_, index) => ({
      ...fixture("cdp-embedded"),
      id: `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`,
      provider_handle: handle,
    }));
    const byId = new Map(rows.map((row) => [row.id, row]));
    const followed = async (nowMs: number) => {
      const checked: string[] = [];
      await recheckOpenActions({ signal: new AbortController().signal, limit: 10, route: "/admin", deps: {
        now: () => nowMs,
        store: {
          ...memory(rows[0]!).store,
          get: async (_owner: MoneyActionOwner, rowId: string) => byId.get(rowId) ?? null,
          listOpenForFollowUp: async () => rows,
        } as unknown as FollowActionDeps["store"],
        resolveHandle: async (row) => { checked.push(row.id); return { status: "pending" }; },
      } });
      return checked;
    };

    const first = await followed(0);
    const later = await followed(61_000);

    expect(first).toHaveLength(10);
    expect(new Set(first).size).toBe(10);
    expect(later).toHaveLength(10);
    expect(later).toContain(rows[10]!.id);
    expect(first).not.toContain(rows[10]!.id);
  });

  for (const provider of ["cdp-embedded", "base-account"] as const) {
    test(`${provider} records a finalized result after POST /handle with no further browser call`, async () => {
      const { store, current } = memory(fixture(provider));
      const tasks: Array<() => Promise<unknown>> = [];
      const deps: FollowActionDeps = { store,
        resolveHandle: async () => ({ status: "complete", transactionHash: hash }),
        readReceipt: async () => ({ status: "confirmed", transactionHash: hash, blockNumber: "10",
          blockHash: `0x${"ef".repeat(32)}`, blockTimestamp: "2026-09-12T00:00:00.000Z", finalized: true,
          userOperations: [{ userOpHash: handle, sender: address, success: true }] }),
      };
      const handler = createHandleActionHandler({
        authorize: async () => Response.json({ user: { subject: "fixture" }, smartAccount: { address, chainId: 8453 }, accountProvider: provider }),
        store, followDeps: deps, schedule: (task) => tasks.push(task),
      });
      const post = () => handler(new Request(`https://home.test/api/actions/${id}/handle`, { method: "POST",
        headers: { "X-Home-Account-Provider": provider }, body: JSON.stringify({ providerHandle: handle }) }),
      { params: Promise.resolve({ id }) });
      expect((await post()).status).toBe(200);
      expect(current().transaction_hash).toBeNull();
      expect(tasks).toHaveLength(1);
      await tasks[0]!();
      expect(current()).toMatchObject({ transaction_hash: hash, observed_receipt_outcome: "succeeded", outcome: "succeeded" });
      expect((await post()).status).toBe(200);
      expect(tasks).toHaveLength(1);
    });
  }

  test("stops at an attributable receipt observation before finality", async () => {
    const { store } = memory({ ...fixture("cdp-embedded"), provider_handle: handle });
    const result = await followActionUntilSettled(await store.get(owner("cdp-embedded"), id) as ActionRow, {
      deadlineMs: 10_000, signal: new AbortController().signal, route: "/test",
      deps: { store, resolveHandle: async () => ({ status: "complete", transactionHash: hash }),
        readReceipt: async () => ({ status: "confirmed", transactionHash: hash, blockNumber: "1",
          blockHash: `0x${"ef".repeat(32)}`, blockTimestamp: "2026-09-12T00:00:00.000Z", finalized: false,
          userOperations: [{ userOpHash: handle, sender: address, success: true }] }) },
      sleep: async () => { throw new Error("should not sleep after attribution"); },
    });
    expect(result).toMatchObject({ outcome: null, observed_receipt_outcome: "succeeded" });
  });

  test("stops at the deadline using a fake clock without real sleeps", async () => {
    const { store } = memory({ ...fixture("cdp-embedded"), provider_handle: handle });
    let time = 0;
    let sleeps = 0;
    const result = await followActionUntilSettled(await store.get(owner("cdp-embedded"), id) as ActionRow, {
      deadlineMs: 5_000, signal: new AbortController().signal, route: "/test",
      deps: { store, now: () => time, resolveHandle: async () => ({ status: "pending" }) },
      sleep: async (ms) => { time += ms; sleeps++; },
    });
    expect(result.transaction_hash).toBeNull();
    expect(sleeps).toBe(2);
  });

  test("rejects a forged owner key before accessing storage", async () => {
    expect(ownerFromActionKey(JSON.stringify(["fixture", address, 1, "cdp-embedded"]))).toBeNull();
    expect(ownerFromActionKey(actionOwnerKey(owner("cdp-embedded")))).toEqual(owner("cdp-embedded"));
  });
});

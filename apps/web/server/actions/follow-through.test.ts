import { describe, expect, jest, test } from "bun:test";
import type { SqlExecutor, SqlQueryOptions } from "@/server/db/sql";
import type { MoneyActionOwner } from "@/shared/money-actions/types";
import { followAction, recheckOpenActions, settleOpenActionsForAccounts } from "./follow-through";
import { actionOwnerKey, ActionsStore, type ActionRow } from "./store";

const ROW_BUDGET_MS = 20;

async function advanceRowDeadlines(run: Promise<void>): Promise<void> {
  let settled = false;
  const observe = () => { settled = true; };
  void run.then(observe, observe);
  for (let step = 0; !settled; step += 1) {
    if (step === 50) throw new Error("the row budget did not settle the batch");
    await Promise.resolve();
    jest.advanceTimersByTime(ROW_BUDGET_MS);
  }
  await run;
}

const owner: MoneyActionOwner = {
  subject: "owner", address: "0x1111111111111111111111111111111111111111",
  chainId: 8453, accountProvider: "base-account",
};

function actionRow(index = 1): ActionRow {
  return {
    id: `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`,
    owner_key: actionOwnerKey(owner), account_address: owner.address, provider: owner.accountProvider, kind: "send",
    summary: { title: "Send USDC", amounts: [], warnings: [], expiresAt: "2026-10-01T12:03:00.000Z" },
    pending: null, created_at: "2026-10-01T12:00:00.000Z", confirmed_at: "2026-10-01T12:00:00.000Z",
    provider_handle: null, transaction_hash: `0x${"ab".repeat(32)}`, handle_recorded_at: null,
    declined_reported_at: null, dispatch_attempt: 0, outcome: null, outcome_source: null,
    settled_at: null, outcome_recorded_at: null,
  };
}

function storeWithRead(rows: ActionRow[], read: SqlExecutor["query"]): ActionsStore {
  class ListedStore extends ActionsStore {
    override async listOpenByAccounts(): Promise<ActionRow[]> { return rows; }
    override async listOpenForFollowUp(): Promise<ActionRow[]> { return rows; }
  }
  return new ListedStore({
    query: read,
    async transaction() { throw new Error("Follow-through must not start a transaction."); },
  });
}

const accountSettlement = {
  name: "account settlement",
  run: (store: ActionsStore, signal: AbortSignal) => settleOpenActionsForAccounts([owner.address], {
    signal, route: "/api/webhooks/cdp", rowBudgetMs: ROW_BUDGET_MS, deps: { store },
  }),
};
const openActionRecheck = {
  name: "open action recheck",
  run: (store: ActionsStore, signal: AbortSignal) => recheckOpenActions({
    signal, route: "/admin", rowBudgetMs: ROW_BUDGET_MS, deps: { store },
  }),
};
const batches = [accountSettlement, openActionRecheck];

describe("follow-through action-store deadlines", () => {
  for (const batch of batches) {
    test(`${batch.name} releases stalled reads at the row budget and continues queued rows`, async () => {
      jest.useFakeTimers();
      try {
        const reads: Array<{ id: unknown; options?: SqlQueryOptions }> = [];
        const rows = Array.from({ length: 5 }, (_, index) => actionRow(index + 1));
        const store = storeWithRead(rows, (_text, values, options) => {
          reads.push({ id: values?.[0], options });
          return new Promise((_resolve, reject) => {
            const signal = options?.signal;
            if (signal?.aborted) reject(signal.reason);
            else signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
          });
        });
        const caller = new AbortController();

        await advanceRowDeadlines(batch.run(store, caller.signal));

        expect(reads.map((read) => read.id).sort()).toEqual(rows.map((row) => row.id).sort());
        expect(caller.signal.aborted).toBe(false);
        for (const read of reads) {
          expect(read.options?.timeoutMs).toBeGreaterThan(0);
          expect(read.options?.signal?.aborted).toBe(true);
          expect(read.options?.signal?.reason).toBeInstanceOf(DOMException);
          expect(read.options?.signal?.reason).toMatchObject({ name: "TimeoutError" });
        }
      } finally {
        jest.useRealTimers();
      }
    }, 500);
  }

  test("returns the unchanged row when the caller aborts a stalled read", async () => {
    const row = actionRow();
    const caller = new AbortController();
    const reads: SqlQueryOptions[] = [];
    const sql: SqlExecutor = {
      query: (_text, _values, options) => {
        if (options) reads.push(options);
        return new Promise((_resolve, reject) => {
          const signal = options?.signal;
          if (signal?.aborted) reject(signal.reason);
          else signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      },
      async transaction() { throw new Error("Follow-through must not start a transaction."); },
    };
    const result = followAction(row, { signal: caller.signal, route: "/admin", deps: { store: new ActionsStore(sql) } });
    caller.abort();

    expect(await result).toBe(row);
    expect(reads).toHaveLength(1);
    expect(reads[0]?.signal).toBe(caller.signal);
    expect(reads[0]?.timeoutMs).toBeGreaterThan(0);
  });

  for (const error of [new Error("Action read unavailable"), new DOMException("SQL read deadline exceeded", "TimeoutError")]) {
    test(`propagates ${error.name} from the read while the row signal is active`, async () => {
      let readSignal: AbortSignal | undefined;
      const store = storeWithRead([actionRow()], async (_text, _values, options) => {
        readSignal = options?.signal;
        throw error;
      });

      await expect(accountSettlement.run(store, new AbortController().signal)).rejects.toBe(error);
      expect(readSignal?.aborted).toBe(false);
    });
  }
});

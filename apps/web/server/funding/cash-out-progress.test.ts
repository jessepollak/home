import "server-only";

import { afterEach, describe, expect, test } from "bun:test";
import { encodeAbiParameters, encodeEventTopics, type TransactionReceipt } from "viem";
import type { ActionRow, ActionsStore, CashoutOrderRow } from "@/server/actions/store";
import { actionOwnerKey } from "@/server/actions/store";
import { setObservabilityLogWriterForTests } from "@/server/observability/log";
import { peerProvider } from "@/server/funding/providers/peer/adapter";
import { PEER_ESCROW_ABI } from "@/server/funding/providers/peer/abi";
import { PEER_PRODUCTION_CONTRACTS, PEER_SANDBOX_CONTRACTS } from "@/server/funding/providers/peer/manifest";
import { UNKNOWN_WINDOW_MS } from "@/server/funding/cash-out-window";
import type { OfframpOrder } from "@/shared/funding/provider-contract";
import { refreshCashoutProgress, type CashoutReceiptRow } from "./cash-out-progress";

const owner = { subject: "progress", address: "0x1111111111111111111111111111111111111111" as const, chainId: 8453 as const, accountProvider: "cdp-embedded" as const };
const depositId = `${PEER_PRODUCTION_CONTRACTS.escrow.toLowerCase()}_7`;
const actionId = "11111111-1111-4111-8111-111111111111";
const timestamp = "2026-09-12T12:00:00.000Z";
const outsideWindow = () => new Date(Date.parse(timestamp) + UNKNOWN_WINDOW_MS + 1);
const insideWindow = () => new Date(Date.parse(timestamp) + UNKNOWN_WINDOW_MS - 1);
const hash = `0x${"ab".repeat(32)}`;
function depositRow(): ActionRow {
  return {
    id: actionId, owner_key: actionOwnerKey(owner), provider: "cdp-embedded", kind: "cash-out",
    summary: { title: "Cash out", amounts: [{ assetId: "usdc", direction: "spend", amountBaseUnits: "2000000" }], warnings: [], expiresAt: timestamp,
      metadata: { product: "cashout", operation: "deposit", providerId: "peer", providerName: "Peer", environment: "production", region: "US",
        platform: "cashapp", platformLabel: "Cash App", currency: "USD", canonicalHandle: "Alice", payeeHash: `0x${"cc".repeat(32)}`, approximateFiatAmount: "2",
        etaSeconds: 100, minConversionRate: "1", intentAmountRange: { min: "2000000", max: "2000000" }, estimateAsOf: timestamp, escrow: PEER_PRODUCTION_CONTRACTS.escrow } },
    pending: null, created_at: timestamp, confirmed_at: timestamp, provider_handle: null, transaction_hash: hash, handle_recorded_at: null,
    account_address: owner.address, declined_reported_at: null, dispatch_attempt: 0, outcome: null,
    outcome_source: null, settled_at: null, outcome_recorded_at: null,
  };
}
function orderRow(linked = true): CashoutOrderRow {
  return { action_id: actionId, owner_key: actionOwnerKey(owner), provider_id: "peer", environment: "production", region: "US", deposit_id: linked ? depositId : null,
    deposit_proven: false,
    state: "submitted", platform: "cashapp", platform_label: "Cash App", amount_atomic: "2000000", filled_atomic: "0", returned_atomic: "0",
    remaining_atomic: "2000000", withdrawable: false, eta_seconds: 100, created_at: timestamp, updated_at: timestamp, refreshed_at: null, settled_at: null };
}
function fakeOrder(state: OfframpOrder["state"], filledAmountAtomic: string, returnedAmountAtomic: string, remainingAmountAtomic: string): OfframpOrder {
  return { depositId, owner: owner.address, state, platform: "cashapp", currency: "USD", canonicalHandle: null,
    payeeHash: `0x${"cc".repeat(32)}`, amountAtomic: "2000000", filledAmountAtomic, returnedAmountAtomic, remainingAmountAtomic,
    nextActions: state === "awaiting-buyer" ? ["withdraw"] : [], updatedAt: timestamp };
}
function fixture(linked = true, filledAtomic = "0", linkedIds: string[] = []) {
  let record = { ...orderRow(linked), filled_atomic: filledAtomic };
  const events: string[] = [];
  setObservabilityLogWriterForTests((line) => { events.push(line); });
  const store = {
    ensureCashoutOrder: async () => record,
    cashoutOrders: async () => [record],
    claimCashoutRefresh: async () => { record = { ...record, refreshed_at: new Date().toISOString() }; },
    linkedCashoutDepositIds: async () => linkedIds,
    linkCashoutDeposit: async (_owner: unknown, _id: string, nextId: string, proven = false) => {
      record = { ...record, deposit_id: nextId, deposit_proven: proven };
      return record;
    },
    updateCashoutProgress: async (_owner: unknown, _id: string, update: { state: CashoutOrderRow["state"]; filledAtomic: string; returnedAtomic: string; remainingAtomic: string; withdrawable: boolean; settled: boolean }) => {
      record = { ...record, state: update.state, filled_atomic: update.filledAtomic, returned_atomic: update.returnedAtomic,
        remaining_atomic: update.remainingAtomic, withdrawable: update.withdrawable, settled_at: update.settled ? timestamp : null };
      return record;
    },
  } as Pick<ActionsStore, "ensureCashoutOrder" | "cashoutOrders" | "claimCashoutRefresh" | "linkedCashoutDepositIds" | "linkCashoutDeposit" | "updateCashoutProgress">;
  return { store, record: () => record, events };
}
function provider(readOrder: (input: { owner: string; depositId: string }) => Promise<OfframpOrder>) {
  return { ...peerProvider, offramp: { ...peerProvider.offramp!, readOrder } };
}
function withdrawalRow(amount = "2000000"): ActionRow {
  return { ...depositRow(), id: "22222222-2222-4222-8222-222222222222", kind: "cash-out-withdraw",
    transaction_hash: `0x${"cd".repeat(32)}`,
    summary: { ...depositRow().summary, amounts: [{ assetId: "usdc", direction: "receive", amountBaseUnits: amount }],
      metadata: { ...depositRow().summary.metadata!, operation: "withdraw", depositId, canonicalHandle: undefined, payeeHash: undefined } as ActionRow["summary"]["metadata"] } };
}
function withdrawalLog(value: bigint, id = BigInt(7), depositor: `0x${string}` = owner.address,
  address: `0x${string}` = PEER_PRODUCTION_CONTRACTS.escrow): TransactionReceipt["logs"][number] {
  return { address, topics: encodeEventTopics({ abi: PEER_ESCROW_ABI, eventName: "DepositWithdrawn", args: { depositId: id, depositor } }),
    data: encodeAbiParameters([{ type: "uint256" }], [value]) } as TransactionReceipt["logs"][number];
}
const signal = new AbortController().signal;
afterEach(() => setObservabilityLogWriterForTests());

describe("durable cash-out progress refresh", () => {
  test("an included unfinalized deposit shows provisional order progress without linking or settling", async () => {
    const { store } = fixture(false);
    let observedHash: string | null = null;
    let reads = 0;
    const result = await refreshCashoutProgress({ owner, rows: [{ row: depositRow(), receipt: "confirmed" }], store, signal,
      readTransactionReceipt: async (nextHash) => { observedHash = nextHash; return { logs: [] }; },
      providerForId: () => ({ ...peerProvider, offramp: { ...peerProvider.offramp!, depositIdFromReceipt: (_receipt, input) => {
        expect(input).toMatchObject({ amountAtomic: "2000000", intentAmountRange: { min: "2000000", max: "2000000" } });
        return depositId;
      }, readOrder: async () => { reads += 1; return fakeOrder("delivered", "2000000", "0", "0"); },
      listOrders: async () => { throw new Error("Must not list an included unfinalized deposit."); } } }), env: { PEER_OFFRAMP_ENABLED: "0" },
    });
    expect(String(observedHash)).toBe(hash);
    expect(reads).toBe(1);
    expect(result[0]).toMatchObject({ deposit_id: null, deposit_proven: false, state: "delivered", filled_atomic: "2000000",
      remaining_atomic: "0", withdrawable: false, settled_at: null });
  });

  test("a written successful outcome links from its transaction receipt when the live receipt is unavailable", async () => {
    const { store } = fixture(false);
    const result = await refreshCashoutProgress({ owner, rows: [{ row: { ...depositRow(), outcome: "succeeded" }, receipt: null }], store, signal,
      readTransactionReceipt: async () => ({ logs: [] }),
      providerForId: () => ({ ...peerProvider, offramp: { ...peerProvider.offramp!,
        depositIdFromReceipt: () => depositId, readOrder: async () => fakeOrder("awaiting-buyer", "0", "0", "2000000"),
      } }), env: { PEER_OFFRAMP_ENABLED: "0" },
    });
    expect(result[0]).toMatchObject({ deposit_id: depositId, deposit_proven: true, state: "awaiting-buyer" });
  });

  test("a written reverted outcome acts like a failed receipt when the live receipt is unavailable", async () => {
    const { store } = fixture(false);
    const result = await refreshCashoutProgress({ owner, rows: [{ row: { ...depositRow(), outcome: "reverted" }, receipt: null }], store, signal,
      now: insideWindow, providerForId: () => ({ ...peerProvider, offramp: { ...peerProvider.offramp!, listOrders: async () => [] } }),
      env: { PEER_OFFRAMP_ENABLED: "0" },
    });
    expect(result[0]).toMatchObject({ state: "failed", deposit_id: null, settled_at: timestamp });
  });

  test("a written not-submitted outcome settles as failed without recovering a matching provider order", async () => {
    const { store } = fixture(false);
    const row = { ...depositRow(), transaction_hash: null, outcome: "not_submitted" as const };
    const result = await refreshCashoutProgress({ owner, rows: [{ row, receipt: null }], store, signal, now: insideWindow,
      readTransactionReceipt: async () => { throw new Error("Must not read a receipt."); },
      providerForId: () => ({ ...peerProvider, offramp: { ...peerProvider.offramp!,
        listOrders: async () => { throw new Error("Must not list provider orders."); },
        readOrder: async () => { throw new Error("Must not read a provider order."); },
      } }), env: { PEER_OFFRAMP_ENABLED: "0" },
    });
    expect(result[0]).toMatchObject({ state: "failed", deposit_id: null, withdrawable: false, settled_at: timestamp });
  });

  test("a written not-submitted outcome drops Cancel from a speculatively linked order", async () => {
    const { store } = fixture(true);
    const row = { ...depositRow(), transaction_hash: null, outcome: "not_submitted" as const };
    const result = await refreshCashoutProgress({ owner, rows: [{ row, receipt: null }], store, signal,
      providerForId: () => provider(async () => { throw new Error("Must not read a provider order."); }), env: { PEER_OFFRAMP_ENABLED: "0" },
    });
    expect(result[0]).toMatchObject({ state: "failed", withdrawable: false, settled_at: timestamp });
  });

  test.each(["payee", "amount", "platform", "currency"] as const)("does not link a receipt whose order has a different %s", async (field) => {
    const { store, events } = fixture(false);
    const order = { ...fakeOrder("awaiting-buyer", "0", "0", "2000000"),
      ...(field === "payee" ? { payeeHash: `0x${"dd".repeat(32)}` as const } :
        field === "amount" ? { amountAtomic: "3000000" } : field === "currency" ? { currency: "EUR" as const } : { platform: "zelle" }) };
    const result = await refreshCashoutProgress({ owner, rows: [{ row: depositRow(), receipt: "confirmed" }], store, signal,
      readTransactionReceipt: async () => ({ logs: [] }),
      providerForId: () => ({ ...peerProvider, offramp: { ...peerProvider.offramp!, depositIdFromReceipt: () => depositId,
        listOrders: async () => [order], readOrder: async () => order } }), env: { PEER_OFFRAMP_ENABLED: "0" },
    });
    expect(result[0]).toMatchObject({ deposit_id: null, state: "submitted", withdrawable: false });
    expect(events.map((event) => JSON.parse(event).code)).toContain("CASHOUT_LINK_MISMATCH");
  });

  test("a confirmed hash without a deposit log recovers the order from the provider list without settling", async () => {
    const { store } = fixture(false);
    const listOrders = async () => [fakeOrder("awaiting-buyer", "0", "0", "2000000")];
    const run = (orders: () => Promise<OfframpOrder[]>) => refreshCashoutProgress({ owner, rows: [{ row: { ...depositRow(), outcome: "succeeded" }, receipt: null }], store, signal,
      now: outsideWindow, readTransactionReceipt: async () => ({ logs: [] }),
      providerForId: () => ({ ...peerProvider, offramp: { ...peerProvider.offramp!, depositIdFromReceipt: () => null, listOrders: orders,
        readOrder: async () => fakeOrder("awaiting-buyer", "0", "0", "2000000") } }), env: { PEER_OFFRAMP_ENABLED: "0" },
    });
    expect((await run(async () => []))[0]).toMatchObject({ deposit_id: null, state: "submitted", settled_at: null });
    expect((await run(listOrders))[0]).toMatchObject({ deposit_id: depositId, state: "awaiting-buyer", settled_at: null });
  });

  test("links a hashless cash-out only with one unclaimed amount, platform, currency and payee match", async () => {
    const { store } = fixture(false);
    const hashless = { ...depositRow(), transaction_hash: null };
    let listed = 0;
    const result = await refreshCashoutProgress({ owner, rows: [{ row: hashless, receipt: null }], store, signal,
      providerForId: () => ({ ...peerProvider, offramp: { ...peerProvider.offramp!,
        listOrders: async (request, ctx) => {
          listed += 1;
          expect(request).toEqual({ owner: owner.address, inFlight: false, onMalformedPayee: "skip" });
          expect(ctx.sandbox).toBe(false);
          return [{ ...fakeOrder("awaiting-buyer", "0", "0", "2000000"), amountAtomic: "3000000" },
            { ...fakeOrder("awaiting-buyer", "0", "0", "2000000"), platform: "zelle" },
            { ...fakeOrder("awaiting-buyer", "0", "0", "2000000"), currency: "EUR", depositId: `${PEER_PRODUCTION_CONTRACTS.escrow.toLowerCase()}_9` },
            { ...fakeOrder("awaiting-buyer", "0", "0", "2000000"), payeeHash: `0x${"dd".repeat(32)}`, depositId: `${PEER_PRODUCTION_CONTRACTS.escrow.toLowerCase()}_8` },
            fakeOrder("awaiting-buyer", "0", "0", "2000000")];
        },
        readOrder: async () => fakeOrder("awaiting-buyer", "0", "0", "2000000"),
      } }), env: { PEER_OFFRAMP_ENABLED: "0" },
    });
    expect(listed).toBe(1);
    expect(result[0]).toMatchObject({ deposit_id: depositId, state: "awaiting-buyer", withdrawable: true });
  });

  test("uses the stored sandbox environment to recover a hashless deposit", async () => {
    const { store } = fixture(false);
    const sandboxId = `${PEER_SANDBOX_CONTRACTS.escrow.toLowerCase()}_3`;
    const originalOrders = store.cashoutOrders.bind(store);
    store.cashoutOrders = async (nextOwner, ids) => (await originalOrders(nextOwner, ids)).map((record) => ({ ...record, environment: "sandbox" }));
    const result = await refreshCashoutProgress({ owner, rows: [{ row: { ...depositRow(), transaction_hash: null }, receipt: null }], store, signal,
      providerForId: () => ({ ...peerProvider, offramp: { ...peerProvider.offramp!,
        listOrders: async (_request, ctx) => {
          expect(ctx.sandbox).toBe(true);
          expect(ctx.deployment.contracts.escrow).toBe(PEER_SANDBOX_CONTRACTS.escrow);
          return [{ ...fakeOrder("awaiting-buyer", "0", "0", "2000000"), depositId: sandboxId }];
        },
        readOrder: async () => ({ ...fakeOrder("awaiting-buyer", "0", "0", "2000000"), depositId: sandboxId }),
      } }), env: { PEER_OFFRAMP_ENABLED: "0" },
    });
    expect(result[0]).toMatchObject({ deposit_id: sandboxId, withdrawable: true });
  });

  test.each(["ambiguous", "already linked"])("does not link a hashless %s candidate", async (caseName) => {
    const { store } = fixture(false, "0", caseName === "already linked" ? [depositId] : []);
    const result = await refreshCashoutProgress({ owner, rows: [{ row: { ...depositRow(), transaction_hash: null }, receipt: null }], store, signal,
      now: insideWindow,
      providerForId: () => ({ ...peerProvider, offramp: { ...peerProvider.offramp!,
        listOrders: async () => caseName === "ambiguous"
          ? [fakeOrder("awaiting-buyer", "0", "0", "2000000"), { ...fakeOrder("awaiting-buyer", "0", "0", "2000000"), depositId: `${PEER_PRODUCTION_CONTRACTS.escrow.toLowerCase()}_8` }]
          : [fakeOrder("awaiting-buyer", "0", "0", "2000000")],
        readOrder: async () => { throw new Error("Must not read an unlinked order."); },
      } }), env: { PEER_OFFRAMP_ENABLED: "0" },
    });
    expect(result[0]).toMatchObject({ deposit_id: null, state: "submitted", withdrawable: false });
  });

  test("does not link a hashless candidate last changed before the action was prepared", async () => {
    const { store } = fixture(false);
    const result = await refreshCashoutProgress({ owner, rows: [{ row: { ...depositRow(), transaction_hash: null }, receipt: "confirmed" }], store, signal,
      now: outsideWindow,
      providerForId: () => ({ ...peerProvider, offramp: { ...peerProvider.offramp!,
        listOrders: async () => [{ ...fakeOrder("delivered", "2000000", "0", "0"), updatedAt: "2026-09-12T11:59:59.000Z" }],
        readOrder: async () => { throw new Error("Must not read an unlinked order."); },
      } }), env: { PEER_OFFRAMP_ENABLED: "0" },
    });
    expect(result[0]).toMatchObject({ deposit_id: null, state: "failed", filled_atomic: "0" });
  });

  test("keeps an old hashless cash-out open while a matching order has no change time", async () => {
    const { store, record } = fixture(false);
    const result = await refreshCashoutProgress({ owner, rows: [{ row: { ...depositRow(), transaction_hash: null }, receipt: "confirmed" }], store, signal,
      now: outsideWindow,
      providerForId: () => ({ ...peerProvider, offramp: { ...peerProvider.offramp!,
        listOrders: async () => [{ ...fakeOrder("awaiting-buyer", "0", "0", "2000000"), updatedAt: new Date(0).toISOString() }],
        readOrder: async () => { throw new Error("Must not read an unlinked order."); },
      } }), env: { PEER_OFFRAMP_ENABLED: "0" },
    });
    expect(result[0]).toMatchObject({ deposit_id: null, state: "submitted", settled_at: null });
    expect(record()).toMatchObject({ deposit_id: null, settled_at: null });
  });

  test("links a hashless candidate even when a later deposit is already linked", async () => {
    const { store } = fixture(false, "0", [`${PEER_PRODUCTION_CONTRACTS.escrow.toLowerCase()}_9`]);
    const result = await refreshCashoutProgress({ owner, rows: [{ row: { ...depositRow(), transaction_hash: null }, receipt: null }], store, signal,
      providerForId: () => ({ ...peerProvider, offramp: { ...peerProvider.offramp!,
        listOrders: async () => [fakeOrder("awaiting-buyer", "0", "0", "2000000")],
        readOrder: async () => fakeOrder("awaiting-buyer", "0", "0", "2000000"),
      } }), env: { PEER_OFFRAMP_ENABLED: "0" },
    });
    expect(result[0]).toMatchObject({ deposit_id: depositId, state: "awaiting-buyer" });
  });

  test("retires an old hashless cash-out without a handle or matching provider order", async () => {
    const { store } = fixture(false);
    const result = await refreshCashoutProgress({ owner, rows: [{ row: { ...depositRow(), transaction_hash: null }, receipt: "confirmed" }], store, signal,
      now: outsideWindow,
      providerForId: () => ({ ...peerProvider, offramp: { ...peerProvider.offramp!,
        listOrders: async () => [{ ...fakeOrder("awaiting-buyer", "0", "0", "2000000"), amountAtomic: "3000000" }],
      } }), env: { PEER_OFFRAMP_ENABLED: "0" },
    });
    expect(result[0]).toMatchObject({ state: "failed", deposit_id: null, filled_atomic: "0", returned_atomic: "0",
      remaining_atomic: "2000000", withdrawable: false, settled_at: timestamp });
  });

  test("keeps an old hashless cash-out open when provider orders are unavailable", async () => {
    const { store, record } = fixture(false);
    let listed = 0;
    const result = await refreshCashoutProgress({ owner, rows: [{ row: { ...depositRow(), transaction_hash: null }, receipt: "confirmed" }], store, signal,
      now: outsideWindow,
      providerForId: () => ({ ...peerProvider, offramp: { ...peerProvider.offramp!,
        listOrders: async () => { listed += 1; throw new Error("Provider unavailable"); },
      } }), env: { PEER_OFFRAMP_ENABLED: "0" },
    });
    expect(listed).toBe(1);
    expect(result[0]).toMatchObject({ state: "submitted", deposit_id: null, settled_at: null });
    expect(record()).toMatchObject({ state: "submitted", settled_at: null });
  });

  test("keeps a hashless cash-out open inside the unknown window", async () => {
    const { store } = fixture(false);
    let listed = 0;
    const result = await refreshCashoutProgress({ owner, rows: [{ row: { ...depositRow(), transaction_hash: null }, receipt: "confirmed" }], store, signal,
      now: insideWindow,
      providerForId: () => ({ ...peerProvider, offramp: { ...peerProvider.offramp!,
        listOrders: async () => { listed += 1; return []; },
      } }), env: { PEER_OFFRAMP_ENABLED: "0" },
    });
    expect(listed).toBe(1);
    expect(result[0]).toMatchObject({ state: "submitted", deposit_id: null, settled_at: null });
  });

  test("keeps an old hashless cash-out open if its provider handle exists", async () => {
    const { store } = fixture(false);
    let listed = 0;
    const result = await refreshCashoutProgress({ owner, rows: [{ row: { ...depositRow(), transaction_hash: null, provider_handle: "Alice" }, receipt: "confirmed" }], store, signal,
      now: outsideWindow,
      providerForId: () => ({ ...peerProvider, offramp: { ...peerProvider.offramp!,
        listOrders: async () => { listed += 1; return []; },
      } }), env: { PEER_OFFRAMP_ENABLED: "0" },
    });
    expect(listed).toBe(1);
    expect(result[0]).toMatchObject({ state: "submitted", deposit_id: null, settled_at: null });
  });

  test("keeps an old hashless cash-out open if provider candidates are ambiguous", async () => {
    const { store } = fixture(false);
    let listed = 0;
    const result = await refreshCashoutProgress({ owner, rows: [{ row: { ...depositRow(), transaction_hash: null }, receipt: "confirmed" }], store, signal,
      now: outsideWindow,
      providerForId: () => ({ ...peerProvider, offramp: { ...peerProvider.offramp!,
        listOrders: async () => { listed += 1; return [fakeOrder("awaiting-buyer", "0", "0", "2000000"),
          { ...fakeOrder("awaiting-buyer", "0", "0", "2000000"), depositId: `${PEER_PRODUCTION_CONTRACTS.escrow.toLowerCase()}_8` }]; },
      } }), env: { PEER_OFFRAMP_ENABLED: "0" },
    });
    expect(listed).toBe(1);
    expect(result[0]).toMatchObject({ state: "submitted", deposit_id: null, settled_at: null });
  });

  test.each(["matching", "mismatched", "unavailable"] as const)("legacy hashless payee %s is checked before linking or settling", async (caseName) => {
    const { store, events } = fixture(false);
    const legacy = depositRow();
    const { payeeHash: _payee, ...metadata } = legacy.summary.metadata as Extract<NonNullable<ActionRow["summary"]["metadata"]>, { product: "cashout" }>;
    let derived = 0;
    let listed = 0;
    const result = await refreshCashoutProgress({ owner, rows: [{ row: { ...legacy, transaction_hash: null, summary: { ...legacy.summary, metadata } as ActionRow["summary"] }, receipt: "confirmed" }],
      store, signal, now: caseName === "unavailable" ? outsideWindow : insideWindow,
      providerForId: () => ({ ...peerProvider, offramp: { ...peerProvider.offramp!,
        payeeHash: async (input) => {
          derived += 1;
          expect(input).toEqual({ platform: "cashapp", currency: "USD", canonicalHandle: "Alice" });
          if (caseName === "unavailable") throw new Error("provider secret");
          return `0x${"cc".repeat(32)}` as const;
        },
        listOrders: async () => { listed += 1; return [{ ...fakeOrder("awaiting-buyer", "0", "0", "2000000"),
          payeeHash: caseName === "mismatched" ? `0x${"dd".repeat(32)}` : `0x${"cc".repeat(32)}` }]; },
        readOrder: async () => fakeOrder("awaiting-buyer", "0", "0", "2000000"),
      } }), env: { PEER_OFFRAMP_ENABLED: "0" },
    });
    expect(derived).toBe(1);
    expect(listed).toBe(caseName === "unavailable" ? 0 : 1);
    expect(result[0]).toMatchObject(caseName === "matching"
      ? { state: "awaiting-buyer", deposit_id: depositId, deposit_proven: false, withdrawable: true, settled_at: null }
      : { state: "submitted", deposit_id: null, withdrawable: false, settled_at: null });
    if (caseName === "unavailable") {
      expect(events.map((event) => JSON.parse(event).code)).toContain("CASHOUT_PAYEE_UNAVAILABLE");
      expect(events.join(" ")).not.toContain("provider secret");
    }
  });

  test("a finalized legacy receipt links by chain proof without deriving a payee", async () => {
    const { store, events } = fixture(false);
    const legacy = depositRow();
    const { payeeHash: _payee, ...metadata } = legacy.summary.metadata as Extract<NonNullable<ActionRow["summary"]["metadata"]>, { product: "cashout" }>;
    let links = 0;
    const originalLink = store.linkCashoutDeposit.bind(store);
    store.linkCashoutDeposit = async (nextOwner, id, nextId, proven) => { links += 1; return originalLink(nextOwner, id, nextId, proven); };
    const result = await refreshCashoutProgress({ owner, rows: [{ row: { ...legacy, outcome: "succeeded", summary: { ...legacy.summary, metadata } as ActionRow["summary"] }, receipt: null }],
      store, signal, readTransactionReceipt: async () => ({ logs: [] }),
      providerForId: () => ({ ...peerProvider, offramp: { ...peerProvider.offramp!,
        depositIdFromReceipt: () => depositId,
        payeeHash: async () => { throw new Error("Receipt-proven deposits must not derive a payee."); },
        readOrder: async () => ({ ...fakeOrder("awaiting-buyer", "0", "0", "2000000"), payeeHash: `0x${"dd".repeat(32)}` }),
        listOrders: async () => { throw new Error("Must not exceed the provider read budget."); },
      } }), env: { PEER_OFFRAMP_ENABLED: "0" },
    });
    expect(links).toBe(1);
    expect(result[0]).toMatchObject({ deposit_id: depositId, deposit_proven: true, state: "awaiting-buyer", settled_at: null });
    expect(events.map((event) => JSON.parse(event).code)).not.toContain("CASHOUT_PAYEE_UNAVAILABLE");
  });

  test("legacy hash derivation and listing consume two provider reads", async () => {
    const { store } = fixture(false);
    const legacy = depositRow();
    const { payeeHash: _payee, ...metadata } = legacy.summary.metadata as Extract<NonNullable<ActionRow["summary"]["metadata"]>, { product: "cashout" }>;
    let listed = 0;
    const result = await refreshCashoutProgress({ owner, rows: [{ row: { ...legacy, summary: { ...legacy.summary, metadata } as ActionRow["summary"] }, receipt: "failed" }],
      store, signal, now: outsideWindow,
      providerForId: () => ({ ...peerProvider, offramp: { ...peerProvider.offramp!,
        payeeHash: async () => `0x${"cc".repeat(32)}` as const,
        listOrders: async () => { listed += 1; return []; },
      } }), env: { PEER_OFFRAMP_ENABLED: "0" },
    });
    expect(listed).toBe(1);
    expect(result[0]).toMatchObject({ deposit_id: null, settled_at: null });
  });

  test("defers legacy fallback rather than deriving when only one provider read remains", async () => {
    const legacy = depositRow();
    const { payeeHash: _payee, ...metadata } = legacy.summary.metadata as Extract<NonNullable<ActionRow["summary"]["metadata"]>, { product: "cashout" }>;
    const second = { ...legacy, id: "33333333-3333-4333-8333-333333333333", transaction_hash: null,
      created_at: new Date(Date.parse(timestamp) + 1000).toISOString(),
      summary: { ...legacy.summary, metadata } as ActionRow["summary"] };
    const records = new Map([[actionId, orderRow()], [second.id, { ...orderRow(false), action_id: second.id, created_at: second.created_at }]]);
    const store = {
      ensureCashoutOrder: async (_owner: unknown, row: ActionRow) => records.get(row.id) ?? null,
      cashoutOrders: async () => [...records.values()],
      claimCashoutRefresh: async () => {},
      linkedCashoutDepositIds: async () => [depositId],
      linkCashoutDeposit: async () => { throw new Error("Must not link."); },
      updateCashoutProgress: async (_owner: unknown, id: string) => records.get(id) ?? null,
    } as unknown as Pick<ActionsStore, "ensureCashoutOrder" | "cashoutOrders" | "claimCashoutRefresh" | "linkedCashoutDepositIds" | "linkCashoutDeposit" | "updateCashoutProgress">;
    let reads = 0;
    let derived = 0;
    let listed = 0;
    const result = await refreshCashoutProgress({ owner, rows: [{ row: legacy, receipt: "pending" }, { row: second, receipt: null }], store, signal,
      providerForId: () => ({ ...peerProvider, offramp: { ...peerProvider.offramp!,
        readOrder: async () => { reads += 1; return fakeOrder("awaiting-buyer", "0", "0", "2000000"); },
        payeeHash: async () => { derived += 1; return `0x${"cc".repeat(32)}` as const; },
        listOrders: async () => { listed += 1; return []; },
      } }), env: { PEER_OFFRAMP_ENABLED: "0" },
    });
    expect(reads).toBe(1);
    expect(derived).toBe(0);
    expect(listed).toBe(0);
    expect(result.find((record) => record.action_id === second.id)).toMatchObject({ deposit_id: null, settled_at: null });
  });

  test("returns stored progress when a provider read outlasts the request deadline", async () => {
    const { store } = fixture(false);
    const controller = new AbortController();
    let listed = false;
    const pending = refreshCashoutProgress({ owner, rows: [{ row: { ...depositRow(), transaction_hash: null }, receipt: "confirmed" }], store,
      signal: controller.signal, now: insideWindow,
      providerForId: () => ({ ...peerProvider, offramp: { ...peerProvider.offramp!,
        listOrders: () => { listed = true; queueMicrotask(() => controller.abort()); return new Promise<never>(() => {}); },
      } }), env: { PEER_OFFRAMP_ENABLED: "0" },
    });
    expect(await pending).toEqual([expect.objectContaining({ state: "submitted", deposit_id: null, settled_at: null })]);
    expect(listed).toBe(true);
  });

  test("returns a link persisted before the deadline stopped the progress update", async () => {
    const { store } = fixture(false);
    const controller = new AbortController();
    const originalLink = store.linkCashoutDeposit.bind(store);
    store.linkCashoutDeposit = async (...args) => { const linked = await originalLink(...args); controller.abort(); return linked; };
    const result = await refreshCashoutProgress({ owner, rows: [{ row: { ...depositRow(), transaction_hash: null }, receipt: "confirmed" }], store,
      signal: controller.signal, now: insideWindow,
      providerForId: () => ({ ...peerProvider, offramp: { ...peerProvider.offramp!,
        listOrders: async () => [fakeOrder("awaiting-buyer", "0", "0", "2000000")],
        readOrder: async () => { throw new Error("A listed order needs no second read."); },
      } }), env: { PEER_OFFRAMP_ENABLED: "0" },
    });
    expect(result[0]).toMatchObject({ deposit_id: depositId, state: "submitted", settled_at: null });
  });

  test("stops waiting on a slow receipt read at the request deadline", async () => {
    const { store } = fixture(false);
    const controller = new AbortController();
    let read = false;
    const pending = refreshCashoutProgress({ owner, rows: [{ row: depositRow(), receipt: "confirmed" }], store, signal: controller.signal,
      readTransactionReceipt: () => { read = true; queueMicrotask(() => controller.abort()); return new Promise<never>(() => {}); },
      providerForId: () => ({ ...peerProvider, offramp: { ...peerProvider.offramp!,
        readOrder: async () => { throw new Error("unexpected read"); },
      } }), env: { PEER_OFFRAMP_ENABLED: "0" },
    });
    expect(await pending).toEqual([expect.objectContaining({ state: "submitted", deposit_id: null })]);
    expect(read).toBe(true);
  });

  test("keeps an unlinked hashless cash-out open if the speculative link conflicts", async () => {
    const { store, events } = fixture(false);
    store.linkCashoutDeposit = async () => { throw new Error("unique constraint conflict"); };
    const result = await refreshCashoutProgress({ owner, rows: [{ row: { ...depositRow(), transaction_hash: null }, receipt: null }], store, signal,
      providerForId: () => ({ ...peerProvider, offramp: { ...peerProvider.offramp!,
        listOrders: async () => [fakeOrder("awaiting-buyer", "0", "0", "2000000")],
      } }), env: { PEER_OFFRAMP_ENABLED: "0" },
    });
    expect(result[0]).toMatchObject({ deposit_id: null, state: "submitted" });
    expect(JSON.parse(events[0]!)).toMatchObject({ code: "CASHOUT_REFRESH_UNAVAILABLE" });
    expect(events[0]).not.toContain("unique constraint conflict");
  });

  test("settles a proven duplicate rejected by the store without losing observed amounts", async () => {
    const { store } = fixture(false, "500000");
    const other = { ...orderRow(), action_id: "33333333-3333-4333-8333-333333333333", deposit_proven: true };
    store.linkCashoutDeposit = async (_owner, _id, nextId, proven) => {
      expect(proven).toBe(true);
      expect(nextId.toLowerCase()).toBe(other.deposit_id!.toLowerCase());
      return null;
    };
    const result = await refreshCashoutProgress({ owner, rows: [{ row: { ...depositRow(), outcome: "succeeded" }, receipt: null }], store, signal,
      readTransactionReceipt: async () => ({ logs: [] }),
      providerForId: () => ({ ...peerProvider, offramp: { ...peerProvider.offramp!,
        depositIdFromReceipt: () => depositId, readOrder: async () => fakeOrder("awaiting-buyer", "500000", "0", "1500000"),
      } }), env: { PEER_OFFRAMP_ENABLED: "0" },
    });
    expect(result[0]).toMatchObject({ deposit_id: null, state: "failed", filled_atomic: "500000", returned_atomic: "0",
      remaining_atomic: "2000000", withdrawable: false, settled_at: timestamp });
  });

  test("a proven link lost to a concurrent refresh retains this action's link", async () => {
    const { store } = fixture(false);
    const link = store.linkCashoutDeposit.bind(store);
    store.linkCashoutDeposit = async (nextOwner, id, nextId) => { await link(nextOwner, id, nextId, true); return null; };
    const result = await refreshCashoutProgress({ owner, rows: [{ row: { ...depositRow(), outcome: "succeeded" }, receipt: null }], store, signal,
      readTransactionReceipt: async () => ({ logs: [] }),
      providerForId: () => ({ ...peerProvider, offramp: { ...peerProvider.offramp!,
        depositIdFromReceipt: () => depositId, readOrder: async () => fakeOrder("awaiting-buyer", "500000", "0", "1500000"),
      } }), env: { PEER_OFFRAMP_ENABLED: "0" },
    });
    expect(result[0]).toMatchObject({ deposit_id: depositId, deposit_proven: true, state: "awaiting-buyer",
      filled_atomic: "500000", settled_at: null });
  });

  test.each([
    ["awaiting-buyer", "500000", "0", "1500000", null],
    ["delivered", "2000000", "0", "0", timestamp],
    ["returned", "500000", "1500000", "0", timestamp],
    ["unknown", "0", "0", "2000000", null],
  ] as const)("persists provider %s with exact filled and returned amounts", async (state, filled, returned, remaining, settled) => {
    const { store } = fixture();
    const result = await refreshCashoutProgress({ owner, rows: [{ row: depositRow(), receipt: "confirmed" }], store, signal,
      providerForId: () => provider(async () => fakeOrder(state, filled, returned, remaining)), env: { PEER_OFFRAMP_ENABLED: "0" },
    });
    expect(result[0]).toMatchObject({ state, filled_atomic: filled, returned_atomic: returned, remaining_atomic: remaining, settled_at: settled });
  });

  test("an included but unfinalized withdrawal does not settle a returned provider order", async () => {
    const { store } = fixture(true, "500000");
    let receiptReads = 0;
    const rows: CashoutReceiptRow[] = [{ row: depositRow(), receipt: "confirmed" }, { row: withdrawalRow(), receipt: "confirmed" }];
    const result = await refreshCashoutProgress({ owner, rows, store, signal,
      readTransactionReceipt: async () => { receiptReads += 1; return { logs: [withdrawalLog(BigInt(1_500_000))] }; },
      providerForId: () => provider(async () => fakeOrder("returned", "500000", "1500000", "0")), env: { PEER_OFFRAMP_ENABLED: "0" },
    });
    expect(receiptReads).toBe(0);
    expect(result[0]).toMatchObject({ state: "returned", returned_atomic: "1500000", settled_at: null });
    expect((await store.cashoutOrders(owner, [actionId]))[0]?.settled_at).toBeNull();
  });

  test("a pending Home withdrawal keeps provider-returned progress refreshable until finality", async () => {
    const { store } = fixture(true, "500000");
    const withdraw = withdrawalRow();
    const metadata = withdraw.summary.metadata as Extract<NonNullable<ActionRow["summary"]["metadata"]>, { product: "cashout"; operation: "withdraw" }>;
    const pending = { ...withdraw, summary: { ...withdraw.summary, metadata: { ...metadata, depositId: depositId.toUpperCase() } } };
    let reads = 0;
    const request = (row: ActionRow) => refreshCashoutProgress({ owner,
      rows: [{ row: depositRow(), receipt: "confirmed" }, { row, receipt: null }], store, signal,
      readTransactionReceipt: async () => ({ logs: [withdrawalLog(BigInt(1_500_000))] }),
      providerForId: () => provider(async () => { reads += 1; return fakeOrder("returned", "500000", "1500000", "0"); }),
      env: { PEER_OFFRAMP_ENABLED: "0" },
    });
    expect((await request(pending))[0]).toMatchObject({ state: "returned", filled_atomic: "500000", returned_atomic: "1500000",
      remaining_atomic: "0", settled_at: null });
    expect((await request({ ...pending, outcome: "succeeded" }))[0]).toMatchObject({ state: "returned", settled_at: timestamp });
    expect(reads).toBe(1);
  });

  test("a dispatched withdrawal without a resolved hash keeps provider-returned progress unsettled", async () => {
    const request = async (row: ActionRow, now: () => Date) => {
      const { store } = fixture(true, "500000");
      return (await refreshCashoutProgress({ owner, rows: [{ row: depositRow(), receipt: "confirmed" }, { row, receipt: null }], store, signal, now,
        providerForId: () => provider(async () => fakeOrder("returned", "500000", "1500000", "0")), env: { PEER_OFFRAMP_ENABLED: "0" },
      }))[0];
    };
    const handleOnly = { ...withdrawalRow(), transaction_hash: null, provider_handle: "user-operation-1", handle_recorded_at: timestamp };
    expect(await request(handleOnly, outsideWindow)).toMatchObject({ state: "returned", settled_at: null });
    const confirmedOnly = { ...withdrawalRow(), transaction_hash: null, provider_handle: null, handle_recorded_at: null, confirmed_at: timestamp };
    expect(await request(confirmedOnly, insideWindow)).toMatchObject({ state: "returned", settled_at: null });
    expect(await request(confirmedOnly, outsideWindow)).toMatchObject({ state: "returned", settled_at: timestamp });
    expect(await request({ ...confirmedOnly, declined_reported_at: timestamp }, insideWindow)).toMatchObject({ state: "returned", settled_at: timestamp });
  });

  test("a finalized successful withdrawal settles only the verified deposit withdrawal, ignoring its prepared summary", async () => {
    const { store } = fixture(true, "500000");
    const withdrawal = { ...withdrawalRow("2000000"), outcome: "succeeded" as const };
    let observedHash: string | undefined;
    const rows: CashoutReceiptRow[] = [{ row: depositRow(), receipt: "confirmed" }, { row: withdrawal, receipt: "confirmed" }];
    const result = await refreshCashoutProgress({ owner, rows, store, signal,
      readTransactionReceipt: async (nextHash) => { observedHash = nextHash; return { logs: [withdrawalLog(BigInt(1_000_000)), withdrawalLog(BigInt(500_000))] }; },
      providerForId: () => provider(async () => { throw new Error("Must not read provider order."); }),
    });
    expect(observedHash).toBe(withdrawal.transaction_hash!);
    expect(result[0]).toMatchObject({ state: "returned", filled_atomic: "500000", returned_atomic: "1500000", remaining_atomic: "0", withdrawable: false, settled_at: timestamp });
  });

  test("a same-owner withdrawal of another deposit leaves Cancel available for the linked order", async () => {
    const { store, events } = fixture(true);
    const updates: string[] = [];
    const originalUpdate = store.updateCashoutProgress.bind(store);
    store.updateCashoutProgress = async (nextOwner, id, update) => {
      updates.push(update.state);
      return originalUpdate(nextOwner, id, update);
    };
    const result = await refreshCashoutProgress({ owner, rows: [
      { row: depositRow(), receipt: "confirmed" }, { row: { ...withdrawalRow(), outcome: "succeeded" }, receipt: null },
    ], store, signal,
    readTransactionReceipt: async () => ({ logs: [withdrawalLog(BigInt(2_000_000), BigInt(8))] }),
    providerForId: () => provider(async () => fakeOrder("awaiting-buyer", "0", "0", "2000000")), env: { PEER_OFFRAMP_ENABLED: "0" },
    });
    expect(updates).toEqual(["awaiting-buyer"]);
    expect(result[0]).toMatchObject({ state: "awaiting-buyer", returned_atomic: "0", withdrawable: true, settled_at: null });
    expect(events.map((event) => JSON.parse(event).code)).toContain("CASHOUT_WITHDRAW_MISMATCH");
  });

  test("a partial verified withdrawal defers final state to the provider after a buyer fills", async () => {
    const { store } = fixture(true, "0");
    const updates: Array<{ returnedAtomic: string; settled: boolean; withdrawable: boolean }> = [];
    const originalUpdate = store.updateCashoutProgress.bind(store);
    store.updateCashoutProgress = async (nextOwner, id, update) => {
      updates.push(update);
      return originalUpdate(nextOwner, id, update);
    };
    const result = await refreshCashoutProgress({ owner, rows: [
      { row: depositRow(), receipt: "confirmed" }, { row: { ...withdrawalRow("2000000"), outcome: "succeeded" }, receipt: null },
    ], store, signal,
    readTransactionReceipt: async () => ({ logs: [withdrawalLog(BigInt(1_000_000)), withdrawalLog(BigInt(500_000)), withdrawalLog(BigInt(800_000), BigInt(8))] }),
    providerForId: () => provider(async () => fakeOrder("returned", "500000", "1500000", "0")), env: { PEER_OFFRAMP_ENABLED: "0" },
    });
    expect(updates[0]).toMatchObject({ returnedAtomic: "1500000", settled: false, withdrawable: false });
    expect(result[0]).toMatchObject({ state: "returned", filled_atomic: "500000", returned_atomic: "1500000", remaining_atomic: "0", settled_at: timestamp });
  });

  test("uses provider observation when a finalized withdrawal receipt cannot be read", async () => {
    const { store } = fixture(true, "500000");
    const result = await refreshCashoutProgress({ owner, rows: [
      { row: depositRow(), receipt: "confirmed" }, { row: { ...withdrawalRow("2000000"), outcome: "succeeded" }, receipt: null },
    ], store, signal,
      readTransactionReceipt: async () => { throw new Error("RPC unavailable"); },
      providerForId: () => provider(async () => fakeOrder("returned", "500000", "1500000", "0")), env: { PEER_OFFRAMP_ENABLED: "0" },
    });
    expect(result[0]).toMatchObject({ state: "returned", returned_atomic: "1500000", settled_at: timestamp });
  });

  test("a finalized reverted action settles only after the provider shows no matching order", async () => {
    const { store } = fixture(false);
    const result = await refreshCashoutProgress({ owner, rows: [{ row: { ...depositRow(), outcome: "reverted" }, receipt: null }], store, signal, now: insideWindow,
      readTransactionReceipt: async () => { throw new Error("Must not read a failed receipt."); },
      providerForId: () => ({ ...peerProvider, offramp: { ...peerProvider.offramp!,
        listOrders: async () => [{ ...fakeOrder("awaiting-buyer", "0", "0", "2000000"), amountAtomic: "3000000" }],
        readOrder: async () => { throw new Error("Must not read an unlinked order."); },
      } }), env: { PEER_OFFRAMP_ENABLED: "0" },
    });
    expect(result[0]).toMatchObject({ state: "failed", deposit_id: null, settled_at: timestamp });
  });

  test("an unfinalized failed receipt without a provider order remains refreshable", async () => {
    const { store } = fixture(false);
    let lists = 0;
    const result = await refreshCashoutProgress({ owner, rows: [{ row: depositRow(), receipt: "failed" }], store, signal,
      now: insideWindow, providerForId: () => ({ ...peerProvider, offramp: { ...peerProvider.offramp!,
        listOrders: async () => { lists += 1; return []; },
      } }), env: { PEER_OFFRAMP_ENABLED: "0" },
    });
    expect(lists).toBe(1);
    expect(result[0]).toMatchObject({ state: "submitted", deposit_id: null, settled_at: null });
  });

  test("failed receipt on a mis-associated hash links the live order instead of settling", async () => {
    const { store } = fixture(false);
    const result = await refreshCashoutProgress({ owner, rows: [{ row: depositRow(), receipt: "failed" }], store, signal, now: insideWindow,
      providerForId: () => ({ ...peerProvider, offramp: { ...peerProvider.offramp!,
        listOrders: async () => [fakeOrder("awaiting-buyer", "0", "0", "2000000")],
        readOrder: async () => fakeOrder("awaiting-buyer", "0", "0", "2000000"),
      } }), env: { PEER_OFFRAMP_ENABLED: "0" },
    });
    expect(result[0]).toMatchObject({ state: "awaiting-buyer", deposit_id: depositId, withdrawable: true, settled_at: null });
  });

  test("a failed deposit-log read on a confirmed cash-out recovers the order from the provider list without settling", async () => {
    const run = (orders: OfframpOrder[], row: ActionRow, receipt: CashoutReceiptRow["receipt"]) => {
      const { store, events } = fixture(false);
      let listed = 0;
      return refreshCashoutProgress({ owner, rows: [{ row, receipt }], store, signal, now: outsideWindow,
        readTransactionReceipt: async () => { throw new Error("RPC unavailable"); },
        providerForId: () => ({ ...peerProvider, offramp: { ...peerProvider.offramp!, listOrders: async () => { listed += 1; return orders; },
          readOrder: async () => fakeOrder("awaiting-buyer", "0", "0", "2000000") } }), env: { PEER_OFFRAMP_ENABLED: "0" },
      }).then((result) => ({ result, listed, codes: events.map((event) => JSON.parse(event).code) }));
    };
    for (const [row, receipt] of [[{ ...depositRow(), outcome: "succeeded" }, null]] as const) {
      const recovered = await run([fakeOrder("awaiting-buyer", "0", "0", "2000000")], row, receipt);
      expect(recovered.listed).toBe(1);
      expect(recovered.codes).toContain("CASHOUT_DEPOSIT_RECEIPT_UNAVAILABLE");
      expect(recovered.result[0]).toMatchObject({ deposit_id: depositId, deposit_proven: false, state: "awaiting-buyer", withdrawable: true, settled_at: null });
      expect((await run([], row, receipt)).result[0]).toMatchObject({ deposit_id: null, state: "submitted", settled_at: null });
    }
  });

  test("an included unfinalized receipt never falls back to listOrders when receipt logs cannot be read", async () => {
    const { store } = fixture(false);
    let listed = 0;
    const result = await refreshCashoutProgress({ owner, rows: [{ row: depositRow(), receipt: "confirmed" }], store, signal,
      readTransactionReceipt: async () => { throw new Error("RPC unavailable"); },
      providerForId: () => ({ ...peerProvider, offramp: { ...peerProvider.offramp!, listOrders: async () => { listed += 1; return []; } } }),
      env: { PEER_OFFRAMP_ENABLED: "0" },
    });
    expect(listed).toBe(0);
    expect(result[0]).toMatchObject({ deposit_id: null, state: "submitted", settled_at: null });
  });

  test("an unavailable receipt recovers the matching provider order without settling", async () => {
    const run = (orders: OfframpOrder[]) => {
      const { store } = fixture(false);
      return refreshCashoutProgress({ owner, rows: [{ row: depositRow(), receipt: "unavailable" }], store, signal, now: outsideWindow,
        readTransactionReceipt: async () => { throw new Error("Must not read an unavailable receipt."); },
        providerForId: () => ({ ...peerProvider, offramp: { ...peerProvider.offramp!, listOrders: async () => orders,
          readOrder: async () => fakeOrder("awaiting-buyer", "0", "0", "2000000") } }), env: { PEER_OFFRAMP_ENABLED: "0" },
      });
    };
    expect((await run([fakeOrder("awaiting-buyer", "0", "0", "2000000")]))[0]).toMatchObject({
      deposit_id: depositId, deposit_proven: false, state: "awaiting-buyer", withdrawable: true, settled_at: null });
    expect((await run([{ ...fakeOrder("awaiting-buyer", "0", "0", "2000000"), payeeHash: `0x${"dd".repeat(32)}` }]))[0]).toMatchObject({
      deposit_id: null, state: "submitted", settled_at: null });
    expect((await run([]))[0]).toMatchObject({ deposit_id: null, state: "submitted", settled_at: null });
  });

  test("failed receipt keeps a linked cash-out on its provider order", async () => {
    const { store } = fixture();
    const result = await refreshCashoutProgress({ owner, rows: [{ row: depositRow(), receipt: "failed" }], store, signal,
      providerForId: () => provider(async () => fakeOrder("awaiting-buyer", "0", "0", "2000000")), env: { PEER_OFFRAMP_ENABLED: "0" },
    });
    expect(result[0]).toMatchObject({ state: "awaiting-buyer", withdrawable: true, settled_at: null });
  });

  test.each([
    ["unavailable", async (): Promise<OfframpOrder[]> => { throw new Error("provider down"); }],
    ["undated", async (): Promise<OfframpOrder[]> => [{ ...fakeOrder("awaiting-buyer", "0", "0", "2000000"), updatedAt: new Date(0).toISOString() }]],
  ] as const)("failed receipt stays open while provider orders are %s", async (_name, listOrders) => {
    const { store, record } = fixture(false);
    const result = await refreshCashoutProgress({ owner, rows: [{ row: depositRow(), receipt: "failed" }], store, signal, now: outsideWindow,
      providerForId: () => ({ ...peerProvider, offramp: { ...peerProvider.offramp!, listOrders,
        readOrder: async () => { throw new Error("Must not read an unlinked order."); },
      } }), env: { PEER_OFFRAMP_ENABLED: "0" },
    });
    expect(result[0]).toMatchObject({ state: "submitted", settled_at: null });
    expect(record()).toMatchObject({ settled_at: null });
  });

  test("provider failures preserve stored progress and emit a sanitized server event", async () => {
    const { store, events } = fixture();
    const result = await refreshCashoutProgress({ owner, rows: [{ row: depositRow(), receipt: "confirmed" }], store, signal,
      providerForId: () => provider(async () => { throw new Error("provider payload"); }), env: { PEER_OFFRAMP_ENABLED: "0" },
    });
    expect(result[0]).toMatchObject({ state: "submitted", filled_atomic: "0", settled_at: null });
    expect((await store.cashoutOrders(owner, [actionId]))[0]?.refreshed_at).not.toBeNull();
    expect(JSON.parse(events[0]!)).toMatchObject({ kind: "action-reconcile", code: "CASHOUT_REFRESH_UNAVAILABLE", outcome: "unavailable" });
    expect(events[0]).not.toContain("provider payload");
  });

  test("rotates provider reads to the oldest unrefreshed cash-out across lists", async () => {
    const ids = [actionId, "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];
    const rows: CashoutReceiptRow[] = ids.map((id, index) => ({
      row: { ...depositRow(), id, created_at: new Date(Date.parse(timestamp) + index * 1000).toISOString() }, receipt: "confirmed",
    }));
    const records = new Map(ids.map((id, index) => [id, {
      ...orderRow(), action_id: id, deposit_id: `${PEER_PRODUCTION_CONTRACTS.escrow.toLowerCase()}_${index + 7}`,
      created_at: rows[index]!.row.created_at,
    }]));
    let claims = 0;
    const store: Pick<ActionsStore, "ensureCashoutOrder" | "cashoutOrders" | "claimCashoutRefresh" | "linkCashoutDeposit" | "updateCashoutProgress"> = {
      ensureCashoutOrder: async (_owner, row) => records.get(row.id) ?? null,
      cashoutOrders: async () => [...records.values()],
      claimCashoutRefresh: async (_owner, id) => {
        const record = records.get(id)!;
        records.set(id, { ...record, refreshed_at: new Date(Date.parse(timestamp) + ++claims * 1000).toISOString() });
      },
      linkCashoutDeposit: async () => null,
      updateCashoutProgress: async (_owner, id, update) => {
        const record = records.get(id)!;
        const updated = { ...record, state: update.state, filled_atomic: update.filledAtomic, returned_atomic: update.returnedAtomic,
          remaining_atomic: update.remainingAtomic, withdrawable: update.withdrawable, settled_at: update.settled ? timestamp : null };
        records.set(id, updated);
        return updated;
      },
    };
    const reads: string[] = [];
    const providerForId = () => provider(async ({ depositId: id }) => {
      reads.push(id);
      return { ...fakeOrder("awaiting-buyer", "0", "0", "2000000"), depositId: id };
    });
    const request = () => refreshCashoutProgress({ owner, rows, store, signal, providerForId, env: { PEER_OFFRAMP_ENABLED: "0" } });

    const first = await request();
    expect(reads).toEqual([records.get(ids[0]!)!.deposit_id, records.get(ids[1]!)!.deposit_id]);
    expect(first.map((record) => record.action_id)).toEqual(ids);
    expect(records.get(ids[2]!)?.refreshed_at).toBeNull();

    const second = await request();
    expect(reads).toEqual([records.get(ids[0]!)!.deposit_id, records.get(ids[1]!)!.deposit_id,
      records.get(ids[2]!)!.deposit_id, records.get(ids[0]!)!.deposit_id]);
    expect(second.map((record) => record.action_id)).toEqual(ids);
    expect(ids.every((id) => records.get(id)?.refreshed_at !== null)).toBe(true);
  });

  for (const linked of [false, true]) {
    test(`claims rotation before a ${linked ? "withdrawal" : "deposit"} receipt read that outlives the deadline`, async () => {
      const ids = [actionId, "33333333-3333-4333-8333-333333333333"];
      const hashes = [`0x${"a1".repeat(32)}`, `0x${"a2".repeat(32)}`];
      const depositRows: CashoutReceiptRow[] = ids.map((id, index) => ({
        row: { ...depositRow(), id, transaction_hash: hashes[index]!, created_at: new Date(Date.parse(timestamp) + index * 1000).toISOString() }, receipt: "confirmed",
      }));
      const records = new Map(ids.map((id, index) => [id, {
        ...orderRow(linked), action_id: id, created_at: depositRows[index]!.row.created_at,
        deposit_id: linked ? `${PEER_PRODUCTION_CONTRACTS.escrow.toLowerCase()}_${index + 7}` : null,
      }]));
      const withdrawHashes = [`0x${"b1".repeat(32)}`, `0x${"b2".repeat(32)}`];
      const withdrawRows: CashoutReceiptRow[] = linked ? ids.map((id, index) => ({
        row: { ...withdrawalRow(), outcome: "succeeded", id: `4444444${index}-4444-4444-8444-444444444444`, transaction_hash: withdrawHashes[index]!,
          summary: { ...withdrawalRow().summary, metadata: { ...withdrawalRow().summary.metadata!, depositId: records.get(id)!.deposit_id! } as ActionRow["summary"]["metadata"] } },
        receipt: "confirmed",
      })) : [];
      let claims = 0;
      const store: Pick<ActionsStore, "ensureCashoutOrder" | "cashoutOrders" | "claimCashoutRefresh" | "linkCashoutDeposit" | "updateCashoutProgress"> = {
        ensureCashoutOrder: async (_owner, row) => records.get(row.id) ?? null,
        cashoutOrders: async () => [...records.values()],
        claimCashoutRefresh: async (_owner, id) => {
          records.set(id, { ...records.get(id)!, refreshed_at: new Date(Date.parse(timestamp) + ++claims * 1000).toISOString() });
        },
        linkCashoutDeposit: async () => null,
        updateCashoutProgress: async (_owner, id) => records.get(id)!,
      };
      const reads: string[] = [];
      const request = async () => {
        const controller = new AbortController();
        await refreshCashoutProgress({ owner, rows: [...depositRows, ...withdrawRows], store, signal: controller.signal, env: { PEER_OFFRAMP_ENABLED: "0" },
          providerForId: () => provider(async () => { throw new Error("Must not reach the provider."); }),
          readTransactionReceipt: (nextHash) => { reads.push(nextHash); queueMicrotask(() => controller.abort()); return new Promise<never>(() => {}); },
        });
      };
      const expected = linked ? withdrawHashes : hashes;

      await request();
      expect(reads).toEqual([expected[0]!]);
      expect(records.get(ids[0]!)?.refreshed_at).not.toBeNull();

      await request();
      expect(reads).toEqual([expected[0]!, expected[1]!]);
    });
  }

  for (const linked of [false, true]) {
    test(`counts ${linked ? "withdrawal" : "failing deposit"} receipt reads against the two-refresh budget`, async () => {
      const ids = [actionId, "33333333-3333-4333-8333-333333333333", "55555555-5555-4555-8555-555555555555"];
      const depositRows: CashoutReceiptRow[] = ids.map((id, index) => ({
        row: { ...depositRow(), id, transaction_hash: `0x${String(index + 1).repeat(64)}`, created_at: new Date(Date.parse(timestamp) + index * 1000).toISOString() },
        receipt: "confirmed",
      }));
      const records = new Map(ids.map((id, index) => [id, {
        ...orderRow(linked), action_id: id, created_at: depositRows[index]!.row.created_at,
        deposit_id: linked ? `${PEER_PRODUCTION_CONTRACTS.escrow.toLowerCase()}_${index + 7}` : null,
      }]));
      const withdrawRows: CashoutReceiptRow[] = linked ? ids.map((id, index) => ({
        row: { ...withdrawalRow(), outcome: "succeeded", id: `6666666${index}-6666-4666-8666-666666666666`, transaction_hash: `0x${String(index + 4).repeat(64)}`,
          summary: { ...withdrawalRow().summary, metadata: { ...withdrawalRow().summary.metadata!, depositId: records.get(id)!.deposit_id! } as ActionRow["summary"]["metadata"] } },
        receipt: "confirmed",
      })) : [];
      let claims = 0;
      const store: Pick<ActionsStore, "ensureCashoutOrder" | "cashoutOrders" | "claimCashoutRefresh" | "linkedCashoutDepositIds" | "linkCashoutDeposit" | "updateCashoutProgress"> = {
        linkedCashoutDepositIds: async () => [],
        ensureCashoutOrder: async (_owner, row) => records.get(row.id) ?? null,
        cashoutOrders: async () => [...records.values()],
        claimCashoutRefresh: async (_owner, id) => {
          records.set(id, { ...records.get(id)!, refreshed_at: new Date(Date.parse(timestamp) + ++claims * 1000).toISOString() });
        },
        linkCashoutDeposit: async () => null,
        updateCashoutProgress: async (_owner, id, update) => {
          const updated = { ...records.get(id)!, state: update.state, returned_atomic: update.returnedAtomic, remaining_atomic: update.remainingAtomic,
            withdrawable: update.withdrawable, settled_at: update.settled ? timestamp : null };
          records.set(id, updated);
          return updated;
        },
      };
      const reads: string[] = [];
      const request = () => refreshCashoutProgress({ owner, rows: [...depositRows, ...withdrawRows], store, signal, env: { PEER_OFFRAMP_ENABLED: "0" },
        providerForId: () => ({ ...peerProvider, offramp: { ...peerProvider.offramp!, listOrders: async () => [],
          readOrder: async () => { throw new Error("Must not read an unlinked order."); } } }),
        readTransactionReceipt: async (nextHash) => {
          reads.push(nextHash);
          if (!linked) throw new Error("RPC unavailable");
          const index = withdrawRows.findIndex(({ row }) => row.transaction_hash === nextHash);
          return { logs: [withdrawalLog(BigInt(2_000_000), BigInt(index + 7))] };
        },
      });
      const expected = (linked ? withdrawRows : depositRows).map(({ row }) => row.transaction_hash!);

      await request();
      expect(reads).toEqual(expected.slice(0, 2));

      await request();
      expect(reads).toHaveLength(linked ? 3 : 4);
      expect(reads[2]).toBe(expected[2]!);
    });
  }

  test("receipt proof reclaims a speculatively linked two-tab deposit across refreshes", async () => {
    const hashless = { ...depositRow(), transaction_hash: null };
    const proven = { ...depositRow(), id: "33333333-3333-4333-8333-333333333333", outcome: "succeeded" as const,
      created_at: new Date(Date.parse(timestamp) + 1000).toISOString() };
    const records = new Map<string, CashoutOrderRow>([
      [hashless.id, { ...orderRow(false), action_id: hashless.id }],
      [proven.id, { ...orderRow(false), action_id: proven.id, created_at: proven.created_at }],
    ]);
    const steps: string[] = [];
    const store: Pick<ActionsStore, "ensureCashoutOrder" | "cashoutOrders" | "claimCashoutRefresh" | "linkedCashoutDepositIds" | "linkCashoutDeposit" | "updateCashoutProgress"> = {
      ensureCashoutOrder: async (_owner, row) => records.get(row.id) ?? null,
      cashoutOrders: async (_owner, ids) => ids.flatMap((id) => { const found = records.get(id); return found ? [found] : []; }),
      claimCashoutRefresh: async (_owner, id) => { records.set(id, { ...records.get(id)!, refreshed_at: timestamp }); },
      linkedCashoutDepositIds: async () => [...records.values()].flatMap((record) => record.deposit_id ? [record.deposit_id.toLowerCase()] : []),
      linkCashoutDeposit: async (_owner, id, nextDepositId, proof = false) => {
        const existing = [...records.values()].find((record) => record.deposit_id?.toLowerCase() === nextDepositId.toLowerCase());
        if (existing && (!proof || existing.deposit_proven)) return null;
        if (existing) records.set(existing.action_id, { ...existing, deposit_id: null, deposit_proven: false, state: "submitted",
          filled_atomic: "0", returned_atomic: "0", remaining_atomic: existing.amount_atomic, withdrawable: false, settled_at: null });
        const updated = { ...records.get(id)!, deposit_id: nextDepositId, deposit_proven: proof };
        records.set(id, updated);
        steps.push(proof ? "proof" : "list-link");
        return updated;
      },
      updateCashoutProgress: async (_owner, id, update) => {
        const updated = { ...records.get(id)!, state: update.state, filled_atomic: update.filledAtomic,
          returned_atomic: update.returnedAtomic, remaining_atomic: update.remainingAtomic, withdrawable: update.withdrawable,
          settled_at: update.settled ? timestamp : null };
        records.set(id, updated);
        return updated;
      },
    };
    const providerForId = () => ({ ...peerProvider, offramp: { ...peerProvider.offramp!,
      depositIdFromReceipt: () => depositId,
      readOrder: async () => fakeOrder("awaiting-buyer", "500000", "0", "1500000"),
      listOrders: async () => { steps.push("list"); return [fakeOrder("awaiting-buyer", "500000", "0", "1500000")]; },
    } });
    const request = (rows: CashoutReceiptRow[]) => refreshCashoutProgress({ owner, rows, store, signal,
      now: outsideWindow, readTransactionReceipt: async () => { steps.push("receipt"); return { logs: [] }; },
      providerForId, env: { PEER_OFFRAMP_ENABLED: "0" },
    });

    const first = await request([{ row: hashless, receipt: null }]);
    expect(first[0]).toMatchObject({ deposit_id: depositId, deposit_proven: false, filled_atomic: "500000", settled_at: null });

    records.set(hashless.id, { ...records.get(hashless.id)!, refreshed_at: null });
    const second = await request([{ row: hashless, receipt: null }, { row: proven, receipt: "confirmed" }]);
    expect(steps).toEqual(["list", "list-link", "receipt", "proof", "list"]);
    expect(second.find((record) => record.action_id === proven.id)).toMatchObject({ deposit_id: depositId, deposit_proven: true,
      filled_atomic: "500000" });
    expect(second.find((record) => record.action_id === hashless.id)).toMatchObject({ deposit_id: null, deposit_proven: false,
      state: "failed", filled_atomic: "0", returned_atomic: "0", remaining_atomic: "2000000", withdrawable: false,
      settled_at: timestamp });
  });

  test("never reads more than two providers per request", async () => {
    const { store } = fixture();
    const other = { ...depositRow(), id: "33333333-3333-4333-8333-333333333333" };
    let reads = 0;
    await refreshCashoutProgress({ owner, rows: [{ row: depositRow(), receipt: "confirmed" }, { row: other, receipt: "confirmed" }], store, signal,
      providerForId: () => provider(async () => { reads += 1; return fakeOrder("awaiting-buyer", "0", "0", "2000000"); }), env: { PEER_OFFRAMP_ENABLED: "0" },
    });
    expect(reads).toBeLessThanOrEqual(2);
  });
});

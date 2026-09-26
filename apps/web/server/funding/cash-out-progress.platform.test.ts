import "server-only";

import { describe, expect, test } from "bun:test";
import { actionOwnerKey, type ActionRow, type ActionsStore, type CashoutOrderRow } from "@/server/actions/store";
import { peerProvider } from "@/server/funding/providers/peer/adapter";
import { PEER_PRODUCTION_CONTRACTS } from "@/server/funding/providers/peer/manifest";
import type { OfframpOrder } from "@/shared/funding/provider-contract";
import { refreshCashoutProgress } from "./cash-out-progress";

const owner = { subject: "progress-platform", address: "0x1111111111111111111111111111111111111111" as const, chainId: 8453 as const, accountProvider: "cdp-embedded" as const };
const depositId = `${PEER_PRODUCTION_CONTRACTS.escrow.toLowerCase()}_7`;
const timestamp = "2026-09-12T12:00:00.000Z";
const actionId = "11111111-1111-4111-8111-111111111111";
const hash = `0x${"ab".repeat(32)}`;
const row: ActionRow = {
  id: actionId, owner_key: actionOwnerKey(owner), provider: "cdp-embedded", kind: "cash-out",
  summary: { title: "Cash out", amounts: [], warnings: [], expiresAt: timestamp,
    metadata: { product: "cashout", operation: "deposit", providerId: "peer", providerName: "Peer", environment: "production",
      region: "US", platform: "zelle", platformLabel: "Zelle", currency: "USD", canonicalHandle: "Alice",
      approximateFiatAmount: "2", etaSeconds: 100, minConversionRate: "1", intentAmountRange: { min: "2000000", max: "2000000" },
      estimateAsOf: timestamp, escrow: PEER_PRODUCTION_CONTRACTS.escrow } },
  pending: null, created_at: timestamp, confirmed_at: timestamp, provider_handle: null, transaction_hash: hash, handle_recorded_at: null,
  account_address: owner.address, declined_reported_at: null, dispatch_attempt: 0, outcome: null,
  outcome_source: null, settled_at: null, outcome_recorded_at: null,
};

function fakeOrder(): OfframpOrder {
  return { depositId, owner: owner.address, state: "awaiting-buyer", platform: "zelle", currency: "USD", canonicalHandle: null,
    payeeHash: `0x${"cc".repeat(32)}`, amountAtomic: "2000000", filledAmountAtomic: "0", returnedAmountAtomic: "0",
    remainingAmountAtomic: "2000000", nextActions: [], updatedAt: timestamp };
}

function fixture(platform: string, linked = true) {
  let record: CashoutOrderRow = {
    action_id: actionId, owner_key: actionOwnerKey(owner), provider_id: "peer", environment: "production", region: "US",
    deposit_id: linked ? depositId : null, state: "submitted", platform, platform_label: "Zelle", amount_atomic: "2000000",
    deposit_proven: false,
    filled_atomic: "0", returned_atomic: "0", remaining_atomic: "2000000", withdrawable: false, eta_seconds: 100,
    created_at: timestamp, updated_at: timestamp, refreshed_at: null, settled_at: null,
  };
  let links = 0;
  const store = {
    ensureCashoutOrder: async () => record,
    cashoutOrders: async () => [record],
    claimCashoutRefresh: async () => { record = { ...record, refreshed_at: new Date().toISOString() }; },
    linkCashoutDeposit: async (_owner, _id, _deposit, proven = false) => { links += 1; record = { ...record, deposit_id: depositId, deposit_proven: proven }; return record; },
    updateCashoutProgress: async (_owner: unknown, _id: string, update: { state: CashoutOrderRow["state"]; settled: boolean }) => {
      record = { ...record, state: update.state, settled_at: update.settled ? timestamp : null };
      return record;
    },
  } as Pick<ActionsStore, "ensureCashoutOrder" | "cashoutOrders" | "claimCashoutRefresh" | "linkCashoutDeposit" | "updateCashoutProgress">;
  return { store, record: () => record, links: () => links };
}

const signal = new AbortController().signal;
describe("cash-out progress recovery", () => {
  test.each([["zelle", "zelle"], ["unknown-platform", "cashapp"]])("uses stored platform %s with fallback %s", async (platform, expected) => {
    const { store } = fixture(platform);
    let selectedMethod: string | undefined;
    const result = await refreshCashoutProgress({ owner, rows: [{ row, receipt: "confirmed" }], store, signal,
      providerForId: () => ({ ...peerProvider, offramp: { ...peerProvider.offramp!, readOrder: async (_input, ctx) => {
        selectedMethod = ctx.binding.paymentMethod.id;
        return fakeOrder();
      } } }), env: { PEER_OFFRAMP_ENABLED: "0" },
    });
    expect(selectedMethod).toBe(expected);
    expect(result[0]?.state).toBe("awaiting-buyer");
  });

  test("keeps a stale unlinked pending receipt open and links it after finality", async () => {
    const { store, record, links } = fixture("zelle", false);
    const providerForId = () => ({ ...peerProvider, offramp: { ...peerProvider.offramp!, depositIdFromReceipt: () => depositId,
      payeeHash: async () => fakeOrder().payeeHash, readOrder: async () => fakeOrder() } });
    await refreshCashoutProgress({ owner, rows: [{ row, receipt: "pending" }], store, signal, providerForId, env: { PEER_OFFRAMP_ENABLED: "0" } });
    expect(record()).toMatchObject({ deposit_id: null, state: "submitted", settled_at: null });
    expect(links()).toBe(0);
    const result = await refreshCashoutProgress({ owner, rows: [{ row: { ...row, outcome: "succeeded" }, receipt: null }], store, signal, providerForId,
      readTransactionReceipt: async () => ({ logs: [] }), env: { PEER_OFFRAMP_ENABLED: "0" } });
    expect(links()).toBe(1);
    expect(result[0]).toMatchObject({ deposit_id: depositId, state: "awaiting-buyer", settled_at: null });
  });
});

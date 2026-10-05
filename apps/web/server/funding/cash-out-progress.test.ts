import "server-only";

import { describe, expect, test } from "bun:test";
import type { ActionRow, CashoutOrderRow } from "@/server/actions/store";
import type { OfframpOrder } from "@/shared/funding/provider-contract";
import { planCashoutRefresh, type CashoutReceiptRow } from "./cash-out-progress";

const NOW = new Date("2026-09-28T12:00:00.000Z");
const HASH = `0x${"ab".repeat(32)}` as const;
const DEPOSIT = "escrow_7";
const metadata = {
  product: "cashout", operation: "deposit", providerId: "peer", providerName: "Peer", environment: "production", region: "US",
  platform: "cashapp", platformLabel: "Cash App", currency: "USD", canonicalHandle: "Alice", payeeHash: HASH,
  approximateFiatAmount: "2", minConversionRate: "1", intentAmountRange: { min: "2000000", max: "2000000" },
  estimateAsOf: NOW.toISOString(), escrow: "0x1111111111111111111111111111111111111111",
} as const;
function action(overrides: Partial<ActionRow> = {}): ActionRow {
  return {
    id: "deposit-action", owner_key: "owner", account_address: metadata.escrow, provider: "cdp-embedded", kind: "cash-out",
    summary: { title: "Cash out", amounts: [], warnings: [], expiresAt: NOW.toISOString(), metadata }, pending: null,
    created_at: NOW.toISOString(), confirmed_at: NOW.toISOString(), provider_handle: null, transaction_hash: null,
    handle_recorded_at: null, declined_reported_at: null, dispatch_attempt: 0, outcome: null, outcome_source: null,
    settled_at: null, outcome_recorded_at: null, ...overrides,
  };
}
function record(overrides: Partial<CashoutOrderRow> = {}): CashoutOrderRow {
  return {
    action_id: "deposit-action", owner_key: "owner", provider_id: "peer", environment: "production", region: "US",
    deposit_id: null, deposit_proven: false, state: "awaiting-buyer", platform: "cashapp", platform_label: "Cash App",
    amount_atomic: "2000000", filled_atomic: "500000", returned_atomic: "0", remaining_atomic: "1500000", withdrawable: true,
    eta_seconds: null, created_at: NOW.toISOString(), updated_at: NOW.toISOString(), refreshed_at: null, settled_at: null, ...overrides,
  };
}
function order(overrides: Partial<OfframpOrder> = {}): OfframpOrder {
  return {
    depositId: DEPOSIT, owner: metadata.escrow, state: "awaiting-buyer", platform: "cashapp", currency: "USD", canonicalHandle: null,
    payeeHash: HASH, amountAtomic: "2000000", filledAmountAtomic: "500000", returnedAmountAtomic: "0",
    remainingAmountAtomic: "1500000", nextActions: ["withdraw"], updatedAt: NOW.toISOString(), ...overrides,
  };
}
function withdrawal(overrides: Partial<ActionRow> = {}): CashoutReceiptRow {
  return { row: action({ id: "withdraw-action", kind: "cash-out-withdraw", summary: { ...action().summary, metadata: {
    ...metadata, operation: "withdraw", canonicalHandle: undefined, payeeHash: undefined, depositId: DEPOSIT,
  } }, ...overrides }), receipt: null };
}
const available = <T,>(value: T): { status: "available"; value: T } => ({ status: "available", value });
const unavailable = { status: "unavailable" } as const;
type Context = NonNullable<Parameters<typeof planCashoutRefresh>[2]>;
type Plan = ReturnType<typeof planCashoutRefresh>;
type Case = { name: string; record?: CashoutOrderRow | null; action?: ActionRow; receipt?: CashoutReceiptRow["receipt"];
  withdrawals?: CashoutReceiptRow[]; context?: Context; kind: Plan["kind"]; steps: Plan["steps"][number]["kind"][] };
const linked = record({ deposit_id: DEPOSIT });
const confirmed = action({ transaction_hash: HASH, outcome: "succeeded" });
const proof = { depositProof: available(DEPOSIT), order: available(order()) };
const noDepositIds: string[] = [];
const noOrders: OfframpOrder[] = [];
const listed = { orders: available([order()]), linkedDepositIds: available(noDepositIds) };
const empty = { orders: available(noOrders), linkedDepositIds: available(noDepositIds) };
const returned = order({ state: "returned", returnedAmountAtomic: "1500000", remainingAmountAtomic: "0", nextActions: [] });

const cases: Case[] = [
  { name: "missing confirmed record", record: null, kind: "missing", steps: ["ensure-order"] },
  { name: "unconfirmed missing record", record: null, action: action({ confirmed_at: null }), kind: "current", steps: [] },
  { name: "unrelated action", action: action({ kind: "send" }), kind: "current", steps: [] },
  { name: "another owner's action", action: action({ owner_key: "other" }), kind: "current", steps: [] },
  { name: "missing cash-out metadata", action: action({ summary: { ...action().summary, metadata: undefined } }), kind: "current", steps: [] },
  { name: "settled delivered replay", record: record({ state: "delivered", settled_at: NOW }), kind: "current", steps: [] },
  { name: "settled failed replay", record: record({ state: "failed", settled_at: NOW }), kind: "current", steps: [] },
  { name: "settled returned replay", record: record({ state: "returned", settled_at: NOW }), kind: "current", steps: [] },
  { name: "aborted refresh", context: { aborted: true }, kind: "current", steps: [] },
  { name: "unsubmitted unproven fails locally", action: action({ outcome: "not_submitted" }), context: { providerReads: 2 }, kind: "terminal", steps: ["settle-failed"] },
  { name: "unsubmitted proven deposit still reads", record: record({ deposit_id: DEPOSIT, deposit_proven: true }), action: action({ outcome: "not_submitted" }), kind: "partial", steps: ["read-order"] },
  { name: "pending receipt with hash waits", action: action({ transaction_hash: HASH }), receipt: "pending", kind: "current", steps: [] },
  { name: "missing receipt with hash waits", action: action({ transaction_hash: HASH }), kind: "current", steps: [] },
  { name: "confirmed receipt proves deposit", action: confirmed, kind: "partial", steps: ["prove-deposit"] },
  { name: "durable success overrides failed receipt", action: confirmed, receipt: "failed", kind: "partial", steps: ["prove-deposit"] },
  { name: "durable reversion overrides confirmed receipt", action: action({ transaction_hash: HASH, outcome: "reverted" }), receipt: "confirmed", kind: "partial", steps: ["read-orders"] },
  { name: "proven receipt needs provider match", action: confirmed, context: { depositProof: available(DEPOSIT) }, kind: "partial", steps: ["read-order"] },
  { name: "matched receipt links proven deposit", action: confirmed, context: proof, kind: "partial", steps: ["link-deposit"] },
  { name: "receipt observation cannot link before durable success", action: action({ transaction_hash: HASH }), receipt: "confirmed", context: proof, kind: "partial", steps: ["update-order"] },
  { name: "completed provider observation cannot settle before durable success", action: action({ transaction_hash: HASH }), receipt: "confirmed", context: { ...proof, order: available(order({ state: "delivered" })) }, kind: "partial", steps: ["update-order"] },
  { name: "receipt read timeout falls back", action: confirmed, context: { depositProof: unavailable }, kind: "partial", steps: ["read-orders"] },
  { name: "missing deposit receipt proof falls back", action: confirmed, context: { depositProof: available(null) }, kind: "partial", steps: ["read-orders"] },
  { name: "provider receipt order timeout retains partial", action: confirmed, context: { ...proof, order: unavailable }, kind: "partial", steps: [] },
  { name: "mismatched receipt order uses remaining read", action: confirmed, context: { ...proof, order: available(order({ amountAtomic: "1" })) }, kind: "partial", steps: ["read-orders"] },
  { name: "receipt mismatch cannot exceed two provider reads", action: confirmed, context: { ...proof, providerReads: 1, order: available(order({ amountAtomic: "1" })) }, kind: "current", steps: [] },
  { name: "mismatched receipt payee cannot link", action: confirmed, context: { ...proof, order: available(order({ payeeHash: "0x1234" })) }, kind: "partial", steps: ["read-orders"] },
  { name: "legacy receipt link does not require payee read", action: action({ ...confirmed, summary: { ...confirmed.summary, metadata: { ...metadata, payeeHash: undefined } } }), context: proof, kind: "partial", steps: ["link-deposit"] },
  { name: "receipt link conflict rereads record", action: confirmed, context: { ...proof, link: available(null) }, kind: "partial", steps: ["read-record"] },
  { name: "receipt conflict still unlinked settles failed", action: confirmed, context: { ...proof, link: available(record()) }, kind: "terminal", steps: ["settle-failed"] },
  { name: "receipt conflict settled replay no-op", action: confirmed, context: { ...proof, link: available(record({ settled_at: NOW })) }, kind: "current", steps: [] },
  { name: "hashless pending reads orders", kind: "partial", steps: ["read-orders"] },
  { name: "legacy hashless needs payee hash first", action: action({ summary: { ...action().summary, metadata: { ...metadata, payeeHash: undefined } } }), kind: "partial", steps: ["read-payee-hash"] },
  { name: "legacy payee timeout retains partial", action: action({ summary: { ...action().summary, metadata: { ...metadata, payeeHash: undefined } } }), context: { payeeHash: unavailable }, kind: "partial", steps: [] },
  { name: "legacy payee derivation uses first of two reads", action: action({ summary: { ...action().summary, metadata: { ...metadata, payeeHash: undefined } } }), context: { payeeHash: available(HASH) }, kind: "partial", steps: ["read-orders"] },
  { name: "legacy payee cannot start after another provider read", action: action({ summary: { ...action().summary, metadata: { ...metadata, payeeHash: undefined } } }), context: { providerReads: 1 }, kind: "current", steps: [] },
  ...(["failed", "unavailable", "unattributed"] as const).map((receipt): Case => ({ name: `${receipt} receipt recovers by provider list`, action: action({ transaction_hash: HASH }), receipt, kind: "partial", steps: ["read-orders"] })),
  { name: "provider list timeout retains partial", context: { orders: unavailable }, kind: "partial", steps: [] },
  { name: "provider list requires linked IDs", context: { orders: available([order()]) }, kind: "partial", steps: ["read-linked-deposits"] },
  { name: "linked IDs unavailable does not pretend empty", context: { ...listed, linkedDepositIds: unavailable }, kind: "partial", steps: [] },
  { name: "one unclaimed candidate links speculatively", context: listed, kind: "partial", steps: ["link-deposit"] },
  { name: "already linked candidate replay cannot relink", context: { ...listed, linkedDepositIds: available([DEPOSIT]) }, kind: "current", steps: [] },
  { name: "two matching candidates remain ambiguous", context: { ...listed, orders: available([order(), order({ depositId: "escrow_8" })]) }, kind: "current", steps: [] },
  { name: "stale candidate cannot link", context: { ...listed, orders: available([order({ updatedAt: "2026-09-28T11:59:59Z" })]) }, kind: "current", steps: [] },
  { name: "foreign amount cannot link", context: { ...listed, orders: available([order({ amountAtomic: "1" })]) }, kind: "current", steps: [] },
  { name: "foreign currency cannot link", context: { ...listed, orders: available([order({ currency: "EUR" })]) }, kind: "current", steps: [] },
  { name: "foreign platform cannot link", context: { ...listed, orders: available([order({ platform: "zelle" })]) }, kind: "current", steps: [] },
  { name: "foreign payee cannot link", context: { ...listed, orders: available([order({ payeeHash: "0x1234" })]) }, kind: "current", steps: [] },
  { name: "reverted with no candidate settles failed", action: action({ outcome: "reverted" }), context: empty, kind: "terminal", steps: ["settle-failed"] },
  { name: "hashless timeout past window settles failed", action: action({ confirmed_at: "2026-09-28T11:44:59Z" }), context: empty, kind: "terminal", steps: ["settle-failed"] },
  { name: "exact timeout boundary remains pending", action: action({ confirmed_at: "2026-09-28T11:45:00Z" }), context: empty, kind: "current", steps: [] },
  { name: "dispatch handle prevents abandonment", action: action({ confirmed_at: "2026-09-28T11:00:00Z", provider_handle: "handle" }), context: empty, kind: "current", steps: [] },
  { name: "undated matching data prevents failed settlement", action: action({ outcome: "reverted" }), context: { ...listed, orders: available([order({ updatedAt: "invalid" })]) }, kind: "current", steps: [] },
  { name: "linked pending reads provider", record: linked, kind: "partial", steps: ["read-order"] },
  { name: "provisionally delivered still reads until settled", record: { ...linked, state: "delivered" }, kind: "partial", steps: ["read-order"] },
  { name: "linked partial order retains withdrawability", record: linked, context: { order: available(order()) }, kind: "partial", steps: ["update-order"] },
  { name: "linked provider timeout retains partial", record: linked, context: { order: unavailable }, kind: "partial", steps: [] },
  { name: "completed order settles delivered", record: linked, context: { order: available(order({ state: "delivered" })) }, kind: "terminal", steps: ["settle-delivered"] },
  { name: "returned provider order settles with no withdrawal", record: linked, context: { order: available(returned) }, kind: "terminal", steps: ["settle-returned"] },
  { name: "returned provider order waits for pending withdrawal", record: linked, withdrawals: [withdrawal({ transaction_hash: HASH })], context: { order: available(returned) }, kind: "partial", steps: ["update-order"] },
  { name: "fresh hashless withdrawal blocks returned settlement", record: linked, withdrawals: [withdrawal()], context: { order: available(returned) }, kind: "partial", steps: ["update-order"] },
  { name: "expired hashless withdrawal allows returned settlement", record: linked, withdrawals: [withdrawal({ confirmed_at: "2026-09-28T11:45:00Z" })], context: { order: available(returned) }, kind: "terminal", steps: ["settle-returned"] },
  { name: "declined withdrawal allows returned settlement", record: linked, withdrawals: [withdrawal({ declined_reported_at: NOW })], context: { order: available(returned) }, kind: "terminal", steps: ["settle-returned"] },
  { name: "another owner withdrawal cannot delay settlement", record: linked, withdrawals: [withdrawal({ owner_key: "other", transaction_hash: HASH })], context: { order: available(returned) }, kind: "terminal", steps: ["settle-returned"] },
  { name: "successful withdrawal requires receipt", record: linked, withdrawals: [withdrawal({ outcome: "succeeded", transaction_hash: HASH })], kind: "partial", steps: ["read-withdraw-receipt"] },
  { name: "withdrawal receipt proves full returned remainder", record: linked, withdrawals: [withdrawal({ outcome: "succeeded", transaction_hash: HASH })], context: { withdrawal: available("1500000") }, kind: "terminal", steps: ["settle-returned"] },
  { name: "partial withdrawal cannot settle", record: linked, withdrawals: [withdrawal({ outcome: "succeeded", transaction_hash: HASH })], context: { withdrawal: available("1000000") }, kind: "partial", steps: ["update-returned"] },
  { name: "zero withdrawal cannot settle", record: linked, withdrawals: [withdrawal({ outcome: "succeeded", transaction_hash: HASH })], context: { withdrawal: available("0") }, kind: "partial", steps: ["update-returned"] },
  { name: "withdrawal receipt mismatch reads provider", record: linked, withdrawals: [withdrawal({ outcome: "succeeded", transaction_hash: HASH })], context: { withdrawal: available(null) }, kind: "partial", steps: ["read-order"] },
  { name: "withdrawal receipt timeout reads provider", record: linked, withdrawals: [withdrawal({ outcome: "succeeded", transaction_hash: HASH })], context: { withdrawal: unavailable }, kind: "partial", steps: ["read-order"] },
  { name: "applied partial withdrawal then reads provider", record: linked, withdrawals: [withdrawal({ outcome: "succeeded", transaction_hash: HASH })], context: { withdrawal: available("1000000"), withdrawalApplied: true }, kind: "partial", steps: ["read-order"] },
  { name: "withdrawal proof does not consume provider read budget", record: linked, withdrawals: [withdrawal({ outcome: "succeeded", transaction_hash: HASH })], context: { providerReads: 1, withdrawal: unavailable }, kind: "partial", steps: ["read-order"] },
  { name: "derived payee and list can reuse completion within two reads", action: action({ summary: { ...action().summary, metadata: { ...metadata, payeeHash: undefined } } }), context: { ...listed, payeeHash: available(HASH), orders: available([order({ state: "delivered" })]), link: available(linked) }, kind: "terminal", steps: ["settle-delivered"] },
  { name: "provider budget exhausted", record: linked, context: { providerReads: 2 }, kind: "current", steps: [] },
  { name: "receipt proof respects provider budget", action: confirmed, context: { providerReads: 2 }, kind: "current", steps: [] },
  { name: "refresh budget exhausted", record: linked, context: { refreshed: 2 }, kind: "current", steps: [] },
  { name: "claimed record can finish after refresh budget", record: linked, context: { refreshed: 2, claimed: true }, kind: "partial", steps: ["read-order"] },
  { name: "last read permits existing payee recovery", context: { providerReads: 1 }, kind: "partial", steps: ["read-orders"] },
  { name: "verified order reused after budget exhausted", record: linked, context: { providerReads: 2, verifiedOrder: order({ state: "delivered" }) }, kind: "terminal", steps: ["settle-delivered"] },
  { name: "receipt-linked completion uses verified order", action: confirmed, context: { ...proof, order: available(order({ state: "delivered" })), link: available(linked) }, kind: "terminal", steps: ["settle-delivered"] },
  { name: "speculatively linked returned order settles", context: { ...listed, orders: available([returned]), link: available(linked) }, kind: "terminal", steps: ["settle-returned"] },
];

describe("cash-out refresh planning state table", () => {
  test.each(cases)("$name", ({ record: persisted, action: deposit = action(), receipt = null, withdrawals = [], context = {}, kind, steps }) => {
    const plan = planCashoutRefresh(persisted === undefined ? record() : persisted, [{ row: deposit, receipt }, ...withdrawals], { now: NOW, ...context });
    expect(plan.kind).toBe(kind);
    expect(plan.steps.map((step) => step.kind)).toEqual(steps);
  });

  test.each(["pending", "completed", "failed", "timeout", "replay"])("%s input is deterministic and does not mutate observations", (scenario) => {
    const row = action({ outcome: scenario === "failed" ? "not_submitted" : null });
    const persisted = record({ deposit_id: DEPOSIT, settled_at: scenario === "replay" ? NOW : null });
    const context: Context = { now: NOW, order: scenario === "timeout" ? unavailable : available(order({ state: scenario === "completed" ? "delivered" : "matched" })) };
    const input = { persisted, rows: [{ row, receipt: null }], context };
    const before = structuredClone(input);
    expect(planCashoutRefresh(persisted, input.rows, context)).toEqual(planCashoutRefresh(persisted, input.rows, context));
    expect(input).toEqual(before);
  });

  test("withdrawal settlement preserves exact amounts", () => {
    const plan = planCashoutRefresh(linked, [{ row: action(), receipt: null }, withdrawal({ outcome: "succeeded", transaction_hash: HASH })], { withdrawal: available("1500000") });
    expect(plan.steps[0]).toEqual({ kind: "settle-returned", update: { state: "returned", filledAtomic: "500000", returnedAtomic: "1500000", remainingAtomic: "0", withdrawable: false, settled: true } });
  });

  test("observed completion without durable success remains unsettled and non-withdrawable", () => {
    const plan = planCashoutRefresh(record(), [{ row: action({ transaction_hash: HASH }), receipt: "confirmed" }], { ...proof, order: available(order({ state: "delivered" })) });
    expect(plan.steps[0]).toMatchObject({ kind: "update-order", update: { settled: false, withdrawable: false } });
  });

  test("time-dependent returned settlement requires explicit time", () => {
    const plan = planCashoutRefresh(linked, [{ row: action(), receipt: null }, withdrawal()], { order: available(returned) });
    expect(plan).toEqual({ kind: "partial", steps: [], reason: "time-required" });
  });

  test("hashless timeout determination requires explicit time", () => {
    expect(planCashoutRefresh(record(), [{ row: action(), receipt: null }], empty)).toEqual({ kind: "partial", steps: [], reason: "time-required" });
  });

  test("missing action data yields no steps", () => {
    expect(planCashoutRefresh(record(), [])).toEqual({ kind: "current", steps: [], reason: "no-actionable-data" });
  });

  test.each([true, false])("link proof flag is %s for receipt versus recovery", (proven) => {
    const plan = planCashoutRefresh(record(), [{ row: proven ? confirmed : action(), receipt: null }], proven ? proof : listed);
    expect(plan.steps[0]).toEqual({ kind: "link-deposit", depositId: DEPOSIT, proven });
  });
});

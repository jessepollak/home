import { describe, expect, test } from "bun:test";
import { evaluateQualification, type QualificationChange, type QualificationCoverage, type QualificationDeposit } from "./qualification-core";
import type { InviteRewardTerms } from "@/shared/growth/reward";

const start = new Date("2026-01-01T00:00:00Z");
const at = (days: number) => new Date(start.getTime() + days * 86_400_000);
const terms: InviteRewardTerms = { minDepositAtoms: "100", inviterRewardAtoms: "10", holdDays: 30, countries: ["US"], termsText: "Terms" };
const deposit: QualificationDeposit = { actionId: "a", txHash: "mint", blockNumber: BigInt("10"), at: start,
  assetsAtoms: BigInt("100"), vaultAddress: "vault", confirmed: true, outcome: "succeeded" };
const change = (delta: bigint, day: number, overrides: Partial<QualificationChange> = {}): QualificationChange => ({
  walletId: "one", vaultAddress: "vault", blockNumber: BigInt(10 + day), logIndex: 1,
  at: at(day), txHash: `tx-${day}`, delta, ...overrides,
});
const mint = change(BigInt("10"), 0, { txHash: "mint" });
const wallet = { walletId: "one", fromBlock: BigInt("1"), initialSharesAtoms: BigInt("0"), forwardBlock: BigInt("100"),
  throughAt: at(40), ingestedAt: at(40), complete: true, inconsistent: false };
type Case = { name: string; deposits?: QualificationDeposit[]; ledger?: QualificationChange[];
  coverage?: QualificationCoverage; now?: Date; anchorTxHash?: string; kind: ReturnType<typeof evaluateQualification>["kind"]; min?: bigint; actionId?: string; reason?: "history-behind" | "history-unavailable" | "balance-dropped" };
const cases: Case[] = [
  { name: "below the single-deposit minimum", deposits: [{ ...deposit, assetsAtoms: BigInt("99") }], kind: "unchanged" },
  { name: "exactly the minimum", kind: "qualified", min: BigInt("10") },
  { name: "several small deposits never add up", deposits: [{ ...deposit, assetsAtoms: BigInt("60") }, { ...deposit, actionId: "b", assetsAtoms: BigInt("60") }], kind: "unchanged" },
  { name: "first qualifying deposit, not the last", deposits: [{ ...deposit, actionId: "later", at: at(1), blockNumber: BigInt("11") }, deposit], kind: "qualified", actionId: "a" },
  { name: "action id breaks a same-block deposit tie", deposits: [{ ...deposit, actionId: "z" }, deposit], kind: "qualified", actionId: "a" },
  { name: "reverted deposit", deposits: [{ ...deposit, outcome: "reverted" }], kind: "unchanged" },
  { name: "not confirmed", deposits: [{ ...deposit, confirmed: false }], kind: "unchanged" },
  { name: "future receipt is not a deposit yet", deposits: [{ ...deposit, at: at(41) }], kind: "unchanged" },
  { name: "balance exactly equals minted at low point", ledger: [mint, change(BigInt("5"), 1), change(-BigInt("5"), 2)], kind: "qualified", min: BigInt("10") },
  { name: "one share below", ledger: [mint, change(-BigInt("1"), 1)], kind: "disqualified", min: BigInt("9") },
  { name: "dip then redeposit does not repair qualification", ledger: [mint, change(-BigInt("10"), 1), change(BigInt("10"), 2)], kind: "disqualified", min: BigInt("0") },
  { name: "capital cycled through another customer's wallet fails", ledger: [mint, change(-BigInt("10"), 1), change(BigInt("10"), 2, { txHash: "cycled-back" })], kind: "disqualified", min: BigInt("0") },
  { name: "withdraw after window qualifies", ledger: [mint, change(-BigInt("10"), 31)], kind: "qualified", min: BigInt("10") },
  { name: "preexisting shares are part of running balance", coverage: { wallets: [{ ...wallet, initialSharesAtoms: BigInt("5") }] }, ledger: [mint, change(-BigInt("5"), 1)], kind: "qualified", min: BigInt("10") },
  { name: "partial forward coverage", coverage: { wallets: [{ ...wallet, throughAt: at(29) }] }, kind: "pending", reason: "history-behind" },
  { name: "wall clock ingestion alone cannot prove chain coverage", coverage: { wallets: [{ ...wallet, throughAt: null }] }, kind: "pending", reason: "history-behind" },
  { name: "partial backfill", coverage: { wallets: [{ ...wallet, complete: false }] }, kind: "pending", reason: "history-behind" },
  { name: "reconciliation mismatch cannot qualify", coverage: { wallets: [{ ...wallet, inconsistent: true }] }, kind: "pending", reason: "history-unavailable" },
  { name: "reconciliation mismatch cannot anchor", now: at(29), coverage: { wallets: [{ ...wallet, throughAt: at(28), ingestedAt: at(28), inconsistent: true }] }, kind: "pending", reason: "history-unavailable" },
  { name: "inconsistent history cannot prove a dip", coverage: { wallets: [{ ...wallet, inconsistent: true }] }, ledger: [mint, change(-BigInt("1"), 1)], kind: "pending", reason: "history-unavailable" },
  { name: "recorded anchor missing from actions", anchorTxHash: "missing", kind: "pending", reason: "history-unavailable" },
  { name: "missing initial checkpoint is never zero", coverage: { wallets: [{ ...wallet, initialSharesAtoms: null }] }, kind: "pending", reason: "history-unavailable" },
  { name: "no enrolled wallets", coverage: { wallets: [] }, kind: "pending", reason: "history-unavailable" },
  { name: "missing deposit transaction", ledger: [], kind: "pending", reason: "history-unavailable" },
  { name: "query truncation cannot qualify", coverage: { wallets: [wallet], overflow: true }, kind: "pending", reason: "history-unavailable" },
  { name: "holding before end with lagging bucket coverage", now: at(29), coverage: { wallets: [{ ...wallet, throughAt: at(28), ingestedAt: at(28) }] }, kind: "saved", min: BigInt("10") },
  { name: "deposit visible with ingestion one second behind now still anchors", now: at(1), coverage: { wallets: [{ ...wallet, throughAt: start, ingestedAt: new Date(at(1).getTime() - 1000) }] }, kind: "saved", min: BigInt("10") },
  { name: "holding needs no bucket timestamp once the deposit is covered", now: at(1), coverage: { wallets: [{ ...wallet, throughAt: null, ingestedAt: null }] }, kind: "saved", min: BigInt("10") },
  { name: "forward cursor before deposit cannot anchor", now: at(29), coverage: { wallets: [{ ...wallet, forwardBlock: BigInt("9"), throughAt: at(28), ingestedAt: at(28) }] }, kind: "pending", reason: "history-behind" },
  { name: "incomplete backfill cannot anchor", now: at(29), coverage: { wallets: [{ ...wallet, complete: false, throughAt: at(28), ingestedAt: at(28) }] }, kind: "pending", reason: "history-behind" },
  { name: "exactly at end qualifies", now: at(30), coverage: { wallets: [{ ...wallet, throughAt: at(30), ingestedAt: at(30) }] }, kind: "qualified", min: BigInt("10") },
  { name: "ingestion before window end cannot qualify", coverage: { wallets: [{ ...wallet, ingestedAt: new Date(at(30).getTime() - 1) }] }, kind: "pending", reason: "history-behind" },
  { name: "coverage exactly through window end qualifies despite lag to now", coverage: { wallets: [{ ...wallet, throughAt: at(30), ingestedAt: at(30) }] }, kind: "qualified", min: BigInt("10") },
  { name: "every wallet must cover window end", coverage: { wallets: [wallet, { ...wallet, walletId: "two", ingestedAt: at(29) }] }, kind: "pending", reason: "history-behind" },
  { name: "dip at end is in window", ledger: [mint, change(-BigInt("1"), 30)], kind: "disqualified", min: BigInt("9") },
  { name: "dip one millisecond after end is outside window", ledger: [mint, change(-BigInt("10"), 30, { at: new Date(at(30).getTime() + 1) })], kind: "qualified", min: BigInt("10") },
  { name: "same block ordered by log index regardless of input order", ledger: [change(-BigInt("1"), 0, { logIndex: 2 }), mint], kind: "disqualified", min: BigInt("9") },
  { name: "same-block withdrawal before mint is pre-window", coverage: { wallets: [{ ...wallet, initialSharesAtoms: BigInt("1") }] }, ledger: [mint, change(-BigInt("1"), 0, { logIndex: 0 })], kind: "qualified", min: BigInt("10") },
  { name: "aggregate across invitee wallets, cancelling one internal transfer log", coverage: { wallets: [wallet, { ...wallet, walletId: "two" }] }, ledger: [mint, change(-BigInt("10"), 1), change(BigInt("10"), 1, { walletId: "two" })], kind: "qualified", min: BigInt("10") },
  { name: "second invitee wallet can cause a disqualifying dip", coverage: { wallets: [wallet, { ...wallet, walletId: "two", initialSharesAtoms: BigInt("5") }] }, ledger: [mint, change(-BigInt("6"), 1, { walletId: "two" })], kind: "disqualified", min: BigInt("9") },
  { name: "other vault cannot satisfy the mint", ledger: [{ ...mint, vaultAddress: "other" }], kind: "pending", reason: "history-unavailable" },
  { name: "valid observed dip disqualifies without waiting for end coverage", coverage: { wallets: [{ ...wallet, throughAt: at(2), ingestedAt: at(2) }] }, ledger: [mint, change(-BigInt("1"), 1)], kind: "disqualified", min: BigInt("9") },
];

describe("invite reward holding qualification", () => {
  for (const entry of cases) test(entry.name, () => {
    const result = evaluateQualification({ terms, now: entry.now ?? at(40), deposits: entry.deposits ?? [deposit],
      ledger: entry.ledger ?? [mint], coverage: entry.coverage ?? { wallets: [wallet] }, anchorTxHash: entry.anchorTxHash });
    expect(result.kind).toBe(entry.kind);
    if (entry.min !== undefined && "minSharesAtoms" in result) expect(result.minSharesAtoms).toBe(entry.min);
    if (entry.actionId !== undefined && "deposit" in result) expect(result.deposit.actionId).toBe(entry.actionId);
    if (entry.reason !== undefined && "reason" in result) expect(result.reason).toBe(entry.reason);
  });
  test("later deposit B anchored first stays anchored when earlier A is observed later", () => {
    const later = { ...deposit, actionId: "b", txHash: "later-mint", blockNumber: BigInt("11"), at: at(1) };
    const laterMint = change(BigInt("10"), 1, { txHash: later.txHash });
    const saved = evaluateQualification({ terms, now: at(2), deposits: [later], ledger: [laterMint],
      coverage: { wallets: [{ ...wallet, throughAt: at(1), ingestedAt: at(1) }] } });
    expect(saved).toMatchObject({ kind: "saved", deposit: { actionId: "b", windowEndsAt: at(31) } });
    if (saved.kind !== "saved") throw new Error("Expected anchor B");
    const result = evaluateQualification({ terms, now: at(40), deposits: [deposit, later], ledger: [mint, laterMint],
      coverage: { wallets: [wallet] }, anchorTxHash: saved.deposit.txHash });
    expect(result).toMatchObject({ kind: "qualified", deposit: { actionId: "b", txHash: later.txHash, windowEndsAt: at(31) },
      qualifiedAt: at(31), minSharesAtoms: BigInt("20") });
  });
  test("atom arithmetic remains exact above Number precision", () => {
    const value = BigInt("9007199254740993");
    const result = evaluateQualification({ terms, now: at(40), deposits: [deposit], ledger: [{ ...mint, delta: value }, change(-BigInt("1"), 1)], coverage: { wallets: [wallet] } });
    expect(result.kind).toBe("disqualified");
    if ("minSharesAtoms" in result) expect(result.minSharesAtoms).toBe(value - BigInt("1"));
  });
});

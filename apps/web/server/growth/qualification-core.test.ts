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
  at: at(day), txHash: null, delta, ...overrides,
});
const mint = change(BigInt("10"), 0);
const wallet = { walletId: "one", fromBlock: BigInt("1"), initialSharesAtoms: BigInt("0"), forwardBlock: BigInt("100"), verifiedBlock: BigInt("100"),
  throughAt: at(40), ingestedAt: at(40), complete: true, inconsistent: false };
type Case = { name: string; deposits?: QualificationDeposit[]; ledger?: QualificationChange[];
  coverage?: QualificationCoverage; now?: Date; anchorTxHash?: string; kind: ReturnType<typeof evaluateQualification>["kind"]; min?: bigint; actionId?: string; shares?: bigint; reason?: "history-behind" | "history-unavailable" | "balance-dropped" };
const cases: Case[] = [
  { name: "NULL-hash production mint saves", now: at(1), kind: "saved", shares: BigInt("10") },
  { name: "NULL-hash production mint qualifies", kind: "qualified", shares: BigInt("10") },
  { name: "exact hash excludes another hash at the same block and time", ledger: [{ ...mint, txHash: "mint" },
    change(BigInt("20"), 0, { txHash: "other", logIndex: 2 })], kind: "qualified", shares: BigInt("10") },
  { name: "exact hash excludes NULL-hash positives from mint and holding boundary", ledger: [{ ...mint, txHash: "mint" },
    change(BigInt("5"), 0, { logIndex: 2 })], kind: "qualified", shares: BigInt("10"), min: BigInt("10") },
  { name: "NULL-hash tail cannot hide a same-block mixed-hash dip", ledger: [{ ...mint, txHash: "mint" },
    change(-BigInt("10"), 0, { txHash: "other", logIndex: 2 }),
    change(BigInt("20"), 0, { txHash: "other", logIndex: 3 }),
    change(BigInt("1"), 0, { logIndex: 4 })], kind: "disqualified", shares: BigInt("10"), min: BigInt("0") },
  { name: "same-block NULL-hash extra mint conservatively raises holding threshold", ledger: [mint,
    change(BigInt("5"), 0, { logIndex: 2 }), change(-BigInt("1"), 1)], kind: "disqualified", min: BigInt("14"), shares: BigInt("15") },
  { name: "hashless changes at another block cannot bind", ledger: [change(BigInt("10"), 1)], kind: "pending", reason: "history-unavailable" },
  { name: "hashless changes at another timestamp cannot bind", ledger: [{ ...mint, at: at(1) }], kind: "pending", reason: "history-unavailable" },
  { name: "matching hash at another block cannot bind", ledger: [change(BigInt("10"), 1, { txHash: "mint" })], kind: "pending", reason: "history-unavailable" },
  { name: "matching hash at another timestamp cannot bind", ledger: [{ ...mint, txHash: "mint", at: at(1) }], kind: "pending", reason: "history-unavailable" },
  { name: "bound zero mint is unavailable", ledger: [{ ...mint, delta: BigInt("0") }], kind: "pending", reason: "history-unavailable" },
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
  { name: "dip inside the corroborated point disqualifies", coverage: { wallets: [{ ...wallet, verifiedBlock: BigInt("11") }] }, ledger: [mint, change(-BigInt("1"), 1)], kind: "disqualified", min: BigInt("9") },
  { name: "dip beyond the last verified block stays pending", coverage: { wallets: [{ ...wallet, verifiedBlock: BigInt("10") }] }, ledger: [mint, change(-BigInt("1"), 1)], kind: "pending", reason: "history-behind" },
  { name: "dip without a verified block stays pending", coverage: { wallets: [{ ...wallet, verifiedBlock: null }] }, ledger: [mint, change(-BigInt("1"), 1)], kind: "pending", reason: "history-behind" },
  { name: "missing receiver credit beyond corroboration cannot disqualify", coverage: { wallets: [wallet, { ...wallet, walletId: "two", verifiedBlock: BigInt("10") }] }, ledger: [mint, change(-BigInt("10"), 1)], kind: "pending", reason: "history-behind" },
  { name: "uncorroborated later ledger position keeps a recovered dip pending", coverage: { wallets: [{ ...wallet, verifiedBlock: BigInt("11") }] }, ledger: [mint, change(-BigInt("1"), 1), change(BigInt("1"), 2)], kind: "pending", reason: "history-behind" },
  { name: "post-window transfer beyond every verified block does not block a corroborated in-window dip", coverage: { wallets: [{ ...wallet, verifiedBlock: BigInt("11") }, { ...wallet, walletId: "two", verifiedBlock: BigInt("12") }] }, ledger: [mint, change(-BigInt("1"), 1), change(BigInt("1"), 31)], kind: "disqualified", min: BigInt("9") },
  { name: "corroborated deposit with no later in-window change still qualifies despite post-window activity", coverage: { wallets: [{ ...wallet, verifiedBlock: deposit.blockNumber }] }, ledger: [mint, change(-BigInt("10"), 31)], kind: "qualified", min: BigInt("10") },
  { name: "qualification needs no verified block without a dip", coverage: { wallets: [{ ...wallet, verifiedBlock: null }] }, kind: "qualified", min: BigInt("10") },
  { name: "saving needs no verified block without a dip", now: at(2), coverage: { wallets: [{ ...wallet, verifiedBlock: null }] }, kind: "saved", min: BigInt("10") },
  { name: "dip then redeposit does not repair qualification", ledger: [mint, change(-BigInt("10"), 1), change(BigInt("10"), 2)], kind: "disqualified", min: BigInt("0") },
  { name: "capital cycled through another customer's wallet fails", ledger: [mint, change(-BigInt("10"), 1), change(BigInt("10"), 2)], kind: "disqualified", min: BigInt("0") },
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
  { name: "cross-wallet transfer above shared forward coverage stays pending after the window", coverage: { wallets: [wallet, { ...wallet, walletId: "two", forwardBlock: BigInt("10"), throughAt: start }] }, ledger: [mint, change(-BigInt("10"), 1)], kind: "pending", reason: "history-behind" },
  { name: "cross-wallet transfer above shared forward coverage preserves the proven holding minimum", now: at(2), coverage: { wallets: [wallet, { ...wallet, walletId: "two", forwardBlock: BigInt("10"), throughAt: start }] }, ledger: [mint, change(-BigInt("10"), 1)], kind: "saved", min: BigInt("10") },
  { name: "receiving change ahead of its wallet cursor is still unproven", coverage: { wallets: [wallet, { ...wallet, walletId: "two", forwardBlock: BigInt("10"), throughAt: start }] }, ledger: [mint, change(-BigInt("10"), 1), change(BigInt("10"), 1, { walletId: "two" })], kind: "pending", reason: "history-behind" },
  { name: "cross-wallet transfer qualifies once the receiving wallet covers it", coverage: { wallets: [wallet, { ...wallet, walletId: "two", forwardBlock: BigInt("11") }] }, ledger: [mint, change(-BigInt("10"), 1), change(BigInt("10"), 1, { walletId: "two" })], kind: "qualified", min: BigInt("10") },
  { name: "covered cross-wallet transfer preserves the holding minimum before window end", now: at(2), coverage: { wallets: [wallet, { ...wallet, walletId: "two", forwardBlock: BigInt("11") }] }, ledger: [mint, change(-BigInt("10"), 1), change(BigInt("10"), 1, { walletId: "two" })], kind: "saved", min: BigInt("10") },
  { name: "covered in-window dip disqualifies before the window ends", now: at(2), ledger: [mint, change(-BigInt("1"), 1)], kind: "disqualified", min: BigInt("9") },
  { name: "lagging wallet cannot mask a dip inside shared forward coverage", now: at(3), coverage: { wallets: [wallet, { ...wallet, walletId: "two", forwardBlock: BigInt("11"), throughAt: at(1), ingestedAt: at(1) }] }, ledger: [mint, change(-BigInt("1"), 1), change(BigInt("1"), 2)], kind: "disqualified", min: BigInt("9") },
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
    if (entry.shares !== undefined && "deposit" in result) expect(result.deposit.sharesAtoms).toBe(entry.shares);
    if (entry.actionId !== undefined && "deposit" in result) expect(result.deposit.actionId).toBe(entry.actionId);
    if (entry.reason !== undefined && "reason" in result) expect(result.reason).toBe(entry.reason);
  });
  test.each([1, 40])("NULL-hash deposit with other hashed transactions stays unavailable at day %s", (day) => {
    const result = evaluateQualification({ terms, now: at(day), deposits: [deposit], coverage: { wallets: [wallet] },
      ledger: [change(BigInt("100"), 0),
        change(-BigInt("100"), 0, { txHash: "other", logIndex: 2 }),
        change(BigInt("200"), 0, { txHash: "other", logIndex: 3 }),
        change(BigInt("1"), 0, { logIndex: 4 })] });
    expect(result).toEqual({ kind: "pending", reason: "history-unavailable" });
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

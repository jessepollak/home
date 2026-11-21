import "server-only";

import type { InviteRewardTerms } from "@/shared/growth/reward";

export type QualificationDeposit = {
  actionId: string; txHash: string; blockNumber: bigint; at: Date; assetsAtoms: bigint;
  vaultAddress: string; confirmed: boolean; outcome: string | null;
};
export type QualificationChange = {
  walletId: string; vaultAddress: string; blockNumber: bigint; logIndex: number;
  at: Date; txHash: string | null; delta: bigint;
};
export type QualificationCoverage = {
  wallets: readonly { walletId: string; fromBlock: bigint; initialSharesAtoms: bigint | null;
    forwardBlock: bigint; throughAt: Date | null; ingestedAt: Date | null; complete: boolean; inconsistent: boolean }[];
  overflow?: boolean;
};
export type AnchoredDeposit = {
  actionId: string; txHash: string; blockNumber: bigint; at: Date; assetsAtoms: bigint;
  sharesAtoms: bigint; windowEndsAt: Date;
};
export type QualificationResult =
  | { kind: "unchanged" }
  | { kind: "pending"; reason: "history-unavailable" | "history-behind" }
  | { kind: "saved"; deposit: AnchoredDeposit; minSharesAtoms: bigint }
  | { kind: "qualified"; deposit: AnchoredDeposit; qualifiedAt: Date; minSharesAtoms: bigint }
  | { kind: "disqualified"; deposit: AnchoredDeposit; reason: "balance-dropped"; minSharesAtoms: bigint };

export function firstQualifyingDeposit(terms: InviteRewardTerms, deposits: readonly QualificationDeposit[], now: Date, anchorTxHash?: string | null) {
  return [...deposits].filter((deposit) => deposit.confirmed && deposit.outcome === "succeeded" &&
    deposit.assetsAtoms >= BigInt(terms.minDepositAtoms) && deposit.at <= now &&
    (anchorTxHash == null || deposit.txHash === anchorTxHash))
    .sort((a, b) => a.at.getTime() - b.at.getTime() ||
      (a.blockNumber < b.blockNumber ? -1 : a.blockNumber > b.blockNumber ? 1 : a.actionId.localeCompare(b.actionId)))[0];
}

export function evaluateQualification(input: {
  terms: InviteRewardTerms; now: Date; deposits: readonly QualificationDeposit[];
  ledger: readonly QualificationChange[]; coverage: QualificationCoverage; anchorTxHash?: string | null;
}): QualificationResult {
  const candidate = firstQualifyingDeposit(input.terms, input.deposits, input.now, input.anchorTxHash);
  if (!candidate) return input.anchorTxHash == null ? { kind: "unchanged" } : { kind: "pending", reason: "history-unavailable" };
  const { wallets } = input.coverage;
  if (input.coverage.overflow || wallets.length === 0 || wallets.some((wallet) =>
    wallet.inconsistent || wallet.initialSharesAtoms === null || wallet.fromBlock >= candidate.blockNumber)) {
    return { kind: "pending", reason: "history-unavailable" };
  }
  if (wallets.some((wallet) => !wallet.complete)) return { kind: "pending", reason: "history-behind" };
  const byWallet = new Map(wallets.map((wallet) => [wallet.walletId, wallet]));
  const changes = input.ledger.filter((change) => {
    const wallet = byWallet.get(change.walletId);
    return wallet !== undefined && change.vaultAddress === candidate.vaultAddress &&
      change.blockNumber > wallet.fromBlock && change.at <= input.now;
  })
    .sort((a, b) => a.blockNumber < b.blockNumber ? -1 : a.blockNumber > b.blockNumber ? 1 : a.logIndex - b.logIndex);
  const minted = changes.filter((change) => change.txHash === candidate.txHash && change.delta > BigInt("0"))
    .reduce((sum, change) => sum + change.delta, BigInt("0"));
  const depositChanges = changes.filter((change) => change.txHash === candidate.txHash);
  const lastDepositChange = depositChanges.at(-1);
  if (minted <= BigInt("0") || !lastDepositChange || depositChanges.some((change) => change.blockNumber !== candidate.blockNumber ||
    change.at.getTime() !== candidate.at.getTime())) return { kind: "pending", reason: "history-unavailable" };
  const deposit: AnchoredDeposit = { actionId: candidate.actionId, txHash: candidate.txHash,
    blockNumber: candidate.blockNumber, at: candidate.at, assetsAtoms: candidate.assetsAtoms,
    sharesAtoms: minted, windowEndsAt: new Date(candidate.at.getTime() + input.terms.holdDays * 86_400_000) };
  let balance = BigInt("0");
  for (const wallet of wallets) {
    if (wallet.initialSharesAtoms === null) return { kind: "pending", reason: "history-unavailable" };
    balance += wallet.initialSharesAtoms;
  }
  let minimum: bigint | null = null;
  for (let index = 0; index < changes.length;) {
    const first = changes[index];
    if (!first) break;
    let delta = first.delta;
    index += 1;
    for (let next = changes[index]; next && next.blockNumber === first.blockNumber && next.logIndex === first.logIndex; next = changes[index]) {
      delta += next.delta;
      index += 1;
    }
    balance += delta;
    if (balance < BigInt("0")) return { kind: "pending", reason: "history-unavailable" };
    const postDeposit = first.blockNumber > lastDepositChange.blockNumber ||
      first.blockNumber === lastDepositChange.blockNumber && first.logIndex >= lastDepositChange.logIndex;
    if (postDeposit && first.at <= deposit.windowEndsAt && (minimum === null || balance < minimum)) minimum = balance;
  }
  if (minimum === null) return { kind: "pending", reason: "history-unavailable" };
  if (minimum < minted) return { kind: "disqualified", deposit, reason: "balance-dropped", minSharesAtoms: minimum };
  if (wallets.some((wallet) => wallet.forwardBlock < candidate.blockNumber) ||
    input.now >= deposit.windowEndsAt && wallets.some((wallet) => wallet.throughAt === null ||
      wallet.throughAt < deposit.windowEndsAt || wallet.ingestedAt === null || wallet.ingestedAt < deposit.windowEndsAt)) {
    return { kind: "pending", reason: "history-behind" };
  }
  return input.now >= deposit.windowEndsAt
    ? { kind: "qualified", deposit, qualifiedAt: deposit.windowEndsAt, minSharesAtoms: minimum }
    : { kind: "saved", deposit, minSharesAtoms: minimum };
}

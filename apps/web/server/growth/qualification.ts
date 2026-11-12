import "server-only";

import type { SqlExecutor } from "@/server/db/sql";
import type { InviteRewardState, InviteRewardTerms } from "@/shared/growth/reward";
import { isRecord } from "@/shared/guards";
import { BASE_CHAIN_ID, BASE_USDC_ADDRESS, getVerifiedSaveVault } from "@/shared/savings/config";
import { evaluateQualification, firstQualifyingDeposit, type AnchoredDeposit, type QualificationChange,
  type QualificationCoverage, type QualificationDeposit } from "./qualification-core";

export type RewardRow = {
  id: string; inviterCustomerId: string; inviteeCustomerId: string; terms: InviteRewardTerms;
  attributedAt: Date; state: InviteRewardState; depositActionId: string | null; depositTxHash: string | null;
  depositAt: Date | null; depositSharesAtoms: bigint | null; windowEndsAt: Date | null;
};
export type EvaluationResult =
  | { kind: "unchanged" }
  | { kind: "pending"; reason: "history-unavailable" | "history-behind" }
  | { kind: "saved"; deposit: AnchoredDeposit; minSharesAtoms: bigint }
  | { kind: "qualified"; qualifiedAt: Date; minSharesAtoms: bigint }
  | { kind: "disqualified"; reason: "balance-dropped"; minSharesAtoms: bigint };

const ACTION_LIMIT = 1_000;
const WALLET_LIMIT = 50;
const CHANGE_LIMIT = 10_000;
const unavailable = { kind: "pending", reason: "history-unavailable" } as const;

type ActionEvidence = { id: string; summary: unknown; transaction_hash: string | null;
  observed_receipt_transaction_hash: string | null; observed_receipt_block_number: string | null;
  settled_at: Date | null; outcome_source: string | null };

function parseDeposit(action: ActionEvidence): QualificationDeposit | null {
  const summary = action.summary;
  if (!isRecord(summary) || !isRecord(summary.metadata) || !Array.isArray(summary.amounts)) return null;
  const metadata = summary.metadata;
  if (metadata.product !== "savings" || metadata.operation !== "deposit" || typeof metadata.vaultAddress !== "string" ||
    !getVerifiedSaveVault(metadata.vaultAddress) || !isRecord(metadata.network) || metadata.network.chainId !== BASE_CHAIN_ID) return null;
  const usdcId = `eip155:${BASE_CHAIN_ID}/erc20:${BASE_USDC_ADDRESS.toLowerCase()}`;
  const amount: unknown = summary.amounts.find((value: unknown) => isRecord(value) && value.assetId === usdcId && value.direction === "spend");
  const hash = action.observed_receipt_transaction_hash ?? action.transaction_hash;
  if (!isRecord(amount) || typeof amount.amountBaseUnits !== "string" || !/^[1-9]\d{0,77}$/.test(amount.amountBaseUnits) ||
    !hash || !/^0x[0-9a-fA-F]{64}$/.test(hash) || action.settled_at === null || action.outcome_source !== "chain" ||
    !action.observed_receipt_block_number || !/^[1-9]\d*$/.test(action.observed_receipt_block_number)) return null;
  return { actionId: action.id, txHash: hash.toLowerCase(), blockNumber: BigInt(action.observed_receipt_block_number),
    at: new Date(action.settled_at), assetsAtoms: BigInt(amount.amountBaseUnits), vaultAddress: metadata.vaultAddress.toLowerCase(),
    confirmed: true, outcome: "succeeded" };
}

export async function readRewardEvidence(sql: SqlExecutor, row: RewardRow, now: Date) {
  const actions = await sql.query<ActionEvidence>(
    `SELECT id, summary, transaction_hash, observed_receipt_transaction_hash, observed_receipt_block_number,
       settled_at, outcome_source FROM actions WHERE customer_id=$1 AND kind='savings-deposit'
       AND confirmed_at IS NOT NULL AND outcome='succeeded'
       ORDER BY settled_at NULLS FIRST, id LIMIT $2`, [row.inviteeCustomerId, ACTION_LIMIT + 1]);
  const deposits = actions.rows.map(parseDeposit);
  if (actions.rows.length > ACTION_LIMIT || deposits.some((deposit) => deposit === null)) return { error: unavailable };
  const knownDeposits = deposits.filter((deposit): deposit is QualificationDeposit => deposit !== null);
  const candidate = firstQualifyingDeposit(row.terms, knownDeposits, now, row.depositTxHash);
  if (!candidate) return row.depositTxHash === null
    ? { deposits: knownDeposits, ledger: [], coverage: { wallets: [] } satisfies QualificationCoverage }
    : { error: unavailable };
  const wallets = await sql.query<{
    wallet_id: string; history_id: number | null; window_start_block: string | null; backfill_block: string | null;
    forward_block: string | null; ingested_at: Date | null; dirty_at: Date | null;
    asset_id: number | null; chain_quantity: string | null; through_at: Date | null;
  }>(`SELECT w.id AS wallet_id, h.id AS history_id, h.window_start_block, h.backfill_block, h.forward_block,
      h.ingested_at, h.dirty_at, a.id AS asset_id, p.chain_quantity,
      (SELECT b.block_time FROM chain_buckets b WHERE b.chain_id=w.chain_id AND b.block_number<=h.forward_block
       ORDER BY b.bucket_at DESC LIMIT 1) AS through_at
    FROM customer_wallets w
    LEFT JOIN history_addresses h ON h.chain_id=w.chain_id AND h.address=w.address
    LEFT JOIN history_assets a ON a.chain_id=w.chain_id AND a.kind='vault-share' AND a.contract_address=$2
    LEFT JOIN balance_checkpoints p ON p.address_id=h.id AND p.asset_id=a.id
      AND p.block_number=h.window_start_block AND p.purpose='window-start'
    WHERE w.customer_id=$1 AND w.chain_id=$3 ORDER BY w.id LIMIT $4`,
  [row.inviteeCustomerId, candidate.vaultAddress, BASE_CHAIN_ID, WALLET_LIMIT + 1]);
  if (wallets.rows.length > WALLET_LIMIT || wallets.rows.some((wallet) => wallet.history_id === null || wallet.asset_id === null)) {
    return { error: unavailable };
  }
  const coverage: QualificationCoverage = { wallets: [] };
  const covered: QualificationCoverage["wallets"][number][] = [];
  const ledger: QualificationChange[] = [];
  for (const wallet of wallets.rows) {
    if (wallet.window_start_block === null || wallet.forward_block === null) return { error: unavailable };
    const mismatches = await sql.query(
      `SELECT 1 FROM balance_checkpoints WHERE address_id=$1 AND asset_id=$2
       AND block_number>=$3 AND block_number<=$4
       AND (log_quantity<>chain_quantity OR (purpose='reconcile' AND log_quantity IS NULL)) LIMIT 1`,
      [wallet.history_id, wallet.asset_id, wallet.window_start_block, wallet.forward_block]);
    covered.push({ walletId: wallet.wallet_id, fromBlock: BigInt(wallet.window_start_block),
      initialSharesAtoms: wallet.chain_quantity === null ? null : BigInt(wallet.chain_quantity),
      forwardBlock: BigInt(wallet.forward_block), throughAt: wallet.through_at, ingestedAt: wallet.ingested_at,
      complete: wallet.backfill_block === wallet.window_start_block && wallet.dirty_at === null,
      inconsistent: mismatches.rows.length > 0 });
    const changes = await sql.query<{ block_number: string; log_index: number; block_time: Date; tx_hash: string | null; delta: string }>(
      `SELECT block_number, log_index, block_time, encode(tx_hash, 'hex') AS tx_hash, delta
       FROM balance_changes WHERE address_id=$1 AND asset_id=$2 AND block_number>$3 AND block_time<=$4
       ORDER BY block_number, log_index LIMIT $5`,
      [wallet.history_id, wallet.asset_id, wallet.window_start_block, now, CHANGE_LIMIT + 1]);
    if (changes.rows.length > CHANGE_LIMIT) return { error: unavailable };
    for (const change of changes.rows) ledger.push({ walletId: wallet.wallet_id, vaultAddress: candidate.vaultAddress,
      blockNumber: BigInt(change.block_number), logIndex: change.log_index, at: change.block_time,
      txHash: change.tx_hash === null ? null : `0x${change.tx_hash}`, delta: BigInt(change.delta) });
  }
  coverage.wallets = covered;
  return { deposits: knownDeposits, ledger, coverage };
}

export async function evaluateReward(sql: SqlExecutor, row: RewardRow, now: Date): Promise<EvaluationResult> {
  if (["approved", "rejected", "disqualified", "ineligible"].includes(row.state)) return { kind: "unchanged" };
  const evidence = await readRewardEvidence(sql, row, now);
  if (evidence.error) return evidence.error;
  const result = evaluateQualification({ terms: row.terms, now, anchorTxHash: row.depositTxHash, ...evidence });
  if (row.state === "joined" && (result.kind === "qualified" || result.kind === "disqualified")) {
    return { kind: "saved", deposit: result.deposit, minSharesAtoms: result.minSharesAtoms };
  }
  if (result.kind === "saved" && row.state !== "joined") return { kind: "unchanged" };
  return result;
}

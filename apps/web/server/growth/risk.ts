import "server-only";

import type { SqlExecutor } from "@/server/db/sql";
import { GROWTH_RISK_THRESHOLDS, type InviteRewardRiskSignal } from "@/shared/growth/reward";
import { BASE_CHAIN_ID, BASE_USDC_ADDRESS } from "@/shared/savings/config";
import { firstQualifyingDeposit } from "./qualification-core";
import { readRewardEvidence, type RewardRow } from "./qualification";

export async function computeRiskSignals(sql: SqlExecutor, row: RewardRow, now: Date): Promise<InviteRewardRiskSignal[]> {
  const signals = new Set<InviteRewardRiskSignal>();
  const thresholds = GROWTH_RISK_THRESHOLDS;
  const counts = await sql.query<{ signup_count: string; inviter_count: string }>(
    `SELECT (SELECT count(*) FROM (SELECT 1 FROM invite_rewards
       WHERE attributed_at >= $1::timestamptz - ($3 * interval '1 hour') AND attributed_at <= $1
       LIMIT $4) s) AS signup_count,
       (SELECT count(*) FROM (SELECT 1 FROM invite_rewards WHERE inviter_customer_id=$2
       AND attributed_at >= $1::timestamptz - ($5 * interval '1 hour') AND attributed_at <= $1
       LIMIT $6) i) AS inviter_count`,
    [row.attributedAt, row.inviterCustomerId, thresholds.signupBurstWindowHours, thresholds.signupBurstCount,
      thresholds.inviterBurstWindowHours, thresholds.inviterBurstCount]);
  if (Number(counts.rows[0]?.signup_count ?? 0) >= thresholds.signupBurstCount) signals.add("signup-burst");
  if (Number(counts.rows[0]?.inviter_count ?? 0) >= thresholds.inviterBurstCount) signals.add("inviter-burst");
  const evidence = await readRewardEvidence(sql, row, now);
  if (evidence.error) return [...signals];
  const deposit = firstQualifyingDeposit(row.terms, evidence.deposits, now, row.depositTxHash);
  if (!deposit) return [...signals];
  const funding = await sql.query<{ inviter: boolean; customer: boolean }>(
    `WITH inflows AS (
       SELECT c.tx_hash, c.block_number, c.asset_id FROM customer_wallets w
       JOIN history_addresses h ON h.chain_id=w.chain_id AND h.address=w.address
       JOIN history_assets a ON a.chain_id=w.chain_id AND a.kind='erc20' AND a.contract_address=$2
       JOIN LATERAL (SELECT tx_hash, block_number, asset_id FROM balance_changes
         WHERE address_id=h.id AND asset_id=a.id AND delta>0 AND tx_hash IS NOT NULL
           AND block_time >= $3::timestamptz - ($4 * interval '1 day') AND block_time <= $3
           AND block_number <= $5 ORDER BY block_number DESC, log_index DESC LIMIT 1000) c ON true
       WHERE w.customer_id=$1 AND w.chain_id=$6 LIMIT 1000
     ), sources AS (
       SELECT DISTINCT w.customer_id FROM inflows i
       JOIN balance_changes c ON c.tx_hash=i.tx_hash AND c.block_number=i.block_number AND c.asset_id=i.asset_id AND c.delta<0
       JOIN history_addresses h ON h.id=c.address_id
       JOIN customer_wallets w ON w.chain_id=h.chain_id AND w.address=h.address
       WHERE w.customer_id<>$1 LIMIT 1000
     ) SELECT EXISTS(SELECT 1 FROM sources WHERE customer_id=$7) AS inviter,
       EXISTS(SELECT 1 FROM sources WHERE customer_id<>$7) AS customer`,
    [row.inviteeCustomerId, BASE_USDC_ADDRESS.toLowerCase(), deposit.at, thresholds.fundingLookbackDays,
      deposit.blockNumber.toString(), BASE_CHAIN_ID, row.inviterCustomerId]);
  if (funding.rows[0]?.inviter) signals.add("funded-by-inviter");
  if (funding.rows[0]?.customer) signals.add("funded-by-customer");
  const wallets = evidence.coverage.wallets;
  if (wallets.length === 0 || wallets.some((wallet) => wallet.initialSharesAtoms === null || !wallet.complete ||
    wallet.fromBlock >= deposit.blockNumber)) return [...signals];
  const byWallet = new Map(wallets.map((wallet) => [wallet.walletId, wallet]));
  const ledger = evidence.ledger.filter((change) => {
    const wallet = byWallet.get(change.walletId);
    if (!wallet) throw new Error("Reward ledger wallet is missing coverage");
    return change.blockNumber > wallet.fromBlock;
  })
    .sort((a, b) => a.blockNumber < b.blockNumber ? -1 : a.blockNumber > b.blockNumber ? 1 : a.logIndex - b.logIndex);
  const firstDepositChange = ledger.find((change) => change.txHash === deposit.txHash);
  if (!firstDepositChange) return [...signals];
  const minted = ledger.filter((change) => change.txHash === deposit.txHash && change.delta > BigInt("0"))
    .reduce((sum, change) => sum + change.delta, BigInt("0"));
  if (minted <= BigInt("0")) return [...signals];
  const windowEnd = row.windowEndsAt ?? new Date(deposit.at.getTime() + row.terms.holdDays * 86_400_000);
  const riskEnd = new Date(windowEnd.getTime() + thresholds.withdrawalAfterWindowHours * 3_600_000);
  let balance = BigInt("0");
  for (const wallet of wallets) {
    if (wallet.initialSharesAtoms === null) return [...signals];
    balance += wallet.initialSharesAtoms;
  }
  for (let index = 0; index < ledger.length;) {
    const first = ledger[index];
    if (!first) break;
    if (first.blockNumber === firstDepositChange.blockNumber && first.logIndex === firstDepositChange.logIndex && balance > BigInt("0")) {
      signals.add("preexisting-shares");
    }
    let delta = first.delta;
    index += 1;
    for (let next = ledger[index]; next && next.blockNumber === first.blockNumber && next.logIndex === first.logIndex; next = ledger[index]) {
      delta += next.delta;
      index += 1;
    }
    balance += delta;
    if (first.at > windowEnd && first.at <= riskEnd && balance < minted) signals.add("withdrew-after-window");
  }
  return [...signals];
}

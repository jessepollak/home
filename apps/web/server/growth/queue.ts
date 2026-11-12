import "server-only";

import type { SqlExecutor } from "@/server/db/sql";
import { emitServerEvent } from "@/server/observability/log";
import { parseAddress } from "@/shared/chain/hex";
import type { InviteRewardRiskSignal, InviteRewardState, InviteRewardTerms } from "@/shared/growth/reward";
import { parseGrowthSettings } from "@/shared/operator-settings/growth";
import { evaluateReward, type EvaluationResult, type RewardRow } from "./qualification";
import { computeRiskSignals } from "./risk";

type StoredReward = {
  id: string; inviter_customer_id: string; invitee_customer_id: string; terms: InviteRewardTerms;
  attributed_at: Date; state: InviteRewardState; deposit_action_id: string | null; deposit_tx_hash: string | null;
  deposit_at: Date | null; deposit_shares_atoms: string | null; window_ends_at: Date | null;
  deposit_assets_atoms: string | null; qualified_at: Date | null; evaluated_at: Date | null;
  reserved_atoms: string | null; decided_at: Date | null;
};

function rewardRow(row: StoredReward): RewardRow {
  return {
    id: row.id, inviterCustomerId: row.inviter_customer_id, inviteeCustomerId: row.invitee_customer_id,
    terms: row.terms, attributedAt: row.attributed_at, state: row.state,
    depositActionId: row.deposit_action_id, depositTxHash: row.deposit_tx_hash, depositAt: row.deposit_at,
    depositSharesAtoms: row.deposit_shares_atoms === null ? null : BigInt(row.deposit_shares_atoms), windowEndsAt: row.window_ends_at,
  };
}

function boundedLimit(limit = 100): number {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error("Invalid reward limit");
  return limit;
}

async function applyEvaluation(sql: SqlExecutor, row: StoredReward, result: EvaluationResult, now: Date): Promise<boolean> {
  const values: unknown[] = [row.id, row.state, row.evaluated_at, now];
  let assignment = "evaluated_at=$4,history_pending=NULL";
  if (result.kind === "pending") {
    values.push(result.reason);
    assignment = "evaluated_at=$4,history_pending=$5";
  } else if (result.kind === "saved") {
    const deposit = result.deposit;
    values.push(deposit.actionId, deposit.txHash, deposit.blockNumber.toString(), deposit.at,
      deposit.assetsAtoms.toString(), deposit.sharesAtoms.toString(), deposit.windowEndsAt, result.minSharesAtoms.toString());
    assignment += ",state='saved',deposit_action_id=$5,deposit_tx_hash=$6,deposit_block_number=$7,deposit_at=$8,deposit_assets_atoms=$9,deposit_shares_atoms=$10,window_ends_at=$11,min_shares_atoms=LEAST(min_shares_atoms,$12::numeric)";
  } else if (result.kind === "qualified") {
    values.push(result.qualifiedAt, result.minSharesAtoms.toString());
    assignment += ",state='qualified',qualified_at=$5,min_shares_atoms=LEAST(min_shares_atoms,$6::numeric)";
  } else if (result.kind === "disqualified") {
    values.push(result.reason, result.minSharesAtoms.toString());
    assignment += ",state='disqualified',reason=$5,qualified_at=NULL,min_shares_atoms=LEAST(min_shares_atoms,$6::numeric)";
  }
  const updated = await sql.query(`UPDATE invite_rewards SET ${assignment}
    WHERE id=$1 AND state=$2 AND evaluated_at IS NOT DISTINCT FROM $3::timestamptz`, values);
  return updated.rowCount === 1;
}

/** @public refresh entry point for the operator reward queue. */
export async function refreshInviteRewards(sql: SqlExecutor, input: { now: Date; limit?: number }): Promise<{ evaluated: number; updated: number; failed: number }> {
  const rows = (await sql.query<StoredReward>(`SELECT * FROM invite_rewards WHERE state IN ('joined','saved')
    ORDER BY evaluated_at NULLS FIRST,id LIMIT $1`, [boundedLimit(input.limit)])).rows;
  let updated = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const result = await evaluateReward(sql, rewardRow(row), input.now);
      if (await applyEvaluation(sql, row, result, input.now)) updated += 1;
    } catch {
      failed += 1;
      emitServerEvent("operator-registry", { route: "/admin/growth", code: "GROWTH_REWARD_REFRESH_FAILED", outcome: "failed" });
    }
  }
  return { evaluated: rows.length, updated, failed };
}

type QueueEntry = {
  id: string; inviterShortId: string; inviteeShortId: string; depositAssetsAtoms: string;
  attributedAt: string; qualifiedAt: string; riskSignals: InviteRewardRiskSignal[];
};

async function queueEntry(sql: SqlExecutor, row: StoredReward, now: Date): Promise<QueueEntry> {
  if (row.deposit_assets_atoms === null || row.qualified_at === null) throw new Error("Stored reward is missing qualification");
  return {
    id: row.id, inviterShortId: row.inviter_customer_id.slice(0, 8), inviteeShortId: row.invitee_customer_id.slice(0, 8),
    depositAssetsAtoms: row.deposit_assets_atoms, attributedAt: row.attributed_at.toISOString(), qualifiedAt: row.qualified_at.toISOString(),
    riskSignals: await computeRiskSignals(sql, rewardRow(row), now),
  };
}

/** @public operator-only queue read model. */
export async function listRewardQueue(sql: SqlExecutor, input: { now: Date; limit?: number }): Promise<{
  qualified: QueueEntry[]; approved: (QueueEntry & { reservedAtoms: string; decidedAt: string })[]; approvedAtoms: string;
}> {
  const qualified = (await sql.query<StoredReward>(`SELECT * FROM invite_rewards WHERE state='qualified'
    ORDER BY qualified_at,id LIMIT $1`, [boundedLimit(input.limit)])).rows;
  const approved = (await sql.query<StoredReward>(`SELECT * FROM invite_rewards WHERE state='approved'
    ORDER BY decided_at DESC,id LIMIT 50`)).rows;
  const total = (await sql.query<{ atoms: string }>("SELECT COALESCE(sum(reserved_atoms),0)::text AS atoms FROM invite_rewards WHERE reserved_atoms IS NOT NULL")).rows[0];
  if (!total) throw new Error("Reward reservation total is missing");
  return {
    qualified: await Promise.all(qualified.map((row) => queueEntry(sql, row, input.now))),
    approved: await Promise.all(approved.map(async (row) => {
      if (row.reserved_atoms === null || row.decided_at === null) throw new Error("Stored reward is missing approval");
      return { ...await queueEntry(sql, row, input.now), reservedAtoms: row.reserved_atoms, decidedAt: row.decided_at.toISOString() };
    })),
    approvedAtoms: total.atoms,
  };
}

type DecisionResult =
  | { ok: true; state: "approved" | "rejected" }
  | { ok: false; error: "not-found" | "not-qualified" | "no-longer-qualifies" | "history-pending" | "cap-reached" | "budget-exhausted" | "settings-missing" | "invalid-actor" | "invalid-reason" };

function reservationError(error: unknown): DecisionResult | null {
  if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "23514" || !("constraint" in error)) return null;
  if (error.constraint === "invite_rewards_cap") return { ok: false, error: "cap-reached" };
  if (error.constraint === "invite_rewards_budget") return { ok: false, error: "budget-exhausted" };
  if (error.constraint === "invite_rewards_settings") return { ok: false, error: "settings-missing" };
  return null;
}

async function decideReward(sql: SqlExecutor, input: { rewardId: string; actor: string; now: Date }, reason: string | null): Promise<DecisionResult> {
  const actor = parseAddress(input.actor);
  if (actor === null || actor !== input.actor) return { ok: false, error: "invalid-actor" };
  try {
    return await sql.transaction(async (tx): Promise<DecisionResult> => {
      const row = (await tx.query<StoredReward>("SELECT * FROM invite_rewards WHERE id=$1 FOR UPDATE", [input.rewardId])).rows[0];
      if (!row) return { ok: false, error: "not-found" };
      if (row.state !== "qualified") return { ok: false, error: "not-qualified" };
      const reward = rewardRow(row);
      if (reason === null) {
        const evaluation = await evaluateReward(tx, reward, input.now);
        if (evaluation.kind === "disqualified") {
          await applyEvaluation(tx, row, evaluation, input.now);
          return { ok: false, error: "no-longer-qualifies" };
        }
        if (evaluation.kind !== "qualified") return { ok: false, error: "history-pending" };
        const stored = (await tx.query<{ value: unknown }>("SELECT value FROM operator_settings WHERE domain='growth'")).rows[0];
        if (!stored || !parseGrowthSettings(stored.value)) return { ok: false, error: "settings-missing" };
      }
      const riskSignals = await computeRiskSignals(tx, reward, input.now);
      const state = reason === null ? "approved" : "rejected";
      const reservedAtoms = reason === null ? row.terms.inviterRewardAtoms : null;
      await tx.query(`UPDATE invite_rewards SET state=$2,decided_at=$3,decided_by=$4,decision_reason=$5,
        reserved_atoms=$6,risk_signals=$7::jsonb,history_pending=NULL WHERE id=$1 AND state='qualified'`,
      [row.id, state, input.now, actor, reason, reservedAtoms, JSON.stringify(riskSignals)]);
      const after = { state, ...(reason === null ? { reservedAtoms } : { reason }), riskSignals };
      await tx.query(`INSERT INTO admin_audit_log (actor,action,target_kind,target_id,before,after,occurred_at)
        VALUES ($1,$2,'reward',$3,$4::jsonb,$5::jsonb,$6)`,
      [actor, `growth.reward.${reason === null ? "approve" : "reject"}`, row.id, JSON.stringify({ state: row.state }), JSON.stringify(after), input.now]);
      return { ok: true, state };
    });
  } catch (error) {
    const mapped = reservationError(error);
    if (mapped) return mapped;
    throw error;
  }
}

/** @public operator approval reserves a reward without paying it. */
export function approveReward(sql: SqlExecutor, input: { rewardId: string; actor: string; now: Date }): Promise<DecisionResult> {
  return decideReward(sql, input, null);
}

/** @public operator-only rejection reason is never exposed to an inviter. */
export function rejectReward(sql: SqlExecutor, input: { rewardId: string; actor: string; reason: string; now: Date }): Promise<DecisionResult> {
  const reason = input.reason.trim();
  if (reason.length < 1 || reason.length > 200 || !input.reason.isWellFormed() || /\p{Cc}/u.test(input.reason)) return Promise.resolve({ ok: false, error: "invalid-reason" });
  return decideReward(sql, input, reason);
}

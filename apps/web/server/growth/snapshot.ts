import "server-only";

import type { SqlExecutor } from "@/server/db/sql";
import type { InviteRewardTerms } from "@/shared/growth/reward";
import { growthProgramActive, parseGrowthSettings } from "@/shared/operator-settings/growth";

type SnapshotResult =
  | { kind: "created"; state: "joined" | "ineligible" }
  | { kind: "skipped"; reason: "database-unavailable" | "settings-missing" | "settings-invalid" | "program-inactive" | "already-snapshotted" };

export async function snapshotInviteReward(tx: SqlExecutor | null, input: {
  inviteeCustomerId: string; inviterCustomerId: string; inviteCode: string; country: string | null; at: Date;
}): Promise<SnapshotResult> {
  if (!tx) return { kind: "skipped", reason: "database-unavailable" };
  const stored = (await tx.query<{ value: unknown }>("SELECT value FROM operator_settings WHERE domain='growth'")).rows[0];
  if (!stored) return { kind: "skipped", reason: "settings-missing" };
  const settings = parseGrowthSettings(stored.value);
  if (!settings) return { kind: "skipped", reason: "settings-invalid" };
  if (!growthProgramActive(settings, input.at)) return { kind: "skipped", reason: "program-inactive" };
  const terms: InviteRewardTerms = {
    inviterRewardAtoms: settings.inviterRewardAtoms, minDepositAtoms: settings.minDepositAtoms,
    holdDays: settings.holdDays, countries: settings.countries, termsText: settings.termsText,
  };
  const reason = input.country === null ? "country-unknown" : settings.countries.some((country) => country === input.country) ? null : "country-not-offered";
  const state = reason === null ? "joined" : "ineligible";
  const inserted = await tx.query(`INSERT INTO invite_rewards
    (id,invitee_customer_id,inviter_customer_id,invite_code,terms,attributed_at,state,reason)
    VALUES (gen_random_uuid(),$1,$2,$3,$4::jsonb,$5,$6,$7)
    ON CONFLICT (invitee_customer_id) DO NOTHING`,
  [input.inviteeCustomerId, input.inviterCustomerId, input.inviteCode, JSON.stringify(terms), input.at, state, reason]);
  return inserted.rowCount === 1 ? { kind: "created", state } : { kind: "skipped", reason: "already-snapshotted" };
}

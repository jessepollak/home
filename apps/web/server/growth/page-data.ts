import "server-only";

import { readDatabaseUrl } from "@/server/config/env";
import { getSqlExecutor } from "@/server/db/sql";
import { readInviteStats } from "@/server/invites/store";
import { emitServerEvent } from "@/server/observability/log";
import { readPayoutSignerConfig } from "@/server/operator/payout-signers";
import { OperatorSettingsStore } from "@/server/operator-settings/store";
import { acceptOperatorAccount } from "@/shared/operator-settings/operator-account";
import { parseGrowthSettings } from "@/shared/operator-settings/growth";
import { readProgramFunnel } from "./funnel";
import { listRewardQueue, refreshInviteRewards } from "./queue";

export async function readGrowthPageData(now = new Date()) {
  if (!readDatabaseUrl()) return null;
  const sql = getSqlExecutor();
  const signers = readPayoutSignerConfig();
  function unavailable() {
    emitServerEvent("operator-registry", { route: "/admin/growth", code: "GROWTH_READ_UNAVAILABLE", outcome: "failed" });
    return null;
  }
  try {
    await refreshInviteRewards(sql, { now, limit: 100 });
  } catch {
    emitServerEvent("operator-registry", { route: "/admin/growth", code: "GROWTH_REFRESH_UNAVAILABLE", outcome: "failed" });
  }
  const [stats, funnel, queue, entry] = await Promise.all([
    readInviteStats().catch(unavailable), readProgramFunnel(sql).catch(unavailable),
    listRewardQueue(sql, { now }).catch(unavailable), new OperatorSettingsStore(sql).read("growth").catch(unavailable),
  ]);
  const value = entry ? parseGrowthSettings(entry.settings.value) : null;
  const settings = entry && value ? { ...entry.settings, value } : null;
  return {
    stats, funnel, queue, settings,
    signerState: signers.kind,
    payoutIsSigner: value?.payoutAccount ? acceptOperatorAccount(value.payoutAccount, signers) !== null : null,
  };
}

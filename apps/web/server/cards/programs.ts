import "server-only";

import { serverEnvironment } from "@/server/config/env";
import { getSqlExecutor, type SqlExecutor } from "@/server/db/sql";
import { emitServerEvent } from "@/server/observability/log";
import { createCardAccountStore } from "./account-store";
import { readBridgeProgram } from "./bridge/program";
import type { CardProgram } from "./program";
import type { CardMode, CardProviderName } from "./provider";

export function createCardPrograms(programs: readonly CardProgram[], defaultProvider: string | undefined, sql: Pick<SqlExecutor, "query">) {
  const byProvider = (provider: CardProviderName, mode: CardMode) => programs.find((program) => program.provider === provider && program.mode === mode) ?? null;
  const defaultProgram = programs.find((program) => program.provider === defaultProvider) ?? (!defaultProvider && programs.length === 1 ? programs[0] : null);
  return {
    mode: defaultProgram?.mode ?? programs[0]?.mode ?? null,
    byProvider,
    async programFor(customerId: string, mode: CardMode, signal?: AbortSignal) {
      const link = await createCardAccountStore(sql).read(customerId, mode, signal);
      return link ? byProvider(link.provider, mode) : defaultProgram?.mode === mode ? defaultProgram : null;
    },
  };
}
export function readCardPrograms(sql: Pick<SqlExecutor, "query"> = getSqlExecutor()) {
  const env = serverEnvironment();
  const programs: CardProgram[] = [];
  try { const bridge = readBridgeProgram(env); if (bridge) programs.push(bridge); }
  catch { emitServerEvent("cards-webhook", { route: "/api/cards", provider: "bridge", code: "CARDS_UNAVAILABLE", outcome: "unavailable" }); }
  const configured = env.CARD_PROGRAM_DEFAULT?.trim();
  const result = createCardPrograms(programs, configured, sql);
  if (!configured && programs.length > 1 || configured && !programs.some((program) => program.provider === configured))
    emitServerEvent("cards-webhook", { route: "/api/cards", code: "CARDS_UNAVAILABLE", outcome: "unavailable" });
  return result;
}
export async function programFor(customerId: string, mode: CardMode, signal?: AbortSignal) {
  return readCardPrograms().programFor(customerId, mode, signal);
}

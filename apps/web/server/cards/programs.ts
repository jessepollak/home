import "server-only";

import { serverEnvironment } from "@/server/config/env";
import { getSqlExecutor, type SqlExecutor } from "@/server/db/sql";
import { emitServerEvent } from "@/server/observability/log";
import { createCardAccountStore } from "./account-store";
import { readBridgeProgram } from "./bridge/program";
import type { CardProgram } from "./program";
import type { CardMode, CardProviderName } from "./provider";

let configFailureReported = false;
function reportConfigFailure(error: unknown, code: string, provider?: string) {
  if (configFailureReported) return;
  configFailureReported = true;
  emitServerEvent("cards-config", { route: "/api/cards", provider, code, outcome: "unavailable",
    errorName: error instanceof Error ? error.name : "UnknownError" });
}

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
type ProgramSnapshot = Readonly<{ programs: readonly CardProgram[]; configured: string | undefined }>;
type Environment = Readonly<Record<string, string | undefined>>;

function environmentKey(env: Environment) {
  return JSON.stringify(Object.keys(env).filter((name) => name.startsWith("BRIDGE_") || name.startsWith("CARD_"))
    .sort().map((name) => [name, env[name]]));
}
function buildSnapshot(env: Environment): ProgramSnapshot {
  const programs: CardProgram[] = [];
  try { const bridge = readBridgeProgram(env); if (bridge) programs.push(bridge); }
  catch (error) { reportConfigFailure(error, "CARDS_CONFIG_INVALID", "bridge"); }
  const configured = env.CARD_PROGRAM_DEFAULT?.trim();
  if (!configured && programs.length > 1 || configured && !programs.some((program) => program.provider === configured))
    reportConfigFailure(new Error("Invalid default card program"), "CARD_PROGRAM_DEFAULT_INVALID");
  return { programs, configured };
}
let programSnapshot: { env: Environment; key: string; snapshot: ProgramSnapshot } | null = null;
function readProgramSnapshot(): ProgramSnapshot {
  const env = serverEnvironment();
  const key = environmentKey(env);
  if (programSnapshot && programSnapshot.env === env && programSnapshot.key === key) return programSnapshot.snapshot;
  const snapshot = buildSnapshot(env);
  programSnapshot = { env, key, snapshot };
  return snapshot;
}

export function readCardPrograms(sql: Pick<SqlExecutor, "query"> = getSqlExecutor()) {
  const { programs, configured } = readProgramSnapshot();
  return createCardPrograms(programs, configured, sql);
}
export async function programFor(customerId: string, mode: CardMode, signal?: AbortSignal) {
  return readCardPrograms().programFor(customerId, mode, signal);
}

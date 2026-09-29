import "server-only";

import { recheckOpenActions } from "@/server/actions/follow-through";
import { emitServerEvent } from "@/server/observability/log";
import type { OperatorDecision } from "./authorize";

const RECHECK_INTERVAL_MS = 30_000;
const RECHECK_DEADLINE_MS = 20_000;
const RECHECK_LIMIT = 10;
let lastStartedAt = Number.NEGATIVE_INFINITY;

export function scheduleOperatorRecheck(
  decision: OperatorDecision,
  schedule: (task: () => Promise<void>) => void,
  route: "/admin" | "/admin/customers",
  deps?: { now?: () => number; recheck?: typeof recheckOpenActions },
): void {
  if (decision.kind !== "operator") return;
  try {
    schedule(async () => {
      const startedAt = (deps?.now ?? Date.now)();
      if (startedAt - lastStartedAt < RECHECK_INTERVAL_MS) return;
      lastStartedAt = startedAt;
      try {
        await (deps?.recheck ?? recheckOpenActions)({ signal: AbortSignal.timeout(RECHECK_DEADLINE_MS), limit: RECHECK_LIMIT, route });
        emitServerEvent("action-reconcile", { route, code: "OPERATOR_RECHECK_COMPLETED", outcome: "ok",
          durationMs: (deps?.now ?? Date.now)() - startedAt });
      } catch {
        emitServerEvent("action-reconcile", { route, code: "OPERATOR_RECHECK_FAILED", outcome: "failed",
          durationMs: (deps?.now ?? Date.now)() - startedAt });
      }
    });
  } catch {
    emitServerEvent("action-reconcile", { route, code: "OPERATOR_RECHECK_UNAVAILABLE", outcome: "unavailable" });
  }
}

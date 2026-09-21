import "server-only";

import { isRegionId, type RegionId } from "@/config/regions";
import { authorizeSession, type SessionAuthorizer } from "@/server/auth/authorize";
import { writeObservabilityEvent } from "@/server/observability/log";
import type { ObservabilityEvent } from "@/server/observability/schema";
import { privateError, privateJson } from "@/server/http/private-response";
import type {
  BalancesAddress,
  BalancesSnapshot,
} from "@/shared/balances/types";

export function createBalancesHandler(dependencies: {
  authorize: SessionAuthorizer;
  readBalances: (
    owner: BalancesAddress,
    region: RegionId,
    signal?: AbortSignal,
  ) => Promise<BalancesSnapshot>;
  ensureAddressSubscribed?: (address: BalancesAddress) => Promise<void>;
  log?: (event: ObservabilityEvent) => unknown;
}) {
  const log = dependencies.log ?? writeObservabilityEvent;
  const subscriptionAttempts = new Set<string>();

  return async function GET(request: Request): Promise<Response> {
    const region = readRegion(request);
    if (!region) {
      return privateError("INVALID_REGION", "A supported balances region is required.", 400);
    }

    const session = await authorizeSession(request, dependencies.authorize);
    if (session instanceof Response) {
      return session;
    }
    if (!session.smartAccount) {
      return privateError("SMART_ACCOUNT_UNAVAILABLE", "A verified Base smart account is not available yet.", 503);
    }

    const address = session.smartAccount.address.toLowerCase() as BalancesAddress;
    if (!subscriptionAttempts.has(address)) {
      subscriptionAttempts.add(address);
      fireAndForgetSubscription(() => dependencies.ensureAddressSubscribed?.(address));
    }

    try {
      const snapshot = await dependencies.readBalances(
        address,
        region,
        request.signal,
      );
      return privateJson(snapshot, 200);
    } catch {
      emitReadFailure(log);
      return privateError("BALANCES_UNAVAILABLE", "Balances are temporarily unavailable.", 502);
    }
  };
}

function readRegion(request: Request): RegionId | null {
  const values = new URL(request.url).searchParams.getAll("region");
  return values.length === 1 && isRegionId(values[0]) ? values[0] : null;
}

function emitReadFailure(
  log: (event: ObservabilityEvent) => unknown,
): void {
  try {
    log({
      kind: "portfolio-balance-source",
      route: "/api/balances",
      source: "configured-base-rpc",
      stage: "inventory",
      outcome: "unavailable",
      reason: "read-failed",
    });
  } catch {
  }
}

function fireAndForgetSubscription(run: () => Promise<void> | undefined): void {
  try {
    const pending = run();
    if (pending) void pending.catch(() => undefined);
  } catch {
  }
}

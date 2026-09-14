import "server-only";

import { isRegionId, type RegionId } from "@/config/regions";
import { authorizeSession, type SessionAuthorizer } from "@/server/auth/authorize";
import { writeObservabilityEvent } from "@/server/observability/log";
import type { ObservabilityEvent } from "@/server/observability/schema";
import { ACCOUNT_PROVIDER_HEADER } from "@/shared/account/session-types";
import type {
  BalancesAddress,
  BalancesSnapshot,
} from "@/shared/balances/types";

const privateResponseHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Vary: `Authorization, ${ACCOUNT_PROVIDER_HEADER}`,
} as const;

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
      return privateJson({
        error: {
          code: "INVALID_REGION",
          message: "A supported balances region is required.",
        },
      }, 400);
    }

    const session = await authorizeSession(request, dependencies.authorize);
    if (session instanceof Response) {
      return session;
    }
    if (!session.smartAccount) {
      return privateJson({
        error: {
          code: "SMART_ACCOUNT_UNAVAILABLE",
          message: "A verified Base smart account is not available yet.",
        },
      }, 503);
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
      return privateJson({
        error: {
          code: "BALANCES_UNAVAILABLE",
          message: "Balances are temporarily unavailable.",
        },
      }, 502);
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
    // Observability never changes responses.
  }
}

function fireAndForgetSubscription(run: () => Promise<void> | undefined): void {
  try {
    const pending = run();
    if (pending) void pending.catch(() => undefined);
  } catch {
    // Subscription failures are non-fatal and logged by the subscription port.
  }
}

function privateJson(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: privateResponseHeaders,
  });
}

import "server-only";

import { isRegionId, type RegionId } from "@/config/regions";
import { authorizeSession, type SessionAuthorizer } from "@/server/auth/authorize";
import { observeSafely, writeObservabilityEvent } from "@/server/observability/log";
import type { ObservabilityEvent } from "@/server/observability/schema";
import { privateError, privateJson } from "@/server/http/private-response";
import { parseBalancesSnapshot } from "@/shared/balances/contract";
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

    let snapshot: BalancesSnapshot;
    try {
      snapshot = await dependencies.readBalances(
        address,
        region,
        request.signal,
      );
    } catch {
      emitFailure(log, {
        kind: "portfolio-balance-source",
        route: "/api/balances",
        source: "configured-base-rpc",
        stage: "inventory",
        outcome: "unavailable",
        reason: "read-failed",
      });
      return privateError("BALANCES_UNAVAILABLE", "Balances are temporarily unavailable.", 502);
    }

    let parsed: BalancesSnapshot;
    try {
      parsed = parseBalancesSnapshot(snapshot, {
        subject: session.user.subject,
        smartAccountAddress: address,
        chainId: session.smartAccount.chainId,
      }, region);
    } catch {
      emitFailure(log, {
        kind: "balances-contract",
        route: "/api/balances",
        reason: "invalid-snapshot",
      });
      return privateError("BALANCES_UNAVAILABLE", "Balances are temporarily unavailable.", 502);
    }

    return privateJson(parsed, 200);
  };
}

function readRegion(request: Request): RegionId | null {
  const values = new URL(request.url).searchParams.getAll("region");
  return values.length === 1 && isRegionId(values[0]) ? values[0] : null;
}

function emitFailure(
  log: (event: ObservabilityEvent) => unknown,
  event: ObservabilityEvent,
): void {
  observeSafely(() => log(event));
}

function fireAndForgetSubscription(run: () => Promise<void> | undefined): void {
  try {
    const pending = run();
    if (pending) void pending.catch(() => undefined);
  } catch { // oxlint-disable-line home/no-silent-catch -- subscription refresh is fire-and-forget and must not fail the balances response
  }
}

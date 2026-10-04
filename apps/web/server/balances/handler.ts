import "server-only";

import { isRegionId, type RegionId } from "@/config/regions";
import { authorizeSession, type SessionAuthorizer } from "@/server/auth/authorize";
import { observeSafely, writeObservabilityEvent } from "@/server/observability/log";
import type { ObservabilityEvent } from "@/server/observability/schema";
import { privateError, privateSerializedJson } from "@/server/http/private-response";
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
    requestStartedAtMs?: number,
  ) => Promise<BalancesSnapshot>;
  ensureAddressSubscribed?: (address: BalancesAddress) => Promise<void>;
  log?: (event: ObservabilityEvent) => unknown;
  nowMs?: () => number;
}) {
  const log = dependencies.log ?? writeObservabilityEvent;
  const nowMs = dependencies.nowMs ?? (() => performance.now());
  const subscriptionAttempts = new Set<string>();

  return async function GET(request: Request): Promise<Response> {
    const startedAt = Date.now();
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
        startedAt,
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
    const validateStartedAt = nowMs();
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

    const validate = Math.max(0, nowMs() - validateStartedAt);
    const serializeStartedAt = nowMs();
    const body = JSON.stringify(parsed);
    const serialize = Math.max(0, nowMs() - serializeStartedAt);
    const response = privateSerializedJson(body, 200);
    observeSafely(() => log({
      kind: "balances-response",
      route: "/api/balances",
      durationMs: { validate, serialize },
      bytes: Buffer.byteLength(body, "utf8"),
    }));
    return response;
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

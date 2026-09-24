import "server-only";

import {
  ACTIVITY_CONTRACT_VERSION,
  type ActivityResponse,
} from "@/shared/activity/contract";
import {
  authorizeSession,
  type SessionAuthorizer,
} from "@/server/auth/authorize";
import { ChainDataError } from "@/server/chain-data/errors";
import type {
  ActivityReadSource,
  ObservabilityEvent,
} from "@/server/observability/schema";
import { privateError, privateJson } from "@/server/http/private-response";
import { isActivityValuationCurrency } from "@/shared/activity/valuation";
import type { ActivityReadRequest, ActivityReader } from "./types";

type ActivityReadObservation = Extract<
  ObservabilityEvent,
  { kind: "activity-read" }
>;
export type ActivityObservationSink = (
  event: ActivityReadObservation,
) => unknown | PromiseLike<unknown>;

export function createActivityHandler(dependencies: {
  authorize: SessionAuthorizer;
  readActivity: ActivityReader;
  source: () => Exclude<ActivityReadSource, "none">;
  now?: () => Date;
  clock?: () => number;
  observe?: ActivityObservationSink;
}) {
  const now = dependencies.now ?? (() => new Date());
  const clock = dependencies.clock ?? (() => Date.now());
  const observe = dependencies.observe ?? (() => undefined);

  return async function GET(request: Request): Promise<Response> {
    const requestStartedAt = clock();
    const session = await authorizeSession(request, dependencies.authorize);
    if (session instanceof Response) {
      emitActivityObservation(
        observe,
        finalObservation({
          outcome: "rejected",
          reason: "authorization",
          source: "none",
          requestStartedAt,
          finishedAt: clock(),
        }),
      );
      return session;
    }
    if (!session.smartAccount) {
      emitActivityObservation(
        observe,
        finalObservation({
          outcome: "rejected",
          reason: "authorization",
          source: "none",
          requestStartedAt,
          finishedAt: clock(),
        }),
      );
      return privateError(
        "SMART_ACCOUNT_UNAVAILABLE",
        "A verified Base smart account is not available yet.",
        503,
      );
    }

    const activityRequest = parseActivityRequest(request, now());
    if (!activityRequest) {
      emitActivityObservation(
        observe,
        finalObservation({
          outcome: "rejected",
          reason: "request",
          source: "none",
          requestStartedAt,
          finishedAt: clock(),
        }),
      );
      return privateError(
        "INVALID_ACTIVITY_REQUEST",
        "Use a valid activity window and pagination cursor.",
        400,
      );
    }

    let source: Exclude<ActivityReadSource, "none">;
    try {
      source = dependencies.source();
    } catch (error) {
      const finishedAt = clock();
      emitActivityObservation(observe, {
        kind: "activity-read",
        route: "/api/activity",
        outcome: "failed",
        reason: "primary-source",
        source: "none",
        durationMs: elapsedMs(finishedAt, requestStartedAt),
        sourceDurationMs: 0,
        sourceAttemptCount: 0,
        pageCount: 0,
        rowCount: 0,
      });
      return activityReadError(error);
    }

    const sourceStartedAt = clock();
    emitActivityObservation(observe, {
      kind: "activity-read",
      route: "/api/activity",
      outcome: "started",
      reason: "primary-source",
      source,
      durationMs: elapsedMs(sourceStartedAt, requestStartedAt),
      sourceDurationMs: 0,
      sourceAttemptCount: 1,
      pageCount: 0,
      rowCount: 0,
    });

    let primaryFinishedAt: number | null = null;
    try {
      const page = await dependencies.readActivity(
        {
          address: session.smartAccount.address,
          chainId: 8453,
          verification: "session-smart-account",
        },
        activityRequest,
        request.signal,
      );
      primaryFinishedAt = clock();
      throwIfAborted(request.signal);

      const finishedAt = clock();
      emitActivityObservation(observe, {
        kind: "activity-read",
        route: "/api/activity",
        outcome: "succeeded",
        reason: "primary-source",
        source,
        durationMs: elapsedMs(finishedAt, requestStartedAt),
        sourceDurationMs: elapsedMs(primaryFinishedAt, sourceStartedAt),
        sourceAttemptCount: 1,
        pageCount: 1,
        rowCount: page.transfers.length,
      });
      return privateJson(
        { version: ACTIVITY_CONTRACT_VERSION, ...page } satisfies ActivityResponse,
        200,
      );
    } catch (error) {
      const finishedAt = clock();
      emitActivityObservation(observe, {
        kind: "activity-read",
        route: "/api/activity",
        outcome: request.signal.aborted ? "cancelled" : "failed",
        reason: request.signal.aborted ? "request" : "primary-source",
        source,
        durationMs: elapsedMs(finishedAt, requestStartedAt),
        sourceDurationMs: elapsedMs(
          primaryFinishedAt ?? finishedAt,
          sourceStartedAt,
        ),
        sourceAttemptCount: 1,
        pageCount: 0,
        rowCount: 0,
      });
      return activityReadError(error);
    }
  };
}

function finalObservation(input: {
  outcome: "rejected";
  reason: "authorization" | "request";
  source: "none";
  requestStartedAt: number;
  finishedAt: number;
}): ActivityReadObservation {
  return {
    kind: "activity-read",
    route: "/api/activity",
    outcome: input.outcome,
    reason: input.reason,
    source: input.source,
    durationMs: elapsedMs(input.finishedAt, input.requestStartedAt),
    sourceDurationMs: 0,
    sourceAttemptCount: 0,
    pageCount: 0,
    rowCount: 0,
  };
}

function emitActivityObservation(
  observe: ActivityObservationSink,
  event: ActivityReadObservation,
): void {
  try {
    const result = observe(event);
    void Promise.resolve(result).catch(() => {
    });
  } catch { // oxlint-disable-line home/no-silent-catch -- the activity observation sink is isolated so reporting cannot change the read response
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason ?? new DOMException("Aborted", "AbortError");
  }
}

function elapsedMs(finishedAt: number, startedAt: number): number {
  return Math.max(0, Math.round(finishedAt - startedAt));
}

function parseActivityRequest(
  request: Request,
  now: Date,
): ActivityReadRequest | null {
  const parameters = new URL(request.url).searchParams;
  const allowed = new Set(["to", "cursor", "currency"]);
  for (const key of parameters.keys()) {
    if (!allowed.has(key)) return null;
  }
  if (
    parameters.getAll("to").length !== 1 ||
    parameters.getAll("cursor").length > 1 ||
    parameters.getAll("currency").length > 1
  ) {
    return null;
  }

  const to = parameters.get("to");
  const cursor = parameters.get("cursor");
  const currency = parameters.get("currency") ?? "USD";
  if (!isActivityValuationCurrency(currency)) return null;
  if (typeof to !== "string" || to.length > 64) return null;
  const toDate = new Date(to);
  if (
    !Number.isFinite(toDate.getTime()) ||
    toDate.toISOString() !== to ||
    toDate.getTime() > now.getTime() + 5 * 60 * 1000 ||
    (cursor !== null && (cursor.length === 0 || cursor.length > 4096))
  ) {
    return null;
  }
  return { to, cursor, currency };
}

function activityReadError(error: unknown): Response {
  if (error instanceof ChainDataError) {
    switch (error.code) {
      case "invalid-input":
        return privateError(
          "INVALID_ACTIVITY_REQUEST",
          "Use a valid activity window and pagination cursor.",
          400,
        );
      case "not-configured":
        return privateError(
          "ACTIVITY_NOT_CONFIGURED",
          "Activity history is not configured. Check ACTIVITY_HISTORY_SOURCE and its required server credentials.",
          503,
        );
      case "timed-out":
        return privateError(
          "ACTIVITY_TIMEOUT",
          "Recent Base activity timed out. Try again.",
          504,
        );
      case "rate-limited":
        return privateError(
          "ACTIVITY_RATE_LIMITED",
          "Activity is rate limited. Try again shortly.",
          429,
        );
      case "unauthorized":
        return privateError(
          "ACTIVITY_UNAUTHORIZED",
          "Activity history authentication was rejected.",
          502,
        );
      case "upstream-error":
        return privateError(
          "ACTIVITY_UPSTREAM",
          "Recent Base activity could not be loaded from the data provider.",
          502,
        );
      case "invalid-response":
        return privateError(
          "ACTIVITY_INVALID_RESPONSE",
          "Recent Base activity returned an unexpected response.",
          502,
        );
      case "payment-required":
        return privateError(
          "ACTIVITY_PAYMENT_REQUIRED",
          "Activity history is not entitled on this project.",
          402,
        );
      default:
        break;
    }
  }
  return privateError(
    "ACTIVITY_UNAVAILABLE",
    "Recent Base activity is temporarily unavailable.",
    502,
  );
}

import type { VerifiedAccountSession } from "@/shared/account/session-types";
import {
  authorizeFundingRequest,
  fundingError,
  fundingJson,
  fundingRequestOrigin,
  type FundingSessionAuthorizer,
} from "@/server/funding/core/auth";
import { FundingProviderConfigurationError } from "@/server/funding/core/provider-context";
import { FundingCoreError } from "@/server/funding/core/service";
import { formatPresentationDate } from "@/shared/formatting";
import {
  FUNDING_ORDER_RESOLUTION_VERSION,
  parseResolveFundingOrderRequest,
} from "@/shared/funding/contracts/order-resolution";
import { emitUnknownFundingOrderRouteFailure } from "./event";

type FundingOrderPostDependencies = {
  authorize: FundingSessionAuthorizer;
  createOrder: (
    session: VerifiedAccountSession,
    body: unknown,
    returnOrigin: string,
    headers: Headers,
  ) => Promise<unknown>;
};

type FundingOpenOrderGetDependencies = {
  authorize: FundingSessionAuthorizer;
  getOpenOrder: (
    session: VerifiedAccountSession,
    region: string,
  ) => Promise<unknown>;
};

type FundingOrderGetByIdDependencies = {
  authorize: FundingSessionAuthorizer;
  getOrder: (
    session: VerifiedAccountSession,
    id: string,
  ) => Promise<unknown>;
};

type FundingOrderResolutionPostDependencies = {
  authorize: FundingSessionAuthorizer;
  resolveAmbiguousOrder: (
    session: VerifiedAccountSession,
    id: string,
  ) => Promise<unknown>;
};

export async function handleFundingOrderPost(
  request: Request,
  dependencies: FundingOrderPostDependencies,
): Promise<Response> {
  const startedAt = Date.now();
  const authorized = await authorizeFundingRequest(request, dependencies.authorize);
  if ("response" in authorized) return authorized.response;
  if (request.headers.get("content-type")?.split(";", 1)[0] !== "application/json") {
    return fundingError("INVALID_ORDER_REQUEST", "A valid quote token is required.", 400);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fundingError("INVALID_ORDER_REQUEST", "A valid quote token is required.", 400);
  }
  try {
    return fundingJson({
      order: await dependencies.createOrder(
        authorized.session,
        body,
        fundingRequestOrigin(request),
        request.headers,
      ),
    }, 201);
  } catch (error) {
    if (error instanceof FundingCoreError) {
      return fundingError(error.code, "The funding order could not be created.", error.status);
    }
    emitUnknownFundingOrderRouteFailure({
      route: "/api/funding/orders",
      code: error instanceof FundingProviderConfigurationError
        ? error.code
        : "ORDER_UNAVAILABLE",
      session: authorized.session,
      startedAt,
    });
    return fundingError("ORDER_UNAVAILABLE", "The funding order is unavailable.", 503);
  }
}

export async function handleFundingOpenOrderGet(
  request: Request,
  dependencies: FundingOpenOrderGetDependencies,
): Promise<Response> {
  const startedAt = Date.now();
  const authorized = await authorizeFundingRequest(request, dependencies.authorize);
  if ("response" in authorized) return authorized.response;
  const region = new URL(request.url).searchParams.get("region");
  if (!region) return fundingError("INVALID_REGION", "Choose a country first.", 400);
  try {
    return fundingJson({
      order: await dependencies.getOpenOrder(authorized.session, region),
    });
  } catch {
    emitUnknownFundingOrderRouteFailure({
      route: "/api/funding/orders",
      code: "ORDER_UNAVAILABLE",
      session: authorized.session,
      startedAt,
    });
    return fundingError("ORDER_UNAVAILABLE", "The funding order is unavailable.", 503);
  }
}

export async function handleFundingOrderGetById(
  request: Request,
  id: string,
  dependencies: FundingOrderGetByIdDependencies,
): Promise<Response> {
  const startedAt = Date.now();
  const authorized = await authorizeFundingRequest(request, dependencies.authorize);
  if ("response" in authorized) return authorized.response;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return fundingError("ORDER_NOT_FOUND", "Funding order not found.", 404);
  }
  try {
    return fundingJson({ order: await dependencies.getOrder(authorized.session, id) });
  } catch (error) {
    if (error instanceof FundingCoreError) {
      return fundingError(error.code, "Funding order not found.", error.status);
    }
    emitUnknownFundingOrderRouteFailure({
      route: "/api/funding/orders/:id",
      code: "ORDER_UNAVAILABLE",
      session: authorized.session,
      startedAt,
    });
    return fundingError("ORDER_UNAVAILABLE", "The funding order is unavailable.", 503);
  }
}

export async function handleFundingOrderResolutionPost(
  request: Request,
  id: string,
  dependencies: FundingOrderResolutionPostDependencies,
): Promise<Response> {
  const startedAt = Date.now();
  const authorized = await authorizeFundingRequest(request, dependencies.authorize);
  if ("response" in authorized) return authorized.response;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return fundingError("ORDER_NOT_FOUND", "Funding order not found.", 404);
  }
  if (request.headers.get("content-type")?.split(";", 1)[0] !== "application/json") {
    return fundingError("INVALID_ORDER_RESOLUTION_REQUEST", "A valid resolution request is required.", 400);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fundingError("INVALID_ORDER_RESOLUTION_REQUEST", "A valid resolution request is required.", 400);
  }
  if (!parseResolveFundingOrderRequest(body)) {
    return fundingError("INVALID_ORDER_RESOLUTION_REQUEST", "A valid resolution request is required.", 400);
  }

  try {
    const order = await dependencies.resolveAmbiguousOrder(authorized.session, id);
    return fundingJson({ version: FUNDING_ORDER_RESOLUTION_VERSION, order });
  } catch (error) {
    if (error instanceof FundingCoreError) {
      return fundingError(
        error.code,
        resolutionMessage(error.code, error.availableAt),
        error.status,
      );
    }
    emitUnknownFundingOrderRouteFailure({
      route: "/api/funding/orders/:id/resolve",
      code: "ORDER_UNAVAILABLE",
      session: authorized.session,
      startedAt,
    });
    return fundingError("ORDER_UNAVAILABLE", "The funding order is unavailable.", 503);
  }
}

function resolutionMessage(code: string, availableAt?: string): string {
  if (code === "ORDER_NOT_FOUND") return "Funding order not found.";
  if (code === "ORDER_NOT_AMBIGUOUS") return "This funding order no longer needs resolution.";
  if (code === "ORDER_RESOLUTION_NOT_READY") {
    return availableAt
      ? `This order can be cleared after ${formatRecoveryTime(availableAt)}.`
      : "This order cannot be cleared yet.";
  }
  if (code === "ORDER_RECOVERY_TIME_INVALID") {
    return "This order cannot be cleared because its recovery time is unavailable.";
  }
  return "The funding order changed before it could be resolved.";
}

function formatRecoveryTime(availableAt: string): string {
  const time = new Date(availableAt);
  if (!Number.isFinite(time.getTime())) return availableAt;
  return formatPresentationDate(time, { style: "date-time-zone", timeZone: "UTC" });
}

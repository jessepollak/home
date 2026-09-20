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

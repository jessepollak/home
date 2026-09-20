import "server-only";

import {
  emitFundingProviderFailure,
  type FundingProviderFailureCode,
} from "../../core/provider-failure";
import { RipioProviderError } from "./client";

export type RipioFailureStage = "customer" | "quote" | "order" | "status";
export type RipioFailureCode = FundingProviderFailureCode;

export function classifyRipioFailure(
  stage: RipioFailureStage,
  error: unknown,
): RipioFailureCode | null {
  if (!(error instanceof RipioProviderError)) return "PROVIDER_TRANSPORT";

  if (error.code === "not-configured" || error.code === "unauthorized") {
    return "FUNDING_PROVIDER_CONFIGURATION";
  }
  if (error.code === "invalid-response") return "PROVIDER_INVALID_RESPONSE";
  if (error.code === "binding-conflict") return echoMismatchCode(stage);
  if (error.code === "invalid-request") {
    return error.status === null ? null : httpFailureCode(error.status);
  }
  if (error.code === "unavailable") {
    return error.status === null ? "PROVIDER_TRANSPORT" : httpFailureCode(error.status);
  }
  if (error.code === "ambiguous-create") {
    const cause = error.cause;
    if (cause instanceof RipioProviderError) {
      if (cause.code === "binding-conflict") return echoMismatchCode(stage);
      if (cause.code === "invalid-response") return "PROVIDER_INVALID_RESPONSE";
      if (cause.status !== null) return httpFailureCode(cause.status);
    }
    return error.status === null ? "PROVIDER_TRANSPORT" : httpFailureCode(error.status);
  }
  return "PROVIDER_TRANSPORT";
}

export function emitRipioFailure(
  stage: RipioFailureStage,
  error: unknown,
  startedAt: number,
  region: string,
): void {
  const code = classifyRipioFailure(stage, error);
  if (!code) return;
  emitFundingProviderFailure({
    route: "/funding/providers/ripio",
    code,
    provider: "ripio",
    region,
    startedAt,
  });
}

function echoMismatchCode(stage: RipioFailureStage): RipioFailureCode {
  if (stage === "quote") return "QUOTE_ECHO_MISMATCH";
  if (stage === "order") return "ORDER_ECHO_MISMATCH";
  if (stage === "status") return "STATUS_ECHO_MISMATCH";
  return "PROVIDER_INVALID_RESPONSE";
}

function httpFailureCode(status: number): RipioFailureCode {
  if (status >= 500) return "PROVIDER_HTTP_5XX";
  if (status >= 400) return "PROVIDER_HTTP_4XX";
  return "PROVIDER_TRANSPORT";
}

import "server-only";

import { emitServerEvent } from "@/server/observability/log";

export const FUNDING_PROVIDER_FAILURE_CODES = [
  "FUNDING_PROVIDER_CONFIGURATION",
  "QUOTE_ECHO_MISMATCH",
  "ORDER_ECHO_MISMATCH",
  "STATUS_ECHO_MISMATCH",
  "PROVIDER_HTTP_4XX",
  "PROVIDER_HTTP_5XX",
  "PROVIDER_TRANSPORT",
  "PROVIDER_INVALID_RESPONSE",
] as const;

export type FundingProviderFailureCode = (typeof FUNDING_PROVIDER_FAILURE_CODES)[number];

export function emitFundingProviderFailure(fields: {
  provider: string;
  route: string;
  code: FundingProviderFailureCode;
  region?: string;
  startedAt: number;
}): void {
  emitServerEvent("funding-order", {
    route: fields.route,
    code: fields.code,
    outcome: failureOutcome(fields.code),
    provider: fields.provider,
    ...(fields.region ? { region: fields.region } : {}),
    durationMs: Date.now() - fields.startedAt,
  });
}

function failureOutcome(
  code: FundingProviderFailureCode,
): "failed" | "unavailable" {
  return code === "QUOTE_ECHO_MISMATCH" ||
    code === "ORDER_ECHO_MISMATCH" ||
    code === "STATUS_ECHO_MISMATCH" ||
    code === "PROVIDER_INVALID_RESPONSE"
    ? "failed"
    : "unavailable";
}

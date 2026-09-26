import "server-only";

import { authorizeSession, type SessionAuthorizer } from "@/server/auth/authorize";
import { getCdpAccessTokenValidator } from "@/server/cdp/provider";
import { privateError, privateJson } from "@/server/http/private-response";
import type { TradeSignerResolver } from "@/shared/trading/server-types";
import type { TradeAvailabilityResponse } from "@/shared/trading/contract";
import { parseTradeAvailabilityResponse, TRADE_AVAILABILITY_CONTRACT_VERSION } from "@/shared/trading/contract";
import { TradePreparationError } from "./permit2";
import { createTradeSignerResolver } from "./signer";

export function createTradeAvailabilityHandler(deps: {
  authorize?: SessionAuthorizer;
  resolveSigner?: TradeSignerResolver;
  env?: Readonly<Record<string, string | undefined>>;
} = {}) {
  return async function GET(request: Request): Promise<Response> {
    const session = await (deps.authorize ?? authorizeSession)(request);
    if (session instanceof Response) return session;
    const env = deps.env ?? process.env;
    const unavailable = (reason: "provider-unconfigured" | "account-unavailable" | "signer-unsupported") =>
      privateJson(parseTradeAvailabilityResponse({ version: TRADE_AVAILABILITY_CONTRACT_VERSION, status: "unavailable", reason })!, 200);
    if (!env.CDP_API_KEY_ID?.trim() || !env.CDP_API_KEY_SECRET?.trim()) return unavailable("provider-unconfigured");
    if (!session.smartAccount) return unavailable("account-unavailable");
    try {
      const signer = await (deps.resolveSigner ?? createTradeSignerResolver({ getValidator: getCdpAccessTokenValidator }))(request, session, request.signal);
      if (signer.smartAccount.toLowerCase() !== session.smartAccount.address.toLowerCase() || signer.ownerIndex !== 0) return unavailable("signer-unsupported");
      return privateJson({ version: TRADE_AVAILABILITY_CONTRACT_VERSION, status: "available" } satisfies TradeAvailabilityResponse, 200);
    } catch (error) {
      if (error instanceof TradePreparationError && error.reason === "signer-unsupported") return unavailable("signer-unsupported");
      return privateError("TRADE_UNAVAILABLE", "Trading is temporarily unavailable.", 503);
    }
  };
}

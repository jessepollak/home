import "server-only";

import { authorizeSession, type SessionAuthorizer } from "@/server/auth/authorize";
import { baseRpc, parseRpcQuantity } from "@/server/chain/rpc";
import { readErc20ExecutionIdentity, TokenChainUnavailable, TokenUnreadable } from "@/server/chain/erc20-execution-identity";
import { readsToken0 } from "@/server/chain/pair";
import { getCdpAccessTokenValidator } from "@/server/cdp/provider";
import { privateError, privateJson } from "@/server/http/private-response";
import { resolveTradeAsset } from "@/shared/trading/assets";
import type { TradeSignerResolver } from "@/shared/trading/server-types";
import { parseTradeAvailabilityResponse, TRADE_AVAILABILITY_CONTRACT_VERSION, type TradeUnavailableReason } from "@/shared/trading/contract";
import { tradeBuyBlocked } from "./buy-policy";
import { TradePreparationError } from "./permit2";
import { createTradeSignerResolver } from "./signer";

export function createTradeAvailabilityHandler(deps: {
  authorize?: SessionAuthorizer;
  resolveSigner?: TradeSignerResolver;
  env?: Readonly<Record<string, string | undefined>>;
  rpc?: typeof baseRpc;
  buyBlocked?: typeof tradeBuyBlocked;
} = {}) {
  return async function GET(request: Request): Promise<Response> {
    const session = await (deps.authorize ?? authorizeSession)(request);
    if (session instanceof Response) return session;
    const env = deps.env ?? process.env;
    const unavailable = (reason: TradeUnavailableReason) =>
      privateJson(parseTradeAvailabilityResponse({ version: TRADE_AVAILABILITY_CONTRACT_VERSION, status: "unavailable", reason })!, 200);
    if (!env.CDP_API_KEY_ID?.trim() || !env.CDP_API_KEY_SECRET?.trim()) return unavailable("provider-unconfigured");
    if (!session.smartAccount) return unavailable("account-unavailable");
    try {
      const signer = await (deps.resolveSigner ?? createTradeSignerResolver({ getValidator: getCdpAccessTokenValidator }))(request, session, request.signal);
      if (signer.smartAccount.toLowerCase() !== session.smartAccount.address.toLowerCase() || signer.ownerIndex !== 0) return unavailable("signer-unsupported");
      const assetId = new URL(request.url).searchParams.get("assetId");
      const resolved = assetId ? resolveTradeAsset(assetId) : null;
      if (!resolved || resolved.status !== "tradeable") return unavailable("asset-unsupported");
      const read = (method: string, params: readonly unknown[]) => (deps.rpc ?? baseRpc)(method, params, { signal: request.signal });
      try { if (parseRpcQuantity(await read("eth_chainId", []), "chain ID") !== BigInt(8453)) return unavailable("chain-unavailable"); }
      catch { return unavailable("chain-unavailable"); }
      if (!resolved.configured) {
        const pair = await readsToken0(resolved.address, read);
        if (pair === true) return unavailable("asset-unsupported");
        if (pair === null) return unavailable("chain-unavailable");
      }
      const identity = await readErc20ExecutionIdentity({
        token: resolved.address, holder: session.smartAccount.address,
        configuredDecimals: resolved.configured?.representation.decimals,
        read,
      });
      const symbol = resolved.configured?.representation.tokenSymbol ?? identity.symbol ?? `0x${resolved.address.slice(2, 6)}`;
      return privateJson(parseTradeAvailabilityResponse({
        version: TRADE_AVAILABILITY_CONTRACT_VERSION, status: "available",
        token: { assetId: resolved.assetId, address: resolved.address, symbol, decimals: identity.decimals },
        buy: (deps.buyBlocked ?? tradeBuyBlocked)(resolved.assetId) ? "blocked" : "available",
        balanceBaseUnits: identity.balance!.toString(),
      })!, 200);
    } catch (error) {
      if (error instanceof TradePreparationError && error.reason === "signer-unsupported") return unavailable("signer-unsupported");
      if (error instanceof TokenUnreadable) return unavailable("token-unreadable");
      if (error instanceof TokenChainUnavailable) return unavailable("chain-unavailable");
      return privateError("TRADE_UNAVAILABLE", "Trading is temporarily unavailable.", 503);
    }
  };
}

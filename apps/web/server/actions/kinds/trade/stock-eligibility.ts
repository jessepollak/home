import "server-only";

import { authorizeSession, type SessionAuthorizer } from "@/server/auth/authorize";
import { privateJson } from "@/server/http/private-response";
import { readRequestIsoCountry } from "@/server/region/request-country";
import { BASE_USDC_ADDRESS } from "@/shared/money-actions/network-fee";
import { STOCK_TRADE_ELIGIBILITY_CONTRACT_VERSION, type StockTradeEligibilityResponse } from "@/shared/trading/contract-stock-eligibility";
import { findStockAsset, stockBuyAllowedForCountry } from "@/shared/trading/stock-eligibility";
import { TradePreparationError } from "./permit2";

type Env = Readonly<Record<string, string | undefined>>;

export function readTrustedEdgeCountry(request: Request, env: Env = process.env): string | null {
  return env.VERCEL === "1" || env.HOME_TRUST_EDGE_COUNTRY_HEADER === "true" ? readRequestIsoCountry(request.headers) : null;
}

export function stockTradeDecision({ fromAsset, toAsset, country }: { fromAsset: string; toAsset: string; country: string | null }): boolean {
  if (findStockAsset(fromAsset)) return !findStockAsset(toAsset) && toAsset.toLowerCase() === BASE_USDC_ADDRESS.toLowerCase();
  if (findStockAsset(toAsset)) return fromAsset.toLowerCase() === BASE_USDC_ADDRESS.toLowerCase() && stockBuyAllowedForCountry(country);
  return true;
}

export function assertStockTradePrepareAllowed({ params, request, env }: { params: unknown; request: Request; env?: Env }): void {
  if (!isRecord(params) || typeof params.assetId !== "string" || !findStockAsset(params.assetId)) return;
  if (params.direction !== "sell" && !stockBuyAllowedForCountry(readTrustedEdgeCountry(request, env))) {
    throw new TradePreparationError("stock-eligibility");
  }
}

export function assertStockTradeConfirmAllowed({ metadata, request, env }: { metadata: unknown; request: Request; env?: Env }): boolean {
  if (!isRecord(metadata)) return true;
  const from = isRecord(metadata.fromAsset) ? metadata.fromAsset : null;
  const to = isRecord(metadata.toAsset) ? metadata.toAsset : null;
  const fromRef = typeof from?.address === "string" ? from.address : null;
  const toRef = typeof to?.address === "string" ? to.address : null;
  const referencesStock = [from, to].some((asset) => asset && [asset.address, asset.id].some((ref) => typeof ref === "string" && !!findStockAsset(ref)));
  if (referencesStock && (!fromRef || !toRef || !/^0x[0-9a-fA-F]{40}$/.test(fromRef) || !/^0x[0-9a-fA-F]{40}$/.test(toRef))) return false;
  if (!fromRef || !toRef) return true;
  if (referencesStock && [from, to].some((asset) => {
    const byId = typeof asset?.id === "string" ? findStockAsset(asset.id) : null;
    const byAddress = typeof asset?.address === "string" ? findStockAsset(asset.address) : null;
    return (byId && byId !== byAddress) || (byAddress && typeof asset?.id === "string" && asset.id !== byAddress.id);
  })) return false;
  if (referencesStock && (findStockAsset(fromRef) === null && findStockAsset(toRef) === null)) return false;
  return stockTradeDecision({ fromAsset: fromRef, toAsset: toRef, country: readTrustedEdgeCountry(request, env) });
}

export function createStockTradeEligibilityHandler(deps: { authorize?: SessionAuthorizer; env?: Env } = {}) {
  return async function GET(request: Request): Promise<Response> {
    const session = await (deps.authorize ?? authorizeSession)(request);
    if (session instanceof Response) return session;
    const country = readTrustedEdgeCountry(request, deps.env);
    return privateJson({ version: STOCK_TRADE_ELIGIBILITY_CONTRACT_VERSION, buy: stockBuyAllowedForCountry(country) ? "eligible" : "restricted", sell: "eligible" } satisfies StockTradeEligibilityResponse, 200);
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

import { authorizeFundingRequest, fundingError, fundingJson } from "@/server/funding/core/auth";
import { authorizeFundingSession } from "@/server/funding/core/runtime";
import { CashoutPreparationError, listCashoutOrders } from "@/server/funding/cash-out";
import { OFFRAMP_ORDERS_VERSION } from "@/shared/funding/contracts/offramp-orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const authorized = await authorizeFundingRequest(request, authorizeFundingSession);
  if ("response" in authorized) return authorized.response;
  const search = new URL(request.url).searchParams;
  const providerId = search.get("providerId") || undefined;
  const region = search.get("region");
  if (!region) return fundingError("INVALID_OFFRAMP_ORDER_QUERY", "Choose a country.", 400);
  try {
    const orders = await listCashoutOrders(authorized.session, {
      providerId,
      region,
      inFlight: search.get("inFlight") !== "0",
      recover: search.get("recover") === "1",
    });
    return fundingJson({
      version: OFFRAMP_ORDERS_VERSION,
      orders: orders.map((order) => ({
        providerId: order.providerId,
        providerName: order.providerName,
        assetId: order.assetId,
        assetSymbol: order.assetSymbol,
        assetDecimals: order.assetDecimals,
        depositId: order.depositId,
        state: order.state,
        platform: order.platform,
        platformLabel: order.platformLabel,
        currency: order.currency,
        canonicalHandle: order.canonicalHandle,
        amountAtomic: order.amountAtomic,
        remainingAmountAtomic: order.remainingAmountAtomic,
        nextActions: order.nextActions,
      })),
    });
  } catch (error) {
    if (error instanceof CashoutPreparationError) return fundingError("OFFRAMP_ORDERS_UNAVAILABLE", error.message, 424);
    return fundingError("OFFRAMP_ORDERS_UNAVAILABLE", "Cash-out status is temporarily unavailable.", 502);
  }
}

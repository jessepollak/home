import { isBaseAccountEnabled } from "@/shared/account/session-types";
import { getCdpAccessTokenValidator } from "@/server/cdp/provider";
import { createSessionHandler } from "@/server/cdp/session";
import { createPortfolioValuationHandler } from "@/server/portfolio/valuation-handler";
import { getPortfolioValuation } from "@/server/portfolio/valuation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const authorizeSession = createSessionHandler({
  getValidator: getCdpAccessTokenValidator,
  baseAccountEnabled: isBaseAccountEnabled(
    process.env.NEXT_PUBLIC_ENABLE_BASE_ACCOUNT,
  ),
});

export const GET = createPortfolioValuationHandler({
  authorize: authorizeSession,
  readValuation: getPortfolioValuation,
});

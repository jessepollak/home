import { authorizeSession } from "@/server/auth/authorize";
import { getPortfolioValuation } from "@/server/portfolio/valuation";
import { createPortfolioValuationHandler } from "@/server/portfolio/valuation-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = createPortfolioValuationHandler({
  authorize: authorizeSession,
  readValuation: getPortfolioValuation,
});

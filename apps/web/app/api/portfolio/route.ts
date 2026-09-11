import { getCdpAccessTokenValidator } from "@/server/cdp/provider";
import { isBaseAccountEnabled } from "@/shared/account/session-types";
import { createSessionHandler } from "@/server/cdp/session";
import { createPortfolioHandler } from "@/server/portfolio/handler";
import { getBasePortfolio } from "@/server/portfolio/rpc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const authorizeSession = createSessionHandler({
  getValidator: getCdpAccessTokenValidator,
  baseAccountEnabled: isBaseAccountEnabled(
    process.env.NEXT_PUBLIC_ENABLE_BASE_ACCOUNT,
  ),
});

export const GET = createPortfolioHandler({
  authorize: authorizeSession,
  readPortfolio: getBasePortfolio,
});

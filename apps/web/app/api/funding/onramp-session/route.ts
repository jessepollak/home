import { isBaseAccountEnabled } from "@/features/account/session-types";
import { getCdpAccessTokenValidator } from "@/server/cdp/provider";
import { createSessionHandler } from "@/server/cdp/session";
import { createCoinbaseHostedOnrampSession } from "@/server/funding/coinbase-onramp";
import { createFundingOnrampSessionHandler } from "@/server/funding/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const authorizeSession = createSessionHandler({
  getValidator: getCdpAccessTokenValidator,
  baseAccountEnabled: isBaseAccountEnabled(
    process.env.NEXT_PUBLIC_ENABLE_BASE_ACCOUNT,
  ),
});

export const POST = createFundingOnrampSessionHandler({
  authorize: authorizeSession,
  createOnrampSession: createCoinbaseHostedOnrampSession,
});

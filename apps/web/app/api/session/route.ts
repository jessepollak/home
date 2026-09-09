import { getCdpAccessTokenValidator } from "@/server/cdp/provider";
import { isBaseAccountEnabled } from "@/features/account/session-types";
import { createSessionHandler } from "@/server/cdp/session";
import { withRequestLog } from "@/server/observability/with-request-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withRequestLog(
  "GET /api/session",
  createSessionHandler({
    getValidator: getCdpAccessTokenValidator,
    baseAccountEnabled: isBaseAccountEnabled(
      process.env.NEXT_PUBLIC_ENABLE_BASE_ACCOUNT,
    ),
  }),
);

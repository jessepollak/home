import { getCdpAccessTokenValidator } from "@/server/cdp/provider";
import { isBaseAccountEnabled } from "@/shared/account/session-types";
import { createSessionHandler } from "@/server/cdp/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = createSessionHandler({
  getValidator: getCdpAccessTokenValidator,
  baseAccountEnabled: isBaseAccountEnabled(
    process.env.NEXT_PUBLIC_ENABLE_BASE_ACCOUNT,
  ),
});

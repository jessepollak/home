import { isBaseAccountEnabled } from "@/shared/account/session-types";
import { getCdpAccessTokenValidator } from "@/server/cdp/provider";
import { createSessionHandler } from "@/server/cdp/session";
import { createTransferReceiptHandler } from "@/server/transfers/handler";
import { getTransferReceipt } from "@/server/money-actions/receipt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const authorizeSession = createSessionHandler({
  getValidator: getCdpAccessTokenValidator,
  baseAccountEnabled: isBaseAccountEnabled(
    process.env.NEXT_PUBLIC_ENABLE_BASE_ACCOUNT,
  ),
  homeSessionSecret: process.env.HOME_SESSION_SECRET,
  nativeBaseAccountEnabled: !process.env.NEXT_PUBLIC_CDP_PROJECT_ID?.trim(),
});

export const GET = createTransferReceiptHandler({
  authorize: authorizeSession,
  readReceipt: getTransferReceipt,
});

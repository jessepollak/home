import { isBaseAccountEnabled } from "@/shared/account/session-types";
import { getCdpAccessTokenValidator } from "@/server/cdp/provider";
import { createSessionHandler } from "@/server/cdp/session";
import { createBorrowHandler } from "@/server/borrowing/handler";
import { getBaseBorrowing } from "@/server/borrowing/rpc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const authorize = createSessionHandler({
  getValidator: getCdpAccessTokenValidator,
  baseAccountEnabled: isBaseAccountEnabled(
    process.env.NEXT_PUBLIC_ENABLE_BASE_ACCOUNT,
  ),
});

export const GET = createBorrowHandler({
  authorize,
  rpc: getBaseBorrowing,
});

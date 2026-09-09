import { isBaseAccountEnabled } from "@/features/account/session-types";
import { getCdpAccessTokenValidator } from "@/server/cdp/provider";
import { createSessionHandler } from "@/server/cdp/session";
import { createBorrowHandlers } from "@/server/borrowing/handler";
import { getBaseBorrowing } from "@/server/borrowing/rpc";
import { issueMoneyAction } from "@/server/money-actions/issue";
import { withRequestLog } from "@/server/observability/with-request-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const authorize = createSessionHandler({
  getValidator: getCdpAccessTokenValidator,
  baseAccountEnabled: isBaseAccountEnabled(
    process.env.NEXT_PUBLIC_ENABLE_BASE_ACCOUNT,
  ),
});

const handlers = createBorrowHandlers({
  authorize,
  rpc: getBaseBorrowing,
  issueAction: issueMoneyAction,
});

export const GET = withRequestLog("GET /api/borrow", handlers.GET);
export const POST = withRequestLog("POST /api/borrow", handlers.POST);

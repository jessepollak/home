import { isBaseAccountEnabled } from "@/features/account/session-types";
import { getCdpAccessTokenValidator } from "@/server/cdp/provider";
import { createSessionHandler } from "@/server/cdp/session";
import { createBorrowHandlers } from "@/server/borrowing/handler";
import { getBaseBorrowing } from "@/server/borrowing/rpc";
import { issueMoneyAction } from "@/server/money-actions/issue";

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

export const GET = handlers.GET;
export const POST = handlers.POST;

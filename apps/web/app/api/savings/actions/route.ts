import { isBaseAccountEnabled } from "@/features/account/session-types";
import { getCdpAccessTokenValidator } from "@/server/cdp/provider";
import { createSessionHandler } from "@/server/cdp/session";
import { issueMoneyAction } from "@/server/money-actions/issue";
import { withRequestLog } from "@/server/observability/with-request-log";
import { createSavingsActionsHandler } from "@/server/savings-actions/handler";
import { prepareSavingsAction } from "@/server/savings-actions/prepare";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const authorizeSession = createSessionHandler({
  getValidator: getCdpAccessTokenValidator,
  baseAccountEnabled: isBaseAccountEnabled(
    process.env.NEXT_PUBLIC_ENABLE_BASE_ACCOUNT,
  ),
});

export const POST = withRequestLog(
  "POST /api/savings/actions",
  createSavingsActionsHandler({
    authorize: authorizeSession,
    prepare: prepareSavingsAction,
    issue: issueMoneyAction,
  }),
);

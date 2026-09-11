import { isBaseAccountEnabled } from "@/shared/account/session-types";
import { getCdpAccessTokenValidator } from "@/server/cdp/provider";
import { createSessionHandler } from "@/server/cdp/session";
import { createIdrxRecoveryHandler } from "@/server/funding/idrx-handler";
import {
  readIdrxMintStatus,
  resolveConfiguredIdrxCustomer,
} from "@/server/funding/idrx";
import { createIdrxAttemptStore } from "@/server/funding/idrx-attempt-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const authorizeSession = createSessionHandler({
  getValidator: getCdpAccessTokenValidator,
  baseAccountEnabled: isBaseAccountEnabled(
    process.env.NEXT_PUBLIC_ENABLE_BASE_ACCOUNT,
  ),
});

export const GET = createIdrxRecoveryHandler({
  authorize: authorizeSession,
  resolveCustomer: resolveConfiguredIdrxCustomer,
  attempts: createIdrxAttemptStore(),
  readStatus: readIdrxMintStatus,
});

import { isBaseAccountEnabled } from "@/shared/account/session-types";
import { getCdpAccessTokenValidator } from "@/server/cdp/provider";
import { createSessionHandler } from "@/server/cdp/session";
import { createIdrxMintHandler } from "@/server/funding/idrx-handler";
import {
  createIdrxMintRequest,
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

export const POST = createIdrxMintHandler({
  authorize: authorizeSession,
  createMint: createIdrxMintRequest,
  resolveCustomer: resolveConfiguredIdrxCustomer,
  attempts: createIdrxAttemptStore(),
});

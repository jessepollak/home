import { isBaseAccountEnabled } from "@/shared/account/session-types";
import { getCdpAccessTokenValidator } from "@/server/cdp/provider";
import { createSessionHandler } from "@/server/cdp/session";
import { issueMoneyAction } from "@/server/money-actions/issue";
import { getTradeBalance } from "@/server/trading/balance";
import { finalizeTradeAction } from "@/server/trading/finalize";
import { createTradeFinalizeHandler } from "@/server/trading/handler";
import { getTradeIntentStore } from "@/server/trading/runtime-intent-store";
import {
  createPermit2StateReader,
  createSmartAccountSignatureVerifier,
  createTradeSignerResolver,
} from "@/server/trading/signer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const authorizeSession = createSessionHandler({
  getValidator: getCdpAccessTokenValidator,
  baseAccountEnabled: isBaseAccountEnabled(process.env.NEXT_PUBLIC_ENABLE_BASE_ACCOUNT),
});
const resolveSigner = createTradeSignerResolver({ getValidator: getCdpAccessTokenValidator });
const readPermit2State = createPermit2StateReader();
const verifySmartAccountSignature = createSmartAccountSignatureVerifier();

export const POST = createTradeFinalizeHandler({
  authorize: authorizeSession,
  finalize: async (input) => finalizeTradeAction(
    {
      readBalance: getTradeBalance,
      readPermit2State,
      resolveSigner,
      verifySmartAccountSignature,
      intentStore: await getTradeIntentStore(),
      issueAction: issueMoneyAction,
    },
    input,
  ),
});

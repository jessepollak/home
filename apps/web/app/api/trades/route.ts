import { isBaseAccountEnabled } from "@/features/account/session-types";
import { getCdpAccessTokenValidator } from "@/server/cdp/provider";
import { createSessionHandler } from "@/server/cdp/session";
import { getTradeBalance } from "@/server/trading/balance";
import { getCdpTradeQuoteClient } from "@/server/trading/cdp";
import { createTradeHandler } from "@/server/trading/handler";
import { prepareTradeAction } from "@/server/trading/prepare";
import { getTradeIntentStore } from "@/server/trading/runtime-intent-store";
import { withRequestLog } from "@/server/observability/with-request-log";
import {
  createPermit2StateReader,
  createTradeSignerResolver,
} from "@/server/trading/signer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const authorizeSession = createSessionHandler({
  getValidator: getCdpAccessTokenValidator,
  baseAccountEnabled: isBaseAccountEnabled(process.env.NEXT_PUBLIC_ENABLE_BASE_ACCOUNT),
});
const resolveSigner = createTradeSignerResolver({
  getValidator: getCdpAccessTokenValidator,
});
const readPermit2State = createPermit2StateReader();

export const POST = withRequestLog(
  "POST /api/trades",
  createTradeHandler({
    authorize: authorizeSession,
    prepare: async (input) =>
      prepareTradeAction(
        {
          quoteClient: {
            async createSwapQuote(request) {
              const client = await getCdpTradeQuoteClient();
              return client.createSwapQuote(request);
            },
          },
          readBalance: getTradeBalance,
          readPermit2State,
          resolveSigner,
          intentStore: await getTradeIntentStore(),
        },
        input,
      ),
  }),
);

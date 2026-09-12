import "server-only";

import { isBaseAccountEnabled } from "@/shared/account/session-types";
import { getCdpAccessTokenValidator } from "@/server/cdp/provider";
import { createSessionHandler } from "@/server/cdp/session";
import { fundingProviders } from "@/server/funding/providers";
import { readCurrentBaseBlock, verifyBaseFundingReceipt } from "./base-receipt";
import { createRuntimeFundingOrderStore } from "./postgres-store";
import { FundingCore } from "./service";
import { emitServerEvent } from "@/server/observability/log";

export const authorizeFundingSession = createSessionHandler({
  getValidator: getCdpAccessTokenValidator,
  baseAccountEnabled: isBaseAccountEnabled(process.env.NEXT_PUBLIC_ENABLE_BASE_ACCOUNT),
});

let core: FundingCore | null = null;
export function getFundingCore(): FundingCore {
  core ??= new FundingCore({
    providers: fundingProviders,
    store: createRuntimeFundingOrderStore(),
    currentBaseBlock: () => readCurrentBaseBlock(),
    verifyReceipt: (order, hash) => verifyBaseFundingReceipt(order, hash),
    logUnmatchedWebhook: ({ providerId, reason }) => {
      emitServerEvent("funding-webhook", {
        route: "/api/funding/webhooks/:provider",
        code: reason === "invalid" ? "WEBHOOK_INVALID" : "WEBHOOK_UNMATCHED",
        outcome: reason,
        provider: providerId,
      });
    },
  });
  return core;
}

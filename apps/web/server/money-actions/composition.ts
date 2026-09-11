import { isBaseAccountEnabled } from "@/shared/account/session-types";
import { getCdpAccessTokenValidator } from "@/server/cdp/provider";
import { createSessionHandler } from "@/server/cdp/session";

export function createMoneyActionSessionAuthorizer() {
  return createSessionHandler({
    getValidator: getCdpAccessTokenValidator,
    baseAccountEnabled: isBaseAccountEnabled(process.env.NEXT_PUBLIC_ENABLE_BASE_ACCOUNT),
  });
}

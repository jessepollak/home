import "server-only";

import { serverEnvironment } from "@/server/config/env";
import { parseOperatorAddressList } from "@/server/operator/config";
import type { OperatorAccountConfig } from "@/shared/operator-settings/operator-account";

export function readPayoutSignerConfig(
  env: Record<string, string | undefined> = serverEnvironment(),
): OperatorAccountConfig {
  return parseOperatorAddressList(env.HOME_PAYOUT_SIGNER_ADDRESSES);
}

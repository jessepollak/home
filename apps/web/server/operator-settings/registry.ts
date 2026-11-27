import "server-only";

import { readPayoutSignerConfig } from "@/server/operator/payout-signers";
import { OPERATOR_SETTINGS_DOMAINS, type DomainDefinition } from "@/shared/operator-settings/contract";
import type { GrowthSettings } from "@/shared/operator-settings/growth";
import { acceptOperatorAccount } from "@/shared/operator-settings/operator-account";

export function serverSettingsRegistry(readSigners = readPayoutSignerConfig) {
  return {
    ...OPERATOR_SETTINGS_DOMAINS,
    growth: {
      ...OPERATOR_SETTINGS_DOMAINS.growth,
      acceptsWrite: (value) => value.payoutAccount === null || acceptOperatorAccount(value.payoutAccount, readSigners()) !== null,
    } satisfies DomainDefinition<GrowthSettings>,
  };
}

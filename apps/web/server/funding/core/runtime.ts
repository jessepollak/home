import "server-only";

import { authorizeSession } from "@/server/auth/authorize";
import { fundingProviders } from "@/server/funding/providers";
import { readCurrentBaseBlock, verifyBaseFundingReceipt } from "./base-receipt";
import { createRuntimeFundingOrderStore } from "./postgres-store";
import { FundingCore } from "./service";
import { emitServerEvent } from "@/server/observability/log";
import { getBalanceSnapshotStore } from "@/server/balances/snapshot-store";
import { FUNDING_SANDBOX_MIGRATION_CODE } from "./provider-context";

export const authorizeFundingSession = authorizeSession;

let core: FundingCore | null = null;
export function getFundingCore(): FundingCore {
  core ??= new FundingCore({
    providers: fundingProviders,
    store: createRuntimeFundingOrderStore(),
    currentBaseBlock: () => readCurrentBaseBlock(),
    verifyReceipt: (order, hash) => verifyBaseFundingReceipt(order, hash),
    markStale: (address, at) => getBalanceSnapshotStore().markStale(8453, address, at),
    logUnmatchedWebhook: ({ providerId, reason }) => {
      emitServerEvent("funding-webhook", {
        route: "/api/funding/webhooks/:provider",
        code: reason === "invalid"
          ? "WEBHOOK_INVALID"
          : reason === "region-mismatch" ? "WEBHOOK_REGION_MISMATCH" : "WEBHOOK_UNMATCHED",
        outcome: reason === "region-mismatch" ? "unmatched" : reason,
        provider: providerId,
      });
    },
    logProviderDiscoveryFailure: ({ providerId, reason, code }) => {
      emitServerEvent("funding-order", {
        route: "/api/funding/providers",
        code: code === FUNDING_SANDBOX_MIGRATION_CODE
          ? code
          : reason === "configuration" ? "OFFRAMP_DISCOVERY_CONFIGURATION" : "OFFRAMP_DISCOVERY_PROVIDER",
        outcome: "unavailable",
        provider: providerId,
      });
    },
  });
  return core;
}

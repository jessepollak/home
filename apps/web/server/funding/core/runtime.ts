import "server-only";

import { authorizeSession } from "@/server/auth/authorize";
import { withFundingOrderEvents, withProviderCustomerEvents } from "@/server/operator-events/funding";
import { deferCustomerRecord } from "@/server/customers/resolve";
import { fundingProviders, fundingUserTokenProviders } from "@/server/funding/providers";
import { FundingUserTokenVault, type FundingUserTokenDiagnostic } from "./provider-user-token";
import { createRuntimeFundingProviderUserTokenStore } from "./user-token-store";
import { readCurrentBaseBlock, verifyBaseFundingReceipt } from "./base-receipt";
import { createRuntimeFundingOrderStore } from "./postgres-store";
import { createRuntimeFundingProviderCustomerStore } from "./customer-store";
import { FundingCore } from "./service";
import { emitServerEvent } from "@/server/observability/log";
import { getBalanceSnapshotStore } from "@/server/balances/snapshot-store";
import { FUNDING_BINDING_ENVIRONMENT_CODE, FUNDING_SANDBOX_MIGRATION_CODE } from "./provider-context";

export const authorizeFundingSession = authorizeSession;

let core: FundingCore | null = null;
export function getFundingCore(): FundingCore {
  core ??= new FundingCore({
    providers: fundingProviders,
    store: withFundingOrderEvents(createRuntimeFundingOrderStore(), (event) =>
      deferCustomerRecord((registry) => registry.record(event))),
    customerStore: withProviderCustomerEvents(createRuntimeFundingProviderCustomerStore(), (event) =>
      deferCustomerRecord((registry) => registry.record(event))),
    userTokenProviders: fundingUserTokenProviders,
    userTokenVault: new FundingUserTokenVault({ store: createRuntimeFundingProviderUserTokenStore(), env: process.env, now: () => new Date(), diagnose: (code: FundingUserTokenDiagnostic, binding) => {
      emitServerEvent("funding-order", { route: "/api/funding/orders", code: `USER_TOKEN_${code.toUpperCase().replaceAll("-", "_")}`, outcome: code === "captured" || code === "cleared-after-rejection" || code === "expired" ? "ok" : "unavailable", provider: binding.providerId, region: binding.region, sandbox: binding.sandbox });
    } }),
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
    logMatchedWebhook: ({ providerId, region }) => {
      emitServerEvent("funding-webhook", {
        route: "/api/funding/webhooks/:provider",
        code: "WEBHOOK_MATCHED",
        outcome: "accepted",
        provider: providerId,
        region,
      });
    },
    logProviderDiscoveryFailure: ({ providerId, reason, code }) => {
      emitServerEvent("funding-order", {
        route: "/api/funding/providers",
        code: code === FUNDING_SANDBOX_MIGRATION_CODE || code === FUNDING_BINDING_ENVIRONMENT_CODE
          ? code
          : reason === "configuration" ? "OFFRAMP_DISCOVERY_CONFIGURATION" : "OFFRAMP_DISCOVERY_PROVIDER",
        outcome: "unavailable",
        provider: providerId,
      });
    },
    logOrderTransition: ({ route, code, outcome, providerId, region, sandbox, durationMs }) => {
      emitServerEvent("funding-order", {
        route,
        code,
        outcome,
        provider: providerId,
        region,
        sandbox,
        durationMs,
      });
    },
  });
  return core;
}

import { balancesSnapshot } from "../tests/browser/fixtures/balances";
import {
  actionsBody,
  basenameProfileBody,
  fundingOfframpOrdersBody,
  fundingProvidersBody,
  sessionBody,
} from "../tests/browser/fixtures/bodies";

const recentRecipient = "0x2211d1d0020daea8039e46cf1367962070d77da9";

export function fixtureRoutes() {
  const balances = balancesSnapshot("US");
  return [
    ["**/api/session", sessionBody],
    ["**/api/balances**", {
      ...balances,
      holdings: balances.holdings.map((holding) => ({ ...holding, imageUrl: undefined })),
    }],
    ["**/api/actions", actionsBody],
    ["**/api/activity**", {}],
    ["**/api/borrow**", {}],
    ["**/api/client-performance", { ok: true }],
    ["**/api/funding/providers**", fundingProvidersBody],
    ["**/api/funding/offramp/orders**", fundingOfframpOrdersBody],
    ["**/api/transfers/recipient-name**", { version: 1, name: "jesse.base.eth", address: recentRecipient }],
    ["**/api/transfers/recent-recipients**", {
      version: 1,
      recipients: [{ address: recentRecipient, name: "jesse.base.eth" }],
    }],
    ["**/api/basename-profile**", basenameProfileBody],
  ] as const;
}

export function requiresSignedInFixture(surfaceId: string): boolean {
  return !new Set(["landing", "sign-in", "access-gate", "coverage", "dev-ui"]).has(surfaceId);
}

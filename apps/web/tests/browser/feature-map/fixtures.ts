import { balancesSnapshot } from "../fixtures/balances";
import { preparedSendFixtureAction } from "../fixtures/api";
import {
  actionsBody,
  basenameProfileBody,
  fundingOfframpOrdersBody,
  fundingProvidersBody,
  sessionBody,
} from "../fixtures/bodies";

const recentRecipient = "0x2211d1d0020daea8039e46cf1367962070d77da9";

export function fixtureRoutes() {
  const balances = balancesSnapshot("US");
  const prepared = preparedSendFixtureAction(recentRecipient);
  return [
    ["**/api/session", sessionBody],
    ["**/api/balances**", {
      ...balances,
      holdings: balances.holdings.map((holding) => ({ ...holding, imageUrl: undefined })),
    }],
    ["**/api/actions", actionsBody],
    ["**/api/actions/prepare", prepared],
    [`**/api/actions/${prepared.id}`, {
      id: prepared.id,
      kind: prepared.kind,
      summary: { title: prepared.title, amounts: prepared.amounts, warnings: prepared.warnings, expiresAt: prepared.expiresAt },
      calls: prepared.calls,
      expiresAt: prepared.expiresAt,
    }],
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

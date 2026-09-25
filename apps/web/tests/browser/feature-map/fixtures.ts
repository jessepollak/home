import { balancesSnapshot } from "../fixtures/balances";
import { preparedSendFixtureAction } from "../fixtures/api";
import {
  actionsBody,
  basenameProfileBody,
  fundingOfframpOrdersBody,
  fundingProvidersBody,
  borrowOverviewBody,
  sessionBody,
} from "../fixtures/bodies";

const recentRecipient = "0x2211d1d0020daea8039e46cf1367962070d77da9";

export function fixtureRoutes() {
  const balances = balancesSnapshot("US");
  const borrowOverview = borrowOverviewBody();
  const prepared = preparedSendFixtureAction(recentRecipient);
  return [
    ["**/api/session", sessionBody],
    ["**/api/balances**", {
      ...balances,
      holdings: balances.holdings.map((holding) => ({ ...holding, imageUrl: undefined })),
    }],
    ["**/api/actions", actionsBody],
    ["**/api/actions/prepare", prepared],
    ["**/api/actions/network-fee", { version: 1, usdcReserveBaseUnits: "20000" }],
    [`**/api/actions/${prepared.id}`, {
      id: prepared.id,
      kind: prepared.kind,
      summary: { title: prepared.title, networkFee: prepared.networkFee, amounts: prepared.amounts, warnings: prepared.warnings, expiresAt: prepared.expiresAt },
      calls: prepared.calls,
      expiresAt: prepared.expiresAt,
    }],
    ["**/api/activity**", {}],
    ["**/api/borrow", borrowOverview],
    ...borrowOverview.opportunities.flatMap((entry) => entry.availability.status === "available"
      ? [[`**/api/borrow/markets/${entry.market.id}`, entry.availability.snapshot] as const]
      : []),
    ["**/api/client-performance", { ok: true }],
    ["**/api/funding/providers**", fundingProvidersBody],
    ["**/api/funding/offramp/orders**", fundingOfframpOrdersBody],
    ["**/api/transfers/recipient-name**", { version: 1, name: "example.base.eth", address: recentRecipient }],
    ["**/api/transfers/recent-recipients**", {
      version: 1,
      recipients: [{ address: recentRecipient, name: "example.base.eth" }],
    }],
    ["**/api/basename-profile**", basenameProfileBody],
  ] as const;
}

export function requiresSignedInFixture(surfaceId: string): boolean {
  return !new Set(["landing", "sign-in", "access-gate", "coverage", "dev-ui"]).has(surfaceId);
}

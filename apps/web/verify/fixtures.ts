import { encodeFunctionData, erc20Abi } from "viem";
import { BASE_USDC } from "../shared/assets/base";
import type { PreparedMoneyAction } from "../shared/money-actions/types";
import { balancesSnapshot } from "../tests/browser/fixtures/balances";
import {
  actionsBody,
  basenameProfileBody,
  fundingOfframpOrdersBody,
  fundingProvidersBody,
  sessionBody,
} from "../tests/browser/fixtures/bodies";

export const fixtureRecipient = "0x2211d1d0020daea8039e46cf1367962070d77da9";
export const fixtureAccount = sessionBody.smartAccount.address as `0x${string}`;

export function fixturePreparedSendAction(now = new Date()): PreparedMoneyAction {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    owner: { subject: sessionBody.user.subject, address: fixtureAccount, chainId: 8453, accountProvider: "cdp-embedded" },
    kind: "send",
    title: "Send USDC",
    calls: [{ to: BASE_USDC.address, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [fixtureRecipient, BigInt(1_000_000)] }), value: "0" }],
    amounts: [{ assetId: BASE_USDC.id, symbol: BASE_USDC.symbol, decimals: BASE_USDC.decimals, amountBaseUnits: "1000000", direction: "spend" }],
    warnings: [],
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
  };
}

export function fixtureRoutes() {
  const balances = balancesSnapshot("US");
  return [
    ["**/api/session", sessionBody],
    ["**/api/balances**", {
      ...balances,
      holdings: balances.holdings.map((holding) => ({ ...holding, imageUrl: undefined })),
    }],
    ["**/api/actions", actionsBody],
    ["**/api/actions/prepare", fixturePreparedSendAction()],
    ["**/api/activity**", {}],
    ["**/api/borrow**", {}],
    ["**/api/client-performance", { ok: true }],
    ["**/api/funding/providers**", fundingProvidersBody],
    ["**/api/funding/offramp/orders**", fundingOfframpOrdersBody],
    ["**/api/transfers/recipient-name**", { version: 1, name: "jesse.base.eth", address: fixtureRecipient }],
    ["**/api/transfers/recent-recipients**", {
      version: 1,
      recipients: [{ address: fixtureRecipient, name: "jesse.base.eth" }],
    }],
    ["**/api/basename-profile**", basenameProfileBody],
  ] as const;
}

export function requiresSignedInFixture(surfaceId: string): boolean {
  return !new Set(["landing", "sign-in", "access-gate", "coverage", "dev-ui"]).has(surfaceId);
}

import { sessionBody } from "../fixtures/bodies";

const now = "2026-09-15T12:00:00.000Z";
const expiry = "2099-01-01T00:00:00.000Z";
export const cashoutFixtureDepositId = "fixture-escrow-1";
export const cashoutFixtureProgress = {
  version: 1, providerId: "peer", region: "US", depositId: cashoutFixtureDepositId,
  state: "awaiting-buyer", platform: "cashapp", platformLabel: "Cash App", amountAtomic: "50000000",
  filledAtomic: "0", returnedAtomic: "0", remainingAtomic: "50000000",
  withdrawable: true, withdrawing: false, etaSeconds: 3600, settledAt: null, updatedAt: now,
} as const;
const baseMetadata = {
  product: "cashout", providerId: "peer", providerName: "Peer", environment: "sandbox",
  platform: "cashapp", platformLabel: "Cash App", currency: "USD", approximateFiatAmount: "50.00",
  etaSeconds: 3600, minConversionRate: "1", intentAmountRange: { min: "50000000", max: "50000000" },
  estimateAsOf: now, escrow: "0x777777779d229cdF3110e9de47943791c26300Ef",
} as const;
const spend = { assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "50000000", direction: "spend" } as const;
const receive = { ...spend, direction: "receive" } as const;
const owner = { ...sessionBody, subject: sessionBody.user.subject };
export const cashoutFixtureAction = {
  id: "90100000-0000-4000-8000-000000000001", provider: "cdp-embedded", kind: "cash-out",
  summary: { title: "Cash out with Peer", amounts: [spend], warnings: [], expiresAt: expiry,
    metadata: { ...baseMetadata, operation: "deposit", canonicalHandle: "fixture-payee" } },
  status: "confirmed", createdAt: now, confirmedAt: now,
  owner: { subject: owner.subject, address: sessionBody.smartAccount.address, chainId: 8453, accountProvider: "cdp-embedded" },
  cashout: cashoutFixtureProgress,
};
export const cashoutFixtureWithdraw = {
  id: "90100000-0000-4000-8000-000000000002", kind: "cash-out-withdraw", title: "Withdraw cash-out",
  calls: [], amounts: [receive], warnings: [], createdAt: now, expiresAt: expiry,
  metadata: { ...baseMetadata, operation: "withdraw", depositId: cashoutFixtureDepositId },
  owner: cashoutFixtureAction.owner,
};

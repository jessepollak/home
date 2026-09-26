import "server-only";

import { afterEach, expect, test } from "bun:test";
import { BASE_USDC_ADDRESS } from "@zkp2p/cash";
import { createProviderContext } from "@/server/funding/core/provider-context";
import { peerProvider } from "./adapter";
import { PEER_PRODUCTION_CONTRACTS } from "./manifest";
import { setPeerClientFactoryForTests } from "./offramp";

const owner = "0x1111111111111111111111111111111111111111" as const;
const depositId = `${PEER_PRODUCTION_CONTRACTS.escrow.toLowerCase()}_7`;
const payeeHash = `0x${"aa".repeat(32)}`;
afterEach(() => setPeerClientFactoryForTests(null));

test("Peer adapter preserves partial fill and returned amounts without exposing payout identity", async () => {
  const order = { depositId, state: "returned", fills: [], totalAmount: BigInt(2_000_000), filledAmount: BigInt(500_000),
    pendingAmount: BigInt(0), returnedAmount: BigInt(1_500_000), nextActions: [], updatedAt: 1_789_214_400, isInFlight: false,
    payouts: [{ platform: "cashapp", platformHash: "0x", currency: "USD", currencyHash: "0x", payeeHash, active: true, pricing: { marketRate: true } }] };
  const cash = { orders: async () => [order], order: async () => order, capabilities: () => ({ environment: "production", chainId: 8453, token: { address: BASE_USDC_ADDRESS } }) };
  setPeerClientFactoryForTests(() => ({ environment: "production", cash: cash as never, sdk: {} as never }));
  const ctx = createProviderContext({ manifest: peerProvider.manifest, region: "US", direction: "offramp", paymentMethodId: "cashapp", env: { PEER_OFFRAMP_ENABLED: "1" } });
  const result = await peerProvider.offramp!.readOrder({ owner, depositId }, ctx);
  expect(result).toMatchObject({ amountAtomic: "2000000", filledAmountAtomic: "500000", returnedAmountAtomic: "1500000", remainingAmountAtomic: "0" });
  expect(result.canonicalHandle).toBeNull();
});

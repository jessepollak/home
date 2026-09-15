import "server-only";

import type { FundingProviderManifest } from "@/shared/funding/provider-contract";

export const PEER_CURATOR_PRODUCTION_ORIGIN = "https://api.zkp2p.xyz" as const;
export const PEER_CURATOR_SANDBOX_ORIGIN = "https://api-staging.zkp2p.xyz" as const;
export const PEER_INDEXER_ORIGIN = "https://indexer.zkp2p.xyz" as const;

// Pinned from @zkp2p/sdk 0.14.1 (pulled by the exact @zkp2p/cash 0.5.3
// dependency). adapter.test.ts asserts these literals against the published
// contract source so an SDK deployment change fails review instead of silently
// widening Home's money-action scope.
export const PEER_PRODUCTION_CONTRACTS = {
  escrow: "0x777777779d229cdF3110e9de47943791c26300Ef",
  intentGuardian: "0x83671606454fA72ba1e2831E18C5090D25629414",
  intentGatingService: "0x396D31055Db28C0C6f36e8b36f18FE7227248a97",
  rateManager: "0xeEd7Db23e724aC4590D6dB6F78fDa6DB203535F3",
} as const;

export const PEER_SANDBOX_CONTRACTS = {
  escrow: "0x77e8f808FE201075e0bD651CD46fdF239fc83265",
  intentGuardian: "0x3355bb8CEFA54509d244384CFA7f2A71fdb1FDD6",
  intentGatingService: "0x396D31055Db28C0C6f36e8b36f18FE7227248a97",
  rateManager: "0x9d773Af159538369b4842e40510562016E3eD3d7",
} as const;

const pendingConfirmation = "pending Peer written corridor confirmation";

export const peerManifest = {
  id: "peer",
  displayName: "Peer",
  docsUrl: "https://github.com/zkp2p/peer-cash",
  offramp: {
    modeEnv: "PEER_OFFRAMP_MODE",
    production: {
      apiOrigins: [PEER_CURATOR_PRODUCTION_ORIGIN, PEER_INDEXER_ORIGIN],
      contracts: PEER_PRODUCTION_CONTRACTS,
    },
    sandbox: {
      apiOrigins: [PEER_CURATOR_SANDBOX_ORIGIN, PEER_INDEXER_ORIGIN],
      contracts: PEER_SANDBOX_CONTRACTS,
    },
  },
  bindings: [
    {
      region: "US",
      assetId: "base:usdc",
      currency: "USD",
      directions: {
        offramp: {
          paymentMethods: [
            { id: "cashapp", label: "Cash App" },
            { id: "zelle", label: "Zelle" },
          ],
          env: ["PEER_OFFRAMP_ENABLED"],
          confirmedBy: pendingConfirmation,
        },
      },
    },
    {
      region: "GB",
      assetId: "base:usdc",
      currency: "GBP",
      directions: {
        offramp: {
          paymentMethods: [
            { id: "monzo", label: "Monzo" },
            { id: "revolut", label: "Revolut" },
          ],
          env: ["PEER_OFFRAMP_ENABLED"],
          confirmedBy: pendingConfirmation,
        },
      },
    },
  ],
} as const satisfies FundingProviderManifest;

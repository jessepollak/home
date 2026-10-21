import "server-only";

import { BaseRpcError, baseRpc } from "@/server/chain/rpc";
import type { FundingProvider, OfframpContext, ProviderContext } from "@/shared/funding/provider-contract";
import { peerManifest } from "./manifest";
import { peerOfframp } from "./offramp";

const ESCROW_CODE_TIMEOUT_MS = 4_000;

function hasDeployment(ctx: ProviderContext): ctx is OfframpContext {
  return "deployment" in ctx && typeof ctx.deployment === "object" && ctx.deployment !== null;
}

export function createPeerProvider(options: { fetchImpl?: typeof fetch } = {}): FundingProvider {
  return {
    manifest: peerManifest,
    offramp: peerOfframp,
    async checkConnection(ctx) {
      if (!hasDeployment(ctx)) return "inconclusive";
      try {
        const code = await baseRpc("eth_getCode", [ctx.deployment.contracts.escrow, "latest"], {
          timeoutMs: ESCROW_CODE_TIMEOUT_MS,
          ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
          ...(ctx.signal ? { signal: ctx.signal } : {}),
        });
        return typeof code === "string" && /^0x(?:[a-fA-F0-9]{2})+$/.test(code) ? "connected" : "inconclusive";
      } catch (error) {
        return error instanceof BaseRpcError && error.code === "invalid-response" ? "inconclusive" : "unreachable";
      }
    },
  };
}

export const peerProvider = createPeerProvider();

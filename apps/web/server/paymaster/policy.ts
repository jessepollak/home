import "server-only";

import { authorizeSession, type SessionAuthorizer } from "@/server/auth/authorize";
import { baseRpc } from "@/server/chain/rpc";
import { privateJson } from "@/server/http/private-response";
import { NETWORK_FEE_POLICY_VERSION, type NetworkFeePolicyResponse } from "@/shared/actions/contracts/network-fee";
import { usdcNetworkFeeReserveBaseUnits } from "@/shared/money-actions/network-fee";
import { isUsdcNetworkFeeEnabled } from "./config";

export function createNetworkFeePolicyHandler(deps: { authorize: SessionAuthorizer; enabled?: () => boolean; readCode?: (address: `0x${string}`, signal?: AbortSignal) => Promise<unknown> }) {
  return async function GET(request: Request): Promise<Response> {
    const session = await authorizeSession(request, deps.authorize);
    if (session instanceof Response) return session;
    let reserve: string | null = null;
    if (session.smartAccount && (deps.enabled ?? isUsdcNetworkFeeEnabled)()) {
      let code: unknown = null;
      try { code = await (deps.readCode ?? ((address, signal) => baseRpc("eth_getCode", [address, "latest"], { signal })))(session.smartAccount.address, request.signal); }
      catch { code = null; }
      if (code === "0x" && session.accountProvider === "base-account") reserve = null;
      else reserve = usdcNetworkFeeReserveBaseUnits(typeof code === "string" && /^0x(?:[0-9a-fA-F]{2})+$/.test(code));
    }
    return privateJson({ version: NETWORK_FEE_POLICY_VERSION, usdcReserveBaseUnits: reserve } satisfies NetworkFeePolicyResponse, 200);
  };
}

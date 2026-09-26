import "server-only";

import { keccak256 } from "viem";
import { privateError, privateJson } from "@/server/http/private-response";
import { getActionsStore, type ActionsStore } from "@/server/actions/store";
import { BASE_USDC_PAYMASTER_ADDRESS, parseMoneyActionNetworkFee } from "@/shared/money-actions/network-fee";
import { createPaymasterClient, PAYMASTER_METHODS, type PaymasterMethod } from "./client";
import { readTokenPayment, ENTRY_POINT_V06 } from "./fee";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const hexDataPattern = /^0x(?:[0-9a-fA-F]{2})*$/;

export function createPaymasterProxyHandler(deps: {
  store?: Pick<ActionsStore, "getForPaymaster">;
  client?: ReturnType<typeof createPaymasterClient>;
  now?: () => number;
} = {}) {
  return async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
    const { id } = await context.params;
    if (!uuidPattern.test(id)) return privateError("INVALID_ACTION", "A valid action id is required.", 400);
    const row = await (deps.store ?? getActionsStore()).getForPaymaster(id);
    const fee = parseMoneyActionNetworkFee(row?.summary.networkFee);
    if (!row || !fee || fee.payment !== "usdc") return privateError("ACTION_NOT_FOUND", "The action was not found.", 404);
    if (!row.confirmed_at || !row.confirmed_call_data_hash) return privateError("ACTION_NOT_CONFIRMED", "The action is not confirmed.", 409);
    const created = new Date(row.created_at).getTime();
    const expiry = Date.parse(row.summary.expiresAt);
    const now = deps.now?.() ?? Date.now();
    if (!Number.isFinite(created) || !Number.isFinite(expiry) || created > now || expiry > created + 30 * 60_000 || now > expiry + 10 * 60_000) {
      return privateError("ACTION_EXPIRED", "The action is no longer available.", 410);
    }
    let body: unknown;
    try { body = await request.json(); } catch { return privateError("INVALID_RPC", "A JSON-RPC object is required.", 400); }
    if (!isRecord(body) || body.jsonrpc !== "2.0" || !isRpcId(body.id) || typeof body.method !== "string" || !PAYMASTER_METHODS.includes(body.method as PaymasterMethod) || !Array.isArray(body.params)) {
      return privateError("INVALID_RPC", "A supported JSON-RPC request is required.", 400);
    }
    const { method, params } = body as { method: PaymasterMethod; params: unknown[]; id: number | string | null };
    const entryPoint = method === "pm_getAcceptedPaymentTokens" ? params[0] : params[1];
    const chain = method === "pm_getAcceptedPaymentTokens" ? params[1] : params[2];
    if (typeof entryPoint !== "string" || entryPoint.toLowerCase() !== ENTRY_POINT_V06.toLowerCase() || (chain !== "0x2105" && chain !== 8453)) {
      return privateError("INVALID_RPC", "Base and a supported EntryPoint are required.", 400);
    }
    if (method !== "pm_getAcceptedPaymentTokens") {
      let owner: unknown;
      try { owner = JSON.parse(row.owner_key); } catch { return privateError("INVALID_ACTION", "The action owner is unavailable.", 400); }
      const sender = isRecord(params[0]) ? params[0].sender : null;
      if (!Array.isArray(owner) || typeof owner[1] !== "string" || !addressPattern.test(owner[1]) || typeof sender !== "string" || !addressPattern.test(sender) || sender.toLowerCase() !== owner[1].toLowerCase()) {
        return privateError("INVALID_RPC", "The sender does not match the action.", 400);
      }
      const callData = isRecord(params[0]) ? params[0].callData : null;
      if (typeof callData !== "string" || !hexDataPattern.test(callData) || keccak256(callData.toLowerCase() as `0x${string}`) !== row.confirmed_call_data_hash) {
        return privateError("INVALID_RPC", "The operation does not match the action.", 400);
      }
    }
    const error = (message: string) => privateJson({ jsonrpc: "2.0", id: body.id, error: { code: -32002, message } }, 200);
    try {
      const result = await (deps.client ?? createPaymasterClient()).request(method, params, request.signal);
      if (method !== "pm_getAcceptedPaymentTokens") {
        let max: bigint;
        try { max = readTokenPayment(result, entryPoint); } catch { return error("USDC payment is required."); }
        if (max > BigInt(fee.maxFeeBaseUnits)) return error("The network fee changed. Prepare the action again.");
      } else if (!isRecord(result) || !Array.isArray(result.acceptedTokens) || result.acceptedTokens.length === 0 || result.acceptedTokens.some(token => !isRecord(token) || typeof (token.address ?? token.tokenAddress) !== "string" || String(token.address ?? token.tokenAddress).toLowerCase() !== fee.token.toLowerCase()) || (result.paymasterAddress !== undefined && (typeof result.paymasterAddress !== "string" || result.paymasterAddress.toLowerCase() !== BASE_USDC_PAYMASTER_ADDRESS.toLowerCase()))) {
        return error("USDC payment is required.");
      }
      return privateJson({ jsonrpc: "2.0", id: body.id, result }, 200);
    } catch { return error("The USDC network fee is temporarily unavailable."); }
  };
}

function isRpcId(value: unknown): value is string | number | null {
  return value === null || typeof value === "string" || (typeof value === "number" && Number.isSafeInteger(value));
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

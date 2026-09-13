import "server-only";

import { baseRpc, parseRpcQuantity } from "@/server/chain/rpc";
import { getFundingAsset } from "@/shared/funding/assets";
import type { FundingOrder } from "./store";
import type { ReceiptMatch } from "./service";

const TRANSFER_TOPIC = `0x${"ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"}`;
const HASH = /^0x[0-9a-fA-F]{64}$/;

export async function readCurrentBaseBlock(env: Readonly<Record<string, string | undefined>> = process.env, fetchImplementation: typeof fetch = fetch): Promise<string> {
  const value = await rpc("eth_blockNumber", [], env, fetchImplementation);
  try { return parseRpcQuantity(value, "block number").toString(10); }
  catch { throw new Error("invalid-base-block"); }
}

export async function verifyBaseFundingReceipt(order: FundingOrder, hash: `0x${string}`, env: Readonly<Record<string, string | undefined>> = process.env, fetchImplementation: typeof fetch = fetch): Promise<ReceiptMatch> {
  const asset = getFundingAsset(order.assetId);
  if (!HASH.test(hash) || !order.expectedTokenAmountAtomic || !asset) return null;
  const value = await rpc("eth_getTransactionReceipt", [hash], env, fetchImplementation);
  if (!record(value) || value.status !== "0x1" || typeof value.blockNumber !== "string" || !Array.isArray(value.logs)) return null;
  let receiptBlock: bigint;
  try { receiptBlock = BigInt(value.blockNumber); } catch { return null; }
  if (receiptBlock < BigInt(order.creationBlock)) return null;
  const destinationTopic = `0x${order.destination.slice(2).toLowerCase().padStart(64, "0")}`;
  for (const candidate of value.logs) {
    if (!record(candidate) || typeof candidate.address !== "string" || candidate.address.toLowerCase() !== asset.address.toLowerCase() || !Array.isArray(candidate.topics) || lower(candidate.topics[0]) !== TRANSFER_TOPIC || lower(candidate.topics[2]) !== destinationTopic || typeof candidate.data !== "string" || typeof candidate.logIndex !== "string") continue;
    try {
      if (BigInt(candidate.data).toString(10) === order.expectedTokenAmountAtomic) return { transactionHash: hash.toLowerCase() as `0x${string}`, logIndex: Number(BigInt(candidate.logIndex)) };
    } catch { continue; }
  }
  return null;
}

async function rpc(method: string, params: unknown[], env: Readonly<Record<string, string | undefined>>, fetchImplementation: typeof fetch): Promise<unknown> {
  try {
    return await baseRpc(method, params, {
      rpcUrl: env.BASE_RPC_URL,
      fetchImpl: fetchImplementation,
      timeoutMs: 6_000,
      id: 1,
    });
  } catch { throw new Error("base-rpc-unavailable"); }
}
function lower(value: unknown): string | null { return typeof value === "string" ? value.toLowerCase() : null; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }

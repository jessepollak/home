import "server-only";

import type { FundingOrder } from "./store";
import type { ReceiptMatch } from "./service";

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const HASH = /^0x[0-9a-fA-F]{64}$/;

export async function readCurrentBaseBlock(env: Readonly<Record<string, string | undefined>> = process.env, fetchImplementation: typeof fetch = fetch): Promise<string> {
  const value = await rpc("eth_blockNumber", [], env, fetchImplementation);
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) throw new Error("invalid-base-block");
  return BigInt(value).toString(10);
}

export async function verifyBaseFundingReceipt(order: FundingOrder, hash: `0x${string}`, env: Readonly<Record<string, string | undefined>> = process.env, fetchImplementation: typeof fetch = fetch): Promise<ReceiptMatch> {
  if (!HASH.test(hash) || !order.expectedTokenAmountAtomic) return null;
  const value = await rpc("eth_getTransactionReceipt", [hash], env, fetchImplementation);
  if (!record(value) || value.status !== "0x1" || typeof value.blockNumber !== "string" || !Array.isArray(value.logs)) return null;
  let receiptBlock: bigint;
  try { receiptBlock = BigInt(value.blockNumber); } catch { return null; }
  if (receiptBlock < BigInt(order.creationBlock)) return null;
  const destinationTopic = `0x${order.destination.slice(2).toLowerCase().padStart(64, "0")}`;
  for (const candidate of value.logs) {
    if (!record(candidate) || typeof candidate.address !== "string" || candidate.address.toLowerCase() !== assetAddress(order.assetId).toLowerCase() || !Array.isArray(candidate.topics) || lower(candidate.topics[0]) !== TRANSFER_TOPIC || lower(candidate.topics[2]) !== destinationTopic || typeof candidate.data !== "string" || typeof candidate.logIndex !== "string") continue;
    try {
      if (BigInt(candidate.data).toString(10) === order.expectedTokenAmountAtomic) return { transactionHash: hash.toLowerCase() as `0x${string}`, logIndex: Number(BigInt(candidate.logIndex)) };
    } catch { continue; }
  }
  return null;
}

async function rpc(method: string, params: unknown[], env: Readonly<Record<string, string | undefined>>, fetchImplementation: typeof fetch): Promise<unknown> {
  const endpoint = env.BASE_RPC_URL?.trim() || "https://mainnet.base.org";
  const response = await fetchImplementation(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), cache: "no-store", signal: AbortSignal.timeout(6_000) });
  if (!response.ok) throw new Error("base-rpc-unavailable");
  const body = await response.json() as unknown;
  if (!record(body) || body.error || !("result" in body)) throw new Error("base-rpc-invalid-response");
  return body.result;
}
function assetAddress(id: string): string {
  if (id === "base:usdc") return "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  if (id === "base:wars") return "0x0dc4f92879b7670e5f4e4e6e3c801d229129d90d";
  if (id === "base:wcop") return "0x8a1d45e102e886510e891d2ec656a708991e2D76";
  if (id === "base:idrx") return "0x18bc5bcc660cf2b9ce3cd51a404afe1a0cbd3c22";
  return "";
}
function lower(value: unknown): string | null { return typeof value === "string" ? value.toLowerCase() : null; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }

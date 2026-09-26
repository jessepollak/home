import "server-only";

import { baseRpc, parseRpcQuantity } from "@/server/chain/rpc";
import type { Address } from "@/shared/trading/server-types";
import { createCdpSwapsClient } from "./cdp-swaps";
import { checkpointExitCode, runSwapsCheckpoint } from "./checkpoint";
import { readSettlerRouter } from "./quote";

function amount(value: string, decimals: number): bigint {
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value)) throw new Error("Invalid amount.");
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals) throw new Error("Invalid amount precision.");
  const result = BigInt(whole) * BigInt(10) ** BigInt(decimals) + BigInt((fraction + "0".repeat(decimals)).slice(0, decimals));
  if (result <= BigInt(0)) throw new Error("Amount must be positive.");
  return result;
}

async function main() {
  if (!process.env.CDP_API_KEY_ID?.trim() || !process.env.CDP_API_KEY_SECRET?.trim()) {
    console.error("CDP_API_KEY_ID and CDP_API_KEY_SECRET are required.");
    process.exitCode = 1;
    return;
  }
  try {
    const flags = new Map<string, string>();
    const args = process.argv.slice(2);
    for (let index = 0; index < args.length; index += 2) {
      const flag = args[index];
      if (!flag || !["--taker", "--buy-usdc", "--sell-cbbtc"].includes(flag) || flags.has(flag) || !args[index + 1]) throw new Error("Invalid checkpoint arguments.");
      flags.set(flag, args[index + 1]);
    }
    const taker = flags.get("--taker");
    if (!taker || !/^0x[0-9a-fA-F]{40}$/.test(taker)) throw new Error("--taker requires a 20-byte address.");
    const client = createCdpSwapsClient();
    const report = await runSwapsCheckpoint({
      client, taker: taker.toLowerCase() as Address,
      amounts: { buy: amount(flags.get("--buy-usdc") ?? "1", 6), sell: amount(flags.get("--sell-cbbtc") ?? "0.00001", 8) },
      now: new Date(),
      readSwapRouter: () => readSettlerRouter(baseRpc),
      read: (method, params) => baseRpc(method, params),
      readBlockNumber: async () => {
        const chain = parseRpcQuantity(await baseRpc("eth_chainId", []), "chain ID");
        if (chain !== BigInt(8453)) throw new Error("Unexpected chain.");
        return parseRpcQuantity(await baseRpc("eth_blockNumber", []), "block number");
      },
    });
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = checkpointExitCode(report);
  } catch {
    console.error("CDP Swaps checkpoint unavailable or invalid arguments.");
    process.exitCode = 2;
    return 2;
  }
}

await main();

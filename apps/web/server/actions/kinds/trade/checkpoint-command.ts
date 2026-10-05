import "server-only";

import { baseRpc, parseRpcQuantity } from "@/server/chain/rpc";
import { readErc20ExecutionIdentity } from "@/server/chain/erc20-execution-identity";
import type { Address } from "@/shared/trading/server-types";
import { createCdpSwapsClient } from "./cdp-swaps";
import { checkpointExitCode, runSwapsCheckpoint } from "./checkpoint";
import { readSettlerRouter } from "./quote";

const DEFAULT_TOKEN = "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf" as Address;
const address = /^0x[0-9a-fA-F]{40}$/;

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
    console.error("CDP Swaps credentials are required.");
    process.exitCode = 1;
    return;
  }
  try {
    const flags = new Map<string, string>();
    const args = process.argv.slice(2);
    const sweep = args.includes("--sweep");
    for (let index = 0; index < args.length; index++) {
      const flag = args[index]!;
      if (flag === "--sweep") continue;
      if (!["--taker", "--token", "--tokens", "--buy-usdc", "--sell"].includes(flag) || flags.has(flag) || !args[index + 1]) throw new Error("Invalid checkpoint arguments.");
      flags.set(flag, args[++index]!);
    }
    const taker = flags.get("--taker");
    if (!taker || !address.test(taker) || (sweep && (!flags.has("--tokens") || flags.has("--sell") || flags.has("--token"))) || (!sweep && flags.has("--tokens"))) throw new Error("Invalid checkpoint arguments.");
    const tokens = sweep ? flags.get("--tokens")!.split(",") : [flags.get("--token") ?? DEFAULT_TOKEN];
    if (!tokens.length || tokens.some((token) => !address.test(token))) throw new Error("Invalid token address.");
    const client = createCdpSwapsClient();
    const reports = [];
    let failed = false;
    for (const rawToken of tokens) {
      const token = rawToken.toLowerCase() as Address;
      const owner = taker.toLowerCase() as Address;
      const buy = amount(flags.get("--buy-usdc") ?? (sweep ? "0.10" : "1"), 6);
      let identity: { decimals: number; symbol: string | null } | null = null;
      try {
        const read = await readErc20ExecutionIdentity({ token, read: baseRpc });
        identity = { decimals: read.decimals, symbol: read.symbol };
      } catch { failed = true; }
      const sell = sweep ? BigInt(1) : amount(flags.get("--sell") ?? "0.00001", identity?.decimals ?? 8);
      const report = await runSwapsCheckpoint({
        client, taker: owner, token, amounts: { buy, sell }, now: new Date(), deriveSellFromBuy: sweep,
        readSwapRouter: async () => { if (identity === null) throw new Error("Chain unavailable"); return readSettlerRouter(baseRpc, token); },
        read: baseRpc,
        readBlockNumber: async () => {
          const chain = parseRpcQuantity(await baseRpc("eth_chainId", []), "chain ID");
          if (chain !== BigInt(8453)) throw new Error("Unexpected chain.");
          return parseRpcQuantity(await baseRpc("eth_blockNumber", []), "block number");
        },
      });
      reports.push({ token, tokenIdentity: identity, ...report });
      if (checkpointExitCode(report) !== 0) failed = true;
    }
    console.log(JSON.stringify(sweep ? { sweep: reports } : reports[0], null, 2));
    process.exitCode = failed ? 2 : 0;
  } catch {
    console.error("CDP Swaps checkpoint unavailable or invalid arguments.");
    process.exitCode = 2;
    return 2;
  }
}

await main();

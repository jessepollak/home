import { createPublicClient, http, type Abi } from "viem";
import { base } from "viem/chains";
import stocks from "../../config/invest-sources/base-stocks.json";
import wrapped from "../../config/invest-sources/coinbase-wrapped.json";
import type { CatalogReport, Change } from "./catalog";

type Address = `0x${string}`;

const tokenAbi = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const satisfies Abi;
const feedAbi = [
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "description", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
] as const satisfies Abi;
const registryAbi = [{ type: "function", name: "getOracleParams", stateMutability: "view", inputs: [{ name: "token", type: "address" }], outputs: [{ name: "multiplier", type: "uint256" }, { name: "paused", type: "bool" }] }] as const satisfies Abi;

export type OnchainReads = {
  token: (address: Address) => Promise<{ symbol: string; decimals: number }>;
  tokenName: (address: Address) => Promise<string>;
  feed: (address: Address) => Promise<{ description: string; decimals: number }>;
  registryMultiplier: (token: Address) => Promise<bigint>;
};

export async function compareOnchain(reads: OnchainReads): Promise<Change[]> {
  const changes: Change[] = [];
  const compare = (key: string, field: string, expected: string | number, actual: string | number) => {
    if (String(expected).toLowerCase() !== String(actual).toLowerCase()) changes.push({ key, field, expected, actual });
  };
  await Promise.all([
    ...[...stocks.stocks, ...wrapped.assets].map(async (asset) => {
      const contract = asset.contract as Address;
      const token = await reads.token(contract);
      compare(asset.tokenSymbol, "symbol", asset.tokenSymbol, token.symbol);
      compare(asset.tokenSymbol, "decimals", asset.decimals, token.decimals);
      if ("onchainName" in asset) compare(asset.tokenSymbol, "name", asset.onchainName, await reads.tokenName(contract));
    }),
    ...stocks.stocks.map(async (asset) => {
      const [feed, multiplier] = await Promise.all([
        reads.feed(asset.feed.proxy as Address),
        reads.registryMultiplier(asset.contract as Address),
      ]);
      compare(asset.tokenSymbol, "feedDescription", asset.feed.description, feed.description);
      compare(asset.tokenSymbol, "feedDecimals", asset.feed.decimals, feed.decimals);
      if (multiplier <= BigInt(0)) compare(asset.tokenSymbol, "registryMultiplier", "positive", multiplier.toString());
    }),
  ]);
  return changes.sort((a, b) => `${a.key}:${a.field}`.localeCompare(`${b.key}:${b.field}`));
}

export async function checkOnchain(rpcUrl: string): Promise<NonNullable<CatalogReport["onchain"]>> {
  try {
    const client = createPublicClient({ chain: base, transport: http(rpcUrl, { timeout: 10_000 }) });
    const block = await client.getBlock({ blockTag: "latest" });
    const changes = await compareOnchain({
      token: async (address) => {
        const [symbol, decimals] = await Promise.all([
          client.readContract({ address, abi: tokenAbi, functionName: "symbol", blockNumber: block.number }),
          client.readContract({ address, abi: tokenAbi, functionName: "decimals", blockNumber: block.number }),
        ]);
        return { symbol, decimals };
      },
      tokenName: (address) => client.readContract({ address, abi: tokenAbi, functionName: "name", blockNumber: block.number }),
      feed: async (address) => {
        const [description, decimals] = await Promise.all([
          client.readContract({ address, abi: feedAbi, functionName: "description", blockNumber: block.number }),
          client.readContract({ address, abi: feedAbi, functionName: "decimals", blockNumber: block.number }),
        ]);
        return { description, decimals };
      },
      registryMultiplier: async (token) => {
        const [multiplier] = await client.readContract({ address: stocks.oracleRegistry as Address, abi: registryAbi, functionName: "getOracleParams", args: [token], blockNumber: block.number });
        return multiplier;
      },
    });
    return { status: "ok", block: block.number.toString(), identityChanges: changes };
  } catch {
    return { status: "unavailable", block: null, identityChanges: [] };
  }
}

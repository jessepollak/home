import "server-only";

import type { PortfolioAddress } from "@/config/portfolio-assets";
import type { RecognizedTokenCatalogEntry } from "@/server/market-data/codex/recognized-catalog";
import { createBaseRpcClient } from "@/server/chain/rpc";
import {
  decodeFunctionResult,
  encodeFunctionData,
  type Hex,
} from "viem";

export const RECOGNIZED_MULTICALL_ADDRESS =
  "0xca11bde05977b3631167028862be2a173976ca11" as const;
export const RECOGNIZED_MULTICALL_CHUNK_SIZE = 128;
export const RECOGNIZED_MULTICALL_MAX_CHUNKS = 4;

const erc20Abi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "decimals", type: "uint8" }],
  },
] as const;

const multicallAbi = [
  {
    type: "function",
    name: "aggregate3",
    stateMutability: "payable",
    inputs: [
      {
        name: "calls",
        type: "tuple[]",
        components: [
          { name: "target", type: "address" },
          { name: "allowFailure", type: "bool" },
          { name: "callData", type: "bytes" },
        ],
      },
    ],
    outputs: [
      {
        name: "returnData",
        type: "tuple[]",
        components: [
          { name: "success", type: "bool" },
          { name: "returnData", type: "bytes" },
        ],
      },
    ],
  },
] as const;

type MulticallRequest = {
  target: PortfolioAddress;
  callData: Hex;
};

type MulticallResult = {
  success: boolean;
  returnData: Hex;
};

export type RecognizedBalanceHolding = RecognizedTokenCatalogEntry & {
  balanceBaseUnits: string;
};

export type RecognizedBalanceResult = {
  status: "complete" | "incomplete";
  holdings: RecognizedBalanceHolding[];
};

export function createRecognizedTokenBalanceReader(options: {
  fetchImpl?: typeof fetch;
  rpcUrl?: string;
  executeMulticall?: (
    calls: readonly MulticallRequest[],
    signal: AbortSignal,
  ) => Promise<readonly (MulticallResult | null)[]>;
} = {}) {
  const executeMulticall =
    options.executeMulticall ??
    createRpcMulticallExecutor({
      fetchImpl: options.fetchImpl ?? fetch,
      rpcUrl: options.rpcUrl,
    });

  return async function readRecognizedTokenBalances(
    catalog: readonly RecognizedTokenCatalogEntry[],
    owner: PortfolioAddress,
    signal: AbortSignal,
  ): Promise<RecognizedBalanceResult> {
    if (!/^0x[0-9a-fA-F]{40}$/.test(owner)) {
      throw new Error("Recognized token balances require a Base account address.");
    }
    const candidates = catalog.slice(
      0,
      RECOGNIZED_MULTICALL_CHUNK_SIZE * RECOGNIZED_MULTICALL_MAX_CHUNKS,
    );
    let incomplete = catalog.length > candidates.length;
    const balanceResults = await executeChunks(
      candidates.map((entry) => ({
        target: entry.address,
        callData: encodeFunctionData({
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [owner],
        }),
      })),
      executeMulticall,
      signal,
    );

    const positive: Array<{
      entry: RecognizedTokenCatalogEntry;
      balance: bigint;
    }> = [];
    for (let index = 0; index < candidates.length; index += 1) {
      const result = balanceResults[index];
      if (!result?.success) {
        incomplete = true;
        continue;
      }
      const balance = decodeBalance(result.returnData);
      if (balance === null) {
        incomplete = true;
        continue;
      }
      if (balance > BigInt(0)) positive.push({ entry: candidates[index]!, balance });
    }

    const decimalResults = await executeChunks(
      positive.map(({ entry }) => ({
        target: entry.address,
        callData: encodeFunctionData({ abi: erc20Abi, functionName: "decimals" }),
      })),
      executeMulticall,
      signal,
    );
    const holdings: RecognizedBalanceHolding[] = [];
    for (let index = 0; index < positive.length; index += 1) {
      const result = decimalResults[index];
      const decimals = result?.success ? decodeDecimals(result.returnData) : null;
      if (decimals === null || decimals !== positive[index]!.entry.decimals) {
        incomplete = true;
        continue;
      }
      holdings.push({
        ...positive[index]!.entry,
        balanceBaseUnits: positive[index]!.balance.toString(10),
      });
    }

    return { status: incomplete ? "incomplete" : "complete", holdings };
  };
}

export const getRecognizedTokenBalances = createRecognizedTokenBalanceReader();

async function executeChunks(
  calls: readonly MulticallRequest[],
  executeMulticall: (
    calls: readonly MulticallRequest[],
    signal: AbortSignal,
  ) => Promise<readonly (MulticallResult | null)[]>,
  signal: AbortSignal,
): Promise<Array<MulticallResult | null>> {
  const output: Array<MulticallResult | null> = [];
  for (let index = 0; index < calls.length; index += RECOGNIZED_MULTICALL_CHUNK_SIZE) {
    const chunk = calls.slice(index, index + RECOGNIZED_MULTICALL_CHUNK_SIZE);
    try {
      const results = await executeMulticall(chunk, signal);
      output.push(...chunk.map((_, resultIndex) => results[resultIndex] ?? null));
    } catch (error) {
      if (signal.aborted) throw error;
      output.push(...chunk.map(() => null));
    }
  }
  return output;
}

function createRpcMulticallExecutor({
  fetchImpl,
  rpcUrl,
}: {
  fetchImpl: typeof fetch;
  rpcUrl?: string;
}) {
  const rpc = createBaseRpcClient({ fetchImpl, rpcUrl });
  return async function executeMulticall(
    calls: readonly MulticallRequest[],
    signal: AbortSignal,
  ): Promise<readonly MulticallResult[]> {
    if (calls.length === 0 || calls.length > RECOGNIZED_MULTICALL_CHUNK_SIZE) {
      throw new Error("Recognized token multicall size is invalid.");
    }
    const data = encodeFunctionData({
      abi: multicallAbi,
      functionName: "aggregate3",
      args: [calls.map((call) => ({ ...call, allowFailure: true }))],
    });
    const envelope = await rpc.request(
      "eth_call",
      [{ to: RECOGNIZED_MULTICALL_ADDRESS, data }, "latest"],
      signal,
    );
    if (typeof envelope !== "string" || !/^0x[0-9a-fA-F]*$/.test(envelope)) {
      throw new Error("Base RPC returned an invalid multicall response.");
    }
    const decoded = decodeFunctionResult({
      abi: multicallAbi,
      functionName: "aggregate3",
      data: envelope as Hex,
    });
    return decoded.map(({ success, returnData }) => ({ success, returnData }));
  };
}

function decodeBalance(data: Hex): bigint | null {
  try {
    return decodeFunctionResult({
      abi: erc20Abi,
      functionName: "balanceOf",
      data,
    });
  } catch {
    return null;
  }
}

function decodeDecimals(data: Hex): number | null {
  try {
    return decodeFunctionResult({
      abi: erc20Abi,
      functionName: "decimals",
      data,
    });
  } catch {
    return null;
  }
}

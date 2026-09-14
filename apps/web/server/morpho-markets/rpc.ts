import "server-only";

import type { MoneyActionCall } from "@/shared/money-actions/types";
import {
  decodeAddressWord,
  decodeWords,
  encodeAllowance,
  encodeBalanceOf,
  encodeBorrowRateView,
  encodeMarket,
  encodeMarketParams,
  encodePosition,
  encodePrice,
} from "./abi";
import {
  BASE_CHAIN_ID,
  type MorphoAddress,
  type MorphoAssetRef,
  type MorphoMarketCapability,
  type MorphoMarketId,
  type VerifiedMorphoMarketRef,
} from "@/shared/morpho-markets/config";
import {
  SECONDS_PER_YEAR,
  accrueBorrowAssets,
  availableBorrowAssets,
  borrowCapacityAssets,
  healthFactorWad,
  liquidationPriceRaw,
  minimumCollateralForDebt,
  toAssetsUp,
} from "@/shared/morpho-markets/math";
import {
  CoinbaseSmartAccountBatchSimulationError,
  createCoinbaseSmartAccountBatchSimulator,
} from "@/server/chain/coinbase-smart-account";
import {
  createBaseRpcClient,
  parseRpcQuantity,
  resolveBaseRpcUrl,
} from "@/server/chain/rpc";

const RPC_TIMEOUT_MS = 8_000;
const UINT128_MAX = (BigInt("1") << BigInt("128")) - BigInt("1");
const UINT256_MAX = (BigInt("1") << BigInt("256")) - BigInt("1");
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const hashPattern = /^0x[0-9a-fA-F]{64}$/;

type FetchLike = typeof fetch;
type RpcRequest = { id: number; method: string; params: unknown[] };
type RpcEnvelope = { id: number; result: unknown };
type SourceBlock = {
  numberHex: string;
  number: bigint;
  hash: `0x${string}`;
  timestamp: bigint;
};

export type MorphoMarketSnapshot = {
  chainId: typeof BASE_CHAIN_ID;
  walletAddress: MorphoAddress;
  market: {
    id: MorphoMarketId;
    morpho: MorphoAddress;
    loanToken: MorphoAssetRef;
    collateralToken: MorphoAssetRef;
    oracle: MorphoAddress;
    irm: MorphoAddress;
    lltvWad: string;
    rank: number;
  };
  capabilities: {
    borrow?: MorphoMarketCapability;
  };
  source: {
    provider: "Base JSON-RPC";
    blockNumber: string;
    blockHash: `0x${string}`;
    blockTimestamp: string;
    fetchedAt: string;
  };
  state: {
    oraclePriceRaw: string;
    borrowRatePerSecondWad: string;
    borrowAprWad: string;
    totalSupplyAssetsRaw: string;
    totalBorrowAssetsRaw: string;
    totalBorrowSharesRaw: string;
    liquidityAssetsRaw: string;
    lastUpdateTimestamp: string;
  };
  wallet: {
    collateralBalanceRaw: string;
    loanBalanceRaw: string;
    collateralAllowanceRaw: string;
    loanAllowanceRaw: string;
  };
  position: {
    collateralRaw: string;
    borrowSharesRaw: string;
    debtAssetsRaw: string;
    availableBorrowAssetsRaw: string;
    withdrawableCollateralRaw: string;
    healthFactorWad: string | null;
    liquidationPriceRaw: string | null;
  };
};

export class MorphoMarketRpcError extends Error {
  readonly code: "rpc" | "account-capability";

  constructor(
    message: string,
    codeOrOptions: "rpc" | "account-capability" | ErrorOptions = "rpc",
    options?: ErrorOptions,
  ) {
    super(message, typeof codeOrOptions === "string" ? options : codeOrOptions);
    this.name = "MorphoMarketRpcError";
    this.code = typeof codeOrOptions === "string" ? codeOrOptions : "rpc";
  }
}

export type MorphoMarketRpcReader = {
  readSnapshot(account: MorphoAddress, marketRef: VerifiedMorphoMarketRef, signal?: AbortSignal): Promise<MorphoMarketSnapshot>;
  simulateBatch(
    calls: readonly MoneyActionCall[],
    account: MorphoAddress,
    blockNumber: string,
    expectedBlockHash: `0x${string}`,
    signal?: AbortSignal,
  ): Promise<void>;
};

export function createMorphoMarketRpcReader(options: {
  fetchImpl?: FetchLike;
  rpcUrl?: string;
  timeoutMs?: number;
  now?: () => Date;
} = {}): MorphoMarketRpcReader {
  const fetchImpl = options.fetchImpl ?? fetch;
  const rpcUrl = resolveBaseRpcUrl(options.rpcUrl);
  const timeoutMs = options.timeoutMs ?? RPC_TIMEOUT_MS;
  const now = options.now ?? (() => new Date());
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30_000) {
    throw new MorphoMarketRpcError("The Base RPC timeout must be 1-30000ms.");
  }
  const batchSimulator = createCoinbaseSmartAccountBatchSimulator({
    fetchImpl,
    rpcUrl,
    timeoutMs,
  });

  async function withTimeout<T>(externalSignal: AbortSignal | undefined, work: (signal: AbortSignal) => Promise<T>) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const abort = () => controller.abort();
    externalSignal?.addEventListener("abort", abort, { once: true });
    try {
      return await work(controller.signal);
    } catch (error) {
      if (error instanceof MorphoMarketRpcError) throw error;
      throw new MorphoMarketRpcError(
        controller.signal.aborted
          ? "The Base Morpho market RPC request timed out or was aborted."
          : "The Base Morpho market RPC request failed.",
        { cause: error },
      );
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", abort);
    }
  }

  return {
    async readSnapshot(account, marketRef, externalSignal) {
      assertAddress(account, "account");
      return withTimeout(externalSignal, async (signal) => {
        const chain = await rpc(fetchImpl, rpcUrl, request(1, "eth_chainId", []), signal);
        if (readQuantity(chain.result, "chain id", UINT256_MAX) !== BigInt(BASE_CHAIN_ID)) {
          throw new MorphoMarketRpcError("The configured RPC is not Base mainnet.");
        }
        const block = readBlock((await rpc(
          fetchImpl,
          rpcUrl,
          request(2, "eth_getBlockByNumber", ["latest", false]),
          signal,
        )).result);
        const calls = await rpcBatch(fetchImpl, rpcUrl, [
          callRequest(3, marketRef.morpho, encodeMarketParams(marketRef.marketId), block.numberHex),
          callRequest(4, marketRef.morpho, encodeMarket(marketRef.marketId), block.numberHex),
          callRequest(5, marketRef.morpho, encodePosition(marketRef.marketId, account), block.numberHex),
          callRequest(6, marketRef.oracle, encodePrice(), block.numberHex),
          callRequest(7, marketRef.collateralToken.address, encodeBalanceOf(account), block.numberHex),
          callRequest(8, marketRef.loanToken.address, encodeBalanceOf(account), block.numberHex),
          callRequest(9, marketRef.collateralToken.address, encodeAllowance(account, marketRef.morpho), block.numberHex),
          callRequest(10, marketRef.loanToken.address, encodeAllowance(account, marketRef.morpho), block.numberHex),
        ], signal);

        verifyMarketParams(decodeWords(resultById(calls, 3), 5, "market params"), marketRef);
        const market = decodeWords(resultById(calls, 4), 6, "market");
        market.forEach((word) => assertMaximum(word, UINT128_MAX, "market word"));
        const position = decodeWords(resultById(calls, 5), 3, "position");
        position.forEach((word) => assertMaximum(word, UINT128_MAX, "position word"));
        const oraclePrice = oneWord(resultById(calls, 6), "oracle price");
        if (oraclePrice === BigInt("0")) throw new MorphoMarketRpcError("The market oracle returned no usable price.");

        const rateResponse = await rpc(
          fetchImpl,
          rpcUrl,
          callRequest(11, marketRef.irm, encodeBorrowRateView(marketRef, market), block.numberHex),
          signal,
        );
        const confirmationResponse = await rpc(
          fetchImpl,
          rpcUrl,
          request(12, "eth_getBlockByNumber", [block.numberHex, false]),
          signal,
        );
        const confirmed = readBlock(confirmationResponse.result);
        if (confirmed.number !== block.number || confirmed.hash.toLowerCase() !== block.hash.toLowerCase()) {
          throw new MorphoMarketRpcError("The Base source block changed while the market was read.");
        }
        const borrowRate = oneWord(rateResponse.result, "borrow rate");
        const [totalSupplyAssets, , storedBorrowAssets, totalBorrowShares, lastUpdate] = market;
        if (lastUpdate === BigInt("0")) throw new MorphoMarketRpcError("The configured Morpho market is not created.");
        if (lastUpdate > block.timestamp) throw new MorphoMarketRpcError("Morpho market time is ahead of the source block.");
        const elapsed = block.timestamp - lastUpdate;
        const currentBorrowAssets = accrueBorrowAssets(storedBorrowAssets, borrowRate, elapsed);
        const interest = currentBorrowAssets - storedBorrowAssets;
        const currentSupplyAssets = totalSupplyAssets + interest;
        assertMaximum(currentBorrowAssets, UINT128_MAX, "accrued borrow assets");
        assertMaximum(currentSupplyAssets, UINT128_MAX, "accrued supply assets");
        const liquidity = currentSupplyAssets >= currentBorrowAssets
          ? currentSupplyAssets - currentBorrowAssets
          : BigInt("0");
        const [, borrowShares, collateral] = position;
        const debt = toAssetsUp(borrowShares, currentBorrowAssets, totalBorrowShares);
        const rawMaxDebt = borrowCapacityAssets(collateral, oraclePrice, marketRef.lltvWad);
        const rawAvailableBorrow = availableBorrowAssets({
          positionBorrowShares: borrowShares,
          totalBorrowAssets: currentBorrowAssets,
          totalBorrowShares,
          maxDebtAssets: rawMaxDebt,
          liquidityAssets: liquidity,
        });
        const rawRequiredCollateral = minimumCollateralForDebt(debt, oraclePrice, marketRef.lltvWad);
        const rawWithdrawableCollateral = collateral > rawRequiredCollateral ? collateral - rawRequiredCollateral : BigInt("0");
        const fetchedAt = now();
        if (Number.isNaN(fetchedAt.getTime())) throw new MorphoMarketRpcError("The Morpho market fetch time is invalid.");

        return {
          chainId: BASE_CHAIN_ID,
          walletAddress: account.toLowerCase() as MorphoAddress,
          market: {
            id: marketRef.marketId,
            morpho: marketRef.morpho,
            loanToken: marketRef.loanToken,
            collateralToken: marketRef.collateralToken,
            oracle: marketRef.oracle,
            irm: marketRef.irm,
            lltvWad: marketRef.lltvWad.toString(10),
            rank: marketRef.rank,
          },
          capabilities: marketRef.capabilities,
          source: {
            provider: "Base JSON-RPC",
            blockNumber: block.number.toString(10),
            blockHash: block.hash.toLowerCase() as `0x${string}`,
            blockTimestamp: block.timestamp.toString(10),
            fetchedAt: fetchedAt.toISOString(),
          },
          state: {
            oraclePriceRaw: oraclePrice.toString(10),
            borrowRatePerSecondWad: borrowRate.toString(10),
            borrowAprWad: (borrowRate * SECONDS_PER_YEAR).toString(10),
            totalSupplyAssetsRaw: currentSupplyAssets.toString(10),
            totalBorrowAssetsRaw: currentBorrowAssets.toString(10),
            totalBorrowSharesRaw: totalBorrowShares.toString(10),
            liquidityAssetsRaw: liquidity.toString(10),
            lastUpdateTimestamp: lastUpdate.toString(10),
          },
          wallet: {
            collateralBalanceRaw: oneWord(resultById(calls, 7), "collateral balance").toString(10),
            loanBalanceRaw: oneWord(resultById(calls, 8), "loan balance").toString(10),
            collateralAllowanceRaw: oneWord(resultById(calls, 9), "collateral allowance").toString(10),
            loanAllowanceRaw: oneWord(resultById(calls, 10), "loan allowance").toString(10),
          },
          position: {
            collateralRaw: collateral.toString(10),
            borrowSharesRaw: borrowShares.toString(10),
            debtAssetsRaw: debt.toString(10),
            availableBorrowAssetsRaw: rawAvailableBorrow.toString(10),
            withdrawableCollateralRaw: rawWithdrawableCollateral.toString(10),
            healthFactorWad: healthFactorWad(rawMaxDebt, debt)?.toString(10) ?? null,
            liquidationPriceRaw: liquidationPriceRaw(debt, collateral, marketRef.lltvWad)?.toString(10) ?? null,
          },
        } satisfies MorphoMarketSnapshot;
      });
    },

    async simulateBatch(calls, account, blockNumber, expectedBlockHash, externalSignal) {
      try {
        await batchSimulator.simulateBatch(calls, account, {
          blockNumber,
          blockHash: expectedBlockHash,
        }, externalSignal);
      } catch (error) {
        if (error instanceof CoinbaseSmartAccountBatchSimulationError) {
          throw new MorphoMarketRpcError(
            morphoSimulationMessage(error),
            error.code,
            { cause: error },
          );
        }
        throw new MorphoMarketRpcError(
          "The Base Morpho market batch simulation failed.",
          { cause: error },
        );
      }
    },
  };
}

export const getBaseMorphoMarkets = createMorphoMarketRpcReader();

function morphoSimulationMessage(
  error: CoinbaseSmartAccountBatchSimulationError,
): string {
  if (error.message === "Base RPC rejected a smart-account batch simulation call.") {
    return "Base RPC rejected a Morpho market call or simulation.";
  }
  if (error.message === "The Base smart-account batch simulation timed out or was aborted.") {
    return "The Base Morpho market RPC request timed out or was aborted.";
  }
  return error.message;
}

function verifyMarketParams(words: bigint[], marketRef: VerifiedMorphoMarketRef) {
  const [loan, collateral, oracle, irm, lltv] = words;
  const actual = [decodeAddressWord(loan), decodeAddressWord(collateral), decodeAddressWord(oracle), decodeAddressWord(irm)];
  const expected = [marketRef.loanToken.address, marketRef.collateralToken.address, marketRef.oracle, marketRef.irm];
  if (actual.some((address, index) => address.toLowerCase() !== expected[index].toLowerCase()) || lltv !== marketRef.lltvWad) {
    throw new MorphoMarketRpcError("The configured Morpho market parameters do not match Base state.");
  }
}

function request(id: number, method: string, params: unknown[]): RpcRequest {
  return { id, method, params };
}

function callRequest(id: number, to: MorphoAddress, data: `0x${string}`, block: string): RpcRequest {
  return request(id, "eth_call", [{ to, data }, block]);
}

async function rpc(fetchImpl: FetchLike, rpcUrl: string, body: RpcRequest, signal: AbortSignal): Promise<RpcEnvelope> {
  try {
    const result = await createBaseRpcClient({ fetchImpl, rpcUrl }).request(body.method, body.params, signal, body.id);
    return { id: body.id, result };
  } catch (error) {
    throw new MorphoMarketRpcError("Base RPC rejected a Morpho market call or simulation.", { cause: error });
  }
}

async function rpcBatch(fetchImpl: FetchLike, rpcUrl: string, body: RpcRequest[], signal: AbortSignal): Promise<RpcEnvelope[]> {
  try {
    const results = await createBaseRpcClient({ fetchImpl, rpcUrl }).batch(body, signal);
    return body.map(({ id }, index) => ({ id, result: results[index] }));
  } catch (error) {
    throw new MorphoMarketRpcError("Base RPC returned an invalid batch response.", { cause: error });
  }
}

function resultById(responses: RpcEnvelope[], id: number) {
  const response = responses.find((entry) => entry.id === id);
  if (!response) throw new MorphoMarketRpcError("Base RPC omitted a required response.");
  return response.result;
}

function oneWord(value: unknown, label: string) {
  return decodeWords(value, 1, label)[0];
}

function readBlock(value: unknown): SourceBlock {
  if (!isRecord(value)) throw new MorphoMarketRpcError("Base RPC returned invalid block metadata.");
  if (typeof value.hash !== "string" || !hashPattern.test(value.hash)) throw new MorphoMarketRpcError("Base RPC returned an invalid block hash.");
  return {
    numberHex: String(value.number),
    number: readQuantity(value.number, "block number", UINT256_MAX),
    hash: value.hash as `0x${string}`,
    timestamp: readQuantity(value.timestamp, "block timestamp", UINT256_MAX),
  };
}

function readQuantity(value: unknown, label: string, maximum: bigint) {
  try { return parseRpcQuantity(value, label, maximum); }
  catch (error) { throw new MorphoMarketRpcError(`Base RPC returned malformed ${label}.`, { cause: error }); }
}

function assertMaximum(value: bigint, maximum: bigint, label: string) {
  if (value < BigInt("0") || value > maximum) throw new MorphoMarketRpcError(`Base RPC returned out-of-range ${label}.`);
}

function assertAddress(value: string, label: string): asserts value is MorphoAddress {
  if (!addressPattern.test(value)) throw new MorphoMarketRpcError(`${label} must be an EVM address.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

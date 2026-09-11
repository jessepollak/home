import type { MoneyActionCall } from "@/shared/money-actions/types";
import {
  decodeAddressWord,
  decodeWords,
  encodeAllowance,
  encodeBalanceOf,
  encodeBorrowRateView,
  encodeCoinbaseExecuteBatch,
  encodeImplementation,
  encodeMarket,
  encodeMarketParams,
  encodePosition,
  encodePrice,
} from "./abi";
import {
  BASE_CHAIN_ID,
  BORROW_COLLATERAL_TOKEN,
  BORROW_IRM_ADDRESS,
  BORROW_LLTV_WAD,
  BORROW_LOAN_TOKEN,
  BORROW_MARKET_ID,
  BORROW_MARKET_PARAMS,
  BORROW_ORACLE_ADDRESS,
  MORPHO_BLUE_ADDRESS,
  type BorrowAddress,
} from "@/shared/borrowing/config";
import {
  SECONDS_PER_YEAR,
  accrueBorrowAssets,
  availableBorrowAssets,
  borrowCapacityAssets,
  healthFactorWad,
  liquidationPriceRaw,
  minimumCollateralForDebt,
  toAssetsUp,
} from "./math";
import type { BorrowMarketSnapshot } from "@/shared/borrowing/types";
import { resolveBaseRpcUrl } from "@/server/portfolio/rpc";

const RPC_TIMEOUT_MS = 8_000;
const UINT128_MAX = (BigInt("1") << BigInt("128")) - BigInt("1");
const UINT256_MAX = (BigInt("1") << BigInt("256")) - BigInt("1");
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const quantityPattern = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/;
const hashPattern = /^0x[0-9a-fA-F]{64}$/;
const hexDataPattern = /^0x(?:[0-9a-fA-F]{2})*$/;

type FetchLike = typeof fetch;
type RpcRequest = { jsonrpc: "2.0"; id: number; method: string; params: unknown[] };
type RpcEnvelope = { jsonrpc: "2.0"; id: number; result: unknown };
type SourceBlock = {
  numberHex: string;
  number: bigint;
  hash: `0x${string}`;
  timestamp: bigint;
};

export class BorrowRpcError extends Error {
  readonly code: "rpc" | "account-capability";

  constructor(
    message: string,
    codeOrOptions: "rpc" | "account-capability" | ErrorOptions = "rpc",
    options?: ErrorOptions,
  ) {
    super(message, typeof codeOrOptions === "string" ? options : codeOrOptions);
    this.name = "BorrowRpcError";
    this.code = typeof codeOrOptions === "string" ? codeOrOptions : "rpc";
  }
}

export type BorrowRpcReader = {
  readSnapshot(account: BorrowAddress, signal?: AbortSignal): Promise<BorrowMarketSnapshot>;
  simulateBatch(
    calls: readonly MoneyActionCall[],
    account: BorrowAddress,
    blockNumber: string,
    expectedBlockHash: `0x${string}`,
    signal?: AbortSignal,
  ): Promise<void>;
};

export function createBorrowRpcReader(options: {
  fetchImpl?: FetchLike;
  rpcUrl?: string;
  timeoutMs?: number;
  now?: () => Date;
} = {}): BorrowRpcReader {
  const fetchImpl = options.fetchImpl ?? fetch;
  const rpcUrl = resolveBaseRpcUrl(options.rpcUrl);
  const timeoutMs = options.timeoutMs ?? RPC_TIMEOUT_MS;
  const now = options.now ?? (() => new Date());
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30_000) {
    throw new BorrowRpcError("The Base RPC timeout must be 1-30000ms.");
  }

  async function withTimeout<T>(externalSignal: AbortSignal | undefined, work: (signal: AbortSignal) => Promise<T>) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const abort = () => controller.abort();
    externalSignal?.addEventListener("abort", abort, { once: true });
    try {
      return await work(controller.signal);
    } catch (error) {
      if (error instanceof BorrowRpcError) throw error;
      throw new BorrowRpcError(
        controller.signal.aborted
          ? "The Base borrowing RPC request timed out or was aborted."
          : "The Base borrowing RPC request failed.",
        { cause: error },
      );
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", abort);
    }
  }

  return {
    async readSnapshot(account, externalSignal) {
      assertAddress(account, "account");
      return withTimeout(externalSignal, async (signal) => {
        const chain = await rpc(fetchImpl, rpcUrl, request(1, "eth_chainId", []), signal);
        if (readQuantity(chain.result, "chain id", UINT256_MAX) !== BigInt(BASE_CHAIN_ID)) {
          throw new BorrowRpcError("The configured RPC is not Base mainnet.");
        }
        const block = readBlock((await rpc(
          fetchImpl,
          rpcUrl,
          request(2, "eth_getBlockByNumber", ["latest", false]),
          signal,
        )).result);
        const calls = await rpcBatch(fetchImpl, rpcUrl, [
          callRequest(3, MORPHO_BLUE_ADDRESS, encodeMarketParams(BORROW_MARKET_ID), block.numberHex),
          callRequest(4, MORPHO_BLUE_ADDRESS, encodeMarket(BORROW_MARKET_ID), block.numberHex),
          callRequest(5, MORPHO_BLUE_ADDRESS, encodePosition(BORROW_MARKET_ID, account), block.numberHex),
          callRequest(6, BORROW_ORACLE_ADDRESS, encodePrice(), block.numberHex),
          callRequest(7, BORROW_COLLATERAL_TOKEN.address, encodeBalanceOf(account), block.numberHex),
          callRequest(8, BORROW_LOAN_TOKEN.address, encodeBalanceOf(account), block.numberHex),
          callRequest(9, BORROW_COLLATERAL_TOKEN.address, encodeAllowance(account, MORPHO_BLUE_ADDRESS), block.numberHex),
          callRequest(10, BORROW_LOAN_TOKEN.address, encodeAllowance(account, MORPHO_BLUE_ADDRESS), block.numberHex),
        ], signal);

        verifyMarketParams(decodeWords(resultById(calls, 3), 5, "market params"));
        const market = decodeWords(resultById(calls, 4), 6, "market");
        market.forEach((word) => assertMaximum(word, UINT128_MAX, "market word"));
        const position = decodeWords(resultById(calls, 5), 3, "position");
        position.forEach((word) => assertMaximum(word, UINT128_MAX, "position word"));
        const oraclePrice = oneWord(resultById(calls, 6), "oracle price");
        if (oraclePrice === BigInt("0")) throw new BorrowRpcError("The market oracle returned no usable price.");

        const rateResponse = await rpc(
          fetchImpl,
          rpcUrl,
          callRequest(11, BORROW_IRM_ADDRESS, encodeBorrowRateView(market), block.numberHex),
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
          throw new BorrowRpcError("The Base source block changed while the market was read.");
        }
        const borrowRate = oneWord(rateResponse.result, "borrow rate");
        const [totalSupplyAssets, , storedBorrowAssets, totalBorrowShares, lastUpdate] = market;
        if (lastUpdate === BigInt("0")) throw new BorrowRpcError("The configured Morpho market is not created.");
        if (lastUpdate > block.timestamp) throw new BorrowRpcError("Morpho market time is ahead of the source block.");
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
        const maxDebt = borrowCapacityAssets(collateral, oraclePrice, BORROW_LLTV_WAD);
        const availableBorrow = availableBorrowAssets({
          positionBorrowShares: borrowShares,
          totalBorrowAssets: currentBorrowAssets,
          totalBorrowShares,
          maxDebtAssets: maxDebt,
          liquidityAssets: liquidity,
        });
        const requiredCollateral = minimumCollateralForDebt(debt, oraclePrice, BORROW_LLTV_WAD);
        const withdrawableCollateral = collateral > requiredCollateral
          ? collateral - requiredCollateral
          : BigInt("0");
        const fetchedAt = now();
        if (Number.isNaN(fetchedAt.getTime())) throw new BorrowRpcError("The borrowing fetch time is invalid.");

        return {
          chainId: BASE_CHAIN_ID,
          walletAddress: account.toLowerCase() as BorrowAddress,
          market: {
            id: BORROW_MARKET_ID,
            morpho: MORPHO_BLUE_ADDRESS,
            loanToken: BORROW_LOAN_TOKEN,
            collateralToken: BORROW_COLLATERAL_TOKEN,
            oracle: BORROW_ORACLE_ADDRESS,
            irm: BORROW_IRM_ADDRESS,
            lltvWad: BORROW_LLTV_WAD.toString(10),
          },
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
            borrowCapacityAssetsRaw: availableBorrow.toString(10),
            withdrawableCollateralRaw: withdrawableCollateral.toString(10),
            healthFactorWad: healthFactorWad(maxDebt, debt)?.toString(10) ?? null,
            liquidationPriceRaw: liquidationPriceRaw(debt, collateral, BORROW_LLTV_WAD)?.toString(10) ?? null,
          },
        } satisfies BorrowMarketSnapshot;
      });
    },

    async simulateBatch(calls, account, blockNumber, expectedBlockHash, externalSignal) {
      assertAddress(account, "account");
      if (calls.length === 0) throw new BorrowRpcError("Simulation requires at least one call.");
      for (const call of calls) assertAddress(call.to, "call.to");
      if (!/^\d+$/.test(blockNumber)) throw new BorrowRpcError("Simulation block number is invalid.");
      if (!hashPattern.test(expectedBlockHash)) throw new BorrowRpcError("Simulation block hash is invalid.");
      await withTimeout(externalSignal, async (signal) => {
        const block = toQuantity(BigInt(blockNumber));
        const accountCode = readCode((await rpc(
          fetchImpl,
          rpcUrl,
          request(21, "eth_getCode", [account, block]),
          signal,
        )).result, "smart account");
        if (!hasExecutableCode(accountCode)) {
          throw new BorrowRpcError(
            "This verified account is not deployed, so Home cannot simulate Coinbase executeBatch for it.",
            "account-capability",
          );
        }

        let implementationResult: unknown;
        try {
          implementationResult = (await rpc(
            fetchImpl,
            rpcUrl,
            request(22, "eth_call", [{ to: account, data: encodeImplementation() }, block]),
            signal,
          )).result;
        } catch (error) {
          throw new BorrowRpcError(
            "This deployed account does not expose the Coinbase smart-account implementation needed for batch simulation.",
            "account-capability",
            { cause: error },
          );
        }
        let implementation: BorrowAddress;
        try {
          implementation = decodeAddressWord(oneWord(implementationResult, "smart account implementation"));
        } catch (error) {
          throw new BorrowRpcError(
            "This deployed account does not expose a valid Coinbase smart-account implementation.",
            "account-capability",
            { cause: error },
          );
        }
        if (/^0x0{40}$/i.test(implementation)) {
          throw new BorrowRpcError("The Coinbase smart-account implementation is unavailable.", "account-capability");
        }
        const implementationCode = readCode((await rpc(
          fetchImpl,
          rpcUrl,
          request(23, "eth_getCode", [implementation, block]),
          signal,
        )).result, "smart account implementation");
        if (!hasExecutableCode(implementationCode)) {
          throw new BorrowRpcError(
            "The Coinbase smart-account implementation is not deployed at the pinned block.",
            "account-capability",
          );
        }

        const response = await rpc(
          fetchImpl,
          rpcUrl,
          request(24, "eth_call", [{
            // Coinbase MultiOwnable permits the account itself; this preserves the exact ordered
            // state changes without claiming that a future user signature has been validated.
            from: account,
            to: account,
            data: encodeCoinbaseExecuteBatch(calls),
            value: "0x0",
          }, block]),
          signal,
        );
        if (typeof response.result !== "string" || !hexDataPattern.test(response.result)) {
          throw new BorrowRpcError("Base RPC returned invalid batch simulation data.");
        }

        const confirmed = readBlock((await rpc(
          fetchImpl,
          rpcUrl,
          request(25, "eth_getBlockByNumber", [block, false]),
          signal,
        )).result);
        if (
          confirmed.number !== BigInt(blockNumber) ||
          confirmed.hash.toLowerCase() !== expectedBlockHash.toLowerCase()
        ) {
          throw new BorrowRpcError("The Base source block changed during batch simulation.");
        }
      });
    },
  };
}

export const getBaseBorrowing = createBorrowRpcReader();

function verifyMarketParams(words: bigint[]) {
  const [loan, collateral, oracle, irm, lltv] = words;
  const actual = [decodeAddressWord(loan), decodeAddressWord(collateral), decodeAddressWord(oracle), decodeAddressWord(irm)];
  const expected = [BORROW_MARKET_PARAMS.loanToken, BORROW_MARKET_PARAMS.collateralToken, BORROW_MARKET_PARAMS.oracle, BORROW_MARKET_PARAMS.irm];
  if (actual.some((address, index) => address.toLowerCase() !== expected[index].toLowerCase()) || lltv !== BORROW_LLTV_WAD) {
    throw new BorrowRpcError("The configured Morpho market parameters do not match Base state.");
  }
}

function request(id: number, method: string, params: unknown[]): RpcRequest {
  return { jsonrpc: "2.0", id, method, params };
}

function callRequest(id: number, to: BorrowAddress, data: `0x${string}`, block: string): RpcRequest {
  return request(id, "eth_call", [{ to, data }, block]);
}

async function rpc(fetchImpl: FetchLike, rpcUrl: string, body: RpcRequest, signal: AbortSignal) {
  const value = await transport(fetchImpl, rpcUrl, body, signal);
  if (Array.isArray(value)) throw new BorrowRpcError("Base RPC returned an unexpected batch response.");
  return envelope(value, body.id);
}

async function rpcBatch(fetchImpl: FetchLike, rpcUrl: string, body: RpcRequest[], signal: AbortSignal) {
  const value = await transport(fetchImpl, rpcUrl, body, signal);
  if (!Array.isArray(value) || value.length !== body.length) throw new BorrowRpcError("Base RPC returned an invalid batch response.");
  const parsed = value.map((entry) => envelope(entry));
  for (const item of body) {
    if (parsed.filter((entry) => entry.id === item.id).length !== 1) throw new BorrowRpcError("Base RPC returned mismatched batch response IDs.");
  }
  return parsed;
}

async function transport(fetchImpl: FetchLike, rpcUrl: string, body: RpcRequest | RpcRequest[], signal: AbortSignal): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(rpcUrl, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal,
    });
  } catch (error) {
    throw new BorrowRpcError("The Base RPC transport failed.", { cause: error });
  }
  if (!response.ok) throw new BorrowRpcError(`Base RPC returned HTTP ${response.status}.`);
  try {
    return JSON.parse(await response.text()) as unknown;
  } catch (error) {
    throw new BorrowRpcError("Base RPC returned malformed JSON.", { cause: error });
  }
}

function envelope(value: unknown, expectedId?: number): RpcEnvelope {
  if (!isRecord(value) || value.jsonrpc !== "2.0" || typeof value.id !== "number" || !Number.isInteger(value.id)) {
    throw new BorrowRpcError("Base RPC returned an invalid response envelope.");
  }
  if ("error" in value || !("result" in value) || (expectedId !== undefined && value.id !== expectedId)) {
    throw new BorrowRpcError("Base RPC rejected a borrowing call or simulation.");
  }
  return value as RpcEnvelope;
}

function resultById(responses: RpcEnvelope[], id: number) {
  const response = responses.find((entry) => entry.id === id);
  if (!response) throw new BorrowRpcError("Base RPC omitted a required response.");
  return response.result;
}

function oneWord(value: unknown, label: string) {
  return decodeWords(value, 1, label)[0];
}

function readCode(value: unknown, label: string) {
  if (typeof value !== "string" || !hexDataPattern.test(value)) {
    throw new BorrowRpcError(`Base RPC returned invalid ${label} code.`);
  }
  return value;
}

function hasExecutableCode(value: string) {
  return value.length > 2 && /[1-9a-f]/i.test(value.slice(2));
}

function readBlock(value: unknown): SourceBlock {
  if (!isRecord(value)) throw new BorrowRpcError("Base RPC returned invalid block metadata.");
  if (typeof value.hash !== "string" || !hashPattern.test(value.hash)) throw new BorrowRpcError("Base RPC returned an invalid block hash.");
  return {
    numberHex: String(value.number),
    number: readQuantity(value.number, "block number", UINT256_MAX),
    hash: value.hash as `0x${string}`,
    timestamp: readQuantity(value.timestamp, "block timestamp", UINT256_MAX),
  };
}

function readQuantity(value: unknown, label: string, maximum: bigint) {
  if (typeof value !== "string" || !quantityPattern.test(value)) throw new BorrowRpcError(`Base RPC returned malformed ${label}.`);
  const parsed = BigInt(value);
  assertMaximum(parsed, maximum, label);
  return parsed;
}

function assertMaximum(value: bigint, maximum: bigint, label: string) {
  if (value < BigInt("0") || value > maximum) throw new BorrowRpcError(`Base RPC returned out-of-range ${label}.`);
}

function assertAddress(value: string, label: string): asserts value is BorrowAddress {
  if (!addressPattern.test(value)) throw new BorrowRpcError(`${label} must be an EVM address.`);
}

function toQuantity(value: bigint) {
  if (value < BigInt("0")) throw new BorrowRpcError("RPC quantity cannot be negative.");
  return `0x${value.toString(16)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

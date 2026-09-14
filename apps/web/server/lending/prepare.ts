import "server-only";

import type { MoneyActionAmount, MoneyActionDraft } from "@/shared/money-actions/types";
import type { MorphoAddress, VerifiedMorphoMarketRef } from "@/shared/morpho-markets/config";
import { actionKindForLendOperation, type LendActionIntent, type LendActionPreparation } from "@/shared/lending/types";
import { approveCall, supplyCall, withdrawAssetsCall, withdrawSharesCall } from "@/server/morpho-markets/abi";
import type { MorphoMarketRpcReader, MorphoMarketSnapshot } from "@/server/morpho-markets/rpc";

const ACTION_EXPIRY_MS = 2 * 60_000;

export class LendPreparationError extends Error {
  readonly code: "invalid-input" | "unsupported-market" | "limit-exceeded" | "simulation-failed";
  constructor(code: LendPreparationError["code"], message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LendPreparationError";
    this.code = code;
  }
}

export async function prepareLendAction(input: {
  request: LendActionIntent;
  market: VerifiedMorphoMarketRef;
  owner: MorphoAddress;
  snapshot: MorphoMarketSnapshot;
  rpc: MorphoMarketRpcReader;
  now?: () => Date;
  signal?: AbortSignal;
}): Promise<LendActionPreparation> {
  const { request, market, snapshot } = input;
  if (request.marketId.toLowerCase() !== market.marketId.toLowerCase() || snapshot.market.id.toLowerCase() !== market.marketId.toLowerCase()) {
    throw new LendPreparationError("unsupported-market", "The lending market is not configured.");
  }
  if (snapshot.walletAddress.toLowerCase() !== input.owner.toLowerCase()) {
    throw new LendPreparationError("invalid-input", "The verified lending state does not belong to the authenticated account.");
  }

  const owner = input.owner.toLowerCase() as MorphoAddress;
  const supplyShares = BigInt(snapshot.position.supplySharesRaw);
  const suppliedAssets = BigInt(snapshot.position.suppliedAssetsRaw);
  const liquidity = BigInt(snapshot.state.liquidityAssetsRaw);
  const withdrawable = BigInt(snapshot.position.withdrawableSupplyAssetsRaw);
  const amount = request.amountBaseUnits === undefined ? null : positiveAmount(request.amountBaseUnits);
  const calls: MoneyActionDraft["calls"] = [];
  const amounts: MoneyActionAmount[] = [];
  const warnings = ["Morpho rates, liquidity, and share value can change before the wallet submits this action."];

  if (request.operation === "supply") {
    if (market.capabilities.lend !== "enabled") {
      throw new LendPreparationError("unsupported-market", "This verified market does not permit new lending supply.");
    }
    const supplied = required(amount);
    requireAtMost(supplied, BigInt(snapshot.wallet.loanBalanceRaw), `Your verified wallet does not currently hold that much ${market.loanToken.symbol}.`);
    if (BigInt(snapshot.wallet.loanAllowanceRaw) < supplied) calls.push(approveCall(market.loanToken, market.morpho, supplied));
    calls.push(supplyCall(market, supplied, owner));
    amounts.push(actionAmount(market, supplied, "spend"));
  } else {
    if (supplyShares === BigInt(0)) {
      throw new LendPreparationError("limit-exceeded", "There is no verified lending supply position to withdraw from this market.");
    }
    if (request.operation === "withdraw") {
      const withdrawn = required(amount);
      requireAtMost(withdrawn, suppliedAssets, "The amount exceeds the current verified lending position.");
      requireAtMost(withdrawn, liquidity, "The amount exceeds current market liquidity.");
      requireAtMost(withdrawn, withdrawable, "The amount exceeds the currently withdrawable lending balance.");
      calls.push(withdrawAssetsCall(market, withdrawn, owner));
      amounts.push(actionAmount(market, withdrawn, "receive"));
      if (withdrawn === liquidity) warnings.push("This review uses all currently indexed market liquidity; the call can fail if liquidity changes.");
    } else {
      if (suppliedAssets > liquidity) {
        throw new LendPreparationError("limit-exceeded", "Current market liquidity cannot withdraw the full supply position. Withdraw an exact available amount instead.");
      }
      calls.push(withdrawSharesCall(market, supplyShares, owner));
      amounts.push({ ...actionAmount(market, suppliedAssets, "receive"), estimated: true });
      warnings.push("Morpho withdraws all current supply shares, so the received asset amount can change before submission.");
    }
  }

  try {
    await input.rpc.simulateBatch(calls, owner, snapshot.source.blockNumber, snapshot.source.blockHash, input.signal);
    const now = input.now?.() ?? new Date();
    if (Number.isNaN(now.getTime())) throw new LendPreparationError("invalid-input", "The review time is invalid.");
    const title = titleFor(request.operation, market);
    const primary = amounts[0]!;
    return {
      draft: {
        kind: actionKindForLendOperation(request.operation),
        title,
        calls,
        amounts,
        warnings,
        expiresAt: new Date(now.getTime() + ACTION_EXPIRY_MS).toISOString(),
        metadata: {
          product: "lend",
          operation: request.operation,
          marketId: market.marketId,
          loanAsset: { id: market.loanToken.id, symbol: market.loanToken.symbol },
          supplySharesRaw: snapshot.position.supplySharesRaw,
          suppliedAssetsRaw: snapshot.position.suppliedAssetsRaw,
          withdrawableAssetsRaw: snapshot.position.withdrawableSupplyAssetsRaw,
          supplyAprWad: snapshot.state.supplyAprWad,
          source: {
            blockNumber: snapshot.source.blockNumber,
            blockHash: snapshot.source.blockHash,
            blockTimestamp: snapshot.source.blockTimestamp,
          },
        },
      },
      summary: {
        operation: request.operation,
        title,
        amount: { symbol: primary.symbol, decimals: primary.decimals, amountBaseUnits: primary.amountBaseUnits },
        warnings: [...warnings],
        asOf: new Date(Number(snapshot.source.blockTimestamp) * 1_000).toISOString(),
      },
      fullySimulated: true,
      simulationBlockHash: snapshot.source.blockHash,
      simulationBlockNumber: snapshot.source.blockNumber,
      simulationBlockTimestamp: snapshot.source.blockTimestamp,
      simulationGap: null,
    };
  } catch (error) {
    if (error instanceof LendPreparationError) throw error;
    throw new LendPreparationError(
      "simulation-failed",
      error instanceof Error && "code" in error && error.code === "account-capability"
        ? error.message
        : "The Base RPC batch simulation rejected this lending action against the pinned market state.",
      { cause: error },
    );
  }
}

function actionAmount(market: VerifiedMorphoMarketRef, amount: bigint, direction: "spend" | "receive"): MoneyActionAmount {
  return { assetId: market.loanToken.id, symbol: market.loanToken.symbol, decimals: market.loanToken.decimals, amountBaseUnits: amount.toString(10), direction };
}
function positiveAmount(value: string) {
  const amount = BigInt(value);
  if (amount <= BigInt(0)) throw new LendPreparationError("invalid-input", "Amount must be greater than zero.");
  return amount;
}
function required(value: bigint | null) {
  if (value === null) throw new LendPreparationError("invalid-input", "The required amount is missing.");
  return value;
}
function requireAtMost(amount: bigint, maximum: bigint, message: string) {
  if (amount > maximum) throw new LendPreparationError("limit-exceeded", message);
}
function titleFor(operation: LendActionIntent["operation"], market: VerifiedMorphoMarketRef) {
  if (operation === "supply") return `Supply ${market.loanToken.symbol}`;
  if (operation === "withdraw-all") return `Withdraw all ${market.loanToken.symbol} supply`;
  return `Withdraw ${market.loanToken.symbol}`;
}

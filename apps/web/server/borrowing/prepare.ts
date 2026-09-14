import "server-only";

import type { MoneyActionAmount, MoneyActionDraft } from "@/shared/money-actions/types";
import type { BorrowMarketSnapshot } from "@/shared/borrowing/contract";
import type { BorrowMarketRef } from "@/shared/borrowing/config";
import {
  BORROW_HEALTH_BUFFER_WAD,
  BORROW_HEALTH_CRITICAL_WAD,
  BORROW_HEALTH_FLOOR_WAD,
} from "@/shared/borrowing/config";
import { approveCall, borrowCall, repayCall, repaySharesCall, supplyCollateralCall, withdrawCollateralCall } from "./abi";
import {
  WAD,
  availableBorrowAssets,
  borrowCapacityAssets,
  healthFactorWad,
  liquidationPriceRaw,
  policyMaximumDebtAssets,
  toAssetsUp,
  toSharesDown,
  toSharesUp,
} from "./math";
import { actionKindForBorrowOperation, type BorrowActionIntent, type BorrowActionPreparation, type BorrowOperation } from "@/shared/borrowing/types";
import type { BorrowRpcReader } from "./rpc";

const ACTION_EXPIRY_MS = 2 * 60_000;

export class BorrowPreparationError extends Error {
  readonly code: "invalid-input" | "unsupported-market" | "limit-exceeded" | "simulation-failed";
  constructor(code: BorrowPreparationError["code"], message: string, options?: ErrorOptions) {
    super(message, options); this.name = "BorrowPreparationError"; this.code = code;
  }
}

export async function prepareBorrowAction(input: {
  request: BorrowActionIntent;
  market: BorrowMarketRef;
  snapshot: BorrowMarketSnapshot;
  rpc: BorrowRpcReader;
  now?: () => Date;
  signal?: AbortSignal;
}): Promise<BorrowActionPreparation> {
  const { request, snapshot, market } = input;
  if (request.marketId.toLowerCase() !== market.marketId.toLowerCase() || snapshot.market.id.toLowerCase() !== market.marketId.toLowerCase()) {
    throw new BorrowPreparationError("unsupported-market", "The borrowing market is not configured.");
  }
  if (snapshot.walletAddress.toLowerCase() !== snapshot.walletAddress) throw new BorrowPreparationError("invalid-input", "The verified wallet address is invalid.");
  const operation = request.operation;

  const amount = request.amountBaseUnits === undefined ? null : positiveAmount(request.amountBaseUnits);
  const collateralAmount = request.collateralAmountBaseUnits === undefined ? null : positiveAmount(request.collateralAmountBaseUnits);
  const maximumRepay = request.maximumRepayBaseUnits === undefined ? null : positiveAmount(request.maximumRepayBaseUnits);
  const owner = snapshot.walletAddress;
  const collateral = BigInt(snapshot.position.collateralRaw);
  const debt = BigInt(snapshot.position.debtAssetsRaw);
  const liquidity = BigInt(snapshot.state.liquidityAssetsRaw);
  const oraclePrice = BigInt(snapshot.state.oraclePriceRaw);
  const totalBorrowAssets = BigInt(snapshot.state.totalBorrowAssetsRaw);
  const totalBorrowShares = BigInt(snapshot.state.totalBorrowSharesRaw);
  const borrowShares = BigInt(snapshot.position.borrowSharesRaw);
  if (increasesRisk(operation, debt) && market.availability !== "enabled") {
    throw new BorrowPreparationError("unsupported-market", "This market is available only for risk reduction.");
  }
  const calls: MoneyActionDraft["calls"] = [];
  const amounts: MoneyActionAmount[] = [];
  const warnings = ["Morpho rates, oracle prices, liquidity, and debt can change before the wallet submits this action."];
  let postDebt = debt;
  let postCollateral = collateral;

  if (operation === "supply-collateral") {
    const supplied = required(amount);
    requireAtMost(supplied, BigInt(snapshot.wallet.collateralBalanceRaw), `Your verified wallet does not currently hold that much ${market.collateralToken.symbol}.`);
    exactApproval(calls, market.collateralToken, market.morpho, supplied, BigInt(snapshot.wallet.collateralAllowanceRaw));
    calls.push(supplyCollateralCall(market, supplied, owner));
    postCollateral += supplied;
    amounts.push(actionAmount(market.collateralToken, supplied, "spend"));
  } else if (operation === "borrow" || operation === "supply-and-borrow") {
    const borrowed = required(amount);
    if (operation === "supply-and-borrow") {
      const supplied = required(collateralAmount);
      requireAtMost(supplied, BigInt(snapshot.wallet.collateralBalanceRaw), `Your verified wallet does not currently hold that much ${market.collateralToken.symbol}.`);
      exactApproval(calls, market.collateralToken, market.morpho, supplied, BigInt(snapshot.wallet.collateralAllowanceRaw));
      calls.push(supplyCollateralCall(market, supplied, owner));
      postCollateral += supplied;
      amounts.push(actionAmount(market.collateralToken, supplied, "spend"));
    }
    const policyMaxDebt = policyMaximumDebtAssets(borrowCapacityAssets(postCollateral, oraclePrice, market.lltvWad), BORROW_HEALTH_FLOOR_WAD);
    const available = availableBorrowAssets({ positionBorrowShares: borrowShares, totalBorrowAssets, totalBorrowShares, maxDebtAssets: policyMaxDebt, liquidityAssets: liquidity });
    requireAtMost(borrowed, available, "The amount exceeds the current Home-adjusted collateral and liquidity limit.");
    const mintedShares = toSharesUp(borrowed, totalBorrowAssets, totalBorrowShares);
    postDebt = toAssetsUp(borrowShares + mintedShares, totalBorrowAssets + borrowed, totalBorrowShares + mintedShares);
    calls.push(borrowCall(market, borrowed, owner));
    amounts.push(actionAmount(market.loanToken, borrowed, "receive"));
    if (borrowed === liquidity) warnings.push("This review uses all currently indexed market liquidity; the call can fail if liquidity changes.");
  } else if (operation === "repay") {
    const repaid = required(amount);
    requireDebt(debt, borrowShares);
    if (repaid >= debt) throw new BorrowPreparationError("limit-exceeded", "For an exact partial repayment, enter less than the current debt or choose Repay all.");
    requireAtMost(repaid, BigInt(snapshot.wallet.loanBalanceRaw), `Your verified wallet does not currently hold that much ${market.loanToken.symbol}.`);
    const repaidShares = toSharesDown(repaid, totalBorrowAssets, totalBorrowShares);
    if (repaidShares === BigInt(0) || repaidShares > borrowShares) throw new BorrowPreparationError("limit-exceeded", "That repayment cannot safely reduce the current borrow shares.");
    exactApproval(calls, market.loanToken, market.morpho, repaid, BigInt(snapshot.wallet.loanAllowanceRaw));
    calls.push(repayCall(market, repaid, owner));
    postDebt = toAssetsUp(borrowShares - repaidShares, totalBorrowAssets > repaid ? totalBorrowAssets - repaid : BigInt(0), totalBorrowShares - repaidShares);
    amounts.push(actionAmount(market.loanToken, repaid, "spend"));
    warnings.push("This is a partial repayment. The remaining debt continues to accrue at a variable rate.");
  } else if (operation === "repay-all" || operation === "close-position") {
    const maximum = required(maximumRepay);
    requireDebt(debt, borrowShares);
    requireAtMost(debt, maximum, `The reviewed maximum must cover the current estimated ${market.loanToken.symbol} debt.`);
    requireAtMost(maximum, BigInt(snapshot.wallet.loanBalanceRaw), `The reviewed maximum cannot exceed your verified wallet's ${market.loanToken.symbol} balance.`);
    exactApproval(calls, market.loanToken, market.morpho, maximum, BigInt(snapshot.wallet.loanAllowanceRaw));
    calls.push(repaySharesCall(market, borrowShares, owner));
    amounts.push({ ...actionAmount(market.loanToken, debt, "spend"), estimated: true });
    amounts.push({ ...actionAmount(market.loanToken, maximum, "spend"), maximum: true });
    postDebt = BigInt(0);
    warnings.push(`Morpho repays all current borrow shares only if the ${market.loanToken.symbol} debit remains within your reviewed maximum.`);
    if (operation === "close-position" && collateral > BigInt(0)) {
      calls.push(withdrawCollateralCall(market, collateral, owner));
      postCollateral = BigInt(0);
      amounts.push(actionAmount(market.collateralToken, collateral, "receive"));
    }
  } else {
    const withdrawn = required(amount);
    requireAtMost(withdrawn, BigInt(snapshot.position.withdrawableCollateralRaw), "The amount exceeds the Home-adjusted collateral withdrawal limit.");
    postCollateral -= withdrawn;
    calls.push(withdrawCollateralCall(market, withdrawn, owner));
    amounts.push(actionAmount(market.collateralToken, withdrawn, "receive"));
  }

  const postRawMaximumDebt = borrowCapacityAssets(postCollateral, oraclePrice, market.lltvWad);
  const postHealth = healthFactorWad(postRawMaximumDebt, postDebt);
  if (increasesRisk(operation, debt) && postDebt > BigInt(0) && (postHealth === null || postHealth < BORROW_HEALTH_FLOOR_WAD)) {
    throw new BorrowPreparationError("limit-exceeded", "This action would leave the position below Home's 1.25 health factor floor.");
  }
  if (postHealth !== null && postHealth < BORROW_HEALTH_CRITICAL_WAD) warnings.push("This review leaves the position in the critical health band.");
  else if (postHealth !== null && postHealth < BORROW_HEALTH_FLOOR_WAD) warnings.push("This review leaves the position below Home's new-risk health floor.");
  else if (postHealth !== null && postHealth < BORROW_HEALTH_BUFFER_WAD) warnings.push("This review leaves a limited liquidation buffer.");

  try {
    await input.rpc.simulateBatch(calls, owner, snapshot.source.blockNumber, snapshot.source.blockHash, input.signal);
    const now = input.now?.() ?? new Date();
    if (Number.isNaN(now.getTime())) throw new BorrowPreparationError("invalid-input", "The review time is invalid.");
    const title = titleFor(operation, market);
    const primary = amounts[0];
    return {
      draft: {
        kind: actionKindForBorrowOperation(operation), title, calls, amounts, warnings,
        expiresAt: new Date(now.getTime() + ACTION_EXPIRY_MS).toISOString(),
        metadata: {
          product: "borrow", operation, marketId: market.marketId,
          loanAsset: { id: market.loanToken.id, symbol: market.loanToken.symbol },
          collateralAsset: { id: market.collateralToken.id, symbol: market.collateralToken.symbol },
          projectedHealthFactorWad: postHealth?.toString(10) ?? null,
          projectedLiquidationPriceRaw: liquidationPriceRaw(postDebt, postCollateral, market.lltvWad)?.toString(10) ?? null,
          borrowAprWad: snapshot.state.borrowAprWad,
          source: { blockNumber: snapshot.source.blockNumber, blockHash: snapshot.source.blockHash, blockTimestamp: snapshot.source.blockTimestamp },
        },
      },
      summary: {
        operation, title,
        amount: { symbol: primary.symbol, decimals: primary.decimals, amountBaseUnits: primary.amountBaseUnits },
        warnings: [...warnings], asOf: new Date(Number(snapshot.source.blockTimestamp) * 1_000).toISOString(),
      },
      fullySimulated: true, simulationBlockHash: snapshot.source.blockHash,
      simulationBlockNumber: snapshot.source.blockNumber, simulationBlockTimestamp: snapshot.source.blockTimestamp, simulationGap: null,
    };
  } catch (error) {
    if (error instanceof BorrowPreparationError) throw error;
    throw new BorrowPreparationError("simulation-failed", error instanceof Error && "code" in error && error.code === "account-capability" ? error.message : "The Base RPC batch simulation rejected this action against the pinned market state.", { cause: error });
  }
}

function exactApproval(calls: MoneyActionDraft["calls"], token: BorrowMarketRef["loanToken"], spender: BorrowMarketRef["morpho"], amount: bigint, allowance: bigint) {
  if (allowance !== amount) calls.push(approveCall(token, spender, amount));
}
function actionAmount(asset: BorrowMarketRef["loanToken"], amount: bigint, direction: "spend" | "receive"): MoneyActionAmount {
  return { assetId: asset.id, symbol: asset.symbol, decimals: asset.decimals, amountBaseUnits: amount.toString(10), direction };
}
function positiveAmount(value: string) { const amount = BigInt(value); if (amount <= BigInt(0)) throw new BorrowPreparationError("invalid-input", "Amount must be greater than zero."); return amount; }
function required(value: bigint | null): bigint { if (value === null) throw new BorrowPreparationError("invalid-input", "The required amount is missing."); return value; }
function requireAtMost(amount: bigint, maximum: bigint, message: string) { if (amount > maximum) throw new BorrowPreparationError("limit-exceeded", message); }
function requireDebt(debt: bigint, shares: bigint) { if (debt === BigInt(0) || shares === BigInt(0)) throw new BorrowPreparationError("limit-exceeded", "There is no current debt to repay in this market."); }
function increasesRisk(operation: BorrowOperation, debt: bigint) {
  return operation === "borrow" || operation === "supply-and-borrow" ||
    (operation === "withdraw-collateral" && debt > BigInt(0));
}
function titleFor(operation: BorrowOperation, market: BorrowMarketRef) {
  switch (operation) {
    case "supply-collateral": return `Add ${market.collateralToken.symbol} collateral`;
    case "borrow": return `Borrow ${market.loanToken.symbol}`;
    case "supply-and-borrow": return `Borrow ${market.loanToken.symbol} against ${market.collateralToken.symbol}`;
    case "repay": return `Repay ${market.loanToken.symbol}`;
    case "repay-all": return `Repay all ${market.loanToken.symbol} debt`;
    case "withdraw-collateral": return `Withdraw ${market.collateralToken.symbol} collateral`;
    case "close-position": return `Close ${market.collateralToken.symbol} / ${market.loanToken.symbol} position`;
  }
}
export function healthWarningLevel(healthFactor: bigint | null) {
  if (healthFactor === null) return "no-debt" as const;
  if (healthFactor < WAD) return "liquidatable" as const;
  if (healthFactor < BORROW_HEALTH_CRITICAL_WAD) return "critical" as const;
  if (healthFactor < BORROW_HEALTH_FLOOR_WAD) return "urgent" as const;
  if (healthFactor < BORROW_HEALTH_BUFFER_WAD) return "warning" as const;
  return "above-warning-threshold" as const;
}

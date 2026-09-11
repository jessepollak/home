import type { MoneyActionAmount, MoneyActionDraft } from "@/shared/money-actions/types";
import {
  approveCall,
  borrowCall,
  repayCall,
  repaySharesCall,
  supplyCollateralCall,
  withdrawCollateralCall,
} from "./abi";
import {
  BORROW_COLLATERAL_TOKEN,
  BORROW_LLTV_WAD,
  BORROW_LOAN_TOKEN,
  MORPHO_BLUE_ADDRESS,
  type BorrowAddress,
} from "@/shared/borrowing/config";
import {
  WAD,
  borrowCapacityAssets,
  healthFactorWad,
  parseTokenAmount,
  toAssetsUp,
  toSharesDown,
  toSharesUp,
} from "./math";
import type {
  BorrowActionPreparation,
  BorrowMarketSnapshot,
  BorrowOperation,
  BorrowPreviewRequest,
} from "@/shared/borrowing/types";
import type { BorrowRpcReader } from "./rpc";

const ACTION_EXPIRY_MS = 2 * 60_000;

export class BorrowPreparationError extends Error {
  readonly code: "invalid-input" | "stale-state" | "limit-exceeded" | "simulation-failed";

  constructor(code: BorrowPreparationError["code"], message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BorrowPreparationError";
    this.code = code;
  }
}

export async function prepareBorrowAction(input: {
  request: BorrowPreviewRequest;
  snapshot: BorrowMarketSnapshot;
  rpc: BorrowRpcReader;
  now?: () => Date;
  signal?: AbortSignal;
}): Promise<BorrowActionPreparation> {
  const { request, snapshot } = input;
  if (request.snapshotBlockHash.toLowerCase() !== snapshot.source.blockHash.toLowerCase()) {
    throw new BorrowPreparationError("stale-state", "Market state changed. Refresh and review the current limits.");
  }
  if (snapshot.walletAddress.toLowerCase() !== snapshot.walletAddress) {
    throw new BorrowPreparationError("invalid-input", "The verified wallet address is invalid.");
  }
  const operation = assertOperation(request.operation);
  const asset = operation === "supply-collateral" || operation === "withdraw-collateral"
    ? BORROW_COLLATERAL_TOKEN
    : BORROW_LOAN_TOKEN;
  let amount: bigint;
  try {
    amount = parseTokenAmount(request.amount, asset.decimals);
  } catch (error) {
    throw new BorrowPreparationError(
      "invalid-input",
      error instanceof Error ? error.message : "The amount is invalid.",
      { cause: error },
    );
  }

  const owner = snapshot.walletAddress as BorrowAddress;
  const collateral = BigInt(snapshot.position.collateralRaw);
  const debt = BigInt(snapshot.position.debtAssetsRaw);
  const liquidity = BigInt(snapshot.state.liquidityAssetsRaw);
  const oraclePrice = BigInt(snapshot.state.oraclePriceRaw);
  const totalBorrowAssets = BigInt(snapshot.state.totalBorrowAssetsRaw);
  const totalBorrowShares = BigInt(snapshot.state.totalBorrowSharesRaw);
  const borrowShares = BigInt(snapshot.position.borrowSharesRaw);
  const calls: MoneyActionDraft["calls"] = [];
  const warnings = [
    "Morpho rates, oracle prices, liquidity, and debt can change before the wallet submits this action.",
  ];
  let actionCall: MoneyActionDraft["calls"][number];
  let approvalNeeded = false;
  let existingAllowance = BigInt("0");
  let postDebt = debt;
  let postCollateral = collateral;

  if (operation === "supply-collateral") {
    requireAtMost(amount, BigInt(snapshot.wallet.collateralBalanceRaw), "Your verified wallet does not currently hold that much cbBTC.");
    existingAllowance = BigInt(snapshot.wallet.collateralAllowanceRaw);
    approvalNeeded = existingAllowance !== amount;
    if (approvalNeeded) calls.push(approveCall(BORROW_COLLATERAL_TOKEN, MORPHO_BLUE_ADDRESS, amount));
    actionCall = supplyCollateralCall(MORPHO_BLUE_ADDRESS, amount, owner);
    postCollateral += amount;
  } else if (operation === "borrow") {
    requireAtMost(amount, BigInt(snapshot.position.borrowCapacityAssetsRaw), "The amount exceeds the current collateral-and-liquidity-limited capacity.");
    const mintedShares = toSharesUp(amount, totalBorrowAssets, totalBorrowShares);
    postDebt = toAssetsUp(
      borrowShares + mintedShares,
      totalBorrowAssets + amount,
      totalBorrowShares + mintedShares,
    );
    actionCall = borrowCall(MORPHO_BLUE_ADDRESS, amount, owner);
  } else if (operation === "repay") {
    if (debt === BigInt("0")) throw new BorrowPreparationError("limit-exceeded", "There is no current debt to repay in this market.");
    if (amount >= debt) {
      throw new BorrowPreparationError(
        "limit-exceeded",
        "For an exact partial repayment, enter less than the current debt or choose Repay all with a reviewed maximum.",
      );
    }
    requireAtMost(amount, BigInt(snapshot.wallet.loanBalanceRaw), "Your verified wallet does not currently hold that much USDC.");
    const repaidShares = toSharesDown(amount, totalBorrowAssets, totalBorrowShares);
    if (repaidShares === BigInt("0")) {
      throw new BorrowPreparationError(
        "limit-exceeded",
        "That repayment is too small to reduce a Morpho borrow share.",
      );
    }
    if (repaidShares > borrowShares) {
      throw new BorrowPreparationError("limit-exceeded", "The repayment exceeds the current borrow shares.");
    }
    existingAllowance = BigInt(snapshot.wallet.loanAllowanceRaw);
    approvalNeeded = existingAllowance !== amount;
    if (approvalNeeded) calls.push(approveCall(BORROW_LOAN_TOKEN, MORPHO_BLUE_ADDRESS, amount));
    actionCall = repayCall(MORPHO_BLUE_ADDRESS, amount, owner);
    postDebt = toAssetsUp(
      borrowShares - repaidShares,
      totalBorrowAssets > amount ? totalBorrowAssets - amount : BigInt("0"),
      totalBorrowShares - repaidShares,
    );
  } else if (operation === "repay-all") {
    if (debt === BigInt("0") || borrowShares === BigInt("0")) {
      throw new BorrowPreparationError("limit-exceeded", "There is no current debt to repay in this market.");
    }
    requireAtMost(debt, amount, "The reviewed maximum must cover the current estimated USDC debit.");
    requireAtMost(amount, BigInt(snapshot.wallet.loanBalanceRaw), "The reviewed maximum cannot exceed your verified wallet's USDC balance.");
    existingAllowance = BigInt(snapshot.wallet.loanAllowanceRaw);
    approvalNeeded = existingAllowance !== amount;
    if (approvalNeeded) calls.push(approveCall(BORROW_LOAN_TOKEN, MORPHO_BLUE_ADDRESS, amount));
    actionCall = repaySharesCall(MORPHO_BLUE_ADDRESS, borrowShares, owner);
    postDebt = BigInt("0");
    warnings.push(
      "The current USDC debit is an estimate. Morpho will repay all current borrow shares only if the debit remains within your reviewed maximum.",
      "If accrued debt exceeds your reviewed maximum before execution, the action reverts and requires a new review.",
    );
  } else {
    requireAtMost(amount, BigInt(snapshot.position.withdrawableCollateralRaw), "The amount exceeds the collateral currently withdrawable without crossing liquidation limits.");
    postCollateral -= amount;
    actionCall = withdrawCollateralCall(MORPHO_BLUE_ADDRESS, amount, owner);
  }
  calls.push(actionCall);

  const postMaxDebt = borrowCapacityAssets(postCollateral, oraclePrice, BORROW_LLTV_WAD);
  const postHealth = healthFactorWad(postMaxDebt, postDebt);
  if (postHealth !== null && postHealth < BigInt("1100000000000000000")) {
    warnings.push("This preview leaves the position very close to its liquidation threshold.");
  } else if (postHealth !== null && postHealth < BigInt("1250000000000000000")) {
    warnings.push("This preview leaves a limited liquidation buffer.");
  }
  if (operation === "borrow" && amount === liquidity) {
    warnings.push("This preview uses all currently indexed market liquidity; the call can fail if liquidity changes.");
  }
  if (operation === "repay") {
    warnings.push("This is a partial repayment. The remaining debt continues to accrue at a variable rate.");
  }

  try {
    await input.rpc.simulateBatch(
      calls,
      owner,
      snapshot.source.blockNumber,
      snapshot.source.blockHash,
      input.signal,
    );
    const now = input.now?.() ?? new Date();
    if (Number.isNaN(now.getTime())) throw new BorrowPreparationError("invalid-input", "The preview time is invalid.");
    const title = titleFor(operation);
    type ReviewedBorrowAmount = MoneyActionAmount & { maximum?: boolean };
    const amounts: ReviewedBorrowAmount[] = operation === "repay-all"
      ? [
          {
            assetId: asset.id,
            symbol: asset.symbol,
            decimals: asset.decimals,
            amountBaseUnits: debt.toString(10),
            direction: "spend",
            estimated: true,
          },
          {
            assetId: asset.id,
            symbol: asset.symbol,
            decimals: asset.decimals,
            amountBaseUnits: amount.toString(10),
            direction: "spend",
            maximum: true,
          },
        ]
      : [{
          assetId: asset.id,
          symbol: asset.symbol,
          decimals: asset.decimals,
          amountBaseUnits: amount.toString(10),
          direction: operation === "supply-collateral" || operation === "repay" ? "spend" : "receive",
        }];
    return {
      draft: {
        kind: operation === "repay-all" ? "repay" : operation,
        title,
        calls,
        amounts,
        warnings,
        expiresAt: new Date(now.getTime() + ACTION_EXPIRY_MS).toISOString(),
      },
      summary: {
        operation,
        title,
        amount: {
          symbol: asset.symbol,
          decimals: asset.decimals,
          amountBaseUnits: amount.toString(10),
        },
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
    if (error instanceof BorrowPreparationError) throw error;
    throw new BorrowPreparationError(
      "simulation-failed",
      error instanceof Error && "code" in error && error.code === "account-capability"
        ? error.message
        : "The Base RPC batch simulation rejected this action against the pinned market state.",
      { cause: error },
    );
  }
}

function requireAtMost(amount: bigint, maximum: bigint, message: string) {
  if (amount > maximum) throw new BorrowPreparationError("limit-exceeded", message);
}

function assertOperation(value: string): BorrowOperation {
  if (
    value !== "supply-collateral" &&
    value !== "borrow" &&
    value !== "repay" &&
    value !== "repay-all" &&
    value !== "withdraw-collateral"
  ) {
    throw new BorrowPreparationError("invalid-input", "The borrowing operation is not supported.");
  }
  return value;
}

function titleFor(operation: BorrowOperation) {
  switch (operation) {
    case "supply-collateral": return "Supply cbBTC collateral";
    case "borrow": return "Borrow USDC";
    case "repay": return "Repay USDC";
    case "repay-all": return "Repay all USDC debt";
    case "withdraw-collateral": return "Withdraw cbBTC collateral";
  }
}

export function healthWarningLevel(healthFactor: bigint | null) {
  if (healthFactor === null) return "no-debt" as const;
  if (healthFactor < WAD) return "liquidatable" as const;
  if (healthFactor < BigInt("1100000000000000000")) return "critical" as const;
  if (healthFactor < BigInt("1250000000000000000")) return "warning" as const;
  return "above-warning-threshold" as const;
}

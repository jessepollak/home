export const WAD = BigInt("1000000000000000000");
export const ORACLE_PRICE_SCALE = BigInt("1000000000000000000000000000000000000");
export const VIRTUAL_ASSETS = BigInt("1");
export const VIRTUAL_SHARES = BigInt("1000000");
export const SECONDS_PER_YEAR = BigInt("31536000");

export function mulDivDown(x: bigint, y: bigint, denominator: bigint): bigint {
  if (denominator <= BigInt("0") || x < BigInt("0") || y < BigInt("0")) throw new RangeError("Invalid mulDiv operands.");
  return (x * y) / denominator;
}

export function mulDivUp(x: bigint, y: bigint, denominator: bigint): bigint {
  if (denominator <= BigInt("0") || x < BigInt("0") || y < BigInt("0")) throw new RangeError("Invalid mulDiv operands.");
  if (x === BigInt("0") || y === BigInt("0")) return BigInt("0");
  return ((x * y) - BigInt("1")) / denominator + BigInt("1");
}

export function toAssetsUp(shares: bigint, totalAssets: bigint, totalShares: bigint): bigint {
  return mulDivUp(shares, totalAssets + VIRTUAL_ASSETS, totalShares + VIRTUAL_SHARES);
}

export function toSharesDown(assets: bigint, totalAssets: bigint, totalShares: bigint): bigint {
  return mulDivDown(assets, totalShares + VIRTUAL_SHARES, totalAssets + VIRTUAL_ASSETS);
}

export function toSharesUp(assets: bigint, totalAssets: bigint, totalShares: bigint): bigint {
  return mulDivUp(assets, totalShares + VIRTUAL_SHARES, totalAssets + VIRTUAL_ASSETS);
}

export function taylorCompounded(ratePerSecondWad: bigint, elapsed: bigint): bigint {
  if (ratePerSecondWad < BigInt("0") || elapsed < BigInt("0")) throw new RangeError("Invalid interest inputs.");
  const firstTerm = ratePerSecondWad * elapsed;
  const secondTerm = mulDivDown(firstTerm, firstTerm, BigInt("2") * WAD);
  const thirdTerm = mulDivDown(secondTerm, firstTerm, BigInt("3") * WAD);
  return firstTerm + secondTerm + thirdTerm;
}

export function accrueBorrowAssets(totalBorrowAssets: bigint, ratePerSecondWad: bigint, elapsed: bigint): bigint {
  return totalBorrowAssets + mulDivDown(totalBorrowAssets, taylorCompounded(ratePerSecondWad, elapsed), WAD);
}

export function borrowCapacityAssets(collateralAssets: bigint, oraclePrice: bigint, lltvWad: bigint): bigint {
  const collateralValue = mulDivDown(collateralAssets, oraclePrice, ORACLE_PRICE_SCALE);
  return mulDivDown(collateralValue, lltvWad, WAD);
}

export function policyMaximumDebtAssets(rawMaximumDebtAssets: bigint, healthFloorWad: bigint): bigint {
  if (healthFloorWad < WAD) throw new RangeError("Health floor must be at least one wad.");
  return mulDivDown(rawMaximumDebtAssets, WAD, healthFloorWad);
}

export function availableBorrowAssets(input: {
  positionBorrowShares: bigint;
  totalBorrowAssets: bigint;
  totalBorrowShares: bigint;
  maxDebtAssets: bigint;
  liquidityAssets: bigint;
}): bigint {
  const currentDebt = toAssetsUp(input.positionBorrowShares, input.totalBorrowAssets, input.totalBorrowShares);
  if (currentDebt >= input.maxDebtAssets || input.liquidityAssets === BigInt("0")) return BigInt("0");
  let low = BigInt("0");
  let high = input.maxDebtAssets - currentDebt;
  if (high > input.liquidityAssets) high = input.liquidityAssets;
  while (low < high) {
    const amount = (low + high + BigInt("1")) / BigInt("2");
    const newShares = toSharesUp(amount, input.totalBorrowAssets, input.totalBorrowShares);
    const postDebt = toAssetsUp(input.positionBorrowShares + newShares, input.totalBorrowAssets + amount, input.totalBorrowShares + newShares);
    if (postDebt <= input.maxDebtAssets) low = amount;
    else high = amount - BigInt("1");
  }
  return low;
}

export function healthFactorWad(maxDebt: bigint, debt: bigint): bigint | null {
  return debt === BigInt("0") ? null : mulDivDown(maxDebt, WAD, debt);
}

export function liquidationBufferBps(healthFactor: bigint | null): bigint | null {
  if (healthFactor === null) return null;
  if (healthFactor <= WAD) return BigInt("0");
  return mulDivDown(healthFactor - WAD, BigInt("10000"), healthFactor);
}

export function minimumCollateralForDebt(debtAssets: bigint, oraclePrice: bigint, lltvWad: bigint): bigint {
  return minimumCollateralForHealthFactor(debtAssets, oraclePrice, lltvWad, WAD);
}

export function minimumCollateralForHealthFactor(debtAssets: bigint, oraclePrice: bigint, lltvWad: bigint, targetHealthFactorWad: bigint): bigint {
  if (debtAssets === BigInt("0")) return BigInt("0");
  if (oraclePrice === BigInt("0") || lltvWad === BigInt("0") || targetHealthFactorWad < WAD) {
    throw new RangeError("Oracle price, LLTV, and health factor must be valid.");
  }
  const requiredMaximumDebt = mulDivUp(debtAssets, targetHealthFactorWad, WAD);
  let high = mulDivUp(mulDivUp(requiredMaximumDebt, WAD, lltvWad), ORACLE_PRICE_SCALE, oraclePrice);
  if (high === BigInt("0")) high = BigInt("1");
  while (borrowCapacityAssets(high, oraclePrice, lltvWad) < requiredMaximumDebt) high *= BigInt("2");
  let low = BigInt("0");
  while (low < high) {
    const midpoint = (low + high) / BigInt("2");
    if (borrowCapacityAssets(midpoint, oraclePrice, lltvWad) >= requiredMaximumDebt) high = midpoint;
    else low = midpoint + BigInt("1");
  }
  return low;
}

export function liquidationPriceRaw(debtAssets: bigint, collateralAssets: bigint, lltvWad: bigint): bigint | null {
  if (debtAssets === BigInt("0")) return null;
  if (collateralAssets === BigInt("0") || lltvWad === BigInt("0")) throw new RangeError("Collateral and LLTV must be positive.");
  const requiredValue = mulDivUp(debtAssets, WAD, lltvWad);
  return mulDivUp(requiredValue, ORACLE_PRICE_SCALE, collateralAssets);
}

export function parseTokenAmount(value: string, decimals: number): bigint {
  const normalized = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(normalized)) throw new TypeError("Enter a positive decimal amount without commas or exponent notation.");
  const [whole, fraction = ""] = normalized.split(".");
  if (fraction.length > decimals) throw new TypeError(`This asset supports at most ${decimals} decimal places.`);
  const amount = BigInt(whole) * (BigInt("10") ** BigInt(decimals)) + BigInt((fraction + "0".repeat(decimals)).slice(0, decimals) || "0");
  if (amount <= BigInt("0")) throw new TypeError("Amount must be greater than zero.");
  return amount;
}

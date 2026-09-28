import { describe, expect, test } from "bun:test";
import { erc20AssetKey, nativeAssetKey, type BalancesTotal } from "./types";
import { valueHistoryPoint, withinEthWeightedTolerance } from "./history-valuation";

type Input = Parameters<typeof valueHistoryPoint>[0];
type Asset = Input["assets"][number];
type Direct = Extract<Asset, { kind: "native" | "erc20" }>;
type Vault = Extract<Asset, { kind: "vault-share" }>;
type MorphoPosition = Input["morphoPositions"][number];

const b = (value: string) => BigInt(value);
const usdcKey = erc20AssetKey("0x1111111111111111111111111111111111111111");
const wethKey = erc20AssetKey("0x2222222222222222222222222222222222222222");
const vaultKey = erc20AssetKey("0x3333333333333333333333333333333333333333");
const stockKey = erc20AssetKey("0x4444444444444444444444444444444444444444");
const marketId = `0x${"11".repeat(32)}` as const;
const usd = (atoms: string, scale = 0) => ({ atoms, scale });
const close = (atoms: string, scale = 0) => ({ status: "close" as const, usdPerToken: usd(atoms, scale) });
const ready = (baseUnits: bigint) => ({ status: "ready" as const, baseUnits });

function cash(baseUnits: bigint): Direct {
  return { key: usdcKey, kind: "erc20", decimals: 6, symbol: "USDC", name: "USD Coin", cashCurrency: "USD", admission: "admitted", quantity: ready(baseUnits), price: close("1") };
}

function eth(baseUnits: bigint): Direct {
  return { key: nativeAssetKey(), kind: "native", decimals: 18, symbol: "ETH", name: "Ether", cashCurrency: null, admission: "admitted", quantity: ready(baseUnits), price: close("3000") };
}

function weth(baseUnits: bigint): Direct {
  return { key: wethKey, kind: "erc20", decimals: 18, symbol: "WETH", name: "Wrapped Ether", cashCurrency: null, admission: "admitted", quantity: ready(baseUnits), price: close("3000") };
}

function vault(baseUnits: bigint, atoms = b("1000000"), scale = 18): Vault {
  return { key: vaultKey, kind: "vault-share", decimals: 18, symbol: "vUSDC", name: "Save", cashCurrency: null, admission: "admitted", quantity: ready(baseUnits), rate: { atoms, scale }, underlyingDecimals: 6, underlyingPrice: close("1") };
}

function morpho(collateralUnits: bigint, borrowShares: bigint, index = { atoms: b("1000000"), scale: 6 }): MorphoPosition {
  return {
    marketId,
    collateral: { assetKey: `morpho:${marketId}:collateral`, asset: { key: wethKey, decimals: 18, symbol: "WETH", name: "Wrapped Ether", cashCurrency: null }, quantity: ready(collateralUnits), price: close("3000") },
    loan: { assetKey: `morpho:${marketId}:borrow-shares`, asset: { key: usdcKey, decimals: 6, symbol: "USDC", name: "USD Coin", cashCurrency: "USD" }, borrowShares: ready(borrowShares), borrowIndex: index, price: close("1") },
  };
}

function point(assets: Asset[] = [], morphoPositions: MorphoPosition[] = [], quoteCurrency: Input["quoteCurrency"] = "USD", fx: Input["fx"] = { status: "missing" }, inventory: Input["inventory"] = "complete", unpriced: Input["unpriced"] = []) {
  return valueHistoryPoint({ assets, morphoPositions, quoteCurrency, fx, inventory, unpriced });
}

function cents(total: BalancesTotal): bigint | null {
  if (total.value === null) return null;
  return BigInt(total.value.atoms) * b("100") / (b("10") ** BigInt(total.value.scale));
}

describe("history point valuation", () => {
  test("deposit increases Cash and net by the deposited amount", () => {
    const before = point([cash(b("100000000"))]);
    const after = point([cash(b("125000000"))]);
    expect(cents(before.net)).toBe(b("10000"));
    expect(cents(after.cash)).toBe(b("12500"));
    expect(cents(after.net)! - cents(before.net)!).toBe(b("2500"));
    expect(after.coverage).toBe("complete");
  });

  test("incomplete inventory leaves Investments and net partial despite exact priced holdings", () => {
    const result = point([cash(b("1000000")), eth(b("1000000000000000000"))], [], "USD", { status: "missing" }, "incomplete");
    expect(result.cash.status).toBe("complete");
    expect(result.investments).toEqual({ status: "partial", currency: "USD", value: usd("3000000000000000000000", 18) });
    expect(result.net).toEqual({ status: "partial", currency: "USD", value: usd("3001000000000000000000", 18), negative: false });
    expect(result.coverage).toBe("partial");
    expect(result.missing).toEqual([]);
  });

  test("Save exchanges USDC for shares with at most one underlying base unit of rounding", () => {
    const before = point([cash(b("10000000")), vault(b("0"))]);
    const after = point([cash(b("0")), vault(b("9999999999999999999"))]);
    expect(before.cash.value).toEqual(usd("10000000000000000000", 18));
    expect(after.cash.value).toEqual(usd("9999999000000000000", 18));
    expect(before.net.value).toEqual(usd("10000000000000000000", 18));
    expect(after.net.value).toEqual(usd("9999999000000000000", 18));
    expect(after.missing).toEqual([]);
  });

  test("borrow increases Cash and debt equally without increasing net", () => {
    const before = point([cash(b("0"))], [morpho(b("1000000000000000000"), b("0"))]);
    const after = point([cash(b("500000000"))], [morpho(b("1000000000000000000"), b("500000000"))]);
    expect(cents(before.net)).toBe(b("300000"));
    expect(cents(after.cash)).toBe(b("50000"));
    expect(cents(after.borrow)).toBe(b("50000"));
    expect(cents(after.net)).toBe(b("300000"));
  });

  test("borrow index rounds debt upward at a fractional base unit", () => {
    const result = point([], [morpho(b("0"), b("1"), { atoms: b("1000001"), scale: 6 })]);
    expect(result.borrow.value).toEqual(usd("2000000000000", 18));
    expect(result.net).toMatchObject({ status: "complete", negative: true });
  });

  test("liquidation removes collateral and debt", () => {
    const before = point([], [morpho(b("1000000000000000000"), b("500000000"))]);
    const after = point([], [morpho(b("500000000000000000"), b("400000000"))]);
    expect(cents(before.investments)).toBe(b("300000"));
    expect(cents(before.borrow)).toBe(b("50000"));
    expect(cents(after.investments)).toBe(b("150000"));
    expect(cents(after.borrow)).toBe(b("40000"));
    expect(cents(after.net)).toBe(b("110000"));
  });

  test("trade shifts Cash to Investments", () => {
    const before = point([cash(b("3000000000")), eth(b("0"))]);
    const after = point([cash(b("0")), eth(b("1000000000000000000"))]);
    expect(cents(before.cash)).toBe(b("300000"));
    expect(cents(after.cash)).toBe(b("0"));
    expect(cents(after.investments)).toBe(b("300000"));
    expect(cents(after.net)).toBe(b("300000"));
  });

  test("sold-to-zero token has no price dependency and zero account is complete", () => {
    const sold: Direct = { ...cash(b("0")), price: { status: "missing", reason: "no-recent-close" } };
    const result = point([sold, weth(b("0"))]);
    expect(result.coverage).toBe("complete");
    expect(result.net).toEqual({ status: "complete", value: usd("0", 18), currency: "USD", negative: false });
    expect(result.missing).toEqual([]);
    expect(point().coverage).toBe("complete");
    expect(cents(point().net)).toBe(b("0"));
  });

  test("WETH wrap uses the same WETH close for native and wrapped balances", () => {
    const before = point([eth(b("2000000000000000000")), weth(b("0"))]);
    const after = point([eth(b("0")), weth(b("2000000000000000000"))]);
    expect(cents(before.net)).toBe(b("600000"));
    expect(cents(after.net)).toBe(b("600000"));
  });

  test("missing stablecoin close is never assumed to be one dollar", () => {
    const missingKey = erc20AssetKey("0x5555555555555555555555555555555555555555");
    const missing: Direct = { ...cash(b("20000000")), key: missingKey, price: { status: "missing", reason: "no-recent-close" } };
    const result = point([cash(b("10000000")), missing]);
    expect(result.cash.status).toBe("partial");
    expect(cents(result.cash)).toBe(b("1000"));
    expect(result.missing).toEqual([{ assetKey: missingKey, reason: "no-recent-close" }]);
    expect(result.coverage).toBe("partial");
  });

  test("unpriced stock basis and positive below-gate assets make Investments partial", () => {
    const stock: Direct = { key: stockKey, kind: "erc20", decimals: 18, symbol: "STOCK", name: "Stock", cashCurrency: null, admission: "admitted", quantity: ready(b("1")), price: { status: "missing", reason: "unpriced-basis" } };
    const gated: Direct = { ...weth(b("1")), admission: "below-market-gate" };
    const result = point([cash(b("1000000")), stock, gated]);
    expect(result.investments.status).toBe("unavailable");
    expect(result.net.status).toBe("partial");
    expect(result.missing).toEqual([{ assetKey: stockKey, reason: "unpriced-basis" }, { assetKey: wethKey, reason: "below-market-gate" }]);
  });

  test("missing quantity reports its read reason instead of zero", () => {
    const result = point([cash(b("1000000")), { ...eth(b("1")), quantity: { status: "unavailable", reason: "mismatch" } }]);
    expect(result.investments.status).toBe("unavailable");
    expect(result.net.status).toBe("partial");
    expect(result.missing).toEqual([{ assetKey: nativeAssetKey(), reason: "mismatch" }]);
  });

  test("FX is required for non-USD positive balances, but USD requires none", () => {
    const missing = point([cash(b("1000000"))], [], "EUR");
    expect(missing.cash.status).toBe("unavailable");
    expect(missing.coverage).toBe("unavailable");
    expect(missing.missing).toEqual([{ assetKey: usdcKey, reason: "fx-unavailable" }]);
    expect(cents(point([cash(b("1000000"))]).cash)).toBe(b("100"));
    const known = point([cash(b("1000000"))], [], "EUR", { status: "ready", quotePerUsd: usd("91", 2) });
    expect(known.net).toEqual({ status: "complete", value: usd("910000000000000000", 18), currency: "EUR", negative: false });
  });

  test("missing close precedes FX missing and no quote currency is unavailable", () => {
    const result = point([cash(b("0")), { ...eth(b("1000000000000000000")), price: { status: "missing", reason: "no-recent-close" } }], [], "EUR");
    expect(result.net.status).toBe("unavailable");
    expect(result.missing).toEqual([{ assetKey: nativeAssetKey(), reason: "no-recent-close" }]);
    const noQuote = point([cash(b("1000000"))], [], null);
    expect(noQuote.coverage).toBe("unavailable");
    expect(noQuote.net).toEqual({ status: "no-quote-currency", value: null, currency: null, negative: false });
  });

  test("debt exceeding assets gives negative net magnitude", () => {
    const result = point([cash(b("10000000"))], [morpho(b("0"), b("20000000"))]);
    expect(result.net).toEqual({ status: "complete", value: usd("10000000000000000000", 18), currency: "USD", negative: true });
  });



  test("a removed market with unknown debt is unavailable, never a partial zero", () => {
    const removed = `morpho:0x${"b".repeat(64)}:borrow-shares`;
    const result = point([], [], "USD", { status: "missing" }, "complete", [{ assetKey: removed, reason: "unsupported", component: "borrow" }]);
    expect(result.borrow.status).toBe("unavailable");
    expect(result.borrow.value).toBeNull();
    expect(result.net.status).toBe("unavailable");
    expect(result.coverage).toBe("unavailable");
    expect(result.missing).toEqual([{ assetKey: removed, reason: "unsupported" }]);
  });
  test("unpriced borrow leaves Investments complete while Borrow and zero net are unavailable", () => {
    const removed = `morpho:0x${"c".repeat(64)}:borrow-shares`;
    const result = point([eth(b("0"))], [], "USD", { status: "missing" }, "complete",
      [{ assetKey: removed, reason: "unsupported", component: "borrow" }]);
    expect(result.investments).toEqual({ status: "complete", value: usd("0", 18), currency: "USD" });
    expect(result.borrow).toEqual({ status: "unavailable", value: null, currency: "USD" });
    expect(result.net).toEqual({ status: "unavailable", value: null, currency: "USD", negative: false });
    expect(result.missing).toEqual([{ assetKey: removed, reason: "unsupported" }]);
    const known = point([eth(b("1000000000000000000"))], [], "USD", { status: "missing" }, "complete",
      [{ assetKey: removed, reason: "unsupported", component: "borrow" }]);
    expect(known.investments.status).toBe("complete");
    expect(known.net).toEqual({ status: "partial", value: usd("3000000000000000000000", 18), currency: "USD", negative: false });
  });
  test("unpriced Investments leaves Borrow complete and downgrades Investments and net", () => {
    const result = point([eth(b("1000000000000000000"))], [], "USD", { status: "missing" }, "complete",
      [{ assetKey: stockKey, reason: "unpriced-basis", component: "investments" }]);
    expect(result.investments).toEqual({ status: "partial", value: usd("3000000000000000000000", 18), currency: "USD" });
    expect(result.borrow.status).toBe("complete");
    expect(result.net.status).toBe("partial");
  });
  test("unpriced Cash downgrades only Cash and net, not Investments or Borrow", () => {
    const result = point([eth(b("1000000000000000000"))], [], "USD", { status: "missing" }, "complete",
      [{ assetKey: usdcKey, reason: "unpriced-basis", component: "cash" }]);
    expect(result.cash).toEqual({ status: "unavailable", value: null, currency: "USD" });
    expect(result.investments.status).toBe("complete");
    expect(result.borrow.status).toBe("complete");
    expect(result.net.status).toBe("partial");
    expect(result.missing).toEqual([{ assetKey: usdcKey, reason: "unpriced-basis" }]);
  });
  test("an unpriceable position marks the point partial without changing known values", () => {
    const known = point([cash(b("100000000"))]);
    const withUnpriced = point([cash(b("100000000"))], [], "USD", { status: "missing" }, "complete",
      [{ assetKey: `morpho:0x${"b".repeat(64)}:collateral`, reason: "unsupported" }]);
    expect(known.coverage).toBe("complete");
    expect(withUnpriced.coverage).toBe("partial");
    expect(withUnpriced.missing).toEqual([{ assetKey: `morpho:0x${"b".repeat(64)}:collateral`, reason: "unsupported" }]);
    expect(cents(withUnpriced.net)).toBe(cents(known.net));
  });
  test("missing vault rate or borrow index does not invent underlying or debt value", () => {
    const brokenVault: Vault = { ...vault(b("1000000000000000000")), rate: null };
    const position = morpho(b("0"), b("1000000"));
    const result = point([cash(b("1000000")), brokenVault], [{ ...position, loan: { ...position.loan, borrowIndex: null } }]);
    expect(result.cash.status).toBe("partial");
    expect(result.borrow.status).toBe("unavailable");
    expect(result.missing).toEqual([{ assetKey: vaultKey, reason: "unpriced-basis" }, { assetKey: position.loan.assetKey, reason: "unpriced-basis" }]);
  });
});

describe("ETH-weighted tolerance", () => {
  test("exactly 0.5% of ETH value passes; one cent beyond fails", () => {
    expect(withinEthWeightedTolerance({ history: usd("100500", 2), reference: usd("100000", 2), ethWeightedValue: usd("1000") })).toBe(true);
    expect(withinEthWeightedTolerance({ history: usd("100501", 2), reference: usd("100000", 2), ethWeightedValue: usd("1000") })).toBe(false);
    expect(withinEthWeightedTolerance({ history: usd("99500", 2), reference: usd("100000", 2), ethWeightedValue: usd("1000") })).toBe(true);
  });

  test("zero ETH weighted value requires an exact rational match", () => {
    expect(withinEthWeightedTolerance({ history: usd("100", 2), reference: usd("1"), ethWeightedValue: usd("0") })).toBe(true);
    expect(withinEthWeightedTolerance({ history: usd("1000000000000000001", 18), reference: usd("1"), ethWeightedValue: usd("0") })).toBe(false);
  });
});

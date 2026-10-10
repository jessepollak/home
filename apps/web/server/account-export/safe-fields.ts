import "server-only";

import type { AccountExportHomeClass } from "@/shared/account/contracts/data-export";
import { parseAddress } from "@/shared/chain/hex";
import { AccountExportError } from "./errors";

function object(value: unknown): Record<string, unknown> {
  if (!isObject(value)) throw new AccountExportError("ACCOUNT_EXPORT_UNAVAILABLE");
  return value;
}

function fields(value: unknown, names: readonly string[], amounts: readonly string[] = [], decimals: readonly string[] = [], required: readonly string[] = []): Record<string, unknown> {
  const input = object(value);
  if (required.some((name) => input[name] === undefined || input[name] === null)) throw new AccountExportError("ACCOUNT_EXPORT_UNAVAILABLE");
  return Object.fromEntries(names.filter((name) => input[name] !== undefined).map((name) => {
    const value = input[name];
    if (value === null && ["contractAddress", "cashCurrency"].includes(name)) return [name, null];
    if (amounts.includes(name) || decimals.includes(name)) {
      const pattern = decimals.includes(name) ? /^(?:0|[1-9]\d*)(?:\.\d+)?$/ : /^(?:0|[1-9]\d*)$/;
      if (typeof value !== "string" || !pattern.test(value)) throw new AccountExportError("ACCOUNT_EXPORT_UNAVAILABLE");
    } else if (["estimated", "maximum", "feesKnown"].includes(name)) {
      if (typeof value !== "boolean") throw new AccountExportError("ACCOUNT_EXPORT_UNAVAILABLE");
    } else if (name === "decimals") {
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 255) throw new AccountExportError("ACCOUNT_EXPORT_UNAVAILABLE");
    } else if (typeof value !== "string") {
      throw new AccountExportError("ACCOUNT_EXPORT_UNAVAILABLE");
    }
    if (name === "expiresAt") {
      if (typeof value !== "string") throw new AccountExportError("ACCOUNT_EXPORT_UNAVAILABLE");
      return [name, new Date(value).toISOString()];
    }
    return [name, value];
  }));
}

function requiredFields(value: unknown, names: readonly string[], amounts: readonly string[] = []): Record<string, unknown> {
  const input = object(value);
  if (names.some((name) => input[name] === undefined)) throw new AccountExportError("ACCOUNT_EXPORT_UNAVAILABLE");
  return fields(input, names, amounts);
}

function list(value: unknown, map: (value: unknown) => Record<string, unknown>): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new AccountExportError("ACCOUNT_EXPORT_UNAVAILABLE");
  return value.map(map);
}

function fees(value: unknown): Record<string, unknown>[] {
  return list(value, (item) => fields(item, ["label", "amount", "currency"], [], ["amount"], ["label", "amount", "currency"]));
}

function networkFee(value: unknown): Record<string, unknown> {
  const input = object(value);
  if (input.payment === "native") return { payment: "native" };
  if (input.payment === "usdc") {
    const token = parseAddress(input.token);
    if (!token || input.decimals !== 6) throw new AccountExportError("ACCOUNT_EXPORT_UNAVAILABLE");
    return { ...fields(input, ["payment", "maxFeeBaseUnits", "decimals"], ["maxFeeBaseUnits"], [], ["payment", "maxFeeBaseUnits", "decimals"]), token };
  }
  throw new AccountExportError("ACCOUNT_EXPORT_UNAVAILABLE");
}

function balance(value: unknown): Record<string, unknown> {
  const input = object(value);
  if (input.status === "ready") return requiredFields(input, ["status", "baseUnits"], ["baseUnits"]);
  if (input.status === "unavailable" && input.baseUnits === null) return { ...requiredFields(input, ["status"]), baseUnits: null };
  throw new AccountExportError("ACCOUNT_EXPORT_UNAVAILABLE");
}

function borrow(value: unknown): Record<string, unknown> | null {
  if (value === null) return null;
  const input = object(value);
  return { markets: list(input.markets, (value) => {
    const market = object(value);
    if (market.status === "ready") return requiredFields(market,
      ["marketId", "status", "blockNumber", "collateralRaw", "debtAssetsRaw", "borrowAprWad"],
      ["blockNumber", "collateralRaw", "debtAssetsRaw", "borrowAprWad"]);
    if (market.status === "unavailable" && ["blockNumber", "collateralRaw", "debtAssetsRaw", "borrowAprWad"].every((name) => market[name] === undefined)) return requiredFields(market, ["marketId", "status"]);
    throw new AccountExportError("ACCOUNT_EXPORT_UNAVAILABLE");
  }) };
}

export function mapJsonFields(name: AccountExportHomeClass, row: Record<string, unknown>): Record<string, unknown> {
  if (name === "actions") {
    const { summary: raw, ...rest } = row;
    const summary = object(raw);
    return { ...rest, summary: {
      ...fields(summary, ["title", "expiresAt"]),
      amounts: list(summary.amounts, (amount) => fields(amount, ["assetId", "symbol", "decimals", "amountBaseUnits", "direction", "estimated", "maximum"], ["amountBaseUnits"], [], ["assetId", "symbol", "decimals", "amountBaseUnits", "direction"])),
      ...(summary.networkFee !== undefined ? { networkFee: networkFee(summary.networkFee) } : {}),
    } };
  }
  if (name === "funding_orders") {
    const { quote: raw, fees: rawFees, ...rest } = row;
    const quote = object(raw);
    return { ...rest, quote: { ...fields(quote, ["fiatAmount", "enteredFiatAmount", "tokenAmountAtomic", "feesKnown", "expiresAt"], ["tokenAmountAtomic"], ["fiatAmount", "enteredFiatAmount"], ["fiatAmount", "tokenAmountAtomic", "expiresAt"]), fees: fees(quote.fees) }, fees: fees(rawFees) };
  }
  if (name === "balance_snapshots") {
    const { holdings: raw, coverage, borrow: rawBorrow, ...rest } = row;
    return { ...rest, holdings: list(raw, (value) => {
      const holding = object(value);
      return {
        ...fields(holding, ["key", "kind", "source", "id", "name", "symbol", "decimals", "contractAddress", "cashCurrency"]),
        balance: balance(holding.balance),
        ...(holding.underlyingBalance !== undefined ? { underlyingBalance: balance(holding.underlyingBalance) } : {}),
        ...(holding.withdrawableBalance !== undefined ? { withdrawableBalance: balance(holding.withdrawableBalance) } : {}),
      };
    }), coverage: requiredFields(coverage, ["registry", "catalog"]), borrow: borrow(rawBorrow) };
  }
  return row;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

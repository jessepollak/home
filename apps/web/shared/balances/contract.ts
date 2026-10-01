import * as z from "zod/mini";
import { parseAddress, parseHash32, type Address } from "@/shared/chain/hex";
import { getDirectPortfolioAssets, portfolioVaults, PORTFOLIO_USDC_ASSET_KEY } from "@/config/portfolio-assets";
import { getBorrowMarketRef } from "@/shared/borrowing/config";
import { isRegionId, presentationRegions, type FiatCurrencyCode, type RegionId } from "@/config/regions";
import {
  BALANCES_CHAIN_ID, BALANCES_VERSION, catalogHoldingId, erc20AssetKey, nativeAssetKey, walletHoldingId,
  type AssetKey, type BalancesAddress, type BalancesSession, type BorrowMarketKey, type Erc20AssetKey,
} from "./types";

/** @public version token for the balances route contract inventory */
export { BALANCES_VERSION } from "./types";

const assetKeyPattern = /^eip155:8453\/erc20:0x[0-9a-f]{40}$/;
const decimalIntegerPattern = /^(?:0|[1-9]\d*)$/;
const currencies = new Set<string>(Object.values(presentationRegions).flatMap((region) =>
  region.currency.code === null ? [] : [region.currency.code]));

const addressSchema = z.custom<BalancesAddress>((value) => parseAddress(value) !== null)
  .check(z.overwrite((value) => parseAddress(value) ?? value));
const blockHashSchema = z.custom<`0x${string}`>((value) => parseHash32(value) !== null)
  .check(z.overwrite((value) => parseHash32(value) ?? value));
const assetKeySchema = z.custom<AssetKey>((value) => typeof value === "string" &&
  (value === nativeAssetKey() || assetKeyPattern.test(value)));
const erc20KeySchema = z.custom<Erc20AssetKey>((value) => typeof value === "string" && assetKeyPattern.test(value));
const marketKeySchema = z.custom<BorrowMarketKey>((value) => typeof value === "string" &&
  parseHash32(value) !== null && getBorrowMarketRef(value) !== null)
  .check(z.overwrite((value) => parseHash32(value) ?? value));
const regionSchema = z.custom<RegionId>((value) => isRegionId(value));
const currencySchema = z.custom<FiatCurrencyCode>((value) => typeof value === "string" && currencies.has(value));
const integerSchema = z.string().check(z.regex(decimalIntegerPattern));
const boundedTextSchema = z.string().check(z.refine((text) => text.trim() === text && text.length > 0 && text.length <= 64));
const decimalsSchema = z.number().check(z.refine((n) => Number.isSafeInteger(n) && n >= 0 && n <= 255));
const scaleSchema = z.number().check(z.refine((n) => Number.isSafeInteger(n) && n >= 0 && n <= 100));
const isoSchema = z.string().check(z.refine((text) => {
  const date = new Date(text);
  return !Number.isNaN(date.getTime()) && date.toISOString() === text;
}));
const imageSchema = z.string().check(z.refine((text) => {
  if (text.length > 2_048) return false;
  try {
    const url = new URL(text);
    return url.protocol === "https:" && !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
}));
const nullableCurrencySchema = z.nullable(currencySchema);
const cashCurrencySchema = z.prefault(nullableCurrencySchema, null);

const decimalSchema = z.object({ atoms: integerSchema, scale: scaleSchema });
const balanceSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ready"), baseUnits: integerSchema }),
  z.object({ status: z.literal("unavailable"), baseUnits: z.null() }),
]);
const readyBalanceSchema = z.object({ status: z.literal("ready"), baseUnits: integerSchema });
const referenceSchema = z.object({ kind: z.literal("tokenized-equity"), session: z.enum(["open", "closed"]) });
const valueSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("priced"), currency: currencySchema, amount: decimalSchema, asOf: isoSchema, reference: z.optional(referenceSchema) }),
  z.object({ status: z.literal("unpriced"), reason: z.enum([
    "price-unavailable", "price-stale", "fx-unavailable", "below-market-gate",
    "no-quote-currency", "price-paused", "asset-removed",
  ]) }),
  z.object({ status: z.literal("unavailable") }),
]);
const cashValueSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("priced"), currency: currencySchema, amount: decimalSchema }),
  z.object({ status: z.literal("unpriced"), reason: z.enum(["price-unavailable", "price-stale", "fx-unavailable"]) }),
  z.object({ status: z.literal("unavailable") }),
]);
const unitValueSchema = z.object({ currency: currencySchema, amount: decimalSchema });

function withoutInapplicableCollateral(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return raw;
  const holding: Record<string, unknown> = { ...raw };
  if (holding.source !== "borrow" && "collateral" in holding) delete holding.collateral;
  return holding;
}

const holdingSchema = z.object({
  key: assetKeySchema, id: z.string(), kind: z.enum(["native", "erc20", "vault-share"]),
  source: z.enum(["registry", "catalog", "wallet", "borrow"]), name: boundedTextSchema, symbol: boundedTextSchema,
  decimals: decimalsSchema, contractAddress: z.nullable(addressSchema), cashCurrency: cashCurrencySchema,
  imageUrl: z.optional(imageSchema),
  underlying: z.optional(z.object({ key: erc20KeySchema, symbol: z.literal("USDC"), decimals: z.literal(6) })),
  balance: balanceSchema, underlyingBalance: z.optional(balanceSchema), value: valueSchema,
  unitValue: z.optional(unitValueSchema), cashValue: z.optional(cashValueSchema),
  collateral: z.optional(z.object({ marketId: marketKeySchema })),
}).check(z.refine((h) => {
  if (!validValue(h.value, h.balance) || !validUnitValue(h.unitValue, h.value, h.kind)) return false;
  if (h.source === "registry") {
    const expected = expectedRegistryHoldings().get(h.id);
    if (!expected || h.key !== expected.key || h.kind !== expected.kind || h.name !== expected.name ||
      h.symbol !== expected.symbol || h.decimals !== expected.decimals ||
      h.contractAddress !== expected.contractAddress ||
      h.cashCurrency !== expected.cashCurrency ||
      (h.imageUrl !== undefined && (expected.kind !== "erc20" || expected.cashCurrency !== null))) return false;
    if (expected.kind === "vault-share") {
      if (h.underlying?.key !== PORTFOLIO_USDC_ASSET_KEY || !h.underlyingBalance ||
        (h.balance.status === "unavailable" && h.underlyingBalance.status !== "unavailable")) return false;
    } else if (h.underlying !== undefined || h.underlyingBalance !== undefined) return false;
    if (expected.cashCurrency) {
      if (!h.cashValue || !validCashValue(h.cashValue, h.balance, expected.cashCurrency)) return false;
    } else if (h.cashValue !== undefined) return false;
    return true;
  }
  return h.source !== "borrow" && h.kind === "erc20" && h.contractAddress !== null &&
    h.id === (h.source === "catalog" ? catalogHoldingId(h.contractAddress) : walletHoldingId(h.contractAddress)) &&
    h.key === erc20AssetKey(h.contractAddress) &&
    !registryAssetKeys().has(h.key) &&
    h.cashCurrency === null && h.underlying === undefined && h.underlyingBalance === undefined &&
    h.cashValue === undefined && h.balance.status === "ready" && h.balance.baseUnits !== "0";
}));
const collateralSchema = z.object({
  key: assetKeySchema, id: z.string(), kind: z.literal("erc20"), source: z.literal("borrow"),
  name: boundedTextSchema, symbol: boundedTextSchema, decimals: decimalsSchema,
  contractAddress: z.nullable(addressSchema), cashCurrency: cashCurrencySchema,
  balance: readyBalanceSchema, value: valueSchema, unitValue: z.optional(unitValueSchema),
  collateral: z.object({ marketId: marketKeySchema }),
  underlying: z.optional(z.object({ key: erc20KeySchema, symbol: z.literal("USDC"), decimals: z.literal(6) })),
  underlyingBalance: z.optional(balanceSchema), cashValue: z.optional(cashValueSchema), imageUrl: z.optional(imageSchema),
}).check(z.refine((h) => h.cashCurrency === null && h.underlying === undefined &&
  h.underlyingBalance === undefined && h.cashValue === undefined && h.imageUrl === undefined &&
  validValue(h.value, h.balance) && validUnitValue(h.unitValue, h.value, h.kind)));
const debtSchema = z.object({
  sign: z.literal(-1), marketId: marketKeySchema,
  asset: z.object({ key: erc20KeySchema, name: boundedTextSchema, symbol: boundedTextSchema, decimals: decimalsSchema }),
  balance: readyBalanceSchema, value: valueSchema,
}).check(z.refine((d) => validValue(d.value, d.balance)));
const positionSchema = z.object({
  marketId: marketKeySchema, collateral: collateralSchema, debt: debtSchema, borrowAprWad: integerSchema,
}).check(z.refine((p) => {
  const market = getBorrowMarketRef(p.marketId);
  if (!market || p.marketId !== market.marketId.toLowerCase()) return false;
  const collateral = market.collateralToken;
  const debt = market.loanToken;
  const collateralAddress = parseAddress(collateral.address);
  return p.collateral.key === erc20AssetKey(collateral.address) &&
    p.collateral.id === `borrow-collateral:${p.marketId}` &&
    collateralAddress !== null && p.collateral.contractAddress === collateralAddress &&
    p.collateral.decimals === collateral.decimals && p.collateral.collateral.marketId === p.marketId &&
    p.debt.marketId === p.marketId &&
    p.debt.asset.key === erc20AssetKey(debt.address) && p.debt.asset.decimals === debt.decimals &&
    (p.collateral.balance.baseUnits !== "0" || p.debt.balance.baseUnits !== "0");
}));
const borrowSchema = z.object({ coverage: z.enum(["complete", "partial"]), positions: z.array(positionSchema) })
  .check(z.refine((borrow) => new Set(borrow.positions.map((p) => p.marketId)).size === borrow.positions.length));
const totalSchema = z.object({
  status: z.enum(["complete", "partial", "unavailable", "no-quote-currency"]),
  value: z.nullable(decimalSchema), currency: nullableCurrencySchema,
}).check(z.refine((total) =>
  total.status === "complete" || total.status === "partial"
    ? total.value !== null && total.currency !== null
    : total.value === null && (total.status !== "no-quote-currency" || total.currency === null)));
const netSchema = z.object({
  status: totalSchema.shape.status, value: totalSchema.shape.value, currency: totalSchema.shape.currency,
  negative: z.boolean(),
}).check(z.refine((net) =>
  (net.status === "complete" || net.status === "partial"
    ? net.value !== null && net.currency !== null
    : net.value === null && (net.status !== "no-quote-currency" || net.currency === null)) &&
  (net.value !== null || !net.negative)));
const totalsSchema = z.object({ cash: totalSchema, investments: totalSchema, borrow: totalSchema, net: netSchema });
const coverageSchema = z.object({ registry: z.enum(["complete", "partial"]), catalog: z.enum(["complete", "incomplete", "unavailable"]) });

const balancesSnapshotSchema = z.object({
  version: z.literal(BALANCES_VERSION),
  owner: z.object({ address: addressSchema, chainId: z.literal(BALANCES_CHAIN_ID) }),
  region: regionSchema, quoteCurrency: nullableCurrencySchema,
  block: z.object({ number: integerSchema, hash: blockHashSchema, timestamp: integerSchema }),
  fetchedAt: isoSchema, holdings: z.array(z.pipe(z.transform(withoutInapplicableCollateral), holdingSchema)), coverage: coverageSchema,
  total: totalSchema, borrow: borrowSchema, totals: totalsSchema, stale: z.optional(z.literal(true)),
}).check(z.refine((snapshot) => {
  const keys = new Set<string>();
  const ids = new Set<string>();
  for (const holding of snapshot.holdings) {
    if (keys.has(holding.key) || ids.has(holding.id)) return false;
    keys.add(holding.key);
    ids.add(holding.id);
  }
  if ([...expectedRegistryHoldings().keys()].some((id) =>
    !snapshot.holdings.some((h) => h.source === "registry" && h.id === id))) return false;
  if ((snapshot.coverage.registry === "partial") !== snapshot.holdings.some((h) =>
    h.source === "registry" && h.balance.status === "unavailable")) return false;
  if (snapshot.borrow.coverage === "partial" &&
    (snapshot.totals.borrow.status === "complete" || snapshot.totals.net.status === "complete")) return false;
  if (snapshot.totals.net.status === "complete" &&
    [snapshot.totals.cash, snapshot.totals.investments, snapshot.totals.borrow].some((t) => t.status !== "complete")) return false;
  return true;
}, "coverage or totals"));

export type ExactDecimal = z.output<typeof decimalSchema>;
export type HoldingBalance = z.output<typeof balanceSchema>;
export type HoldingValue = z.output<typeof valueSchema>;
export type HoldingCashValue = z.output<typeof cashValueSchema>;
export type Holding = z.output<typeof holdingSchema>;
export type BorrowCollateralHolding = z.output<typeof collateralSchema>;
/** @public debt line response type for balance consumers */
export type BorrowDebtLine = z.output<typeof debtSchema>;
export type BorrowPosition = z.output<typeof positionSchema>;
export type BalancesBorrow = z.output<typeof borrowSchema>;
export type BalancesCoverage = z.output<typeof coverageSchema>;
export type BalancesTotal = z.output<typeof totalSchema>;
export type BalancesNetTotal = z.output<typeof netSchema>;
export type BalancesTotals = z.output<typeof totalsSchema>;
export type BalancesSnapshot = z.output<typeof balancesSnapshotSchema>;

export class BalancesResponseError extends Error {
  constructor(message = "The balances response is invalid.") {
    super(message);
    this.name = "BalancesResponseError";
  }
}

type RegistryExpectation = {
  id: string;
  key: string;
  kind: Holding["kind"];
  name: string;
  symbol: string;
  decimals: number;
  contractAddress: Address | null;
  cashCurrency: FiatCurrencyCode | null;
};
let registryExpectations: Map<string, RegistryExpectation> | null = null;
let registryKeys: ReadonlySet<string> | null = null;

function registryAssetKeys(): ReadonlySet<string> {
  registryKeys ??= new Set([...expectedRegistryHoldings().values()].map((holding) => holding.key));
  return registryKeys;
}

export function expectedRegistryHoldings(): ReadonlyMap<string, RegistryExpectation> {
  if (registryExpectations) return registryExpectations;
  const expectations = new Map<string, RegistryExpectation>();
  for (const asset of getDirectPortfolioAssets()) {
    const key = asset.kind === "native" ? nativeAssetKey() :
      asset.contractAddress ? erc20AssetKey(asset.contractAddress) : null;
    if (!key) throw new Error("Registry ERC-20 asset requires a contract address.");
    expectations.set(asset.id, {
      id: asset.id, key, kind: asset.kind, name: asset.name, symbol: asset.symbol, decimals: asset.decimals,
      contractAddress: parseAddress(asset.contractAddress),
      cashCurrency: asset.cashCurrency,
    });
  }
  for (const vault of portfolioVaults) {
    expectations.set(vault.id, {
      id: vault.id, key: erc20AssetKey(vault.address), kind: "vault-share", name: vault.name,
      symbol: vault.symbol, decimals: vault.decimals, contractAddress: parseAddress(vault.address), cashCurrency: null,
    });
  }
  registryExpectations = expectations;
  return expectations;
}

function validValue(value: HoldingValue, balance: HoldingBalance): boolean {
  return balance.status === "unavailable" ? value.status === "unavailable" : value.status !== "unavailable";
}
function validCashValue(value: HoldingCashValue, balance: HoldingBalance, currency: FiatCurrencyCode): boolean {
  return balance.status === "unavailable" ? value.status === "unavailable" :
    value.status === "priced" ? value.currency === currency : value.status === "unpriced";
}
function validUnitValue(unit: z.output<typeof unitValueSchema> | undefined, value: HoldingValue, kind: string): boolean {
  return unit === undefined || (kind !== "vault-share" && value.status === "priced" &&
    unit.currency === value.currency && unit.amount.atoms !== "0");
}

export function parseBalancesSnapshot(
  value: unknown, session: BalancesSession, expectedRegion: RegionId,
): BalancesSnapshot {
  const expectedCurrency = presentationRegions[expectedRegion].currency.code;
  const sessionAddress = parseAddress(session.smartAccountAddress);
  const contextualSchema = balancesSnapshotSchema
    .check(z.refine((snapshot) => snapshot.owner.address === sessionAddress && sessionAddress !== null &&
      session.chainId === BALANCES_CHAIN_ID && snapshot.region === expectedRegion &&
      snapshot.quoteCurrency === expectedCurrency, "owner or region"))
    .check(z.refine((snapshot) => {
      const validTotal = (total: BalancesTotal) => total.currency === expectedCurrency &&
        (expectedCurrency === null ? total.status === "no-quote-currency" : total.status !== "no-quote-currency");
      if (!validTotal(snapshot.total) || ![
        snapshot.totals.cash, snapshot.totals.investments, snapshot.totals.borrow, snapshot.totals.net,
      ].every(validTotal)) return false;
      const validPriced = (value: HoldingValue) => value.status === "priced"
        ? expectedCurrency !== null && value.currency === expectedCurrency
        : value.status === "unpriced"
          ? (expectedCurrency === null) === (value.reason === "no-quote-currency")
          : true;
      return snapshot.holdings.every((h) => validPriced(h.value) &&
        (h.unitValue === undefined || (h.value.status === "priced" && h.unitValue.currency === h.value.currency))) &&
        snapshot.borrow.positions.every((p) => validPriced(p.collateral.value) && validPriced(p.debt.value));
    }, "valuation currency"));
  const result = contextualSchema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    const detail = issue && issue.path.length > 0 ? issue.path.join(".") : issue?.message ?? "schema";
    throw new BalancesResponseError(`The balances response is invalid (${detail}).`);
  }
  return result.data;
}

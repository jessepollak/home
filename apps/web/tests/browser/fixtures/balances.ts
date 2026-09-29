import { portfolioVaults } from "../../../config/portfolio-assets";
import { presentationRegions, type FiatCurrencyCode, type RegionId } from "../../../config/regions";
import {
  buildBalancesSnapshotFixture,
  catalogHolding,
  decimal,
  FIXTURE_PRICE_AS_OF,
  priced,
  pricedCash,
  ready,
  type HoldingOverride,
} from "../../../shared/balances/fixtures";
import type { BalancesSnapshot, Holding } from "../../../shared/balances/types";

export const SMOKE_OWNER = "0x1111111111111111111111111111111111111111" as const;
export const RECOGNIZED_IMAGE_URL = "https://images.example.test/recognized.svg";
export const CBBTC_IMAGE_URL = "https://images.example.test/cbbtc.svg";

const recognizedEntry = {
  address: "0x9999999999999999999999999999999999999999",
  name: "Recognized Coin",
  symbol: "RCG",
  decimals: 18,
  imageUrl: RECOGNIZED_IMAGE_URL,
} as const;

const dustEntry = {
  address: "0x7777777777777777777777777777777777777777",
  name: "Dust Coin",
  symbol: "DUST",
  decimals: 18,
} as const;

function quoteCurrency(region: RegionId): FiatCurrencyCode | null {
  return presentationRegions[region].currency.code as FiatCurrencyCode | null;
}

function quotedValue(region: RegionId, atoms: string): Holding["value"] {
  const currency = quoteCurrency(region);
  return currency
    ? priced(currency, atoms)
    : { status: "unpriced", reason: "no-quote-currency" };
}

export function recognizedCatalogHolding(region: RegionId): Holding {
  return catalogHolding(recognizedEntry, "1230000000000000000", quotedValue(region, "1820"));
}

export function dustCatalogHolding(region: RegionId): Holding {
  const currency = quoteCurrency(region);
  return catalogHolding(
    dustEntry,
    "1000000000000000",
    currency ? priced(currency, "9", 3) : { status: "unpriced", reason: "no-quote-currency" },
  );
}

function stockRegistry(currency: FiatCurrencyCode | null): Record<string, HoldingOverride> {
  const lastClose: Holding["value"] = currency
    ? { status: "priced", currency, amount: decimal("9012", 2), asOf: FIXTURE_PRICE_AS_OF, reference: { kind: "tokenized-equity", session: "closed" } }
    : { status: "unpriced", reason: "no-quote-currency" };
  return {
    nvdac: { balance: ready("50000000"), value: lastClose },
    metac: { balance: ready("20000000"), value: { status: "unpriced", reason: "price-paused" } },
    aaplc: { balance: ready("30000000"), value: { status: "unpriced", reason: "price-stale" } },
    tslac: { balance: ready("10000000"), value: { status: "unpriced", reason: "price-unavailable" } },
  };
}

export function balancesSnapshot(region: RegionId = "US", options: { stocks?: boolean } = {}): BalancesSnapshot {
  const currency = quoteCurrency(region);
  const snapshot = buildBalancesSnapshotFixture({
    region,
    owner: SMOKE_OWNER,
    registry: {
      ...(options.stocks ? stockRegistry(currency) : {}),
      usdc: {
        balance: ready("12340000"),
        value: quotedValue(region, "1234"),
        cashValue: pricedCash("USD", "1234"),
      },
      cbbtc: {
        balance: ready("100000"),
        value: quotedValue(region, "6000"),
      },
      [portfolioVaults[0].id]: {
        balance: ready("1000000000000000000"),
        underlyingBalance: ready("1000000"),
        value: quotedValue(region, "100"),
      },
    },
    catalog: [recognizedCatalogHolding(region), dustCatalogHolding(region)],
    total: currency
      ? { status: options.stocks ? "partial" : "complete", value: decimal(options.stocks ? "18066" : "9054", 2), currency }
      : { status: "no-quote-currency", value: null, currency: null },
  });
  return {
    ...snapshot,
    holdings: snapshot.holdings.map((holding) => holding.id === "cbbtc"
      ? { ...holding, imageUrl: CBBTC_IMAGE_URL, ...(currency ? { unitValue: { currency, amount: decimal("60000", 0) } } : {}) }
      : holding),
  };
}

export function scrollableBalancesSnapshot(region: RegionId = "US"): BalancesSnapshot {
  const base = balancesSnapshot(region);
  const extras = Array.from({ length: 24 }, (_, index) =>
    catalogHolding(
      {
        address: `0x${(index + 1).toString(16).padStart(40, "0")}`,
        name: `Extra holding ${index + 1}`,
        symbol: `X${index + 1}`,
        decimals: 18,
      },
      "1",
      { status: "unpriced", reason: "price-unavailable" },
    ));
  return { ...base, holdings: [...base.holdings, ...extras] };
}

export function manyOwnedInvestmentsSnapshot(): BalancesSnapshot {
  const base = balancesSnapshot();
  const extras = Array.from({ length: 48 }, (_, index) =>
    catalogHolding(
      {
        address: `0x${(4096 + index).toString(16).padStart(40, "0")}`,
        name: `Extra investment ${String(index + 1).padStart(2, "0")}`,
        symbol: `X${index + 1}`,
        decimals: 18,
      },
      "1000000000000000000",
      priced("USD", "1"),
    ));
  const increaseValue = (amount: BalancesSnapshot["total"]) => amount.value
    ? { ...amount.value, atoms: (BigInt(amount.value.atoms) + BigInt(48)).toString() }
    : null;
  return {
    ...base,
    holdings: [...base.holdings, ...extras],
    total: { ...base.total, value: increaseValue(base.total) },
    totals: {
      ...base.totals,
      investments: { ...base.totals.investments, value: increaseValue(base.totals.investments) },
      net: { ...base.totals.net, value: increaseValue(base.totals.net) },
    },
  };
}

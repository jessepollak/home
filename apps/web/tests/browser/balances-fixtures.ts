import { portfolioVaults } from "../../config/portfolio-assets";
import { presentationRegions, type FiatCurrencyCode, type RegionId } from "../../config/regions";
import {
  buildBalancesSnapshotFixture,
  catalogHolding,
  decimal,
  priced,
  pricedCash,
  ready,
  unavailableBalance,
} from "../../shared/balances/fixtures";
import type { BalancesSnapshot, Holding } from "../../shared/balances/types";

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
  return catalogHolding(
    recognizedEntry,
    "1230000000000000000",
    quotedValue(region, "1820"),
  );
}

export function dustCatalogHolding(region: RegionId): Holding {
  const currency = quoteCurrency(region);
  return catalogHolding(
    dustEntry,
    "1000000000000000",
    currency
      ? priced(currency, "9", 3)
      : { status: "unpriced", reason: "no-quote-currency" },
  );
}

/**
 * The browser fixture mirrors shared/balances/fixtures.ts: the builder supplies
 * every configured direct asset and all three vault shares, while these
 * overrides provide the positive holdings exercised by the smoke suite.
 */
export function balancesSnapshot(region: RegionId = "US"): BalancesSnapshot {
  const currency = quoteCurrency(region);
  const snapshot = buildBalancesSnapshotFixture({
    region,
    owner: SMOKE_OWNER,
    registry: {
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
      ? { status: "complete", value: decimal("9054", 2), currency }
      : { status: "no-quote-currency", value: null, currency: null },
  });
  return {
    ...snapshot,
    holdings: snapshot.holdings.map((holding) => holding.id === "cbbtc"
      ? { ...holding, imageUrl: CBBTC_IMAGE_URL }
      : holding),
  };
}

export function rowAnatomySnapshot(region: RegionId = "US"): BalancesSnapshot {
  const currency = quoteCurrency(region);
  if (!currency) throw new Error("The row-anatomy fixture needs a quote currency.");
  return buildBalancesSnapshotFixture({
    region,
    owner: SMOKE_OWNER,
    registry: {
      usdc: {
        balance: unavailableBalance,
        value: { status: "unavailable" },
        cashValue: { status: "unavailable" },
      },
      toshi: {
        balance: ready("2500000000000000000"),
        value: { status: "unpriced", reason: "price-unavailable" },
      },
      eth: {
        balance: unavailableBalance,
        value: { status: "unavailable" },
      },
      [portfolioVaults[0].id]: {
        balance: ready("1000000000000000000"),
        underlyingBalance: ready("1000000"),
        value: priced(currency, "100"),
      },
    },
    catalog: [recognizedCatalogHolding(region)],
    coverage: { registry: "partial", catalog: "complete" },
    total: { status: "partial", value: decimal("1920", 2), currency },
  });
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

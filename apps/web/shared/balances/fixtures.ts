
import { PORTFOLIO_USDC_ASSET_KEY } from "@/config/portfolio-assets";
import { presentationRegions, type FiatCurrencyCode, type RegionId } from "@/config/regions";
import { expectedRegistryHoldings } from "./contract";
import {
  BALANCES_CHAIN_ID,
  BALANCES_VERSION,
  catalogHoldingId,
  erc20AssetKey,
  walletHoldingId,
  type BalancesSnapshot,
  type ExactDecimal,
  type Holding,
  type HoldingBalance,
  type HoldingCashValue,
  type HoldingValue,
} from "./types";

export const FIXTURE_OWNER_ADDRESS = "0x1111111111111111111111111111111111111111" as const;
export const FIXTURE_BLOCK = {
  number: "35123456",
  hash: "0x9c4a9d8b1f6e2c3d4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f",
  timestamp: "1788811200",
} as const;
export const FIXTURE_FETCHED_AT = "2026-09-13T12:00:00.000Z";
export const FIXTURE_PRICE_AS_OF = "2026-09-13T11:59:30.000Z";

export const FIXTURE_CATALOG = {
  priced: {
    address: "0x940181a94a35a4569e4529a3cdfb74e38fd98631",
    name: "Aerodrome",
    symbol: "AERO",
    decimals: 18,
    imageUrl: "https://assets.example.invalid/aero.png",
  },
  belowGate: {
    address: "0x2222222222222222222222222222222222222222",
    name: "Thin Market Token",
    symbol: "THIN",
    decimals: 18,
  },
  priceMissing: {
    address: "0x3333333333333333333333333333333333333333",
    name: "Quiet Token",
    symbol: "QUIET",
    decimals: 6,
    imageUrl: "https://assets.example.invalid/quiet.png",
  },
} as const;

export const FIXTURE_WALLET_TOKEN = {
  address: "0x5555555555555555555555555555555555555555",
  name: "Discovered Token",
  symbol: "DISC",
  decimals: 18,
  imageUrl: "https://assets.example.invalid/disc.png",
} as const;

export type HoldingOverride = Partial<
  Pick<Holding, "balance" | "value" | "cashValue" | "underlyingBalance">
>;

export type BalancesFixtureOptions = {
  region?: RegionId;
  owner?: `0x${string}`;
  registry?: Record<string, HoldingOverride>;
  catalog?: Holding[];
  coverage?: Partial<BalancesSnapshot["coverage"]>;
  total?: Partial<BalancesSnapshot["total"]>;
  fetchedAt?: string;
};

export function decimal(atoms: string, scale: number): ExactDecimal {
  return { atoms, scale };
}

export function ready(baseUnits: string): HoldingBalance {
  return { status: "ready", baseUnits };
}

export const unavailableBalance: HoldingBalance = { status: "unavailable", baseUnits: null };

export function priced(currency: FiatCurrencyCode, atoms: string, scale = 2): HoldingValue {
  return { status: "priced", currency, amount: decimal(atoms, scale), asOf: FIXTURE_PRICE_AS_OF };
}

export function pricedCash(currency: FiatCurrencyCode, atoms: string, scale = 2): HoldingCashValue {
  return { status: "priced", currency, amount: decimal(atoms, scale) };
}

export type CatalogFixtureEntry = {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  imageUrl?: string;
};

export function catalogHolding(
  entry: CatalogFixtureEntry,
  balance: string,
  value: HoldingValue,
): Holding {
  return discoveredHolding("catalog", entry, balance, value);
}

export function walletHolding(
  entry: CatalogFixtureEntry,
  balance: string,
  value: HoldingValue,
): Holding {
  return discoveredHolding("wallet", entry, balance, value);
}

function discoveredHolding(
  source: "catalog" | "wallet",
  entry: CatalogFixtureEntry,
  balance: string,
  value: HoldingValue,
): Holding {
  return {
    key: erc20AssetKey(entry.address),
    id: source === "catalog" ? catalogHoldingId(entry.address) : walletHoldingId(entry.address),
    kind: "erc20",
    source,
    name: entry.name,
    symbol: entry.symbol,
    decimals: entry.decimals,
    contractAddress: entry.address as `0x${string}`,
    cashCurrency: null,
    ...(entry.imageUrl ? { imageUrl: entry.imageUrl } : {}),
    balance: ready(balance),
    value,
  };
}

export function buildBalancesSnapshotFixture(options: BalancesFixtureOptions = {}): BalancesSnapshot {
  const region = options.region ?? "US";
  const quoteCurrency = presentationRegions[region].currency.code as FiatCurrencyCode | null;
  const owner = options.owner ?? FIXTURE_OWNER_ADDRESS;

  const registryHoldings: Holding[] = [...expectedRegistryHoldings().values()].map((expected) => {
    const override = options.registry?.[expected.id] ?? {};
    const balance = override.balance ?? ready("0");
    const value: HoldingValue =
      override.value ??
      (balance.status === "unavailable"
        ? { status: "unavailable" }
        : quoteCurrency === null
          ? { status: "unpriced", reason: "no-quote-currency" }
          : priced(quoteCurrency, "0"));
    const holding: Holding = {
      key: expected.key as Holding["key"],
      id: expected.id,
      kind: expected.kind,
      source: "registry",
      name: expected.name,
      symbol: expected.symbol,
      decimals: expected.decimals,
      contractAddress: expected.contractAddress as Holding["contractAddress"],
      cashCurrency: expected.cashCurrency,
      balance,
      value,
    };
    if (expected.kind === "vault-share") {
      holding.underlying = { key: PORTFOLIO_USDC_ASSET_KEY, symbol: "USDC", decimals: 6 };
      holding.underlyingBalance =
        override.underlyingBalance ??
        (balance.status === "unavailable" ? unavailableBalance : ready("0"));
    }
    if (expected.cashCurrency) {
      holding.cashValue =
        override.cashValue ??
        (balance.status === "unavailable"
          ? { status: "unavailable" }
          : pricedCash(expected.cashCurrency, "0"));
    }
    return holding;
  });

  const holdings = [...registryHoldings, ...(options.catalog ?? [])];
  const registryUnavailable = registryHoldings.some((holding) => holding.balance.status === "unavailable");
  const coverage: BalancesSnapshot["coverage"] = {
    registry: registryUnavailable ? "partial" : "complete",
    catalog: "complete",
    ...options.coverage,
  };
  const total: BalancesSnapshot["total"] =
    quoteCurrency === null
      ? { status: "no-quote-currency", value: null, currency: null, ...options.total }
      : {
          status: registryUnavailable ? "partial" : "complete",
          value: decimal("0", 2),
          currency: quoteCurrency,
          ...options.total,
        };

  return {
    version: BALANCES_VERSION,
    owner: { address: owner, chainId: BALANCES_CHAIN_ID },
    region,
    quoteCurrency,
    block: { ...FIXTURE_BLOCK },
    fetchedAt: options.fetchedAt ?? FIXTURE_FETCHED_AT,
    holdings,
    coverage,
    total,
  };
}

export const balancesSnapshotFixture: BalancesSnapshot = buildBalancesSnapshotFixture({
  region: "US",
  registry: {
    usdc: {
      balance: ready("1234560000"),
      value: priced("USD", "123456"),
      cashValue: pricedCash("USD", "123456"),
    },
    eth: {
      balance: ready("500000000000000000"),
      value: priced("USD", "160000"),
    },
    cbbtc: {
      balance: ready("100000"),
      value: { status: "unpriced", reason: "price-unavailable" },
    },
    toshi: {
      balance: unavailableBalance,
      value: { status: "unavailable" },
    },
    "morpho-steakhouse-usdc": {
      balance: ready("1000000000000000000"),
      underlyingBalance: ready("1000123"),
      value: priced("USD", "100012"),
    },
  },
  catalog: [
    catalogHolding(FIXTURE_CATALOG.priced, "12500000000000000000", priced("USD", "1820")),
    catalogHolding(FIXTURE_CATALOG.belowGate, "4200000000000000000000", {
      status: "unpriced",
      reason: "below-market-gate",
    }),
    catalogHolding(FIXTURE_CATALOG.priceMissing, "75000000", {
      status: "unpriced",
      reason: "price-unavailable",
    }),
  ],
  coverage: { registry: "partial", catalog: "complete" },
  total: { status: "partial", value: decimal("385288", 2), currency: "USD" },
});

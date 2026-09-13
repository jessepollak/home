import type {
  FiatCurrencyCode,
  RegionId,
} from "@/config/regions";
import type {
  PortfolioAddress,
  PortfolioAssetKey,
} from "@/config/portfolio-assets";

export type ExactDecimal = {
  atoms: string;
  scale: number;
};

export type ValuationSource = {
  provider: "Base JSON-RPC" | "Codex" | "Coinbase Exchange Rates";
  method: string;
  fetchedAt: string;
  asOf: string | null;
  timeBasis: "block" | "provider-as-of" | "retrieved-at";
};

export type DirectPortfolioHolding = {
  kind: "direct";
  id: string;
  assetKey: PortfolioAssetKey;
  name: string;
  symbol: string;
  decimals: number;
  assetKind: "native" | "erc20";
  contractAddress: PortfolioAddress | null;
  cashCurrency: FiatCurrencyCode | null;
  balanceBaseUnits: string | null;
  readStatus: "ready" | "incomplete" | "unavailable";
};

export type VaultPortfolioHolding = {
  kind: "vault-position";
  id: string;
  assetKey: `eip155:8453/erc20:${string}`;
  name: string;
  symbol: string;
  vaultAddress: PortfolioAddress;
  decimals: number;
  underlyingAssetKey: `eip155:8453/erc20:${string}`;
  underlyingSymbol: "USDC";
  underlyingDecimals: 6;
  sharesBaseUnits: string | null;
  underlyingBaseUnits: string | null;
  readStatus: "ready" | "vault-failure";
  conversionMethod: "erc4626-convertToAssets";
};

export type PortfolioInventorySnapshot = {
  walletAddress: PortfolioAddress;
  chainId: 8453;
  block: {
    number: string;
    hash: `0x${string}`;
    timestamp: string;
  };
  fetchedAt: string;
  holdings: Array<DirectPortfolioHolding | VaultPortfolioHolding>;
};

export type PriceQuote = {
  assetKey: `eip155:8453/erc20:${string}`;
  contractAddress: PortfolioAddress;
  quoteCurrency: "USD";
  unitPrice: ExactDecimal | null;
  sourceValue: string | null;
  status: "fresh" | "missing" | "stale" | "invalid" | "unavailable";
  source: ValuationSource;
};

export type FxQuote = {
  baseCurrency: "USD";
  quoteCurrency: FiatCurrencyCode;
  quoteUnitsPerUsd: ExactDecimal | null;
  sourceValue: string | null;
  status: "fresh" | "missing" | "invalid" | "unavailable";
  source: ValuationSource;
};

export type NativeEthQuote = {
  baseCurrency: "USD";
  assetSymbol: "ETH";
  assetUnitsPerUsd: ExactDecimal | null;
  sourceValue: string | null;
  status: "fresh" | "missing" | "invalid" | "unavailable";
  source: ValuationSource;
};

export type ValuationLine = {
  holdingAssetKey: PortfolioAssetKey;
  valueCurrency: FiatCurrencyCode;
  value: ExactDecimal | null;
  status:
    | "priced"
    | "unpriced"
    | "read-incomplete"
    | "read-unavailable"
    | "vault-failure";
  reason: string | null;
};

export type NativeCashValuation = {
  holdingAssetKey: `eip155:8453/erc20:${string}`;
  denominationCurrency: FiatCurrencyCode;
  value: ExactDecimal | null;
  status: "priced" | "unpriced" | "read-incomplete" | "read-unavailable";
  reason:
    | "holding-read-incomplete"
    | "holding-read-unavailable"
    | "exact-contract-price-unavailable"
    | "denomination-fx-unavailable"
    | null;
  exactContractUsdPrice: PriceQuote | null;
  denominationFx: FxQuote | null;
};

export type CashBucket = {
  id: string;
  roles: Array<"canonical-usd" | "selected-local">;
  assetKey: `eip155:8453/erc20:${string}` | null;
  symbol: string;
  denominationCurrency: FiatCurrencyCode;
  tokenAmountBaseUnits: string | null;
  tokenDecimals: number | null;
  indicativeValue: ExactDecimal | null;
  valuationStatus:
    | "priced"
    | "unpriced"
    | "read-incomplete"
    | "read-unavailable"
    | "unsupported";
};

export type RecognizedPortfolioHolding = {
  id: `recognized:${string}`;
  assetKey: `eip155:8453/erc20:${string}`;
  name: string;
  symbol: string;
  decimals: number;
  contractAddress: PortfolioAddress;
  imageUrl?: string;
  balanceBaseUnits: string;
  liquidityUsd: ExactDecimal;
  volume24Usd: ExactDecimal;
  valueCurrency: FiatCurrencyCode | null;
  value: ExactDecimal | null;
  valuationStatus: "priced" | "unpriced";
};

export type RecognizedPortfolioSection = {
  status: "complete" | "incomplete";
  holdings: RecognizedPortfolioHolding[];
};

export type PortfolioValuationSnapshot = {
  version: 2;
  walletAddress: PortfolioAddress;
  chainId: 8453;
  selectedRegion: RegionId;
  quoteCurrency: FiatCurrencyCode | null;
  block: PortfolioInventorySnapshot["block"];
  fetchedAt: string;
  inventory: {
    scope: "configured-base-assets-v1";
    walletDiscoveryComplete: false;
    holdings: Array<DirectPortfolioHolding | VaultPortfolioHolding>;
    omissions: Array<{
      code: string;
      assetOrScope: string;
      reason: string;
    }>;
  };
  prices: PriceQuote[];
  fx: FxQuote | null;
  nativeEthQuote: NativeEthQuote;
  lines: ValuationLine[];
  /** Optional bounded Codex catalog discovery. Never persisted client-side. */
  recognized?: RecognizedPortfolioSection;
  /** Additive v2 extension. Legacy v2 snapshots may omit it. */
  nativeCashValuations?: NativeCashValuation[];
  cashBuckets: CashBucket[];
  total: {
    label: "supported-portfolio-value";
    status:
      | "all-supported-read-holdings-priced"
      | "partial"
      | "unavailable-no-quote-currency"
      | "unavailable";
    value: ExactDecimal | null;
    currency: FiatCurrencyCode | null;
    unpricedAssetKeys: PortfolioAssetKey[];
    unavailableAssetKeys: PortfolioAssetKey[];
  };
};

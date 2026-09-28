export const BASE_CHAIN_ID = 8453 as const;

export type InvestAssetCategory = "stock" | "crypto" | "meme";
export type InvestAssetAvailability = "restricted" | "informational";
export const TOKENIZED_EQUITY_ORACLE_REGISTRY = "0x3f3E8cf41cdd3b1D118c16471aB0113DfDDd5CaD" as const;
export type StockValuation = {
  kind: "tokenized-equity-feed";
  feedProxy: `0x${string}`;
  feedDecimals: 8;
  heartbeatSeconds: number;
};

export type AssetRepresentation = {
  tokenSymbol: string;
  decimals?: number;
  issuer?: string;
  relationship: string;
};

export type InvestAsset = {
  id: string;
  category: InvestAssetCategory;
  listing?: "listed" | "removed";
  displayName: string;
  displaySymbol: string;
  initials: string;
  chainId: typeof BASE_CHAIN_ID;
  contractAddress: `0x${string}`;
  availability: InvestAssetAvailability;
  descriptor: string;
  representation: AssetRepresentation;
  valuation?: StockValuation;
  projectUrl?: string;
  contractUrl: string;
  /** Resolved metadata image. Never a shipped SVG mark. */
  imageUrl?: string;
};

type ConfiguredInvestAsset = InvestAsset & {
  listing: "listed" | "removed";
  representation: AssetRepresentation & { decimals: number };
};

export const stockAssets = [
  {
    id: "nvdac",
    category: "stock",
    listing: "listed",
    displayName: "NVIDIA",
    displaySymbol: "NVDA",
    initials: "NV",
    chainId: BASE_CHAIN_ID,
    contractAddress: "0xb20000000000000000000078ee7ce2fE4908108C",
    availability: "restricted",
    descriptor: "Coinbase Tokenized Stock · Regulation S",
    representation: {
      tokenSymbol: "NVDAc",
      decimals: 8,
      issuer: "Coinbase",
      relationship:
        "Tokenized stock representation; corporate actions can change its relationship to a share.",
    },
    valuation: { kind: "tokenized-equity-feed", feedProxy: "0x04689a41629776563E6822F76f2e57D148d28513", feedDecimals: 8, heartbeatSeconds: 86400 },
    contractUrl:
      "https://basescan.org/token/0xb20000000000000000000078ee7ce2fE4908108C",
  },
  {
    id: "metac",
    category: "stock",
    listing: "listed",
    displayName: "Meta",
    displaySymbol: "META",
    initials: "ME",
    chainId: BASE_CHAIN_ID,
    contractAddress: "0xb2000000000000000000008bC8786B856E61707C",
    availability: "restricted",
    descriptor: "Coinbase Tokenized Stock · Regulation S",
    representation: {
      tokenSymbol: "METAc",
      decimals: 8,
      issuer: "Coinbase",
      relationship:
        "Tokenized stock representation; corporate actions can change its relationship to a share.",
    },
    valuation: { kind: "tokenized-equity-feed", feedProxy: "0x6526aE6797A76123638b863AeE4dD27Ba4E4b27D", feedDecimals: 8, heartbeatSeconds: 86400 },
    contractUrl:
      "https://basescan.org/token/0xb2000000000000000000008bC8786B856E61707C",
  },
  {
    id: "aaplc",
    category: "stock",
    listing: "listed",
    displayName: "Apple",
    displaySymbol: "AAPL",
    initials: "AP",
    chainId: BASE_CHAIN_ID,
    contractAddress: "0xb200000000000000000000C2e324d24d7eEcd1fb",
    availability: "restricted",
    descriptor: "Coinbase Tokenized Stock · Regulation S",
    representation: {
      tokenSymbol: "AAPLc",
      decimals: 8,
      issuer: "Coinbase",
      relationship:
        "Tokenized stock representation; corporate actions can change its relationship to a share.",
    },
    valuation: { kind: "tokenized-equity-feed", feedProxy: "0x787f13dEa48Db0897CbCDD985de77809D837F988", feedDecimals: 8, heartbeatSeconds: 86400 },
    contractUrl:
      "https://basescan.org/token/0xb200000000000000000000C2e324d24d7eEcd1fb",
  },
  {
    id: "googlc",
    category: "stock",
    listing: "listed",
    displayName: "Alphabet",
    displaySymbol: "GOOGL",
    initials: "GO",
    chainId: BASE_CHAIN_ID,
    contractAddress: "0xb2000000000000000000002D0BA3164cc74f58B7",
    availability: "restricted",
    descriptor: "Coinbase Tokenized Stock · Regulation S",
    representation: {
      tokenSymbol: "GOOGLc",
      decimals: 8,
      issuer: "Coinbase",
      relationship:
        "Tokenized stock representation; corporate actions can change its relationship to a share.",
    },
    valuation: { kind: "tokenized-equity-feed", feedProxy: "0x5bF49E0ffA937CE2FfF033c739aD7C634c4D34F2", feedDecimals: 8, heartbeatSeconds: 86400 },
    contractUrl:
      "https://basescan.org/token/0xb2000000000000000000002D0BA3164cc74f58B7",
  },
  {
    id: "amznc",
    category: "stock",
    listing: "listed",
    displayName: "Amazon",
    displaySymbol: "AMZN",
    initials: "AM",
    chainId: BASE_CHAIN_ID,
    contractAddress: "0xb200000000000000000000d9192b6B456483C2E8",
    availability: "restricted",
    descriptor: "Coinbase Tokenized Stock · Regulation S",
    representation: {
      tokenSymbol: "AMZNc",
      decimals: 8,
      issuer: "Coinbase",
      relationship:
        "Tokenized stock representation; corporate actions can change its relationship to a share.",
    },
    valuation: { kind: "tokenized-equity-feed", feedProxy: "0x06A8E4b3aBB3B7543d8396FB2B763d22820cB295", feedDecimals: 8, heartbeatSeconds: 86400 },
    contractUrl:
      "https://basescan.org/token/0xb200000000000000000000d9192b6B456483C2E8",
  },
  {
    id: "msftc",
    category: "stock",
    listing: "listed",
    displayName: "Microsoft",
    displaySymbol: "MSFT",
    initials: "MS",
    chainId: BASE_CHAIN_ID,
    contractAddress: "0xB200000000000000000000Ab99cFa739E253872B",
    availability: "restricted",
    descriptor: "Coinbase Tokenized Stock · Regulation S",
    representation: {
      tokenSymbol: "MSFTc",
      decimals: 8,
      issuer: "Coinbase",
      relationship:
        "Tokenized stock representation; corporate actions can change its relationship to a share.",
    },
    valuation: { kind: "tokenized-equity-feed", feedProxy: "0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c", feedDecimals: 8, heartbeatSeconds: 86400 },
    contractUrl:
      "https://basescan.org/token/0xB200000000000000000000Ab99cFa739E253872B",
  },
  {
    id: "mstrc",
    category: "stock",
    listing: "listed",
    displayName: "Strategy",
    displaySymbol: "MSTR",
    initials: "ST",
    chainId: BASE_CHAIN_ID,
    contractAddress: "0xb2000000000000000000004884b426556b92883d",
    availability: "restricted",
    descriptor: "Coinbase Tokenized Stock · Regulation S",
    representation: {
      tokenSymbol: "MSTRc",
      decimals: 8,
      issuer: "Coinbase",
      relationship:
        "Tokenized stock representation; corporate actions can change its relationship to a share.",
    },
    valuation: { kind: "tokenized-equity-feed", feedProxy: "0xB3cE282CD188b35DA0E38D8Bc7d58e33173D202a", feedDecimals: 8, heartbeatSeconds: 86400 },
    contractUrl:
      "https://basescan.org/token/0xb2000000000000000000004884b426556b92883d",
  },
  {
    id: "sndkc",
    category: "stock",
    listing: "listed",
    displayName: "SanDisk",
    displaySymbol: "SNDK",
    initials: "SN",
    chainId: BASE_CHAIN_ID,
    contractAddress: "0xb200000000000000000000397293Cb8cda9a10c5",
    availability: "restricted",
    descriptor: "Coinbase Tokenized Stock · Regulation S",
    representation: {
      tokenSymbol: "SNDKc",
      decimals: 8,
      issuer: "Coinbase",
      relationship:
        "Tokenized stock representation; corporate actions can change its relationship to a share.",
    },
    valuation: { kind: "tokenized-equity-feed", feedProxy: "0x388b0dC46C0Fb05A74BeE0994fa5b02c6Fcca2eA", feedDecimals: 8, heartbeatSeconds: 86400 },
    contractUrl:
      "https://basescan.org/token/0xb200000000000000000000397293Cb8cda9a10c5",
  },
  {
    id: "spcxc",
    category: "stock",
    listing: "listed",
    displayName: "SpaceX",
    displaySymbol: "SPCX",
    initials: "SP",
    chainId: BASE_CHAIN_ID,
    contractAddress: "0xb2000000000000000000007b9fcbd005511aCBd5",
    availability: "restricted",
    descriptor: "Coinbase Tokenized Stock · Regulation S",
    representation: {
      tokenSymbol: "SPCXc",
      decimals: 8,
      issuer: "Coinbase",
      relationship:
        "Tokenized stock representation; corporate actions can change its relationship to a share.",
    },
    valuation: { kind: "tokenized-equity-feed", feedProxy: "0x6A634B235903C4ad6376892180d6fF8612e3Fa68", feedDecimals: 8, heartbeatSeconds: 86400 },
    contractUrl:
      "https://basescan.org/token/0xb2000000000000000000007b9fcbd005511aCBd5",
  },
  {
    id: "tslac",
    category: "stock",
    listing: "listed",
    displayName: "Tesla",
    displaySymbol: "TSLA",
    initials: "TS",
    chainId: BASE_CHAIN_ID,
    contractAddress: "0xb2000000000000000000001e800a7f5189430cD0",
    availability: "restricted",
    descriptor: "Coinbase Tokenized Stock · Regulation S",
    representation: {
      tokenSymbol: "TSLAc",
      decimals: 8,
      issuer: "Coinbase",
      relationship:
        "Tokenized stock representation; corporate actions can change its relationship to a share.",
    },
    valuation: { kind: "tokenized-equity-feed", feedProxy: "0xFaf869185383a24F8cb00e27BdA6b63B9905DCb4", feedDecimals: 8, heartbeatSeconds: 86400 },
    contractUrl:
      "https://basescan.org/token/0xb2000000000000000000001e800a7f5189430cD0",
  },
] as const satisfies readonly ConfiguredInvestAsset[];

export const cryptoAssets = [
  {
    id: "cbbtc",
    category: "crypto",
    listing: "listed",
    displayName: "Bitcoin",
    displaySymbol: "BTC",
    initials: "BT",
    chainId: BASE_CHAIN_ID,
    contractAddress: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
    availability: "informational",
    descriptor: "Coinbase Wrapped BTC on Base",
    representation: {
      tokenSymbol: "cbBTC",
      decimals: 8,
      issuer: "Coinbase",
      relationship:
        "Coinbase says cbBTC represents BTC held by Coinbase 1:1; Home does not provide redemption.",
    },
    projectUrl: "https://www.coinbase.com/cbbtc",
    contractUrl:
      "https://basescan.org/token/0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
  },
  {
    id: "cbxrp",
    category: "crypto",
    listing: "listed",
    displayName: "XRP",
    displaySymbol: "XRP",
    initials: "XR",
    chainId: BASE_CHAIN_ID,
    contractAddress: "0xcb585250f852C6c6bf90434AB21A00f02833a4af",
    availability: "informational",
    descriptor: "Coinbase Wrapped XRP on Base",
    representation: {
      tokenSymbol: "cbXRP",
      decimals: 6,
      issuer: "Coinbase",
      relationship:
        "Coinbase says cbXRP represents XRP held by Coinbase 1:1; Home does not provide redemption.",
    },
    projectUrl: "https://www.coinbase.com/cbbtc",
    contractUrl:
      "https://basescan.org/token/0xcb585250f852C6c6bf90434AB21A00f02833a4af",
  },
  {
    id: "cbdoge",
    category: "crypto",
    listing: "listed",
    displayName: "Dogecoin",
    displaySymbol: "DOGE",
    initials: "DO",
    chainId: BASE_CHAIN_ID,
    contractAddress: "0xcbD06E5A2B0C65597161de254AA074E489dEb510",
    availability: "informational",
    descriptor: "Coinbase Wrapped DOGE on Base",
    representation: {
      tokenSymbol: "cbDOGE",
      decimals: 8,
      issuer: "Coinbase",
      relationship:
        "Coinbase says cbDOGE represents DOGE held by Coinbase 1:1; Home does not provide redemption.",
    },
    projectUrl: "https://www.coinbase.com/cbbtc",
    contractUrl:
      "https://basescan.org/token/0xcbD06E5A2B0C65597161de254AA074E489dEb510",
  },
  {
    id: "cbltc",
    category: "crypto",
    listing: "listed",
    displayName: "Litecoin",
    displaySymbol: "LTC",
    initials: "LT",
    chainId: BASE_CHAIN_ID,
    contractAddress: "0xcb17C9Db87B595717C857a08468793f5bAb6445F",
    availability: "informational",
    descriptor: "Coinbase Wrapped LTC on Base",
    representation: {
      tokenSymbol: "cbLTC",
      decimals: 8,
      issuer: "Coinbase",
      relationship:
        "Coinbase says cbLTC represents LTC held by Coinbase 1:1; Home does not provide redemption.",
    },
    projectUrl: "https://www.coinbase.com/cbbtc",
    contractUrl:
      "https://basescan.org/token/0xcb17C9Db87B595717C857a08468793f5bAb6445F",
  },
  {
    id: "cbada",
    category: "crypto",
    listing: "listed",
    displayName: "Cardano",
    displaySymbol: "ADA",
    initials: "AD",
    chainId: BASE_CHAIN_ID,
    contractAddress: "0xcbADA732173e39521CDBE8bf59a6Dc85A9fc7b8c",
    availability: "informational",
    descriptor: "Coinbase Wrapped ADA on Base",
    representation: {
      tokenSymbol: "cbADA",
      decimals: 6,
      issuer: "Coinbase",
      relationship:
        "Coinbase says cbADA represents ADA held by Coinbase 1:1; Home does not provide redemption.",
    },
    projectUrl: "https://www.coinbase.com/cbbtc",
    contractUrl:
      "https://basescan.org/token/0xcbADA732173e39521CDBE8bf59a6Dc85A9fc7b8c",
  },
  {
    id: "cbhype", category: "crypto", listing: "listed", displayName: "Hyperliquid", displaySymbol: "HYPE", initials: "HY",
    chainId: BASE_CHAIN_ID, contractAddress: "0xB200000000000000000000451d033a5000cb479e",
    availability: "informational", descriptor: "Coinbase Wrapped HYPE on Base",
    representation: { tokenSymbol: "cbHYPE", decimals: 18, issuer: "Coinbase", relationship: "Coinbase says cbHYPE represents HYPE held by Coinbase 1:1; Home does not provide redemption." },
    projectUrl: "https://www.coinbase.com/cbbtc",
    contractUrl: "https://basescan.org/token/0xB200000000000000000000451d033a5000cb479e",
  },
  {
    id: "cbzec", category: "crypto", listing: "listed", displayName: "Zcash", displaySymbol: "ZEC", initials: "ZC",
    chainId: BASE_CHAIN_ID, contractAddress: "0xB2000000000000000000008501b13360000cb2EC",
    availability: "informational", descriptor: "Coinbase Wrapped ZEC on Base",
    representation: { tokenSymbol: "cbZEC", decimals: 8, issuer: "Coinbase", relationship: "Coinbase says cbZEC represents ZEC held by Coinbase 1:1; Home does not provide redemption." },
    projectUrl: "https://www.coinbase.com/cbbtc",
    contractUrl: "https://basescan.org/token/0xB2000000000000000000008501b13360000cb2EC",
  },
  {
    id: "cbmega", category: "crypto", listing: "listed", displayName: "MegaETH", displaySymbol: "MEGA", initials: "ME",
    chainId: BASE_CHAIN_ID, contractAddress: "0xcb111E6A2a3bde90856D299d61341ac302167D23",
    availability: "informational", descriptor: "Coinbase Wrapped MEGA on Base",
    representation: { tokenSymbol: "cbMEGA", decimals: 18, issuer: "Coinbase", relationship: "Coinbase says cbMEGA represents MEGA held by Coinbase 1:1; Home does not provide redemption." },
    projectUrl: "https://www.coinbase.com/cbbtc",
    contractUrl: "https://basescan.org/token/0xcb111E6A2a3bde90856D299d61341ac302167D23",
  },
] as const satisfies readonly ConfiguredInvestAsset[];

/**
 * Known meme holdings for portfolio/trading identity.
 * Invest discover does not use this list — Memes is Codex trending.
 */
export const memeAssets = [
  {
    id: "degen",
    category: "meme",
    listing: "listed",
    displayName: "Degen",
    displaySymbol: "DEGEN",
    initials: "DE",
    chainId: BASE_CHAIN_ID,
    contractAddress: "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed",
    availability: "informational",
    descriptor: "Farcaster-born community token",
    representation: {
      tokenSymbol: "DEGEN",
      decimals: 18,
      relationship: "Base ERC-20 token; the display and token symbols are the same.",
    },
    projectUrl: "https://www.degen.tips/",
    contractUrl:
      "https://basescan.org/token/0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed",
  },
  {
    id: "toshi",
    category: "meme",
    listing: "listed",
    displayName: "Toshi",
    displaySymbol: "TOSHI",
    initials: "TO",
    chainId: BASE_CHAIN_ID,
    contractAddress: "0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4",
    availability: "informational",
    descriptor: "Community meme and utility token",
    representation: {
      tokenSymbol: "TOSHI",
      decimals: 18,
      relationship: "Base ERC-20 token; the display and token symbols are the same.",
    },
    projectUrl: "https://www.toshithecat.com/",
    contractUrl:
      "https://basescan.org/token/0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4",
  },
] as const satisfies readonly ConfiguredInvestAsset[];

export const investAssets = [
  ...stockAssets,
  ...cryptoAssets,
  ...memeAssets,
] as const;

export type InvestAssetId = (typeof investAssets)[number]["id"];

export function findInvestAssetByAddress(address: string): InvestAsset | undefined {
  const key = address.toLowerCase();
  return investAssets.find(
    (asset) => asset.contractAddress.toLowerCase() === key,
  );
}

export function initialsFromSymbol(symbol: string): string {
  const letters = symbol.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase();
  return letters || "?";
}

export function trendingTokenId(address: `0x${string}`): string {
  return `base:${address.toLowerCase()}`;
}

export function isDiscoverableAsset(asset: InvestAsset): boolean {
  return asset.listing !== "removed";
}

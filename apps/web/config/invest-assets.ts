export const BASE_CHAIN_ID = 8453 as const;

export type InvestAssetCategory = "stock" | "crypto" | "meme";
export type InvestAssetAvailability = "restricted" | "informational";

export type AssetRepresentation = {
  tokenSymbol: string;
  decimals?: number;
  issuer?: string;
  relationship: string;
};

export type InvestAsset = {
  id: string;
  category: InvestAssetCategory;
  displayName: string;
  displaySymbol: string;
  initials: string;
  chainId: typeof BASE_CHAIN_ID;
  contractAddress: `0x${string}`;
  availability: InvestAssetAvailability;
  descriptor: string;
  representation: AssetRepresentation;
  projectUrl?: string;
  contractUrl: string;
  /** Resolved metadata image. Never a shipped SVG mark. */
  imageUrl?: string;
};

export const stockAssets = [
  {
    id: "nvdac",
    category: "stock",
    displayName: "NVIDIA",
    displaySymbol: "NVDA",
    initials: "NV",
    chainId: BASE_CHAIN_ID,
    contractAddress: "0xb20000000000000000000078ee7ce2fE4908108C",
    availability: "restricted",
    descriptor: "Coinbase Tokenized Stock · Regulation S",
    representation: {
      tokenSymbol: "NVDAc",
      issuer: "Coinbase",
      relationship:
        "Tokenized stock representation; corporate actions can change its relationship to a share.",
    },
    contractUrl:
      "https://basescan.org/token/0xb20000000000000000000078ee7ce2fE4908108C",
  },
  {
    id: "metac",
    category: "stock",
    displayName: "Meta",
    displaySymbol: "META",
    initials: "ME",
    chainId: BASE_CHAIN_ID,
    contractAddress: "0xb2000000000000000000008bC8786B856E61707C",
    availability: "restricted",
    descriptor: "Coinbase Tokenized Stock · Regulation S",
    representation: {
      tokenSymbol: "METAc",
      issuer: "Coinbase",
      relationship:
        "Tokenized stock representation; corporate actions can change its relationship to a share.",
    },
    contractUrl:
      "https://basescan.org/token/0xb2000000000000000000008bC8786B856E61707C",
  },
  {
    id: "aaplc",
    category: "stock",
    displayName: "Apple",
    displaySymbol: "AAPL",
    initials: "AP",
    chainId: BASE_CHAIN_ID,
    contractAddress: "0xb200000000000000000000C2e324d24d7eEcd1fb",
    availability: "restricted",
    descriptor: "Coinbase Tokenized Stock · Regulation S",
    representation: {
      tokenSymbol: "AAPLc",
      issuer: "Coinbase",
      relationship:
        "Tokenized stock representation; corporate actions can change its relationship to a share.",
    },
    contractUrl:
      "https://basescan.org/token/0xb200000000000000000000C2e324d24d7eEcd1fb",
  },
  {
    id: "googlc",
    category: "stock",
    displayName: "Alphabet",
    displaySymbol: "GOOGL",
    initials: "GO",
    chainId: BASE_CHAIN_ID,
    contractAddress: "0xb2000000000000000000002D0BA3164cc74f58B7",
    availability: "restricted",
    descriptor: "Coinbase Tokenized Stock · Regulation S",
    representation: {
      tokenSymbol: "GOOGLc",
      issuer: "Coinbase",
      relationship:
        "Tokenized stock representation; corporate actions can change its relationship to a share.",
    },
    contractUrl:
      "https://basescan.org/token/0xb2000000000000000000002D0BA3164cc74f58B7",
  },
] as const satisfies readonly InvestAsset[];

export const cryptoAssets = [
  {
    id: "cbbtc",
    category: "crypto",
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
    projectUrl: "https://www.coinbase.com/campaigns/cbbtc",
    contractUrl:
      "https://basescan.org/token/0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
  },
  {
    id: "cbxrp",
    category: "crypto",
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
    projectUrl: "https://www.coinbase.com/campaigns/cbbtc",
    contractUrl:
      "https://basescan.org/token/0xcb585250f852C6c6bf90434AB21A00f02833a4af",
  },
  {
    id: "cbdoge",
    category: "crypto",
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
    projectUrl: "https://www.coinbase.com/campaigns/cbbtc",
    contractUrl:
      "https://basescan.org/token/0xcbD06E5A2B0C65597161de254AA074E489dEb510",
  },
  {
    id: "cbltc",
    category: "crypto",
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
    projectUrl: "https://www.coinbase.com/campaigns/cbbtc",
    contractUrl:
      "https://basescan.org/token/0xcb17C9Db87B595717C857a08468793f5bAb6445F",
  },
  {
    id: "cbada",
    category: "crypto",
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
    projectUrl: "https://www.coinbase.com/campaigns/cbbtc",
    contractUrl:
      "https://basescan.org/token/0xcbADA732173e39521CDBE8bf59a6Dc85A9fc7b8c",
  },
] as const satisfies readonly InvestAsset[];

/**
 * Known meme holdings for portfolio/trading identity.
 * Invest discover does not use this list — Memes is Codex trending.
 */
export const memeAssets = [
  {
    id: "degen",
    category: "meme",
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
] as const satisfies readonly InvestAsset[];

export const investAssets = [
  ...stockAssets,
  ...cryptoAssets,
  ...memeAssets,
] as const;

export type InvestAssetId = (typeof investAssets)[number]["id"];

export const investSources = {
  stockRoster: {
    label: "Official Base stock roster",
    url: "https://www.base.org/stocks",
  },
  stockAnnouncement: {
    label: "Base stock announcement",
    url: "https://blog.base.org/tokenized-stocks",
  },
  coinbaseWrappedAssets: {
    label: "Coinbase wrapped asset roster",
    url: "https://www.coinbase.com/campaigns/cbbtc",
  },
} as const;

export function shortenContractAddress(address: `0x${string}`): string {
  return `${address.slice(0, 8)}…${address.slice(-4)}`;
}

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

export const BASE_MAINNET_CHAIN_ID = 8453 as const;

export type HexAddress = `0x${string}`;
export type TransactionHash = `0x${string}`;

export type BaseErc20Asset = {
  id: string;
  chainId: typeof BASE_MAINNET_CHAIN_ID;
  address: HexAddress;
};

export type TransferHistoryCursor = {
  blockNumber: string;
  transactionHash: TransactionHash;
  logIndex: string;
  tokenAddress: HexAddress;
  logId: string;
};

export type BaseErc20Transfer = {
  id: string;
  logId: string;
  chainId: typeof BASE_MAINNET_CHAIN_ID;
  assetId: string | null;
  tokenAddress: HexAddress;
  walletAddress: HexAddress;
  fromAddress: HexAddress;
  toAddress: HexAddress;
  direction: "incoming" | "outgoing" | "self";
  amountBaseUnits: string;
  blockNumber: string;
  blockHash: TransactionHash;
  transactionHash: TransactionHash;
  logIndex: string;
  blockTimestamp: string;
};

export type ChainDataSource = {
  provider: "cdp-sql";
  cached: boolean;
  stale: boolean;
  executionTimestamp: string;
  executionTimeMs: number;
  fetchedAt: string;
};

export type BaseErc20TransferPage = {
  transfers: BaseErc20Transfer[];
  nextCursor: string | null;
  source: ChainDataSource;
};

export type ListBaseErc20TransfersInput = {
  /** Must come from the authenticated session's verified smart account. */
  verifiedWalletAddress: string;
  assetIds: readonly string[];
  /** Include wallet-scoped ERC-20 transfers whose contracts are not in assets. */
  includeUnknownAssets?: boolean;
  from: string;
  to: string;
  limit?: number;
  cursor?: string | null;
  cacheMaxAgeMs?: number;
  staleAfterMs?: number;
  signal?: AbortSignal;
};

export type CdpSqlColumn = {
  name: string;
  type: string;
};

export type CdpSqlMetadata = {
  cached: boolean;
  executionTimestamp: string;
  executionTimeMs: number;
  rowCount: number;
};

/** Normalized after `parseCdpSqlResponseEnvelope`. Live CDP fields are optional. */
export type CdpSqlResponse = {
  result: unknown[];
  schema?: { columns: CdpSqlColumn[] };
  metadata: CdpSqlMetadata;
};

export type CdpSqlRunRequest = {
  sql: string;
  cache?: { maxAgeMs: number };
  signal?: AbortSignal;
};

export interface CdpSqlTransport {
  run(request: CdpSqlRunRequest): Promise<CdpSqlResponse>;
}

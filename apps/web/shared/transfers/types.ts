export type TransferAssetId = string;

export type TransferAsset = {
  id: TransferAssetId;
  assetKey: string;
  name: string;
  symbol: string;
  decimals: number;
  kind: "native" | "erc20";
  contractAddress: `0x${string}` | null;
  cashCurrency: string | null;
};

export type TransferAssetAvailability = TransferAsset & {
  balanceBaseUnits: string;
  balanceLabel: string;
};

export type TransferRequest = {
  assetId: TransferAssetId;
  recipient: `0x${string}`;
  amountBaseUnits: string;
  recipientName?: string;
};

export type TransferFailureReason =
  | "unavailable"
  | "stale-session"
  | "invalid-request"
  | "insufficient-balance"
  | "rejected"
  | "failed"
  | "confirmation-timeout"
  | "submission-pending"
  | "submission-unknown";

export class TransferExecutionError extends Error {
  readonly reason: TransferFailureReason;

  constructor(reason: TransferFailureReason, cause?: unknown) {
    super(reason, { cause });
    this.name = "TransferExecutionError";
    this.reason = reason;
  }
}

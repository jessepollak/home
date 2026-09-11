export type TransferAssetId = "usdc" | "eth";

export type TransferRequest = {
  assetId: TransferAssetId;
  recipient: `0x${string}`;
  amountBaseUnits: string;
};

export type ConfirmedTransfer = TransferRequest & {
  transactionHash: `0x${string}`;
};

export type PendingTransfer = TransferRequest & {
  intentId: string;
  provider: "cdp-embedded" | "base-account";
  state: "submitted" | "unknown";
  transactionHash?: `0x${string}`;
  userOperationHash?: `0x${string}`;
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

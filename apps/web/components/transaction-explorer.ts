export type TransactionExplorerLink = {
  href: string;
  label: string;
  title?: string;
};

export type TransactionDetailRow = {
  label: string;
  value: string;
  title?: string;
};

export type TransactionDetails = {
  title: string;
  rows: TransactionDetailRow[];
  explorer: TransactionExplorerLink | null;
};

const transactionHashPattern = /^0x[0-9a-fA-F]{64}$/;

export function isTransactionHash(value: unknown): value is `0x${string}` {
  return typeof value === "string" && transactionHashPattern.test(value);
}

/**
 * Builds a BaseScan transaction link only for a real 0x-prefixed 64-hex
 * transaction hash. ERC-4337 user-operation hashes and other submission
 * references must not open the Base transaction explorer.
 */
export function transactionExplorerLink(
  transactionHash: unknown,
): TransactionExplorerLink | null {
  if (!isTransactionHash(transactionHash)) return null;
  return {
    href: `https://basescan.org/tx/${transactionHash}`,
    label: "View on BaseScan",
    title: "View the transaction on BaseScan",
  };
}

/** Condenses a validated transaction hash for compact detail display. */
export function condensedTransactionHash(value: string): string {
  if (!isTransactionHash(value)) return value;
  return `${value.slice(0, 10)}…${value.slice(-8)}`;
}

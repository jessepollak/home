import type { StepStatus } from "./ui/status-step";

export type TransactionDetailStep = { status: StepStatus; title: string; time?: string };

export type TransactionExplorerLink = {
  href: string;
  label: string;
  title?: string;
};

export type TransactionStatusTone = "success" | "pending" | "failure" | "neutral";

export type TransactionStatus = { label: string; tone: TransactionStatusTone };

export type TransactionDetailRow =
  | { label: string; value: string; display?: string }
  | { label: string; value: string; network: "base" }
  | { label: string; value: string; statusTone: TransactionStatusTone };

export function baseNetworkRow(): TransactionDetailRow {
  return { label: "Network", value: "Base", network: "base" };
}

export type TransactionAmountHeader = {
  amount: string;
  unit?: string;
  tone: "success" | "default";
  status: TransactionStatus;
};

export type TransactionDetails = {
  title: string;
  header?: TransactionAmountHeader;
  rows: TransactionDetailRow[];
  steps?: TransactionDetailStep[];
  explorer: TransactionExplorerLink | null;
};

const transactionHashPattern = /^0x[0-9a-fA-F]{64}$/;

export function isTransactionHash(value: unknown): value is `0x${string}` {
  return typeof value === "string" && transactionHashPattern.test(value);
}

export function transactionExplorerLink(
  transactionHash: unknown,
): TransactionExplorerLink | null {
  if (!isTransactionHash(transactionHash)) return null;
  return {
    href: `https://basescan.org/tx/${transactionHash}`,
    label: "View on explorer",
    title: "View the transaction on BaseScan",
  };
}

export function condensedTransactionHash(value: string): string {
  if (!isTransactionHash(value)) return value;
  return `${value.slice(0, 10)}…${value.slice(-8)}`;
}

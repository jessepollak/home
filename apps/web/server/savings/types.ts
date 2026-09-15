import "server-only";

import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { MoneyActionCall, MoneyActionDraft } from "@/shared/money-actions/types";
import type { Address } from "@/shared/savings/types";
import type { PinnedBlockSource } from "@/server/chain/coinbase-smart-account";

export type SavingsActionKind = "deposit" | "withdraw";

export type SavingsActionInput = {
  kind: SavingsActionKind;
  vaultAddress: Address;
  amountBaseUnits: string;
};

export type SavingsActionBlock = {
  number: string;
  numberHex: string;
  hash: `0x${string}`;
  timestamp: string;
};

export type SavingsActionState = {
  block: SavingsActionBlock;
  assetAddress: Address;
  shareDecimals: number;
  usdcBalance: bigint;
  sharesBalance: bigint;
  allowance: bigint | null;
  limit: bigint;
  previewShares: bigint;
  fee: bigint;
};

export type SavingsActionStateReader = (
  input: {
    kind: SavingsActionKind;
    accountAddress: Address;
    vaultAddress: Address;
    amount: bigint;
  },
  signal?: AbortSignal,
) => Promise<SavingsActionState>;

export type SavingsActionBatchSimulator = (
  calls: readonly MoneyActionCall[],
  accountAddress: Address,
  source: PinnedBlockSource,
  signal?: AbortSignal,
) => Promise<void>;

export type PrepareSavingsAction = (input: {
  session: VerifiedAccountSession;
  action: SavingsActionInput;
  signal?: AbortSignal;
}) => Promise<MoneyActionDraft>;

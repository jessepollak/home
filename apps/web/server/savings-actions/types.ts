import type { VerifiedAccountSession } from "@/client/account/session-types";
import type { MoneyActionDraft } from "@/client/money-actions/types";
import type { Address } from "@/server/morpho/types";

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

export type PrepareSavingsAction = (input: {
  session: VerifiedAccountSession;
  action: SavingsActionInput;
  signal?: AbortSignal;
}) => Promise<MoneyActionDraft>;

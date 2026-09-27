import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { CashoutProgressState } from "@/shared/funding/contracts/cash-out-progress";

export const ACTIVITY_ORDERS_CONTRACT_VERSION = 1 as const;
export const ACTIVITY_ORDERS_LIMIT = 50;

export type ActivityOrderStatus =
  | "waiting-customer"
  | "waiting-provider"
  | "waiting-chain"
  | "waiting-home"
  | "confirmed"
  | "failed"
  | "expired"
  | "ambiguous"
  | "reversed"
  | "refunded";

export type ActivityFundingOrderStage =
  | "awaiting-payment"
  | "provider-processing"
  | "arriving"
  | "received"
  | "expired"
  | "cancelled"
  | "cleared"
  | "failed"
  | "refunded"
  | "unconfirmed";

export type ActivityFundingInstructionKind = "redirect" | "embed" | "bank-transfer" | "qr" | "payment-key";

export type ActivityFundingOrder = {
  kind: "funding";
  id: string;
  region: string;
  providerId: string;
  providerName: string;
  paymentMethodLabel: string;
  status: ActivityOrderStatus;
  stage: ActivityFundingOrderStage;
  instruction: ActivityFundingInstructionKind | null;
  resumable: boolean;
  fiatAmount: string;
  fiatCurrency: string;
  asset: { id: string; symbol: string; decimals: number };
  tokenAmountAtomic: string | null;
  sandbox: boolean;
  expiresAt: string | null;
  clearableAt: string | null;
  transactionHash: `0x${string}` | null;
  logIndex: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ActivityCashoutOrder = {
  kind: "cash-out";
  id: string;
  orderId: string | null;
  region: string;
  providerId: string;
  providerName: string;
  platform: string;
  platformLabel: string;
  status: ActivityOrderStatus;
  state: CashoutProgressState;
  decimals: number;
  amountAtomic: string;
  filledAtomic: string;
  returnedAtomic: string;
  remainingAtomic: string;
  withdrawable: boolean;
  settledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ActivityOrder = ActivityFundingOrder | ActivityCashoutOrder;

export type ActivityOrdersResponse = {
  version: typeof ACTIVITY_ORDERS_CONTRACT_VERSION;
  owner: { subject: string; accountProvider: VerifiedAccountSession["accountProvider"] };
  orders: ActivityOrder[];
};

export class ActivityOrdersResponseError extends Error {
  constructor() {
    super("The activity orders response is invalid.");
    this.name = "ActivityOrdersResponseError";
  }
}

const statuses: readonly string[] = [
  "waiting-customer", "waiting-provider", "waiting-chain", "waiting-home", "confirmed",
  "failed", "expired", "ambiguous", "reversed", "refunded",
];
const fundingStages: readonly string[] = [
  "awaiting-payment", "provider-processing", "arriving", "received",
  "expired", "cancelled", "cleared", "failed", "refunded", "unconfirmed",
];
const instructionKinds: readonly string[] = ["redirect", "embed", "bank-transfer", "qr", "payment-key"];
const cashoutStates: readonly string[] = [
  "submitted", "awaiting-buyer", "matched", "delivering", "delivered", "returned", "failed", "unknown",
];
const atomicPattern = /^(?:0|[1-9][0-9]*)$/;
const decimalPattern = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
const hashPattern = /^0x[0-9a-fA-F]{64}$/;

export function parseActivityOrders(value: unknown, session: VerifiedAccountSession): ActivityOrder[] {
  if (!isRecord(value) || value.version !== ACTIVITY_ORDERS_CONTRACT_VERSION || !isRecord(value.owner) ||
    !Array.isArray(value.orders)) throw new ActivityOrdersResponseError();
  if (value.owner.subject !== session.user.subject || value.owner.accountProvider !== session.accountProvider) {
    throw new ActivityOrdersResponseError();
  }
  return value.orders.flatMap((item): ActivityOrder[] => {
    const order = readActivityOrder(item);
    return order ? [order] : [];
  });
}

function readActivityOrder(value: unknown): ActivityOrder | null {
  if (!isRecord(value) || !text(value.id) || !text(value.region) || !text(value.providerId) ||
    !text(value.providerName) || !statuses.includes(value.status as string) ||
    !timestamp(value.createdAt) || !timestamp(value.updatedAt)) return null;
  if (value.kind === "funding") {
    const asset = value.asset;
    if (!fundingStages.includes(value.stage as string) ||
      !(value.instruction === null || instructionKinds.includes(value.instruction as string)) ||
      !text(value.paymentMethodLabel) || typeof value.fiatAmount !== "string" || !decimalPattern.test(value.fiatAmount) ||
      !text(value.fiatCurrency) || !isRecord(asset) || !text(asset.id) || !text(asset.symbol) ||
      !Number.isSafeInteger(asset.decimals) || (asset.decimals as number) < 0 ||
      !(value.tokenAmountAtomic === null || atomic(value.tokenAmountAtomic)) || typeof value.sandbox !== "boolean" ||
      typeof value.resumable !== "boolean" ||
      !(value.expiresAt === null || timestamp(value.expiresAt)) ||
      !(value.clearableAt === null || timestamp(value.clearableAt)) ||
      !(value.transactionHash === null || typeof value.transactionHash === "string" && hashPattern.test(value.transactionHash)) ||
      !(value.logIndex === null || atomic(value.logIndex)) ||
      (value.transactionHash === null && value.logIndex !== null)) return null;
    return value as ActivityFundingOrder;
  }
  if (value.kind === "cash-out") {
    if (!(value.orderId === null || text(value.orderId)) || !text(value.platform) || !text(value.platformLabel) ||
      !cashoutStates.includes(value.state as string) || !Number.isSafeInteger(value.decimals) ||
      (value.decimals as number) < 0 || !atomic(value.amountAtomic) || !atomic(value.filledAtomic) ||
      !atomic(value.returnedAtomic) || !atomic(value.remainingAtomic) || typeof value.withdrawable !== "boolean" ||
      !(value.settledAt === null || timestamp(value.settledAt))) return null;
    return value as ActivityCashoutOrder;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
function atomic(value: unknown): value is string {
  return typeof value === "string" && atomicPattern.test(value);
}
function timestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export const CASHOUT_PROGRESS_VERSION = 1 as const;

export type CashoutProgressState =
  | "submitted"
  | "awaiting-buyer"
  | "matched"
  | "delivering"
  | "delivered"
  | "returned"
  | "failed"
  | "unknown";

export type CashoutProgress = {
  version: typeof CASHOUT_PROGRESS_VERSION;
  providerId: string;
  region: string;
  depositId: string | null;
  depositBlockNumber?: string;
  progressConfirmed?: boolean;
  state: CashoutProgressState;
  platform: string;
  platformLabel: string;
  amountAtomic: string;
  filledAtomic: string;
  returnedAtomic: string;
  remainingAtomic: string;
  withdrawable: boolean;
  withdrawing: boolean;
  etaSeconds: number | null;
  settledAt: string | null;
  updatedAt: string;
};

const states: readonly string[] = ["submitted", "awaiting-buyer", "matched", "delivering", "delivered", "returned", "failed", "unknown"];
const digits = (value: unknown): value is string => typeof value === "string" && /^\d+$/.test(value);
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const nonBlank = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

export function readCashoutProgress(value: unknown): CashoutProgress | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (item.version !== CASHOUT_PROGRESS_VERSION || !text(item.providerId) || !text(item.region) ||
    !(item.depositId === null || nonBlank(item.depositId)) || !states.includes(item.state as string) ||
    !text(item.platform) || !text(item.platformLabel) || !digits(item.amountAtomic) ||
    !digits(item.filledAtomic) || !digits(item.returnedAtomic) || !digits(item.remainingAtomic) ||
    typeof item.withdrawable !== "boolean" || typeof item.withdrawing !== "boolean" ||
    !(item.etaSeconds === null || typeof item.etaSeconds === "number" && Number.isSafeInteger(item.etaSeconds) && item.etaSeconds >= 0) ||
    !(item.settledAt === null || text(item.settledAt)) || !text(item.updatedAt) ||
    !(item.depositBlockNumber === undefined || digits(item.depositBlockNumber)) ||
    !(item.progressConfirmed === undefined || typeof item.progressConfirmed === "boolean")) return null;
  return item as CashoutProgress;
}

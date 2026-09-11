import type {
  MoneyActionOperationStatus,
  PreparedMoneyAction,
} from "./types";
import type { StoredMoneyActionOperation } from "@/server/money-actions/store";

export type MoneyActionApiFetch = (path: string, init?: RequestInit) => Promise<unknown>;

export type ClaimedMoneyAction = {
  action: PreparedMoneyAction;
  operation: StoredMoneyActionOperation;
  disposition: "dispatch" | "recover";
};

export async function claimMoneyAction(
  fetchApi: MoneyActionApiFetch,
  action: PreparedMoneyAction,
): Promise<ClaimedMoneyAction> {
  const value = await fetchApi(`/api/actions/${action.id}/claim`, {
    method: "POST",
    body: JSON.stringify({ reviewHash: action.reviewHash }),
  });
  if (
    !isRecord(value) ||
    !isRecord(value.action) ||
    value.action.id !== action.id ||
    value.action.reviewHash !== action.reviewHash ||
    (value.disposition !== "dispatch" && value.disposition !== "recover") ||
    !(await sameReviewedAction(action, value.action))
  ) {
    throw new MoneyActionClientError("invalid-response");
  }
  const canonicalAction = value.action as unknown as PreparedMoneyAction;
  const operation = await parseStoredMoneyActionOperation(value.operation, action.id, canonicalAction);
  return {
    action: canonicalAction,
    operation,
    disposition: value.disposition,
  };
}

export async function recordMoneyActionSubmission(
  fetchApi: MoneyActionApiFetch,
  id: string,
  reference: { submissionId?: string; transactionHash?: `0x${string}`; userOperationHash?: `0x${string}` },
  expectedAction?: PreparedMoneyAction,
): Promise<StoredMoneyActionOperation> {
  const value = await fetchApi(`/api/actions/${id}/submission`, {
    method: "POST",
    body: JSON.stringify(reference),
  });
  if (!isRecord(value)) throw new MoneyActionClientError("invalid-response");
  return parseStoredMoneyActionOperation(value.operation, id, expectedAction);
}

export async function recordMoneyActionStatus(
  fetchApi: MoneyActionApiFetch,
  id: string,
  status: Extract<MoneyActionOperationStatus, "unknown" | "rejected" | "expired" | "failed">,
): Promise<StoredMoneyActionOperation> {
  const value = await fetchApi(`/api/actions/${id}/status`, {
    method: "POST",
    body: JSON.stringify({ status }),
  });
  if (!isRecord(value) || !isRecord(value.operation)) throw new MoneyActionClientError("invalid-response");
  return value.operation as unknown as StoredMoneyActionOperation;
}

export async function releaseMoneyActionAdmission(
  fetchApi: MoneyActionApiFetch,
  id: string,
): Promise<StoredMoneyActionOperation> {
  const value = await fetchApi(`/api/actions/${id}/admission-release`, {
    method: "POST",
    body: JSON.stringify({ reason: "owner-request" }),
  });
  if (!isRecord(value) || !isRecord(value.operation) || !isRecord(value.operation.action) || value.operation.action.id !== id) {
    throw new MoneyActionClientError("invalid-response");
  }
  return value.operation as unknown as StoredMoneyActionOperation;
}

export async function readMoneyAction(
  fetchApi: MoneyActionApiFetch,
  id: string,
  expectedAction?: PreparedMoneyAction,
): Promise<StoredMoneyActionOperation> {
  const value = await fetchApi(`/api/actions/${id}`, { method: "GET" });
  if (!isRecord(value)) throw new MoneyActionClientError("invalid-response");
  return parseStoredMoneyActionOperation(value.operation, id, expectedAction);
}

export class MoneyActionClientError extends Error {
  constructor(readonly reason: "invalid-response" | "stale-session" | "submission-unknown" | "failed") {
    super(reason);
    this.name = "MoneyActionClientError";
  }
}

export async function sameReviewedAction(left: unknown, right: unknown): Promise<boolean> {
  if (!(await hasValidSensitiveCallDigests(left)) || !(await hasValidSensitiveCallDigests(right))) {
    return false;
  }
  return stableStringify(reviewComparison(left)) === stableStringify(reviewComparison(right));
}

async function hasValidSensitiveCallDigests(value: unknown): Promise<boolean> {
  if (!isRecord(value) || value.sensitivePayload !== true) return true;
  if (!Array.isArray(value.calls)) return false;
  for (const call of value.calls) {
    if (!isRecord(call) || typeof call.data !== "string" || typeof call.dataHash !== "string") return false;
    if (call.data === "0x") continue;
    const bytes = new TextEncoder().encode(call.data);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    if (hex !== call.dataHash) return false;
  }
  return true;
}

function reviewComparison(value: unknown): unknown {
  if (!isRecord(value) || value.sensitivePayload !== true || !Array.isArray(value.calls)) return value;
  return {
    ...value,
    calls: value.calls.map((call) => isRecord(call)
      ? { ...call, data: `<sensitive:${String(call.dataHash)}>` }
      : call),
  };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function parseStoredMoneyActionOperation(
  value: unknown,
  id: string,
  expectedAction?: PreparedMoneyAction,
): Promise<StoredMoneyActionOperation> {
  const statuses = new Set<MoneyActionOperationStatus>([
    "prepared", "submitting", "submitted", "included", "confirmed", "rejected", "expired", "failed", "unknown",
  ]);
  if (
    !isRecord(value) ||
    !isRecord(value.action) ||
    value.action.id !== id ||
    typeof value.status !== "string" || !statuses.has(value.status as MoneyActionOperationStatus) ||
    typeof value.attemptCount !== "number" || !Number.isSafeInteger(value.attemptCount) || value.attemptCount < 0 ||
    typeof value.createdAt !== "string" || Number.isNaN(Date.parse(value.createdAt)) ||
    typeof value.updatedAt !== "string" || Number.isNaN(Date.parse(value.updatedAt)) ||
    (value.claimedAt !== undefined && (typeof value.claimedAt !== "string" || Number.isNaN(Date.parse(value.claimedAt)))) ||
    (value.abandonedAt !== undefined && (typeof value.abandonedAt !== "string" || Number.isNaN(Date.parse(value.abandonedAt)))) ||
    (value.submissionId !== undefined && (typeof value.submissionId !== "string" || !/^[\x21-\x7e]{1,512}$/.test(value.submissionId))) ||
    (value.transactionHash !== undefined && (typeof value.transactionHash !== "string" || !/^0x[0-9a-f]{64}$/.test(value.transactionHash))) ||
    (value.userOperationHash !== undefined && (typeof value.userOperationHash !== "string" || !/^0x[0-9a-f]{64}$/.test(value.userOperationHash))) ||
    !(await validPreparedMoneyAction(value.action)) ||
    (expectedAction !== undefined && !(await sameReviewedAction(expectedAction, value.action)))
  ) {
    throw new MoneyActionClientError("invalid-response");
  }
  return value as unknown as StoredMoneyActionOperation;
}

async function validPreparedMoneyAction(value: Record<string, unknown>): Promise<boolean> {
  if (
    typeof value.id !== "string" ||
    typeof value.reviewHash !== "string" || !/^[0-9a-f]{64}$/.test(value.reviewHash) ||
    !isRecord(value.owner) ||
    typeof value.owner.subject !== "string" ||
    typeof value.owner.address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value.owner.address) ||
    value.owner.chainId !== 8453 ||
    (value.owner.accountProvider !== "cdp-embedded" && value.owner.accountProvider !== "base-account") ||
    typeof value.kind !== "string" ||
    typeof value.title !== "string" ||
    !Array.isArray(value.calls) ||
    !Array.isArray(value.amounts) ||
    !Array.isArray(value.warnings) ||
    typeof value.createdAt !== "string" || Number.isNaN(Date.parse(value.createdAt)) ||
    typeof value.expiresAt !== "string" || Number.isNaN(Date.parse(value.expiresAt))
  ) return false;
  return hasValidSensitiveCallDigests(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

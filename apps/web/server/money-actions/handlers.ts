import type { MoneyActionOperationStatus } from "@/features/money-actions/types";
import type { MoneyActionExecutionProof, TransferReceiptStatus } from "@/server/transfers/receipt";
import { getMoneyActionStore } from "./runtime-store";
import { moneyActionOwner, readAuthorizedMoneyActionSession } from "./session";
import type { MoneyActionStore, StoredMoneyActionOperation } from "./store";

export type SessionAuthorizer = (request: Request) => Promise<Response>;
export type MoneyActionReceiptReader = (
  transactionHash: `0x${string}`,
  proof?: MoneyActionExecutionProof,
  signal?: AbortSignal,
) => Promise<TransferReceiptStatus>;

const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Vary: "Authorization, X-Home-Account-Provider",
} as const;
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reviewHashPattern = /^[0-9a-f]{64}$/;
const transactionHashPattern = /^0x[0-9a-fA-F]{64}$/;
const submissionIdPattern = /^[\x21-\x7e]{1,512}$/;

export type ValidateBeforeMoneyActionClaim = (input: {
  request: Request;
  owner: StoredMoneyActionOperation["action"]["owner"];
  action: StoredMoneyActionOperation["action"];
  now: string;
}) => Promise<void>;

export function createClaimMoneyActionHandler(dependencies: {
  authorize: SessionAuthorizer;
  store?: MoneyActionStore;
  now?: () => Date;
  validateBeforeClaim?: ValidateBeforeMoneyActionClaim;
}) {
  return async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
    const authorized = await authorizeOwner(request, dependencies.authorize);
    if (authorized instanceof Response) return authorized;
    const { id } = await context.params;
    const body = await readJson(request);
    if (!idPattern.test(id) || !isRecord(body) || typeof body.reviewHash !== "string" || !reviewHashPattern.test(body.reviewHash) || Object.keys(body).some((key) => key !== "reviewHash")) {
      return error("INVALID_ACTION_CLAIM", "A valid action id and review hash are required.", 400);
    }
    const store = dependencies.store ?? await getMoneyActionStore();
    if (dependencies.validateBeforeClaim) {
      const existing = await store.get(authorized, id);
      if (!existing || existing.action.reviewHash !== body.reviewHash) {
        return error("ACTION_NOT_FOUND", "The prepared action was not found for this account.", 404);
      }
      if (existing.status === "prepared") {
        const validationNow = (dependencies.now ?? (() => new Date()))().toISOString();
        try {
          await dependencies.validateBeforeClaim({
            request,
            owner: authorized,
            action: existing.action,
            now: validationNow,
          });
        } catch {
          return error("ACTION_PRECONDITION_FAILED", "The action must be refreshed before it can be claimed.", 409);
        }
      }
    }
    const claimNow = (dependencies.now ?? (() => new Date()))().toISOString();
    const claim = await store.claim(authorized, id, body.reviewHash, claimNow);
    return claim ? json(claim, 200) : error("ACTION_NOT_FOUND", "The prepared action was not found for this account.", 404);
  };
}

export function createMoneyActionSubmissionHandler(dependencies: {
  authorize: SessionAuthorizer;
  readReceipt: MoneyActionReceiptReader;
  store?: MoneyActionStore;
  now?: () => Date;
}) {
  return async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
    const owner = await authorizeOwner(request, dependencies.authorize);
    if (owner instanceof Response) return owner;
    const { id } = await context.params;
    const body = await readJson(request);
    if (!idPattern.test(id) || !isRecord(body) || !validSubmission(body, owner.accountProvider)) {
      return error("INVALID_SUBMISSION_REFERENCE", "A valid provider submission reference is required.", 400);
    }
    const now = (dependencies.now ?? (() => new Date()))().toISOString();
    const store = dependencies.store ?? await getMoneyActionStore();
    const record = await store.recordSubmission(owner, id, {
      ...(typeof body.submissionId === "string" ? { submissionId: body.submissionId } : {}),
      ...(typeof body.transactionHash === "string" ? { transactionHash: body.transactionHash.toLowerCase() as `0x${string}` } : {}),
      ...(typeof body.userOperationHash === "string" ? { userOperationHash: body.userOperationHash.toLowerCase() as `0x${string}` } : {}),
    }, now);
    if (!record) return error("ACTION_NOT_CLAIMED", "This action cannot accept a new submission reference.", 409);

    if (record.transactionHash) {
      try {
        const receipt = await dependencies.readReceipt(
          record.transactionHash,
          executionProof(record),
          request.signal,
        );
        if (receipt.status === "confirmed" && receipt.verifiedExecution) {
          const next = await store.updateStatus(
            owner,
            id,
            receipt.success ? "confirmed" : "failed",
            (dependencies.now ?? (() => new Date()))().toISOString(),
            { verifiedExecution: receipt.verifiedExecution },
          );
          return json({ operation: next ?? record, receipt: publicReceipt(receipt) }, 200);
        }
      } catch {
        // Keep the durable submitted reference; a later owner-scoped read can retry.
      }
    }
    return json({ operation: record }, 200);
  };
}

export function createMoneyActionStatusHandler(dependencies: {
  authorize: SessionAuthorizer;
  store?: MoneyActionStore;
  now?: () => Date;
}) {
  return async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
    const owner = await authorizeOwner(request, dependencies.authorize);
    if (owner instanceof Response) return owner;
    const { id } = await context.params;
    const body = await readJson(request);
    const allowed: MoneyActionOperationStatus[] = ["unknown", "rejected", "expired", "failed"];
    if (!idPattern.test(id) || !isRecord(body) || !allowed.includes(body.status as MoneyActionOperationStatus) || Object.keys(body).some((key) => key !== "status")) {
      return error("INVALID_ACTION_STATUS", "Only a bounded unresolved or terminal wallet outcome may be recorded.", 400);
    }
    const store = dependencies.store ?? await getMoneyActionStore();
    const requested = body.status as MoneyActionOperationStatus;
    const record = await store.updateStatus(
      owner,
      id,
      requested,
      (dependencies.now ?? (() => new Date()))().toISOString(),
      requested === "rejected" || requested === "expired" || requested === "failed"
        ? { expectedSourceStatus: "submitting", requireNoSubmissionReference: true }
        : undefined,
    );
    return record ? json({ operation: record }, 200) : error("ACTION_NOT_FOUND", "The action was not found or cannot transition to that status.", 404);
  };
}

export function createMoneyActionAdmissionReleaseHandler(dependencies: {
  authorize: SessionAuthorizer;
  store?: MoneyActionStore;
  now?: () => Date;
}) {
  return async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
    const owner = await authorizeOwner(request, dependencies.authorize);
    if (owner instanceof Response) return owner;
    const { id } = await context.params;
    const body = await readJson(request);
    if (
      !idPattern.test(id) ||
      (body != null && (
        !isRecord(body) ||
        Object.keys(body).some((key) => key !== "reason") ||
        (body.reason !== undefined && body.reason !== "owner-request")
      ))
    ) {
      return error("INVALID_ADMISSION_RELEASE", "Only the owner can release Home admission for this action.", 400);
    }
    const store = dependencies.store ?? await getMoneyActionStore();
    const record = await store.releaseAdmission(
      owner,
      id,
      (dependencies.now ?? (() => new Date()))().toISOString(),
    );
    return record
      ? json({ operation: record }, 200)
      : error("ACTION_NOT_FOUND", "The action was not found or cannot release admission.", 404);
  };
}

export function createMoneyActionReadHandler(dependencies: {
  authorize: SessionAuthorizer;
  readReceipt: MoneyActionReceiptReader;
  store?: MoneyActionStore;
  now?: () => Date;
}) {
  return async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
    const owner = await authorizeOwner(request, dependencies.authorize);
    if (owner instanceof Response) return owner;
    const { id } = await context.params;
    if (!idPattern.test(id)) return error("INVALID_ACTION_ID", "A valid action id is required.", 400);
    const store = dependencies.store ?? await getMoneyActionStore();
    let record = await store.get(owner, id);
    if (!record) return error("ACTION_NOT_FOUND", "The action was not found for this account.", 404);
    if (record.transactionHash && !["confirmed", "failed"].includes(record.status)) {
      try {
        const receipt = await dependencies.readReceipt(
          record.transactionHash,
          executionProof(record),
          request.signal,
        );
        if (receipt.status === "confirmed" && receipt.verifiedExecution) {
          record = await store.updateStatus(
            owner,
            id,
            receipt.success ? "confirmed" : "failed",
            (dependencies.now ?? (() => new Date()))().toISOString(),
            { verifiedExecution: receipt.verifiedExecution },
          ) ?? record;
        }
      } catch {
        // Returning the durable unresolved operation is safer than masking it.
      }
    }
    return json({ operation: record }, 200);
  };
}

export function createMoneyActionListHandler(dependencies: {
  authorize: SessionAuthorizer;
  store?: MoneyActionStore;
}) {
  return async function GET(request: Request) {
    const owner = await authorizeOwner(request, dependencies.authorize);
    if (owner instanceof Response) return owner;
    const url = new URL(request.url);
    for (const key of url.searchParams.keys()) {
      if (key !== "limit" && key !== "scope") {
        return error("INVALID_OPERATIONS_REQUEST", "Use a valid operations selector and limit.", 400);
      }
    }
    if (url.searchParams.getAll("limit").length > 1 || url.searchParams.getAll("scope").length > 1) {
      return error("INVALID_OPERATIONS_REQUEST", "Use one operations selector and limit.", 400);
    }
    const rawLimit = url.searchParams.get("limit") ?? "20";
    const limit = Number(rawLimit);
    const rawScope = url.searchParams.get("scope");
    if (
      !/^[0-9]+$/.test(rawLimit) || !Number.isSafeInteger(limit) || limit < 1 || limit > 50 ||
      (rawScope !== null && rawScope !== "unresolved-send")
    ) {
      return error("INVALID_OPERATIONS_REQUEST", "Use a valid operations selector and limit.", 400);
    }
    const scope = rawScope ?? undefined;
    const store = dependencies.store ?? await getMoneyActionStore();
    const operations = await store.list(owner, limit, scope);
    return json(scope ? { scope, operations } : { operations }, 200);
  };
}

async function authorizeOwner(request: Request, authorize: SessionAuthorizer) {
  const response = await authorize(request);
  if (!response.ok) return response;
  const session = await readAuthorizedMoneyActionSession(request, response);
  const owner = session ? moneyActionOwner(session) : null;
  return owner ?? error("SMART_ACCOUNT_UNAVAILABLE", "A verified Base account is required.", 503);
}

function validSubmission(
  body: Record<string, unknown>,
  provider: "cdp-embedded" | "base-account",
): boolean {
  if (Object.keys(body).some((key) => !["submissionId", "transactionHash", "userOperationHash"].includes(key))) return false;
  const submissionId = typeof body.submissionId === "string" && submissionIdPattern.test(body.submissionId);
  const transactionHash = typeof body.transactionHash === "string" && transactionHashPattern.test(body.transactionHash);
  const userOperationHash = typeof body.userOperationHash === "string" && transactionHashPattern.test(body.userOperationHash);
  if (body.submissionId !== undefined && !submissionId) return false;
  if (body.transactionHash !== undefined && !transactionHash) return false;
  if (body.userOperationHash !== undefined && !userOperationHash) return false;
  if (provider === "cdp-embedded") {
    return !submissionId && userOperationHash && (!transactionHash || userOperationHash);
  }
  return submissionId && !userOperationHash;
}

function publicReceipt(receipt: Extract<TransferReceiptStatus, { status: "confirmed" }>) {
  return {
    status: receipt.status,
    transactionHash: receipt.transactionHash,
    blockNumber: receipt.blockNumber,
    success: receipt.success,
  };
}

function executionProof(record: StoredMoneyActionOperation): MoneyActionExecutionProof {
  return {
    accountProvider: record.action.owner.accountProvider,
    sender: record.action.owner.address,
    expectedCalls: record.action.calls,
    notBefore: record.claimedAt ?? record.action.createdAt,
    ...(record.userOperationHash ? { userOperationHash: record.userOperationHash } : {}),
  };
}

async function readJson(request: Request): Promise<unknown> {
  try { return await request.json(); } catch { return null; }
}

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: privateHeaders });
}

function error(code: string, message: string, status: number): Response {
  return json({ error: { code, message } }, status);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

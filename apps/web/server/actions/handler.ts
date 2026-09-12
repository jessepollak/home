import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { MoneyActionOwner, PreparedMoneyAction } from "@/shared/money-actions/types";
import { authorizeSession, type SessionAuthorizer } from "@/server/auth/authorize";
import { createTransferReceiptReader, type TransferReceiptStatus } from "./receipt";
import { moneyActionOwner } from "@/server/money-actions/session";
import { getActionsStore, type ActionRow, type ActionsStore, type PendingAction } from "./store";
import { deriveActionStatus, type ActionReceiptState } from "./status";
import { finalizeTradeCalls, type PendingTradeConfirmation } from "./kinds/trade/finalize";
import { createSmartAccountSignatureVerifier } from "./kinds/trade/signer";
import type { SmartAccountSignatureVerifier } from "@/shared/trading/server-types";
import { emitServerEvent } from "@/server/observability/log";

export type ActionAuthorizer = SessionAuthorizer;

const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Vary: "Authorization, X-Home-Account-Provider",
} as const;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hashPattern = /^0x[0-9a-fA-F]{64}$/;

async function authorizeOwner(request: Request, authorize: ActionAuthorizer): Promise<MoneyActionOwner | Response> {
  const boundary = await authorizeSession(request, authorize);
  if (boundary instanceof Response) return boundary;
  const owner = moneyActionOwner(boundary);
  return owner ?? privateError("AUTH_UNAVAILABLE", "Authentication is temporarily unavailable.", 503);
}

export function createGetActionHandler(dependencies: {
  authorize: ActionAuthorizer;
  store?: Pick<ActionsStore, "get">;
  readReceipt?: (hash: `0x${string}`, signal?: AbortSignal) => Promise<TransferReceiptStatus>;
  now?: () => Date;
}) {
  return async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
    const owner = await authorizeOwner(request, dependencies.authorize);
    if (owner instanceof Response) return owner;
    const { id } = await context.params;
    if (!uuidPattern.test(id)) return privateError("ACTION_NOT_FOUND", "The action was not found.", 404);
    const row = await (dependencies.store ?? getActionsStore()).get(owner, id);
    if (!row) return privateError("ACTION_NOT_FOUND", "The action was not found.", 404);
    if (!row.confirmed_at) {
      return privateJson({
        id: row.id,
        kind: row.kind,
        summary: row.summary,
        calls: row.pending?.calls ?? [],
        expiresAt: row.summary.expiresAt,
      }, 200);
    }
    let receipt: ActionReceiptState | null = null;
    if (row.transaction_hash && hashPattern.test(row.transaction_hash)) {
      try {
        const readReceipt = dependencies.readReceipt ?? ((hash: `0x${string}`, signal?: AbortSignal) => createTransferReceiptReader()(hash, signal));
        receipt = receiptState(await readReceipt(row.transaction_hash.toLowerCase() as `0x${string}`, request.signal));
      } catch {
        receipt = "unavailable";
      }
    }
    return privateJson(await presentAction(row, owner, receipt, dependencies.now?.()), 200);
  };
}

export function createConfirmActionHandler(dependencies: {
  authorize: ActionAuthorizer;
  store?: Pick<ActionsStore, "get" | "confirm">;
  verifySmartAccountSignature?: SmartAccountSignatureVerifier;
  now?: () => Date;
}) {
  return async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
    const startedAt = Date.now();
    const owner = await authorizeOwner(request, dependencies.authorize);
    if (owner instanceof Response) return owner;
    const fail = (code: string, message: string, status: number) => {
      emitServerEvent("action-confirm", {
        route: "/api/actions/:id/confirm",
        code,
        outcome: "failed",
        provider: owner.accountProvider,
        owner,
        durationMs: Date.now() - startedAt,
      });
      return privateError(code, message, status);
    };
    const { id } = await context.params;
    if (!uuidPattern.test(id)) return fail("INVALID_ACTION", "A valid action id is required.", 400);
    const store = dependencies.store ?? getActionsStore();
    const draft = await store.get(owner, id);
    if (!draft || draft.confirmed_at || !draft.pending?.calls?.length) {
      return fail("ACTION_NOT_FOUND", "The action is unavailable or already confirmed.", 404);
    }
    if (Date.parse(draft.summary.expiresAt) <= (dependencies.now?.() ?? new Date()).getTime()) {
      return fail("ACTION_EXPIRED", "The action review expired. Prepare it again.", 410);
    }

    let calls = draft.pending.calls;
    if (draft.kind === "trade") {
      const body = await readJson(request);
      const signature = isRecord(body) && typeof body.signature === "string" && /^0x(?:[0-9a-fA-F]{2})+$/.test(body.signature)
        ? body.signature.toLowerCase() as `0x${string}`
        : null;
      if (!signature || !isPendingTradeConfirmation(draft.pending)) {
        return fail("INVALID_TRADE_SIGNATURE", "A valid reviewed Permit2 signature is required.", 400);
      }
      try {
        calls = await finalizeTradeCalls({
          pending: draft.pending,
          signature,
          owner: owner.address,
          provider: owner.accountProvider,
          verifySmartAccountSignature: dependencies.verifySmartAccountSignature ?? createSmartAccountSignatureVerifier(),
          signal: request.signal,
        });
      } catch {
        return fail("INVALID_TRADE_SIGNATURE", "The Permit2 signature does not match the verified owner.", 400);
      }
    }

    const row = await store.confirm(owner, id, calls);
    if (!row || !row.pending?.calls?.length) return fail("ACTION_NOT_FOUND", "The action is unavailable or already confirmed.", 404);
    return privateJson({ id: row.id, calls: row.pending.calls, summary: row.summary, expiresAt: row.summary.expiresAt }, 200);
  };
}

export function createHandleActionHandler(dependencies: {
  authorize: ActionAuthorizer;
  store?: Pick<ActionsStore, "recordHandle">;
}) {
  return async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
    const startedAt = Date.now();
    const owner = await authorizeOwner(request, dependencies.authorize);
    if (owner instanceof Response) return owner;
    const fail = (code: string, message: string, status: number) => {
      emitServerEvent("action-handle", {
        route: "/api/actions/:id/handle",
        code,
        outcome: "failed",
        provider: owner.accountProvider,
        owner,
        durationMs: Date.now() - startedAt,
      });
      return privateError(code, message, status);
    };
    const { id } = await context.params;
    const body = await readJson(request);
    if (!uuidPattern.test(id) || !isRecord(body)) return fail("INVALID_ACTION_HANDLE", "A valid action handle is required.", 400);
    const providerHandle = typeof body.providerHandle === "string" && /^[\x21-\x7e]{1,512}$/.test(body.providerHandle)
      ? body.providerHandle : undefined;
    const transactionHash = typeof body.transactionHash === "string" && hashPattern.test(body.transactionHash)
      ? body.transactionHash.toLowerCase() : undefined;
    if ((!providerHandle && !transactionHash) || Object.keys(body).some((key) => key !== "providerHandle" && key !== "transactionHash")) {
      return fail("INVALID_ACTION_HANDLE", "A provider handle or transaction hash is required.", 400);
    }
    const row = await (dependencies.store ?? getActionsStore()).recordHandle(owner, id, { providerHandle, transactionHash });
    return row ? privateJson({ action: await presentAction(row, owner) }, 200)
      : fail("ACTION_NOT_FOUND", "The action is unavailable or the handle conflicts.", 404);
  };
}

export function createListActionsHandler(dependencies: {
  authorize: ActionAuthorizer;
  store?: Pick<ActionsStore, "list">;
  readReceipt?: (hash: `0x${string}`, signal?: AbortSignal) => Promise<TransferReceiptStatus>;
  now?: () => Date;
}) {
  return async function GET(request: Request): Promise<Response> {
    const owner = await authorizeOwner(request, dependencies.authorize);
    if (owner instanceof Response) return owner;
    const store = dependencies.store ?? getActionsStore();
    const readReceipt = dependencies.readReceipt ?? ((hash, signal) => createTransferReceiptReader()(hash, signal));
    const rows = await store.list(owner);
    const actions = await Promise.all(rows.map(async (row) => {
      let receipt: ActionReceiptState | null = null;
      if (row.transaction_hash && hashPattern.test(row.transaction_hash)) {
        try {
          const result = await readReceipt(row.transaction_hash.toLowerCase() as `0x${string}`, request.signal);
          receipt = receiptState(result);
        } catch {
          receipt = "unavailable";
        }
      }
      return presentAction(row, owner, receipt, dependencies.now?.());
    }));
    return privateJson({ actions }, 200);
  };
}

export async function presentAction(
  row: ActionRow,
  owner: MoneyActionOwner,
  receipt: ActionReceiptState | null = null,
  now = new Date(),
) {
  const confirmedAt = iso(row.confirmed_at) ?? iso(row.created_at)!;
  return {
    id: row.id,
    provider: row.provider,
    kind: row.kind,
    summary: row.summary,
    status: deriveActionStatus({
      confirmedAt,
      transactionHash: row.transaction_hash,
      receipt,
      now,
    }),
    createdAt: iso(row.created_at)!,
    confirmedAt,
    ...(row.provider_handle ? { providerHandle: row.provider_handle } : {}),
    ...(row.transaction_hash ? { transactionHash: row.transaction_hash.toLowerCase() } : {}),
    owner: {
      subject: owner.subject,
      address: owner.address,
      chainId: 8453,
      accountProvider: owner.accountProvider,
    },
  };
}

export function preparedActionFromResponse(
  session: VerifiedAccountSession,
  action: PreparedMoneyAction,
): PreparedMoneyAction {
  return { ...action, owner: moneyActionOwner(session)! };
}

function receiptState(receipt: TransferReceiptStatus): ActionReceiptState {
  if (receipt.status === "pending") return "pending";
  if (receipt.status === "confirmed") return receipt.success ? "confirmed" : "failed";
  return "unavailable";
}

function iso(value: string | Date | null): string | null {
  if (!value) return null;
  return typeof value === "string" ? new Date(value).toISOString() : value.toISOString();
}

async function readJson(request: Request): Promise<unknown> {
  try { return await request.json(); } catch { return null; }
}

function privateJson(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: privateHeaders });
}
function privateError(code: string, message: string, status: number): Response {
  return privateJson({ error: { code, message } }, status);
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isPendingTradeConfirmation(pending: PendingAction): pending is PendingAction & PendingTradeConfirmation {
  return Boolean(
    pending.permitHash &&
    pending.signingTypedData &&
    pending.signerAddress &&
    pending.signerOwnerIndex === 0 &&
    typeof pending.signerDeployed === "boolean" &&
    Number.isSafeInteger(pending.swapCallIndex),
  );
}

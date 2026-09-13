import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { MoneyActionDraft, PreparedMoneyAction } from "@/shared/money-actions/types";
import {
  assertTransferRequest,
  encodeErc20Transfer,
  getTransferAsset,
} from "@/shared/transfers/transfer-helpers";
import { TransferExecutionError, type TransferRequest } from "@/shared/transfers/types";
import { authorizeSession, type SessionAuthorizer } from "@/server/auth/authorize";
import { issueMoneyAction } from "./issue";

export function createPrepareSendMoneyActionHandler(dependencies: {
  authorize: SessionAuthorizer;
  issue?: (session: VerifiedAccountSession, request: TransferRequest) => Promise<PreparedMoneyAction>;
  now?: () => Date;
}) {
  return async function POST(request: Request): Promise<Response> {
    const session = await authorizeSession(request, dependencies.authorize);
    if (session instanceof Response) return session;
    if (!session.smartAccount) {
      return privateError("SMART_ACCOUNT_UNAVAILABLE", "A verified Base account is required.", 503);
    }
    const body = await readJson(request);
    if (!isTransferRequest(body)) {
      return privateError("INVALID_SEND_REQUEST", "Use a valid Base recipient, asset, and integer amount.", 400);
    }
    try {
      assertTransferRequest(body);
      const action = dependencies.issue
        ? await dependencies.issue(session, body)
        : await issueSendMoneyAction(session, body, dependencies.now?.() ?? new Date());
      return privateJson(action, 201);
    } catch {
      return privateError("INVALID_SEND_REQUEST", "Use a valid Base recipient, asset, and integer amount.", 400);
    }
  };
}

export async function issueSendMoneyAction(
  session: VerifiedAccountSession,
  request: TransferRequest,
  now = new Date(),
): Promise<PreparedMoneyAction> {
  return issueMoneyAction(session, buildSendMoneyActionDraft(request, now));
}

export function buildSendMoneyActionDraft(
  request: TransferRequest,
  now = new Date(),
): MoneyActionDraft {
  assertTransferRequest(request);
  const call = buildServerTransferCall(request);
  const asset = getTransferAsset(request.assetId);
  if (!asset) throw new TransferExecutionError("invalid-request");
  return {
    kind: "send",
    title: `Send ${asset.symbol}`,
    calls: [{ to: call.to, data: call.data, value: call.value.toString(10) }],
    amounts: [{
      assetId: request.assetId,
      symbol: asset.symbol,
      decimals: asset.decimals,
      amountBaseUnits: request.amountBaseUnits,
      direction: "spend",
    }],
    warnings: [
      `Recipient: ${request.recipient}`,
      `Execution target: ${call.to}`,
      "Your wallet will show the Base network fee before you sign.",
    ],
    expiresAt: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
  };
}

export function buildServerTransferCall(request: TransferRequest): {
  to: `0x${string}`;
  value: bigint;
  data: `0x${string}`;
} {
  assertTransferRequest(request);
  const asset = getTransferAsset(request.assetId);
  if (!asset) throw new TransferExecutionError("invalid-request");
  const amount = BigInt(request.amountBaseUnits);
  if (asset.kind === "native") {
    return { to: request.recipient, value: amount, data: "0x" };
  }
  if (!asset.contractAddress) throw new TransferExecutionError("invalid-request");
  return encodeErc20Transfer(asset.contractAddress, request.recipient, amount);
}

function isTransferRequest(value: unknown): value is TransferRequest {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => ["assetId", "recipient", "amountBaseUnits"].includes(key)) &&
    typeof (value as TransferRequest).assetId === "string" &&
    typeof (value as TransferRequest).recipient === "string" &&
    typeof (value as TransferRequest).amountBaseUnits === "string",
  );
}

async function readJson(request: Request): Promise<unknown> {
  try { return await request.json(); } catch { return null; }
}

const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Vary: "Authorization, X-Home-Account-Provider",
} as const;

function privateJson(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: privateHeaders });
}

function privateError(code: string, message: string, status: number): Response {
  return privateJson({ error: { code, message } }, status);
}

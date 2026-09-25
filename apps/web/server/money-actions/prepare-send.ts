import "server-only";

import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { MoneyActionDraft, PreparedMoneyAction } from "@/shared/money-actions/types";
import { normalizeTransferRecipientName } from "@/shared/transfers/recipient-name";
import {
  assertTransferRequest,
  encodeErc20Transfer,
  getTransferAsset,
  normalizeTransferRecipient,
} from "@/shared/transfers/transfer-helpers";
import { TransferExecutionError, type TransferRequest } from "@/shared/transfers/types";
import { authorizeSession, type SessionAuthorizer } from "@/server/auth/authorize";
import { issueMoneyAction } from "./issue";
import { applyNetworkFee } from "@/server/paymaster/fee";
import { privateError, privateJson } from "@/server/http/private-response";
import {
  resolveTransferRecipientName,
  type TransferRecipientNameResolver,
} from "@/server/transfers/recipient-resolver";

/** @public exercised by server/money-actions/prepare-send.test.ts */
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
        : await issueSendMoneyAction(session, body, dependencies.now?.() ?? new Date(), { signal: request.signal, request });
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
  options: { signal?: AbortSignal; resolveName?: TransferRecipientNameResolver; request?: Request } = {},
): Promise<PreparedMoneyAction> {
  const draft = await buildVerifiedSendMoneyActionDraft(request, now, options);
  return issueMoneyAction(session, await applyNetworkFee(session, draft, { signal: options.signal, request: options.request }));
}

export async function buildVerifiedSendMoneyActionDraft(
  request: TransferRequest,
  now = new Date(),
  options: { signal?: AbortSignal; resolveName?: TransferRecipientNameResolver } = {},
): Promise<MoneyActionDraft> {
  const normalizedRequest = normalizeSendRequest(request);
  await assertRecipientNameBoundary(normalizedRequest, options.resolveName ?? resolveTransferRecipientName, options.signal);
  return buildSendMoneyActionDraft(normalizedRequest, now);
}

export function buildSendMoneyActionDraft(
  request: TransferRequest,
  now = new Date(),
): MoneyActionDraft {
  const normalizedRequest = normalizeSendRequest(request);
  const call = buildServerTransferCall(normalizedRequest);
  const asset = getTransferAsset(normalizedRequest.assetId);
  if (!asset) throw new TransferExecutionError("invalid-request");
  return {
    kind: "send",
    title: `Send ${asset.symbol}`,
    calls: [{ to: call.to, data: call.data, value: call.value.toString(10) }],
    amounts: [{
      assetId: normalizedRequest.assetId,
      symbol: asset.symbol,
      decimals: asset.decimals,
      amountBaseUnits: normalizedRequest.amountBaseUnits,
      direction: "spend",
    }],
    warnings: [
      `Recipient: ${normalizedRequest.recipient}`,
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
  const recipient = normalizeTransferRecipient(request.recipient);
  if (asset.kind === "native") {
    return { to: recipient, value: amount, data: "0x" };
  }
  if (!asset.contractAddress) throw new TransferExecutionError("invalid-request");
  return encodeErc20Transfer(asset.contractAddress, recipient, amount);
}

async function assertRecipientNameBoundary(
  request: TransferRequest,
  resolveName: TransferRecipientNameResolver,
  signal?: AbortSignal,
): Promise<void> {
  if (request.recipientName === undefined) return;
  const name = normalizeTransferRecipientName(request.recipientName);
  if (!name) throw new TransferExecutionError("invalid-request");
  const resolved = await resolveName(name, { signal });
  if (
    resolved === null ||
    normalizeTransferRecipient(resolved) !== normalizeTransferRecipient(request.recipient)
  ) {
    throw new TransferExecutionError("invalid-request");
  }
}

function normalizeSendRequest(request: TransferRequest): TransferRequest {
  assertTransferRequest(request);
  return {
    ...request,
    recipient: normalizeTransferRecipient(request.recipient),
    ...(request.recipientName === undefined
      ? {}
      : { recipientName: normalizeTransferRecipientName(request.recipientName)! }),
  };
}

function isTransferRequest(value: unknown): value is TransferRequest {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => ["assetId", "recipient", "amountBaseUnits", "recipientName"].includes(key)) &&
    typeof (value as TransferRequest).assetId === "string" &&
    typeof (value as TransferRequest).recipient === "string" &&
    typeof (value as TransferRequest).amountBaseUnits === "string" &&
    ((value as TransferRequest).recipientName === undefined ||
      typeof (value as TransferRequest).recipientName === "string"),
  );
}

async function readJson(request: Request): Promise<unknown> {
  try { return await request.json(); } catch { return null; }
}

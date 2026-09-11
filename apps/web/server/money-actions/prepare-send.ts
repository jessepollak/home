import type { VerifiedAccountSession } from "@/shared/account/session-types";
import {
  TRANSFER_ASSETS,
  assertTransferRequest,
  buildTransferCall,
} from "@/shared/transfers/transfer-helpers";
import type { TransferRequest } from "@/shared/transfers/types";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import { PORTFOLIO_BASE_USDC_ADDRESS } from "@/shared/portfolio/types";
import { issueMoneyAction } from "./issue";
import { readAuthorizedMoneyActionSession } from "./session";
import type { SessionAuthorizer } from "./handlers";

export function createPrepareSendMoneyActionHandler(dependencies: {
  authorize: SessionAuthorizer;
  issue?: (session: VerifiedAccountSession, request: TransferRequest) => Promise<PreparedMoneyAction>;
  now?: () => Date;
}) {
  return async function POST(request: Request): Promise<Response> {
    const boundary = await dependencies.authorize(request);
    if (!boundary.ok) return boundary;
    const session = await readAuthorizedMoneyActionSession(request, boundary);
    if (!session?.smartAccount) {
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
  assertTransferRequest(request);
  const call = buildTransferCall(request);
  const asset = TRANSFER_ASSETS[request.assetId];
  const target = request.assetId === "usdc" ? PORTFOLIO_BASE_USDC_ADDRESS : request.recipient;
  return issueMoneyAction(session, {
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
      `Execution target: ${target}`,
      "Your wallet will show the Base network fee before you sign.",
    ],
    expiresAt: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
  });
}

function isTransferRequest(value: unknown): value is TransferRequest {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => ["assetId", "recipient", "amountBaseUnits"].includes(key)) &&
    ((value as TransferRequest).assetId === "usdc" || (value as TransferRequest).assetId === "eth") &&
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

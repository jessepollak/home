import {
  ACCOUNT_PROVIDER_HEADER,
  type AccountProvider,
  type VerifiedAccountSession,
} from "@/shared/account/session-types";
import type { SessionAuthorizer } from "@/server/portfolio/handler";
import type { BorrowAddress } from "@/shared/borrowing/config";
import type { BorrowRpcReader } from "./rpc";

const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Vary: `Authorization, ${ACCOUNT_PROVIDER_HEADER}`,
} as const;

export function createBorrowHandler(dependencies: {
  authorize: SessionAuthorizer;
  rpc: BorrowRpcReader;
}) {
  return async function GET(request: Request) {
    const response = await dependencies.authorize(request);
    if (!response.ok) return response;
    const session = await parseSession(response, readRequestedProvider(request));
    if (!session) {
      return privateJson({ error: { code: "AUTH_UNAVAILABLE", message: "Authentication is temporarily unavailable." } }, 503);
    }
    if (!session.smartAccount) {
      return privateJson({ error: { code: "SMART_ACCOUNT_UNAVAILABLE", message: "A verified Base smart account is not available yet." } }, 503);
    }
    try {
      const snapshot = await dependencies.rpc.readSnapshot(
        session.smartAccount.address,
        request.signal,
      );
      return privateJson(snapshot, 200);
    } catch {
      return privateJson(
        {
          error: {
            code: "BORROW_STATE_UNAVAILABLE",
            message: "Current Morpho position, oracle, liquidity, or limit state is unavailable.",
          },
        },
        502,
      );
    }
  };
}

async function parseSession(response: Response, expectedProvider: AccountProvider | null): Promise<VerifiedAccountSession | null> {
  let value: unknown;
  try { value = await response.json(); } catch { return null; }
  if (!isRecord(value) || !isRecord(value.user) || !expectedProvider) return null;
  if (typeof value.user.subject !== "string" || value.user.subject.trim().length === 0 || value.accountProvider !== expectedProvider) return null;
  if (!isRecord(value.smartAccount)) return null;
  if (
    typeof value.smartAccount.address !== "string" ||
    !/^0x[0-9a-fA-F]{40}$/.test(value.smartAccount.address) ||
    value.smartAccount.chainId !== 8453
  ) return null;
  return {
    user: { subject: value.user.subject },
    smartAccount: {
      address: value.smartAccount.address.toLowerCase() as BorrowAddress,
      chainId: 8453,
    },
    accountProvider: expectedProvider,
  };
}

function readRequestedProvider(request: Request): AccountProvider | null {
  const value = request.headers.get(ACCOUNT_PROVIDER_HEADER);
  if (value === null || value === "cdp-embedded") return "cdp-embedded";
  return value === "base-account" ? "base-account" : null;
}

function privateJson(body: unknown, status: number) {
  return Response.json(body, { status, headers: privateHeaders });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

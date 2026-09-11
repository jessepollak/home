import {
  ACCOUNT_PROVIDER_HEADER,
  type AccountProvider,
} from "@/shared/account/session-types";
import type { Address, MorphoVaultPosition } from "@/shared/savings/types";

const BASE_CHAIN_ID = 8453 as const;

export type SavingsPositionAccount = {
  subject: string;
  address: Address;
  accountProvider: AccountProvider;
};

export type SavingsPositionsResult = {
  accountAddress: Address;
  fetchedAt: string;
  vaults: Array<{
    vaultAddress: Address;
    position: MorphoVaultPosition | null;
  }>;
};

const privateResponseHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Vary: `Authorization, ${ACCOUNT_PROVIDER_HEADER}`,
} as const;

export function createSavingsPositionsHandler(dependencies: {
  authorize: (request: Request) => Promise<Response>;
  readPositions: (
    account: SavingsPositionAccount,
    signal?: AbortSignal,
  ) => Promise<SavingsPositionsResult>;
}) {
  return async function GET(request: Request): Promise<Response> {
    const boundaryResponse = await dependencies.authorize(request);
    if (!boundaryResponse.ok) return boundaryResponse;

    const account = await parseAuthorizedAccount(
      boundaryResponse,
      requestedProvider(request),
    );
    if (!account) {
      return privateJson(
        {
          error: {
            code: "AUTH_UNAVAILABLE",
            message: "Authentication is temporarily unavailable.",
          },
        },
        503,
      );
    }

    try {
      return privateJson(
        await dependencies.readPositions(account, request.signal),
        200,
      );
    } catch {
      return privateJson(
        {
          error: {
            code: "SAVINGS_POSITIONS_UNAVAILABLE",
            message: "Current supported Morpho positions are temporarily unavailable.",
          },
        },
        502,
      );
    }
  };
}

async function parseAuthorizedAccount(
  response: Response,
  expectedProvider: AccountProvider | null,
): Promise<SavingsPositionAccount | null> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    return null;
  }
  if (
    !isRecord(value) ||
    !isRecord(value.user) ||
    !isRecord(value.smartAccount) ||
    !expectedProvider ||
    typeof value.user.subject !== "string" ||
    value.user.subject.trim().length === 0 ||
    value.accountProvider !== expectedProvider ||
    typeof value.smartAccount.address !== "string" ||
    !/^0x[0-9a-fA-F]{40}$/.test(value.smartAccount.address) ||
    value.smartAccount.chainId !== BASE_CHAIN_ID
  ) {
    return null;
  }

  return {
    subject: value.user.subject,
    address: value.smartAccount.address.toLowerCase() as Address,
    accountProvider: expectedProvider,
  };
}

function requestedProvider(request: Request): AccountProvider | null {
  const value = request.headers.get(ACCOUNT_PROVIDER_HEADER);
  if (value === null || value === "cdp-embedded") return "cdp-embedded";
  return value === "base-account" ? "base-account" : null;
}

function privateJson(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: privateResponseHeaders });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

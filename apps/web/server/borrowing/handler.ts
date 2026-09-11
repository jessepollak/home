import {
  ACCOUNT_PROVIDER_HEADER,
  type AccountProvider,
  type VerifiedAccountSession,
} from "@/shared/account/session-types";
import type { SessionAuthorizer } from "@/server/portfolio/handler";
import type { BorrowAddress } from "@/shared/borrowing/config";
import { BorrowPreparationError, prepareBorrowAction } from "./prepare";
import { BorrowRpcError, type BorrowRpcReader } from "./rpc";
import type {
  BorrowPreviewRequest,
  BorrowPreviewResponse,
  IssueBorrowAction,
} from "@/shared/borrowing/types";

const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Vary: `Authorization, ${ACCOUNT_PROVIDER_HEADER}`,
} as const;

export function createBorrowHandlers(dependencies: {
  authorize: SessionAuthorizer;
  rpc: BorrowRpcReader;
  issueAction?: IssueBorrowAction;
}) {
  async function authorize(request: Request) {
    const response = await dependencies.authorize(request);
    if (!response.ok) return { response, session: null } as const;
    const session = await parseSession(response, readRequestedProvider(request));
    if (!session) {
      return {
        response: privateJson({ error: { code: "AUTH_UNAVAILABLE", message: "Authentication is temporarily unavailable." } }, 503),
        session: null,
      } as const;
    }
    if (!session.smartAccount) {
      return {
        response: privateJson({ error: { code: "SMART_ACCOUNT_UNAVAILABLE", message: "A verified Base smart account is not available yet." } }, 503),
        session: null,
      } as const;
    }
    return { response: null, session } as const;
  }

  return {
    GET: async (request: Request) => {
      const authorized = await authorize(request);
      if (!authorized.session) return authorized.response;
      try {
        const snapshot = await dependencies.rpc.readSnapshot(
          authorized.session.smartAccount!.address,
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
    },

    POST: async (request: Request) => {
      const authorized = await authorize(request);
      if (!authorized.session) return authorized.response;
      let body: BorrowPreviewRequest;
      try {
        body = await readPreviewRequest(request);
      } catch (error) {
        return privateJson(
          { error: { code: "INVALID_BORROW_REQUEST", message: error instanceof Error ? error.message : "The request is invalid." } },
          400,
        );
      }

      try {
        const snapshot = await dependencies.rpc.readSnapshot(
          authorized.session.smartAccount!.address,
          request.signal,
        );
        const stateWasRefreshed = body.snapshotBlockHash.toLowerCase() !== snapshot.source.blockHash.toLowerCase();
        const preparation = await prepareBorrowAction({
          request: { ...body, snapshotBlockHash: snapshot.source.blockHash },
          snapshot,
          rpc: dependencies.rpc,
          signal: request.signal,
        });
        if (stateWasRefreshed) {
          const notice = "Limits were refreshed to the latest pinned Base block before this preview.";
          preparation.draft.warnings.unshift(notice);
          preparation.summary.warnings.unshift(notice);
        }

        if (preparation.fullySimulated && dependencies.issueAction) {
          const action = await dependencies.issueAction(authorized.session, preparation.draft);
          return privateJson(
            { status: "prepared", action, snapshot } satisfies BorrowPreviewResponse,
            201,
          );
        }

        const disabledReason = preparation.simulationGap ??
          "Shared money-action review and execution are not integrated in this worktree.";
        return privateJson(
          {
            status: "preview-only",
            preview: {
              ...preparation.summary,
              execution: "disabled",
              disabledReason,
            },
            snapshot,
          } satisfies BorrowPreviewResponse,
          200,
        );
      } catch (error) {
        if (error instanceof BorrowPreparationError) {
          const status = error.code === "stale-state" ? 409 : error.code === "simulation-failed" ? 422 : 400;
          return privateJson({ error: { code: error.code.toUpperCase().replaceAll("-", "_"), message: error.message } }, status);
        }
        const message = error instanceof BorrowRpcError
          ? "Current Morpho position, oracle, liquidity, limits, or simulation is unavailable."
          : "The borrowing preview is temporarily unavailable.";
        return privateJson({ error: { code: "BORROW_PREVIEW_UNAVAILABLE", message } }, 502);
      }
    },
  };
}

async function readPreviewRequest(request: Request): Promise<BorrowPreviewRequest> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") throw new TypeError("Content-Type must be application/json.");
  const contentLength = request.headers.get("content-length");
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > 4096)) {
    throw new TypeError("The request body is too large.");
  }
  const text = await request.text();
  if (text.length === 0 || text.length > 4096) throw new TypeError("The request body is invalid.");
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new TypeError("The request body must be valid JSON.");
  }
  if (!isRecord(value) || typeof value.operation !== "string" || typeof value.amount !== "string" || typeof value.snapshotBlockHash !== "string") {
    throw new TypeError("Operation, amount, and snapshot block hash are required.");
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(value.snapshotBlockHash)) throw new TypeError("The snapshot block hash is invalid.");
  return {
    operation: value.operation as BorrowPreviewRequest["operation"],
    amount: value.amount,
    snapshotBlockHash: value.snapshotBlockHash.toLowerCase() as `0x${string}`,
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

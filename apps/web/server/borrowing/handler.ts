import "server-only";

import { ACCOUNT_PROVIDER_HEADER } from "@/shared/account/session-types";
import { BORROW_MARKETS, getBorrowMarketRef } from "@/shared/borrowing/config";
import type { BorrowOverviewResponse, BorrowResponse } from "@/shared/borrowing/contract";
import { authorizeSession, type SessionAuthorizer } from "@/server/auth/authorize";
import { emitServerEvent } from "@/server/observability/log";
import type { BorrowRpcReader } from "./rpc";

const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Vary: `Authorization, ${ACCOUNT_PROVIDER_HEADER}`,
} as const;

export function createBorrowHandler(dependencies: { authorize: SessionAuthorizer; rpc: BorrowRpcReader; now?: () => Date }) {
  return async function GET(request: Request) {
    const session = await authorizeSession(request, dependencies.authorize);
    if (session instanceof Response) return session;
    if (!session.smartAccount) return privateError("SMART_ACCOUNT_UNAVAILABLE", "A verified Base smart account is not available yet.", 503);
    const startedAt = Date.now();
    const results = await Promise.all(BORROW_MARKETS.map(async (market) => {
      try {
        return { market, snapshot: await dependencies.rpc.readSnapshot(session.smartAccount!.address, market, request.signal), error: null } as const;
      } catch {
        emitServerEvent("borrow-overview", {
          route: "/api/borrow",
          code: "BORROW_MARKET_READ_UNAVAILABLE",
          outcome: "unavailable",
          provider: "base-rpc",
          owner: { subject: session.user.subject, accountProvider: session.accountProvider },
          durationMs: Date.now() - startedAt,
        });
        return { market, snapshot: null, error: "Current verified chain state is unavailable for this market." } as const;
      }
    }));
    const fetchedAt = (dependencies.now?.() ?? new Date()).toISOString();
    const verified = results.filter((result) => result.snapshot !== null);
    const response: BorrowOverviewResponse = {
      version: "1",
      chainId: 8453,
      owner: { address: session.smartAccount.address.toLowerCase() as `0x${string}`, accountProvider: session.accountProvider },
      discovery: {
        status: verified.length === results.length ? "complete" : "partial",
        candidateCount: results.length,
        verifiedCount: verified.length,
        reason: verified.length === results.length ? null : "One or more configured markets could not be verified. Missing values are unavailable, not zero.",
        fetchedAt,
      },
      opportunities: results.map(({ market, snapshot, error }) => ({
        market: snapshot?.market ?? marketIdentity(market),
        availability: snapshot
          ? { status: "available", mode: market.availability, reason: null, source: snapshot.source }
          : { status: "unavailable", mode: market.availability, reason: error!, source: null },
      })),
      positions: verified.flatMap(({ snapshot }) => snapshot && (BigInt(snapshot.position.collateralRaw) > BigInt(0) || BigInt(snapshot.position.borrowSharesRaw) > BigInt(0))
        ? [{
            market: snapshot.market, source: snapshot.source,
            collateralRaw: snapshot.position.collateralRaw, borrowSharesRaw: snapshot.position.borrowSharesRaw,
            debtAssetsRaw: snapshot.position.debtAssetsRaw, healthFactorWad: snapshot.position.healthFactorWad,
          }]
        : []),
    };
    return privateJson(response satisfies BorrowResponse, 200);
  };
}

export function createBorrowMarketHandler(dependencies: { authorize: SessionAuthorizer; rpc: BorrowRpcReader }) {
  return async function GET(request: Request, context: { params: Promise<{ marketId: string }> }) {
    const session = await authorizeSession(request, dependencies.authorize);
    if (session instanceof Response) return session;
    if (!session.smartAccount) return privateError("SMART_ACCOUNT_UNAVAILABLE", "A verified Base smart account is not available yet.", 503);
    const { marketId } = await context.params;
    const market = getBorrowMarketRef(marketId);
    if (!market) return privateError("BORROW_MARKET_NOT_FOUND", "The borrowing market is not configured.", 404);
    try {
      return privateJson(await dependencies.rpc.readSnapshot(session.smartAccount.address, market, request.signal), 200);
    } catch {
      return privateError("BORROW_STATE_UNAVAILABLE", "Current verified market, position, oracle, liquidity, or limit state is unavailable.", 502);
    }
  };
}

function marketIdentity(market: (typeof BORROW_MARKETS)[number]) {
  return {
    id: market.marketId, morpho: market.morpho, loanToken: market.loanToken, collateralToken: market.collateralToken,
    oracle: market.oracle, irm: market.irm, lltvWad: market.lltvWad.toString(10), rank: market.rank,
  };
}
function privateJson(body: unknown, status: number) { return Response.json(body, { status, headers: privateHeaders }); }
function privateError(code: string, message: string, status: number) { return privateJson({ error: { code, message } }, status); }

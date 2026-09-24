import "server-only";

import { BORROW_MARKETS, getBorrowMarketRef } from "@/shared/borrowing/config";
import type { BorrowOverviewResponse, BorrowResponse } from "@/shared/borrowing/contract";
import { authorizeSession, type SessionAuthorizer } from "@/server/auth/authorize";
import { emitServerEvent } from "@/server/observability/log";
import { privateError, privateJson } from "@/server/http/private-response";
import type { BorrowRpcReadResult, BorrowRpcReader } from "./rpc";

export function createBorrowHandler(dependencies: { authorize: SessionAuthorizer; rpc: BorrowRpcReader; now?: () => Date }) {
  return async function GET(request: Request) {
    const session = await authorizeSession(request, dependencies.authorize);
    if (session instanceof Response) return session;
    if (!session.smartAccount) return privateError("SMART_ACCOUNT_UNAVAILABLE", "A verified Base smart account is not available yet.", 503);
    const startedAt = Date.now();
    let results: BorrowRpcReadResult[];
    try {
      results = await dependencies.rpc.readSnapshots(session.smartAccount.address, BORROW_MARKETS, request.signal);
    } catch {
      results = BORROW_MARKETS.map((market) => ({ market, error: new Error("The shared Base source block could not be verified.") }));
    }
    const fetchedAt = (dependencies.now?.() ?? new Date()).toISOString();
    const verified = results.filter((result): result is Extract<BorrowRpcReadResult, { snapshot: object }> => result.snapshot !== undefined);
    for (const result of results) {
      if (result.snapshot) continue;
      emitServerEvent("borrow-overview", {
        route: "/api/borrow", code: "BORROW_MARKET_READ_UNAVAILABLE", outcome: "unavailable",
        provider: "base-rpc", owner: { subject: session.user.subject, accountProvider: session.accountProvider },
        durationMs: Date.now() - startedAt,
      });
    }
    const source = verified[0]?.snapshot.source;
    const response: BorrowOverviewResponse = {
      version: "2", chainId: 8453,
      owner: { address: session.smartAccount.address.toLowerCase() as `0x${string}`, accountProvider: session.accountProvider },
      discovery: {
        status: verified.length === results.length ? "complete" : "partial",
        sourceBlock: source ? {
          provider: source.provider, blockNumber: source.blockNumber,
          blockHash: source.blockHash, blockTimestamp: source.blockTimestamp,
        } : null,
        candidateCount: results.length, verifiedCount: verified.length,
        reason: verified.length === results.length ? null : "One or more configured markets could not be verified. Missing values are unavailable, not zero.",
        fetchedAt,
      },
      opportunities: results.map(({ market, snapshot }) => ({
        market: snapshot?.market ?? marketIdentity(market),
        availability: snapshot
          ? { status: "available", mode: market.availability, reason: null, source: snapshot.source, snapshot }
          : { status: "unavailable", mode: market.availability, reason: "Current verified chain state is unavailable for this market.", source: null },
      })),
      positions: verified.flatMap(({ snapshot }) => BigInt(snapshot.position.collateralRaw) > BigInt(0) || BigInt(snapshot.position.borrowSharesRaw) > BigInt(0)
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

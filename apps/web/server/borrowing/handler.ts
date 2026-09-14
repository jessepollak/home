import "server-only";

import { ACCOUNT_PROVIDER_HEADER } from "@/shared/account/session-types";
import type { BorrowMarketRef } from "@/shared/borrowing/config";
import type { BorrowOverviewResponse, BorrowResponse } from "@/shared/borrowing/contract";
import type { LendingOpportunity, LendingPosition } from "@/shared/lending/contract";
import { VERIFIED_MORPHO_MARKETS, getVerifiedMorphoMarket, type VerifiedMorphoMarketRef } from "@/shared/morpho-markets/config";
import { authorizeSession, type SessionAuthorizer } from "@/server/auth/authorize";
import { projectLendingDetail } from "@/server/lending/project";
import type { MorphoMarketRpcReader, MorphoMarketSnapshot } from "@/server/morpho-markets/rpc";
import { emitServerEvent } from "@/server/observability/log";
import { projectBorrowSnapshot } from "./rpc";

const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Vary: `Authorization, ${ACCOUNT_PROVIDER_HEADER}`,
} as const;

type MarketRead = {
  market: VerifiedMorphoMarketRef;
  snapshot: MorphoMarketSnapshot | null;
  error: string | null;
};

export function createBorrowHandler(dependencies: {
  authorize: SessionAuthorizer;
  rpc: MorphoMarketRpcReader;
  markets?: readonly VerifiedMorphoMarketRef[];
  now?: () => Date;
}) {
  return async function GET(request: Request) {
    const session = await authorizeSession(request, dependencies.authorize);
    if (session instanceof Response) return session;
    if (!session.smartAccount) return privateError("SMART_ACCOUNT_UNAVAILABLE", "A verified Base smart account is not available yet.", 503);
    const startedAt = Date.now();
    const markets = dependencies.markets ?? VERIFIED_MORPHO_MARKETS;
    const reads = await Promise.all(markets.map(async (market): Promise<MarketRead> => {
      try {
        return { market, snapshot: await dependencies.rpc.readSnapshot(session.smartAccount!.address, market, request.signal), error: null };
      } catch {
        emitReadUnavailable(session, startedAt);
        return { market, snapshot: null, error: "Current verified chain state is unavailable for this market." };
      }
    }));
    const fetchedAt = (dependencies.now?.() ?? new Date()).toISOString();
    const borrowReads = reads.flatMap((read) => {
      const availability = read.market.capabilities.borrow;
      return availability ? [{ ...read, market: { ...read.market, availability } satisfies BorrowMarketRef }] : [];
    });
    const borrowResults = borrowReads.map(({ market, snapshot, error }) => {
      if (!snapshot) return { market, snapshot: null, error: error! };
      try {
        return { market, snapshot: projectBorrowSnapshot(snapshot, market), error: null };
      } catch {
        return { market, snapshot: null, error: "Current verified borrowing state is unavailable for this market." };
      }
    });
    const verifiedBorrow = borrowResults.filter((result) => result.snapshot !== null);
    const lending = projectLendingOverview(reads);
    const response: BorrowOverviewResponse = {
      version: "1",
      chainId: 8453,
      owner: { address: session.smartAccount.address.toLowerCase() as `0x${string}`, accountProvider: session.accountProvider },
      discovery: {
        status: verifiedBorrow.length === borrowResults.length ? "complete" : "partial",
        candidateCount: borrowResults.length,
        verifiedCount: verifiedBorrow.length,
        reason: verifiedBorrow.length === borrowResults.length ? null : "One or more configured markets could not be verified. Missing values are unavailable, not zero.",
        fetchedAt,
      },
      opportunities: borrowResults.map(({ market, snapshot, error }) => ({
        market: snapshot?.market ?? marketIdentity(market),
        availability: snapshot
          ? { status: "available", mode: market.availability, reason: null, source: snapshot.source }
          : { status: "unavailable", mode: market.availability, reason: error!, source: null },
      })),
      positions: verifiedBorrow.flatMap(({ snapshot }) => snapshot && (BigInt(snapshot.position.collateralRaw) > BigInt(0) || BigInt(snapshot.position.borrowSharesRaw) > BigInt(0))
        ? [{
            market: snapshot.market, source: snapshot.source,
            collateralRaw: snapshot.position.collateralRaw, borrowSharesRaw: snapshot.position.borrowSharesRaw,
            debtAssetsRaw: snapshot.position.debtAssetsRaw, healthFactorWad: snapshot.position.healthFactorWad,
          }]
        : []),
      lending,
    };
    return privateJson(response satisfies BorrowResponse, 200);
  };
}

export function createBorrowMarketHandler(dependencies: {
  authorize: SessionAuthorizer;
  rpc: MorphoMarketRpcReader;
  markets?: readonly VerifiedMorphoMarketRef[];
}) {
  return async function GET(request: Request, context: { params: Promise<{ marketId: string }> }) {
    const session = await authorizeSession(request, dependencies.authorize);
    if (session instanceof Response) return session;
    if (!session.smartAccount) return privateError("SMART_ACCOUNT_UNAVAILABLE", "A verified Base smart account is not available yet.", 503);
    const { marketId } = await context.params;
    const market = findMarket(dependencies.markets, marketId);
    if (!market) return privateError("BORROW_MARKET_NOT_FOUND", "The borrowing market is not configured.", 404);
    try {
      const snapshot = await dependencies.rpc.readSnapshot(session.smartAccount.address, market, request.signal);
      if (market.capabilities.borrow) {
        const borrowMarket = { ...market, availability: market.capabilities.borrow } satisfies BorrowMarketRef;
        return privateJson(projectBorrowSnapshot(snapshot, borrowMarket), 200);
      }
      if (market.capabilities.lend) return privateJson(lendingOnlyDetail(snapshot, market), 200);
      return privateError("BORROW_MARKET_NOT_FOUND", "The borrowing market is not configured.", 404);
    } catch {
      return privateError("BORROW_STATE_UNAVAILABLE", "Current verified market, position, oracle, liquidity, or limit state is unavailable.", 502);
    }
  };
}

function projectLendingOverview(reads: readonly MarketRead[]) {
  const opportunities: LendingOpportunity[] = [];
  const positions: LendingPosition[] = [];
  for (const { market, snapshot, error } of reads) {
    const mode = market.capabilities.lend ?? "withdraw-only";
    if (!snapshot) {
      opportunities.push({
        market: marketIdentity(market),
        availability: { status: "unavailable", mode, canSupply: false, canWithdraw: false, reason: error!, source: null, state: null },
      });
      continue;
    }
    try {
      const detail = projectLendingDetail(snapshot, market);
      opportunities.push({
        market: snapshot.market,
        availability: {
          status: "available", mode: detail.mode, canSupply: detail.canSupply, canWithdraw: detail.canWithdraw,
          reason: detail.reason, source: snapshot.source, state: detail.state,
        },
      });
      if (BigInt(detail.position.supplySharesRaw) > BigInt(0)) {
        positions.push({ market: snapshot.market, source: snapshot.source, ...detail.position });
      }
    } catch {
      opportunities.push({
        market: snapshot.market,
        availability: {
          status: "unavailable", mode, canSupply: false, canWithdraw: false,
          reason: "Current verified lending state is unavailable for this market.", source: null, state: null,
        },
      });
    }
  }
  return { version: "1" as const, opportunities, positions };
}

function lendingOnlyDetail(snapshot: MorphoMarketSnapshot, market: VerifiedMorphoMarketRef) {
  return {
    version: "1" as const,
    chainId: snapshot.chainId,
    walletAddress: snapshot.walletAddress,
    market: snapshot.market,
    source: snapshot.source,
    wallet: snapshot.wallet,
    lending: projectLendingDetail(snapshot, market),
  };
}

function emitReadUnavailable(session: { user: { subject: string }; accountProvider: string }, startedAt: number) {
  emitServerEvent("borrow-overview", {
    route: "/api/borrow",
    code: "BORROW_MARKET_READ_UNAVAILABLE",
    outcome: "unavailable",
    provider: "base-rpc",
    owner: { subject: session.user.subject, accountProvider: session.accountProvider },
    durationMs: Date.now() - startedAt,
  });
}
function findMarket(markets: readonly VerifiedMorphoMarketRef[] | undefined, marketId: string) {
  return markets
    ? markets.find((market) => market.marketId.toLowerCase() === marketId.toLowerCase()) ?? null
    : getVerifiedMorphoMarket(marketId);
}
function marketIdentity(market: VerifiedMorphoMarketRef) {
  return {
    id: market.marketId, morpho: market.morpho, loanToken: market.loanToken, collateralToken: market.collateralToken,
    oracle: market.oracle, irm: market.irm, lltvWad: market.lltvWad.toString(10), rank: market.rank,
  };
}
function privateJson(body: unknown, status: number) { return Response.json(body, { status, headers: privateHeaders }); }
function privateError(code: string, message: string, status: number) { return privateJson({ error: { code, message } }, status); }

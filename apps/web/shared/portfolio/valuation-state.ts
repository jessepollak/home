import type { RegionId } from "@/config/regions";
import type { PortfolioValuationSnapshot } from "@/shared/portfolio/valuation-types";
import type { VerifiedPortfolioSession } from "@/shared/portfolio/types";

export type { PortfolioValuationSnapshot };
export type VerifiedPortfolioValuationSession = VerifiedPortfolioSession;

export type PortfolioValuationState =
  | { status: "unavailable"; snapshot: null; error: null }
  | { status: "loading"; snapshot: null; error: null }
  | { status: "ready"; snapshot: PortfolioValuationSnapshot; error: null }
  | {
      status: "error";
      snapshot: null;
      error: "portfolio-valuation-unavailable";
    };

export type FetchPortfolioValuation = (
  region: RegionId,
  signal: AbortSignal,
) => Promise<unknown>;

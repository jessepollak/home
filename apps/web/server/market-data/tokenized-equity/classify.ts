import "server-only";

import type { ExactDecimal } from "@/shared/balances/types";
import { isClosedAt, openMarketSeconds, type EquityCalendar } from "./session";

export type TokenizedEquityFeed = {
  assetId: string;
  token: `0x${string}`;
  feedProxy: `0x${string}`;
  feedDecimals: number;
  heartbeatSeconds: number;
};

export type EquityBlock = { number: string; timestamp: string };

export type TokenizedEquityReference =
  | { assetId: string; status: "open" | "closed"; price: ExactDecimal; updatedAt: string; roundId: string; multiplierWad: string; block: EquityBlock }
  | { assetId: string; status: "paused"; lastPrice: ExactDecimal | null; updatedAt: string | null; multiplierWad: string; block: EquityBlock }
  | { assetId: string; status: "stale"; lastPrice: ExactDecimal; updatedAt: string; multiplierWad: string; block: EquityBlock }
  | { assetId: string; status: "unavailable"; reason: "not-deployed" | "read-failed" | "invalid-answer" | "decimals-mismatch" | "future-timestamp" | "registry-invalid"; block: EquityBlock | null };

const MAX_CLOSED_STRETCH_SECONDS = 7 * 86_400;

export type EquityRound = { roundId: bigint; answer: bigint; updatedAt: bigint; decimals: number };
export type EquityRegistry = { multiplier: bigint; paused: boolean };

export function classifyTokenizedEquityRound(input: {
  feed: TokenizedEquityFeed;
  round: EquityRound;
  registry: EquityRegistry;
  block: { number: bigint; timestamp: bigint };
  calendar?: EquityCalendar;
}): TokenizedEquityReference {
  const { feed, round, registry, block, calendar } = input;
  const referenceBlock = { number: block.number.toString(), timestamp: new Date(Number(block.timestamp) * 1000).toISOString() };
  const unavailable = (reason: Extract<TokenizedEquityReference, { status: "unavailable" }>["reason"]): TokenizedEquityReference => ({ assetId: feed.assetId, status: "unavailable", reason, block: referenceBlock });
  if (round.decimals !== feed.feedDecimals) return unavailable("decimals-mismatch");
  if (registry.multiplier <= BigInt(0)) return unavailable("registry-invalid");
  const price = round.answer > BigInt(0) ? { atoms: round.answer.toString(), scale: feed.feedDecimals } : null;
  const common = { assetId: feed.assetId, multiplierWad: registry.multiplier.toString(), block: referenceBlock };
  if (registry.paused) {
    const updatedAt = round.updatedAt > BigInt(0) && round.updatedAt <= BigInt(8_640_000_000_000)
      ? new Date(Number(round.updatedAt) * 1000).toISOString() : null;
    return { ...common, status: "paused", lastPrice: price, updatedAt };
  }
  if (!price || round.updatedAt === BigInt(0)) return unavailable("invalid-answer");
  if (round.updatedAt > block.timestamp + BigInt(60)) return unavailable("future-timestamp");
  if (round.updatedAt < BigInt(0)) return unavailable("invalid-answer");
  const updatedAt = new Date(Number(round.updatedAt) * 1000).toISOString();
  const staleAfter = feed.heartbeatSeconds + 3600;
  const wallSeconds = Number(block.timestamp - round.updatedAt);
  if (wallSeconds > staleAfter + MAX_CLOSED_STRETCH_SECONDS || openMarketSeconds(Number(round.updatedAt), Number(block.timestamp), calendar) > staleAfter) {
    return { ...common, status: "stale", lastPrice: price, updatedAt };
  }
  return { ...common, status: isClosedAt(Number(block.timestamp), calendar) ? "closed" : "open", price, updatedAt, roundId: round.roundId.toString() };
}

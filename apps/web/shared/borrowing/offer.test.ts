import { describe, expect, test } from "bun:test";
import type { BorrowMarketSnapshot, BorrowOverviewOpportunity } from "./contract";
import { leadingBorrowOffer } from "./offer";

const source = {
  provider: "Base JSON-RPC",
  blockNumber: "1",
  blockHash: `0x${"a".repeat(64)}`,
  blockTimestamp: "2026-09-23T12:00:00.000Z",
  fetchedAt: "2026-09-23T12:00:00.000Z",
} as const;
const snapshot = {} as BorrowMarketSnapshot;

function opportunity(
  label: string,
  rank: number,
  availability: BorrowOverviewOpportunity["availability"],
): BorrowOverviewOpportunity {
  return {
    market: { id: `0x${label}`, rank } as unknown as BorrowOverviewOpportunity["market"],
    availability,
  };
}

describe("leadingBorrowOffer", () => {
  test("skips a reducing-only market even when it ranks first", () => {
    const leading = leadingBorrowOffer([
      opportunity("reducing", 0, { status: "available", mode: "reducing-only", reason: null, source, snapshot }),
      opportunity("enabled", 1, { status: "available", mode: "enabled", reason: null, source, snapshot }),
    ]);

    expect(leading?.market.id).toBe("0xenabled");
  });

  test("skips unavailable markets and returns null when none can open", () => {
    expect(leadingBorrowOffer([
      opportunity("down", 0, { status: "unavailable", mode: "enabled", reason: "read failed", source: null }),
      opportunity("reducing", 1, { status: "available", mode: "reducing-only", reason: null, source, snapshot }),
    ])).toBeNull();
  });

  test("picks the lowest-ranked enabled market", () => {
    const leading = leadingBorrowOffer([
      opportunity("second", 2, { status: "available", mode: "enabled", reason: null, source, snapshot }),
      opportunity("first", 1, { status: "available", mode: "enabled", reason: null, source, snapshot }),
    ]);

    expect(leading?.market.id).toBe("0xfirst");
  });
});

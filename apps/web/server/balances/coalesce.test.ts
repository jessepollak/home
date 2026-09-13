import { describe, expect, test } from "bun:test";
import { createBalancesService } from "./coalesce";
import type { BalancesRead } from "./types";

const owner = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const read: BalancesRead = { block: { number: "1", hash: `0x${"1".repeat(64)}`, timestamp: "1" }, holdings: [], coverage: { registry: "complete", catalog: "unavailable" } };

describe("balances read coalescing", () => {
  test("shares one in-flight owner read and reuses it across regions", async () => {
    let count = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const service = createBalancesService({
      readUniverse: async () => ({ entries: [], catalogStatus: "unavailable" }),
      readBalances: async () => { count += 1; await gate; return read; },
      priceBalances: async () => [],
      now: () => new Date("2026-09-13T12:00:00.000Z"),
    });
    const first = service(owner, "US");
    const second = service(owner, "US");
    release();
    await Promise.all([first, second]);
    await service(owner, "DE");
    expect(count).toBe(1);
  });
});

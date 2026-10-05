import { describe, expect, test } from "bun:test";
import { encodeAbiParameters, parseAbiParameters } from "viem";
import { createTokenizedEquityHistoryReader } from "./history";
import { parseHistoryResponse } from "@/shared/invest/contracts/market-price-history";

const latest = BigInt(60_000_000);
const timestamp = Date.parse("2026-10-05T16:00:00.000Z");
const word = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}`;
function fixture(options: { wrongChain?: boolean; anchorFailOnce?: boolean; notDeployed?: boolean; leading?: boolean; paused?: boolean; stale?: boolean; duplicateTimes?: boolean; abort?: AbortController } = {}) {
  let blockReads = 0;
  const time = (block: bigint) => BigInt(timestamp / 1000) - (latest - block) * BigInt(2);
  const rpc = {
    async request(method: string, params: readonly unknown[], signal?: AbortSignal) {
      signal?.throwIfAborted();
      await Promise.resolve();
      if (method === "eth_chainId") return options.wrongChain ? "0x1" : "0x2105";
      if (method === "eth_blockNumber") return `0x${latest.toString(16)}`;
      const blockTag = params[0];
      if (typeof blockTag !== "string") throw new Error("Missing RPC block tag");
      const block = BigInt(blockTag); blockReads += 1;
      if (options.anchorFailOnce && blockReads === 1) throw new Error("RPC rejected");
      return { number: params[0], timestamp: `0x${(options.duplicateTimes ? BigInt(timestamp / 1000) : time(block)).toString(16)}` };
    },
    async batch(calls: readonly { method: string; params: readonly unknown[] }[], signal?: AbortSignal) {
      signal?.throwIfAborted();
      await Promise.resolve();
      const blockTag = calls[0]?.params[1];
      if (typeof blockTag !== "string") throw new Error("Missing batch RPC block tag");
      const block = BigInt(blockTag);
      const absent = options.notDeployed || options.leading && block < latest - BigInt(200_000);
      if (options.abort && blockReads >= 5) options.abort.abort();
      return [word(BigInt(8)), absent ? "0x" : encodeAbiParameters(parseAbiParameters("uint80, int256, uint256, uint256, uint80"),
        [BigInt(1), BigInt("1234567890123456789"), BigInt(0), options.stale ? time(block) - BigInt(20 * 86400) : time(block), BigInt(1)]),
      encodeAbiParameters(parseAbiParameters("uint256, bool"), [BigInt("2000000000000000000"), options.paused ?? false])];
    },
  };
  return { rpc, hasFeedBlockReads: () => blockReads > 0 };
}

describe("stock reference history", () => {
  test("preserves exact feed answers without applying the registry multiplier", async () => {
    const fake = fixture();
    const read = createTokenizedEquityHistoryReader({ rpc: fake.rpc, now: () => timestamp });
    const value = await read("nvdac", "1W");
    expect(value.status).toBe("ready"); expect(value.points).toHaveLength(32);
    expect(value.points.every((point) => point.value === "12345678901.23456789" && (point.session === "open" || point.session === "closed"))).toBe(true);
    const first = value.points[0]; const last = value.points.at(-1);
    if (!first || !last) throw new Error("Missing history endpoints");
    expect(first.time).toBe("2026-09-28T16:00:00.000Z");
    expect(last.time).toBe("2026-10-05T16:00:00.000Z");
    expect(parseHistoryResponse(value)).toEqual(value);
  });

  test("a wrong RPC chain fails before sampling", async () => {
    const fake = fixture({ wrongChain: true });
    const value = await createTokenizedEquityHistoryReader({ rpc: fake.rpc, now: () => timestamp })("nvdac", "1W");
    expect(value.status).toBe("error"); expect(value.points).toEqual([]);
    expect(fake.hasFeedBlockReads()).toBe(false);
  });

  test("a recovered anchor preserves the full history", async () => {
    const fake = fixture({ anchorFailOnce: true });
    const value = await createTokenizedEquityHistoryReader({ rpc: fake.rpc, now: () => timestamp })("nvdac", "1W");
    expect(value.status).toBe("ready"); expect(value.points).toHaveLength(32);
    expect(value.coverage?.gaps).toEqual([]);
  });

  test("budget exhaustion keeps partial observations and an incomplete gap", async () => {
    const fake = fixture();
    const read = createTokenizedEquityHistoryReader({ rpc: fake.rpc, now: () => timestamp, budget: 22 });
    const value = await read("nvdac", "1W");
    expect(value.status).toBe("ready"); expect(value.points).toHaveLength(5);
    expect(value.coverage?.gaps).toContainEqual(expect.objectContaining({ reason: "incomplete" }));
    expect(parseHistoryResponse(value)).toEqual(value);
  });

  test("a deadline abort preserves partial observations", async () => {
    const controller = new AbortController(); const fake = fixture({ abort: controller });
    const read = createTokenizedEquityHistoryReader({ rpc: fake.rpc, now: () => timestamp, deadline: () => controller.signal });
    const value = await read("nvdac", "1W");
    expect(value.status).toBe("ready"); expect(value.points.length).toBeGreaterThan(0); expect(value.points.length).toBeLessThan(32);
    expect(value.coverage?.gaps).toContainEqual(expect.objectContaining({ reason: "incomplete" }));
  });

  test("leading undeployed feed blocks produce gaps rather than substitute prices", async () => {
    const fake = fixture({ leading: true });
    const value = await createTokenizedEquityHistoryReader({ rpc: fake.rpc, now: () => timestamp })("nvdac", "1W");
    expect(value.status).toBe("ready"); expect(value.points.length).toBeLessThan(32);
    const first = value.points[0];
    if (!first) throw new Error("Missing first deployed history point");
    expect(value.coverage?.gaps).toEqual([{ from: "2026-09-28T16:00:00.000Z", to: first.time, reason: "not-deployed" }]);
  });

  test.each(["paused", "stale"] as const)("%s samples never become points", async (state) => {
    const fake = fixture({ [state]: true });
    const value = await createTokenizedEquityHistoryReader({ rpc: fake.rpc, now: () => timestamp })("nvdac", "1D");
    expect(value.status).toBe("error"); expect(value.points).toEqual([]);
    expect(value.coverage?.gaps).toEqual([{ from: "2026-10-04T16:00:00.000Z", to: "2026-10-05T16:00:00.000Z", reason: state }]);
  });

  test("all undeployed samples produce empty history", async () => {
    const fake = fixture({ notDeployed: true }); const read = createTokenizedEquityHistoryReader({ rpc: fake.rpc, now: () => timestamp });
    const value = await read("nvdac", "1D"); expect(value.status).toBe("empty"); expect(value.points).toEqual([]);
  });

  test("duplicate actual timestamps are dropped to keep observations strictly increasing", async () => {
    const fake = fixture({ duplicateTimes: true });
    const value = await createTokenizedEquityHistoryReader({ rpc: fake.rpc, now: () => timestamp })("nvdac", "1D");
    expect(value.points).toHaveLength(1); expect(parseHistoryResponse(value)).toEqual(value);
  });

});

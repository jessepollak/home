import { describe, expect, test } from "bun:test";
import { createInvestHistoryAdmission } from "./history-admission";

const address = "0x1111111111111111111111111111111111111111";
const indexed = { address: address as `0x${string}`, name: "Indexed", symbol: "IDX", decimals: 18 };

describe("Invest history identity admission", () => {
  test("admits trending OR independently verified exact indexed identity", async () => {
    let lookups = 0;
    const admitTrending = createInvestHistoryAdmission({ trending: async () => true, lookup: async () => { lookups++; return new Map(); } });
    expect(await admitTrending(address, 8453)).toBe(true);
    expect(lookups).toBe(0);
    const admitIndexed = createInvestHistoryAdmission({ trending: async () => false, lookup: async () => new Map([[address, indexed]]) });
    expect(await admitIndexed(address, 8453)).toBe(true);
  });

  test("rejects wrong chain, mismatched lookup identity, upstream failure and malformed address", async () => {
    let calls = 0;
    const admit = createInvestHistoryAdmission({ trending: async () => false, lookup: async () => { calls++; return new Map([[address, { ...indexed, address: "0x2222222222222222222222222222222222222222" }]]); } });
    expect(await admit(address, 1)).toBe(false);
    expect(await admit("invalid", 8453)).toBe(false);
    expect(await admit(address, 8453)).toBe(false);
    expect(calls).toBe(1);
    expect(await createInvestHistoryAdmission({ trending: async () => { throw new Error("unavailable"); }, lookup: async () => { throw new Error("unavailable"); } })(address, 8453)).toBe(false);
  });

  test("coalesces requests, caches and bounds concurrent distinct reads", async () => {
    let release!: () => void;
    const wait = new Promise<void>((resolve) => { release = resolve; });
    let calls = 0;
    const admit = createInvestHistoryAdmission({ trending: async () => { calls++; await wait; return true; }, lookup: async () => new Map() });
    const first = admit(address, 8453);
    const same = admit(address, 8453);
    const second = admit("0x9999999999999999999999999999999999999999", 8453);
    release();
    expect(await second).toBe(true);
    await Promise.all([first, same]);
    expect(await admit(address, 8453)).toBe(true);
    expect(calls).toBe(2);
  });
  test("retains false through the TTL boundary, refetches once afterward, and saturates at eight flights", async () => {
    let time = 0;
    let calls = 0;
    let release!: (value: boolean) => void;
    const held = new Promise<boolean>((resolve) => { release = resolve; });
    const admit = createInvestHistoryAdmission({ now: () => time, trending: async () => { calls++; return calls <= 8 ? held : false; }, lookup: async () => new Map() });
    const keys = Array.from({ length: 8 }, (_, index) => `0x${index.toString(16).padStart(40, "0")}`);
    const pending = keys.map((key) => admit(key, 8453));
    const joined = admit(keys[0]!, 8453);
    expect(await admit("0xffffffffffffffffffffffffffffffffffffffff", 8453)).toBe(false);
    expect(calls).toBe(8);
    release(false);
    const responses = await Promise.all([...pending, joined]);
    expect(responses).toHaveLength(9);
    expect(responses.every((value) => value === false)).toBe(true);
    time = 45_000;
    expect(await admit(keys[0]!, 8453)).toBe(false);
    expect(calls).toBe(8);
    time = 45_001;
    expect(await admit(keys[0]!, 8453)).toBe(false);
    expect(calls).toBe(9);
  });
});

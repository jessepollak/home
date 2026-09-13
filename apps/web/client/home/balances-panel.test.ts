import { describe, expect, test } from "bun:test";
import type { RegionId } from "@/config/regions";
import { clampHomeScrollTop, homeBalancesRestoreScope } from "./balances-panel";

const ADDRESS = "0x1111111111111111111111111111111111111111";

describe("balances restoration helpers", () => {
  test("clamps saved offsets to a measurable scroll range", () => {
    const tall = { scrollHeight: 1000, clientHeight: 400 } as HTMLElement;
    const short = { scrollHeight: 600, clientHeight: 400 } as HTMLElement;
    const flat = { scrollHeight: 300, clientHeight: 400 } as HTMLElement;

    expect(clampHomeScrollTop(tall, 480)).toBe(480);
    expect(clampHomeScrollTop(short, 480)).toBe(200);
    expect(clampHomeScrollTop(flat, 480)).toBe(480);
    expect(clampHomeScrollTop(null, 480)).toBe(480);
    expect(clampHomeScrollTop(tall, 0)).toBe(0);
  });

  test("fences restoration by every owner identity field", () => {
    const base = {
      ownerKey: "owner",
      provider: "cdp-embedded",
      subject: "subject",
      smartAccount: ADDRESS,
      region: "US" as RegionId,
    };
    const scope = homeBalancesRestoreScope(base);
    expect(scope).toBeTruthy();
    for (const changed of [
      { ...base, ownerKey: "other" },
      { ...base, provider: "base-account" },
      { ...base, subject: "other" },
      { ...base, smartAccount: "0x2222222222222222222222222222222222222222" },
      { ...base, region: "BR" as RegionId },
    ]) {
      expect(homeBalancesRestoreScope(changed)).not.toBe(scope);
    }
    expect(homeBalancesRestoreScope({ ...base, smartAccount: null })).toBeNull();
  });
});

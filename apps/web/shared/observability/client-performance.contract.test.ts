import { describe, expect, test } from "bun:test";
import { parseClientPerformanceReport } from "./client-performance.contract";

const navigation = { version: 1, kind: "home-navigation", route: "/home", from: "/cash",
  trigger: "in-app", cache: "first-visit", device: "mobile-low", durationMs: 12.8 } as const;
const scroll = { version: 1, kind: "home-scroll", route: "/invest", cache: "retained",
  device: "desktop-unknown", durationMs: 324, frameCount: 3.8,
  slowFrameCount: 8, maxFrameMs: 67 } as const;

describe("closed interaction reports", () => {
  test("navigation rounds and caps durations", () => {
    expect(parseClientPerformanceReport(navigation)).toEqual({ ...navigation, durationMs: 10 });
    expect(parseClientPerformanceReport({ ...navigation, durationMs: 50_000 })).toMatchObject({ durationMs: 10_000 });
    expect(parseClientPerformanceReport({ ...navigation, durationMs: -12 })).toMatchObject({ durationMs: 0 });
  });
  test("scroll rounds, bounds, clamps slow frames, and pairs optional fields", () => {
    expect(parseClientPerformanceReport(scroll)).toEqual({ ...scroll, durationMs: 300,
      frameCount: 4, slowFrameCount: 4, maxFrameMs: 70 });
    expect(parseClientPerformanceReport({ ...scroll, durationMs: 50_000, frameCount: 20_000,
      slowFrameCount: 20_000, maxFrameMs: 9_000, longFrameCount: 2_000, longFrameMs: 40_000 }))
      .toMatchObject({ durationMs: 30_000, frameCount: 10_000, slowFrameCount: 10_000,
        maxFrameMs: 5_000, longFrameCount: 1_000, longFrameMs: 30_000 });
    expect(parseClientPerformanceReport({ ...scroll, longFrameCount: 1.6, longFrameMs: 34 }))
      .toMatchObject({ longFrameCount: 2, longFrameMs: 30 });
  });
  test("rejects private/unknown dimensions, missing keys and invalid numerics", () => {
    for (const invalid of [
      { ...navigation, address: "private" }, { ...navigation, deployment: "private" },
      { ...scroll, userAgent: "private" }, { ...navigation, from: "/home" },
      { ...navigation, from: "/" }, { ...navigation, route: "/" },
      { ...navigation, trigger: "click" }, { ...scroll, cache: "cold" },
      { ...scroll, device: "tablet" }, { ...scroll, longFrameCount: 1 },
      { ...scroll, longFrameMs: 12 }, { ...scroll, frameCount: "3" },
      { ...scroll, maxFrameMs: Infinity }, { ...navigation, durationMs: NaN },
      { ...navigation, durationMs: "12" },
      Object.fromEntries(Object.entries(navigation).filter(([key]) => key !== "cache")),
      Object.fromEntries(Object.entries(scroll).filter(([key]) => key !== "frameCount")),
    ]) expect(parseClientPerformanceReport(invalid)).toBeNull();
  });
  test("keeps the existing kinds unchanged", () => {
    const startup = { version: 1, kind: "home-startup", route: "/", outcome: "ready",
      cache: "unknown", shellMs: 1, totalMs: 3 } as const;
    expect(parseClientPerformanceReport(startup)).toEqual(startup);
  });
});

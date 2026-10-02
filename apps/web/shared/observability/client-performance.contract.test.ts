import { describe, expect, test } from "bun:test";
import { CLIENT_PERFORMANCE_KINDS, clientPerformanceBucket, parseClientPerformanceReport } from "./client-performance.contract";

const navigation = { version: 1, kind: "home-navigation", route: "/home", from: "/cash",
  trigger: "in-app", cache: "first-visit", device: "mobile-low", durationMs: 12.8 } as const;
const scroll = { version: 1, kind: "home-scroll", route: "/invest", cache: "retained",
  device: "desktop-unknown", durationMs: 324, frameCount: 3.8,
  slowFrameCount: 8, maxFrameMs: 67 } as const;

describe("closed interaction reports", () => {
  test("accepts bounded optional tap attribution without changing older reports", () => {
    expect(parseClientPerformanceReport({ ...navigation, dispatchDelayMs: 603, inputToPaintMs: 627,
      cachePersistMs: 514, contentState: "ready" })).toEqual({ ...navigation, durationMs: 10,
      dispatchDelayMs: 600, inputToPaintMs: 630, cachePersistMs: 510, contentState: "ready" });
    expect(parseClientPerformanceReport({ ...navigation, dispatchDelayMs: 40_000, inputToPaintMs: 50_000,
      cachePersistMs: 90_000 })).toMatchObject({ dispatchDelayMs: 30_000, inputToPaintMs: 30_000, cachePersistMs: 30_000 });
  });
  test("rejects incomplete or malformed attribution and private readiness labels", () => {
    for (const extra of [
      { dispatchDelayMs: 10 }, { inputToPaintMs: 20 },
      { dispatchDelayMs: 100, inputToPaintMs: 20 },
      { dispatchDelayMs: 0, inputToPaintMs: 0 },
      { dispatchDelayMs: 10, inputToPaintMs: 20, trigger: "history" },
      { dispatchDelayMs: Infinity, inputToPaintMs: 30 },
      { cachePersistMs: "100" }, { cachePersistMs: NaN }, { contentState: "private-owner" },
    ]) expect(parseClientPerformanceReport({ ...navigation, ...extra })).toBeNull();
  });
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
  test("accepts an optional closed engine without changing reports from older builds", () => {
    for (const report of [navigation, scroll]) {
      expect(parseClientPerformanceReport(report)).not.toHaveProperty("engine");
      for (const engine of ["chromium", "webkit", "gecko", "other"] as const) {
        expect(parseClientPerformanceReport({ ...report, engine }))
          .toMatchObject({ kind: report.kind, engine });
      }
      for (const engine of ["safari", "private", "", null, undefined]) {
        expect(parseClientPerformanceReport({ ...report, engine })).toBeNull();
      }
    }
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
      { ...navigation, engine: "private" }, { ...scroll, engine: "safari" },
      Object.fromEntries(Object.entries(navigation).filter(([key]) => key !== "cache")),
      Object.fromEntries(Object.entries(scroll).filter(([key]) => key !== "frameCount")),
    ]) expect(parseClientPerformanceReport(invalid)).toBeNull();
  });
  test("keeps the existing kinds unchanged", () => {
    const startup = { version: 1, kind: "home-startup", route: "/", outcome: "ready",
      cache: "unknown", shellMs: 1, totalMs: 3 } as const;
    expect(parseClientPerformanceReport(startup)).toEqual(startup);
  });
  test("routes closed kinds into independent budgets", () => {
    expect(CLIENT_PERFORMANCE_KINDS).toEqual([
      "home-startup", "home-auth-phase", "home-navigation", "home-scroll",
    ]);
    expect(CLIENT_PERFORMANCE_KINDS.map(clientPerformanceBucket)).toEqual([
      "reporting", "reporting", "interaction", "interaction",
    ]);
  });
});

test("parses optional balance stages and rejects arbitrary cache details", () => {
  const report = { version: 1, kind: "home-startup", route: "/home", outcome: "ready", cache: "restored",
    shellMs: 10, totalMs: 100, balanceCache: "cold", balanceFetchMs: 40, balanceResponseMs: 80, balanceParsedMs: 90 } as const;
  expect(parseClientPerformanceReport(report)).toEqual(report);
  expect(parseClientPerformanceReport({ ...report, balanceCache: "private-owner" })).toBeNull();
  expect(parseClientPerformanceReport({ ...report, balanceFetchMs: Infinity })).toBeNull();
  expect(parseClientPerformanceReport({ ...report, wallet: "private-wallet" })).toBeNull();
});

describe("schema boundary compatibility", () => {
  const startup = { version: 1, kind: "home-startup", route: "/", outcome: "ready",
    cache: "unknown", shellMs: 1, totalMs: 3 } as const;
  const restore = { version: 1, kind: "home-auth-phase", route: "/", flow: "restore",
    hint: "none", outcome: "signed-out", sessionSettledMs: 100, totalMs: 100 } as const;
  const signout = { version: 1, kind: "home-auth-phase", route: "/", flow: "signout",
    outcome: "success", nativeLogoutAttempted: false, walletDisconnectAttempted: false,
    cdpSignOutAttempted: false, totalMs: 100 } as const;

  test("rejects every unsupported version and missing own required key for every shape", () => {
    for (const report of [startup, restore, signout, navigation, scroll]) {
      for (const version of [0, 2, "1", undefined]) {
        expect(parseClientPerformanceReport({ ...report, version })).toBeNull();
      }
      for (const [key, value] of Object.entries(report)) {
        const missing = Object.fromEntries(Object.entries(report).filter(([field]) => field !== key));
        expect(parseClientPerformanceReport(missing)).toBeNull();
        expect(parseClientPerformanceReport(Object.assign(Object.create({ [key]: value }), missing)))
          .toBeNull();
      }
    }
  });

  test("rejects present undefined optionals instead of treating them as absent", () => {
    const reports = [
      [startup, ["sessionMs", "balancesMs", "balanceCache", "balanceFetchMs", "balanceResponseMs", "balanceParsedMs", "interactiveMs"]],
      [restore, ["sdkActivateMs", "cdpInitializedMs", "nativeSettledMs", "tokenMs", "validationMs", "stalledStage"]],
      [signout, ["visibleNavigationMs", "nativeLogoutMs", "walletDisconnectMs", "cdpSignOutMs"]],
      [navigation, ["engine", "dispatchDelayMs", "inputToPaintMs", "cachePersistMs", "contentState"]],
      [scroll, ["engine", "longFrameCount", "longFrameMs"]],
    ] as const;
    for (const [report, fields] of reports) {
      for (const field of fields) {
        expect(parseClientPerformanceReport({ ...report, [field]: undefined })).toBeNull();
      }
    }
  });

  test("checks optional pairing against normalized timings", () => {
    expect(parseClientPerformanceReport({ ...navigation, dispatchDelayMs: 14, inputToPaintMs: 11 }))
      .toEqual({ ...navigation, durationMs: 10, dispatchDelayMs: 10, inputToPaintMs: 10 });
    expect(parseClientPerformanceReport({ ...scroll, longFrameCount: -1, longFrameMs: -10 }))
      .toMatchObject({ longFrameCount: 0, longFrameMs: 0 });
  });

  test("retains own-field boundaries for non-JSON objects", () => {
    const inherited = Object.assign(Object.create({ engine: "private", owner: "private" }), navigation);
    expect(parseClientPerformanceReport(inherited)).toEqual({ ...navigation, durationMs: 10 });
    expect(parseClientPerformanceReport(Object.assign(Object.create({ contentState: "ready" }), navigation)))
      .toEqual({ ...navigation, durationMs: 10, contentState: "ready" });
    expect(parseClientPerformanceReport(Object.assign(Object.create({ contentState: "private" }), navigation)))
      .toEqual({ ...navigation, durationMs: 10 });
    expect(parseClientPerformanceReport(Object.defineProperty({ ...startup }, "totalMs", { enumerable: false })))
      .toEqual(startup);
    expect(parseClientPerformanceReport(Object.defineProperty({ ...startup }, "owner", { value: "private" })))
      .toEqual(startup);
    expect(parseClientPerformanceReport(Object.assign(Object.create({ balanceCache: "cold" }), startup)))
      .toEqual({ ...startup, balanceCache: "cold" });
    expect(parseClientPerformanceReport(Object.assign(Object.create({ balanceCache: "private" }), startup)))
      .toEqual(startup);
  });
  test("keeps the beacon field order stable for every report kind", () => {
    expect(Object.keys(parseClientPerformanceReport({
      version: 1, kind: "home-startup", route: "/home", outcome: "ready", cache: "restored",
      shellMs: 10, sessionMs: 20, balancesMs: 30, interactiveMs: 40, balanceFetchMs: 50,
      balanceResponseMs: 60, balanceParsedMs: 70, balanceCache: "cold", totalMs: 100,
    }) ?? {})).toEqual([
      "version", "kind", "route", "outcome", "cache", "shellMs", "sessionMs", "balancesMs",
      "interactiveMs", "balanceFetchMs", "balanceResponseMs", "balanceParsedMs", "balanceCache", "totalMs",
    ]);
    expect(Object.keys(parseClientPerformanceReport({
      version: 1, kind: "home-auth-phase", route: "/home", flow: "restore", hint: "cdp",
      outcome: "verified", sdkActivateMs: 100, cdpInitializedMs: 150, nativeSettledMs: 200,
      tokenMs: 250, validationMs: 300, stalledStage: "token", sessionSettledMs: 350, totalMs: 400,
    }) ?? {})).toEqual([
      "version", "kind", "route", "flow", "hint", "outcome", "sdkActivateMs", "cdpInitializedMs",
      "nativeSettledMs", "tokenMs", "validationMs", "stalledStage", "sessionSettledMs", "totalMs",
    ]);
    expect(Object.keys(parseClientPerformanceReport({
      version: 1, kind: "home-auth-phase", route: "/home", flow: "signout", outcome: "success",
      visibleNavigationMs: 50, nativeLogoutAttempted: true, nativeLogoutMs: 100,
      walletDisconnectAttempted: true, walletDisconnectMs: 150, cdpSignOutAttempted: true,
      cdpSignOutMs: 200, totalMs: 250,
    }) ?? {})).toEqual([
      "version", "kind", "route", "flow", "outcome", "visibleNavigationMs", "nativeLogoutMs",
      "walletDisconnectMs", "cdpSignOutMs", "nativeLogoutAttempted", "walletDisconnectAttempted",
      "cdpSignOutAttempted", "totalMs",
    ]);
    expect(Object.keys(parseClientPerformanceReport({
      version: 1, kind: "home-navigation", route: "/home", from: "/cash", trigger: "in-app",
      cache: "retained", device: "mobile-high", engine: "chromium", dispatchDelayMs: 100,
      inputToPaintMs: 200, cachePersistMs: 300, contentState: "ready", durationMs: 150,
    }) ?? {})).toEqual([
      "version", "kind", "route", "from", "trigger", "cache", "device", "dispatchDelayMs",
      "inputToPaintMs", "cachePersistMs", "contentState", "engine", "durationMs",
    ]);
    expect(Object.keys(parseClientPerformanceReport({
      version: 1, kind: "home-scroll", route: "/invest", cache: "first-visit", device: "desktop-low",
      engine: "webkit", durationMs: 400, frameCount: 50, slowFrameCount: 5, maxFrameMs: 120,
      longFrameCount: 2, longFrameMs: 200,
    }) ?? {})).toEqual([
      "version", "kind", "route", "cache", "device", "engine", "durationMs", "frameCount",
      "slowFrameCount", "maxFrameMs", "longFrameCount", "longFrameMs",
    ]);
  });
});

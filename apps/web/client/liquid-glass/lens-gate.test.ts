import { describe, expect, test } from "bun:test";
import { isChromiumEngine, shouldMountNavLens, shouldRefractNavRim, type NavLensEnvironment } from "./lens-gate";

const glass: NavLensEnvironment = { mobileLayout: true, reducedTransparency: false, forcedColors: false, backdropFilter: true };
const chrome = [{ brand: "Google Chrome" }, { brand: "Chromium" }, { brand: "Not=A?Brand" }];

describe("shouldMountNavLens", () => {
  test("mounts in the mobile glass layout", () => {
    expect(shouldMountNavLens(glass)).toBe(true);
  });

  test.each([
    ["the desktop layout", { mobileLayout: false }],
    ["reduced transparency", { reducedTransparency: true }],
    ["forced colors", { forcedColors: true }],
    ["the opaque path without backdrop-filter", { backdropFilter: false }],
  ] as const)("stays unmounted for %s", (_, change) => {
    expect(shouldMountNavLens({ ...glass, ...change })).toBe(false);
  });
});

describe("isChromiumEngine", () => {
  test.each([
    ["Chrome", chrome],
    ["Edge", [{ brand: "Microsoft Edge" }, { brand: "Chromium" }, { brand: "Not/A)Brand" }]],
    ["headless Chromium", [{ brand: "HeadlessChrome" }, { brand: "Chromium" }]],
  ])("recognises %s", (_, brands) => {
    expect(isChromiumEngine(brands)).toBe(true);
  });

  test.each([
    ["Safari and every iOS browser, which expose no brands", undefined],
    ["Firefox, which exposes no brands", undefined],
    ["an insecure context without user-agent data", null],
    ["an empty brand list", []],
    ["a brand list without Chromium", [{ brand: "Not A;Brand" }, { brand: "Google Chrome" }]],
    ["a brand that only contains the word", [{ brand: "Chromium-ish" }]],
  ] as const)("rejects %s", (_, brands) => {
    expect(isChromiumEngine(brands)).toBe(false);
  });
});

describe("shouldRefractNavRim", () => {
  test("refracts the capsule rim in Chromium on the glass path", () => {
    expect(shouldRefractNavRim({ ...glass, brands: chrome })).toBe(true);
  });

  test("keeps the frosted capsule outside Chromium", () => {
    expect(shouldRefractNavRim({ ...glass, brands: undefined })).toBe(false);
  });

  test.each([
    ["the desktop layout", { mobileLayout: false }],
    ["reduced transparency", { reducedTransparency: true }],
    ["forced colors", { forcedColors: true }],
    ["the opaque path without backdrop-filter", { backdropFilter: false }],
  ] as const)("stays off in Chromium for %s", (_, change) => {
    expect(shouldRefractNavRim({ ...glass, ...change, brands: chrome })).toBe(false);
  });
});

import { describe, expect, test } from "bun:test";
import { composite, contrastRatio, formatRatio, relativeLuminance, toHex } from "../../stories/review/explorations/library/foundations/contrast";
import { blockDeclarations, colorFamily, colorTokens, themeScale, topLevelBlocks } from "../../stories/review/explorations/library/foundations/tokens";
import { cubicBezier, motionUsage, radiusUsage, spacingUsage, typeUsage } from "../../stories/review/explorations/library/foundations/usage";

const white = { r: 255, g: 255, b: 255, a: 1 };
const black = { r: 0, g: 0, b: 0, a: 1 };
const hex = (value: string) => ({
  r: Number.parseInt(value.slice(1, 3), 16), g: Number.parseInt(value.slice(3, 5), 16), b: Number.parseInt(value.slice(5, 7), 16), a: 1,
});

describe("contrast", () => {
  test("uses WCAG relative luminance", () => {
    expect(relativeLuminance(white)).toBe(1);
    expect(relativeLuminance(black)).toBe(0);
    expect(contrastRatio(black, white)).toBe(21);
    expect(contrastRatio(white, black)).toBe(21);
    expect(contrastRatio(white, white)).toBe(1);
  });

  test("matches published ratios for Home tokens", () => {
    expect(contrastRatio(hex("#0052ff"), white)).toBeCloseTo(5.75, 2);
    expect(contrastRatio(hex("#c8372d"), white)).toBeCloseTo(5.2, 1);
    expect(contrastRatio(hex("#737373"), hex("#f5f5f5"))).toBeLessThan(4.5);
  });

  test("composites translucent colours over their background before measuring", () => {
    const tint = { r: 255, g: 255, b: 255, a: 0.2 };
    const dark = hex("#171717");
    expect(composite(tint, dark)).toEqual({ r: 0.2 * 255 + 0.8 * 23, g: 0.2 * 255 + 0.8 * 23, b: 0.2 * 255 + 0.8 * 23, a: 1 });
    expect(contrastRatio(tint, dark)).toBeCloseTo(contrastRatio(composite(tint, dark), dark), 10);
    expect(contrastRatio(black, { ...black, a: 0 })).toBe(21);
  });

  test("never rounds a failing ratio up to a pass", () => {
    expect(formatRatio(4.4999)).toBe("4.49:1");
    expect(formatRatio(21)).toBe("21.00:1");
  });

  test("formats hex with alpha only when translucent", () => {
    expect(toHex(hex("#0052ff"))).toBe("#0052ff");
    expect(toHex({ r: 255, g: 255, b: 255, a: 0.2 })).toBe("#ffffff33");
  });
});

const css = `@import "tailwindcss";
@custom-variant dark (&:is(.dark *));
@theme inline {
  --spacing-hairline: 1px;
  --color-card: var(--card);
  --radius-sm: calc(var(--radius) * 0.6);
  --radius-lg: var(--radius);
}
:root {
  color-scheme: light;
  --background: oklch(1 0 0); --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0); --muted: oklch(0.97 0 0); --muted-foreground: oklch(0.556 0 0);
  --border: oklch(0.922 0 0);
  --primary: #0052ff; --primary-foreground: #ffffff; --ring: #0052ff;
  --radius: 0.25rem;
  --market-loss: #c8372d; --warning: #b45309; --status-positive: #137333;
  --balance-bar-cash: #0aa852;
  --balance-bar-pending-cash-out: repeating-linear-gradient(-45deg, var(--balance-bar-cash) 0 1.5px, transparent 1.5px 3px);
  --payout-zelle: #6d1ed4; --payout-zelle-foreground: #ffffff;
  --globe-land: #8295ad;
  --shell-safe-area-bottom: 0px;
  --shell-navigation-offset: max(calc(var(--shell-safe-area-bottom) - 0.75rem), 0.75rem);
  --overlay: oklch(0.145 0 0 / 10%);
}
@supports (height: 100dvh) {
  :root { --shell-viewport-overhang: calc(100dvh - 100svh); }
}
.dark {
  color-scheme: dark;
  --background: oklch(0.205 0 0); --card: oklch(0.205 0 0); --primary: #578bfa; --overlay: oklch(0 0 0 / 60%);
}`;

describe("token parsing", () => {
  test("reads only top-level :root and .dark declarations", () => {
    const fixture = `@import "x"; :root { --a: #fff; --b: 1px; } @supports (x) { :root { --c: red; } } .dark { --a: #000; }`;
    expect(topLevelBlocks(fixture).map((block) => block.prelude)).toEqual([":root", "@supports (x)", ".dark"]);
    expect(blockDeclarations(fixture, ":root")).toEqual([{ name: "a", value: "#fff" }, { name: "b", value: "1px" }]);
    expect(blockDeclarations(fixture, ".dark")).toEqual([{ name: "a", value: "#000" }]);
  });

  test("lists every colour token in :root and nothing else", () => {
    const tokens = colorTokens(css);
    const root = blockDeclarations(css, ":root");
    const names = tokens.map((token) => token.name);
    expect(names).toContain("primary");
    expect(names).toContain("balance-bar-pending-cash-out");
    expect(names).not.toContain("radius");
    expect(names.some((name) => name.startsWith("shell-"))).toBe(false);
    expect(new Set(names).size).toBe(names.length);
    expect(names.every((name) => root.some((declaration) => declaration.name === name))).toBe(true);
    const dark = new Set(blockDeclarations(css, ".dark").map((declaration) => declaration.name));
    for (const name of dark) if (root.find((declaration) => declaration.name === name)?.value.match(/^(#|oklch)/)) expect(names).toContain(name);
  });

  test("derives families from names and orders them", () => {
    expect(["card", "foreground", "muted-foreground", "primary-foreground", "ring", "warning", "status-caution",
      "market-gain", "balance-cash", "payout-zelle-foreground"].map(colorFamily))
      .toEqual(["surface", "text", "text", "primary", "primary", "status", "status", "market", "balance", "payout"]);
    const families = colorTokens(css).map((token) => token.family);
    expect([...new Set(families)]).toEqual(["surface", "text", "primary", "status", "market", "balance", "payout", "globe"]);
  });

  test("assigns theme.md thresholds by role", () => {
    const rule = (name: string) => colorTokens(css).find((token) => token.name === name)!;
    expect(rule("muted-foreground").rule).toEqual({ use: "text", min: 4.5, against: "surfaces" });
    expect(rule("market-loss").rule).toEqual({ use: "text", min: 4.5, against: "surfaces" });
    expect(rule("status-positive").rule).toEqual({ use: "graphic", min: 3, against: "surfaces" });
    expect(rule("ring").rule).toEqual({ use: "graphic", min: 3, against: "surfaces" });
    expect(rule("primary-foreground").rule).toEqual({ use: "text", min: 4.5, against: { pair: "primary" } });
    expect(rule("payout-zelle").rule).toEqual({ use: "brand" });
    expect(rule("border").rule).toEqual({ use: "surface" });
    expect(rule("balance-bar-pending-cash-out")).toMatchObject({ pattern: true, rule: { use: "pattern" }, rootOnly: true });
    expect(rule("primary").rootOnly).toBe(false);
  });

  test("reads the @theme inline radius and spacing scales", () => {
    expect(themeScale(css, "radius")).toEqual([{ name: "sm", value: "calc(var(--radius) * 0.6)" }, { name: "lg", value: "var(--radius)" }]);
    expect(themeScale(css, "spacing").map((entry) => entry.name)).toContain("hairline");
  });
});

describe("usage scanning", () => {
  const files = [{
    path: "components/ui/sheet.tsx",
    source: `const a = "text-sm font-medium md:text-lg leading-snug tabular-nums text-[13px] text-muted-foreground";
const b = "p-2 gap-1.5 -mt-px px-hairline rounded-lg data-[x]:rounded-t-xl rounded-full";
const c = "transition-[transform,opacity] duration-350 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:duration-0! data-[immediate]:duration-0 lg:duration-180 active:scale-[0.97] motion-reduce:active:scale-none";
const d = "[transition:transform_500ms_cubic-bezier(0.22,1,0.36,1),opacity_250ms]";`,
  }];

  test("counts stock type utilities and flags off-scale sizes", () => {
    const usage = typeUsage(files);
    expect(usage.sizes).toEqual([{ step: "sm", count: 1 }, { step: "lg", count: 1 }]);
    expect(usage.weights).toEqual([{ step: "medium", count: 1 }]);
    expect(usage.leadings).toEqual([{ step: "snug", count: 1 }]);
    expect(usage.arbitrarySizes).toEqual([{ step: "13px", count: 1 }]);
    expect(usage.tabular).toBe(1);
  });

  test("counts radius and spacing steps including named spacing", () => {
    expect(radiusUsage(files)).toEqual([{ step: "lg", count: 1 }, { step: "xl", count: 1 }, { step: "full", count: 1 }]);
    expect(spacingUsage(files, ["hairline"]).map((entry) => entry.step)).toEqual(["px", "1.5", "2", "hairline"]);
  });

  test("reads transitions without reduced-motion or immediate overrides", () => {
    const { uses, press } = motionUsage(files);
    expect(uses).toContainEqual({ component: "sheet", properties: "transform, opacity", duration: 350,
      easing: "cubic-bezier(0.22,1,0.36,1)", variant: "" });
    expect(uses).toContainEqual({ component: "sheet", properties: "transform, opacity", duration: 180, easing: null, variant: "lg" });
    expect(uses.some((use) => use.duration === 0)).toBe(false);
    expect(uses).toContainEqual({ component: "sheet", properties: "transform", duration: 500, easing: "cubic-bezier(0.22,1,0.36,1)", variant: "" });
    expect(uses).toContainEqual({ component: "sheet", properties: "opacity", duration: 250, easing: "ease", variant: "" });
    expect(press).toEqual([{ component: "sheet", variant: "active", scale: 0.97 }]);
  });

  test("parses cubic-bezier and keyword easings", () => {
    expect(cubicBezier("cubic-bezier(0.22, 1, 0.36, 1)")).toEqual([0.22, 1, 0.36, 1]);
    expect(cubicBezier("ease")).toEqual([0.25, 0.1, 0.25, 1]);
    expect(cubicBezier("steps(4)")).toBeNull();
  });
});

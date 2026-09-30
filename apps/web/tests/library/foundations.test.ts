import { describe, expect, test } from "bun:test";
import "@/client/account/dom-test-harness";
import { Scanner } from "@tailwindcss/oxide";
import { scanLibraryCandidates } from "../../.storybook/library-candidates";
import { confirmedCandidates, type SourceFile } from "../../stories/review/explorations/library/foundations/candidates";
import { readMotionReference } from "../../stories/review/explorations/library/foundations/motion-values";
import { measureColor, measurementSummary } from "../../stories/review/explorations/library/foundations/color-measurements";
import { probeThemes, readThemeValues, toRgba, utilityValues } from "../../stories/review/explorations/library/foundations/probe";
import { componentCandidateSet, loadCandidateSet } from "../../stories/review/explorations/library/foundations/sources";
import { composite, contrastRatio, formatRatio, relativeLuminance, toHex } from "../../stories/review/explorations/library/foundations/contrast";
import { blockDeclarations, colorFamily, colorTokens, radiusSteps, themeScale, topLevelBlocks } from "../../stories/review/explorations/library/foundations/tokens";
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

const knownColors = new Set(blockDeclarations(css, ":root").filter(({ name }) =>
  !["radius", "shell-safe-area-bottom", "shell-navigation-offset"].includes(name)).map(({ value }) => value));
const validColor = (value: string) => knownColors.has(value);

describe("token parsing", () => {
  test("reads only top-level :root and .dark declarations", () => {
    const fixture = `@import "x"; :root { --a: #fff; --b: 1px; } @supports (x) { :root { --c: red; } } .dark { --a: #000; }`;
    expect(topLevelBlocks(fixture).map((block) => block.prelude)).toEqual([":root", "@supports (x)", ".dark"]);
    expect(blockDeclarations(fixture, ":root")).toEqual([{ name: "a", value: "#fff" }, { name: "b", value: "1px" }]);
    expect(blockDeclarations(fixture, ".dark")).toEqual([{ name: "a", value: "#000" }]);
  });

  test("lists every colour token in :root and nothing else", () => {
    const tokens = colorTokens(css, validColor);
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
    const families = colorTokens(css, validColor).map((token) => token.family);
    expect([...new Set(families)]).toEqual(["surface", "text", "primary", "status", "market", "balance", "payout", "globe"]);
  });

  test("assigns theme.md thresholds by role", () => {
    const rule = (name: string) => colorTokens(css, validColor).find((token) => token.name === name)!;
    expect(rule("muted-foreground").rule).toEqual({ use: "text", min: 4.5, against: { pair: "muted" } });
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

describe("Tailwind candidate usage", () => {
  const names = [
    "text-sm", "font-medium", "md:text-lg", "leading-snug", "tabular-nums", "text-[13px]",
    "p-2", "gap-1.5", "-mt-px", "px-hairline", "rounded-lg", "data-[x]:rounded-t-xl", "rounded-full",
    "transition-[transform,opacity]", "duration-350", "ease-[cubic-bezier(0.22,1,0.36,1)]",
    "motion-reduce:duration-0!", "data-[immediate]:duration-0", "lg:duration-180",
    "[transition:transform_500ms_cubic-bezier(0.22,1,0.36,1),opacity_250ms]",
    "transition", "transition-opacity", "transition-none", "duration-100", "duration-150", "duration-200",
    "ease-in", "ease-out", "delay-75", "delay-0", "delay-[80ms]", "duration-[100ms]", "duration-[80ms]",
    "md:duration-200", "hover:ease-out", "motion-reduce:duration-[80ms]",
    "p-0.5", "text-[1.5rem]", "duration-[1.5s]", "[transition:opacity_.2s]",
    "[[data-variant=legend]+&]:-mt-1.5", "[&[data-x]]:duration-200", "duration-(--duration)", "ease-(--curve)",
  ];
  const stylesheet = names.map((name) => `.${CSS.escape(name)} { transition-duration: 80ms; }`).join("\n");
  const scan = (files: SourceFile[], cssText = stylesheet) => {
    const style = document.createElement("style");
    style.textContent = cssText;
    document.head.append(style);
    try {
      const layer = { name: "utilities", cssText: "@layer utilities { }", cssRules: style.sheet!.cssRules };
      const owner = { styleSheets: [{ cssRules: [layer] }], defaultView: window } as unknown as Document;
      const snapshot = confirmedCandidates(scanLibraryCandidates(files, new Scanner({})), owner);
      expect(snapshot.status).toBe("available");
      return snapshot.files;
    } finally { style.remove(); }
  };
  const motion = (source: string) => motionUsage(scan([{ path: "example.tsx", source }])).uses;
  const files = scan([{
    path: "components/ui/sheet.tsx",
    source: `const a = "text-sm font-medium md:text-lg leading-snug tabular-nums text-[13px] text-muted-foreground";
const b = "p-2 gap-1.5 -mt-px px-hairline rounded-lg data-[x]:rounded-t-xl rounded-full";
<div className={cn("transition-[transform,opacity] duration-350 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:duration-0! data-[immediate]:duration-0", desktop && "lg:duration-180")} />
<div className="[transition:transform_500ms_cubic-bezier(0.22,1,0.36,1),opacity_250ms]" />`,
  }]);
  const counts = (entries: { step: string; count: number }[]) => entries.map(({ step, count }) => ({ step, count }));

  test("counts confirmed type candidates, off-scale sizes and their files", () => {
    const usage = typeUsage(files);
    expect(counts(usage.sizes)).toEqual([{ step: "sm", count: 1 }, { step: "lg", count: 1 }]);
    expect(counts(usage.weights)).toEqual([{ step: "medium", count: 1 }]);
    expect(counts(usage.leadings)).toEqual([{ step: "snug", count: 1 }]);
    expect(counts(usage.arbitrarySizes)).toEqual([{ step: "13px", count: 1 }]);
    expect(usage.tabular).toEqual({ step: "tabular-nums", count: 1, files: ["components/ui/sheet.tsx"] });
    expect(usage.sizes[1].files).toEqual(["components/ui/sheet.tsx"]);
  });

  test("counts confirmed radius and spacing steps including named spacing", () => {
    expect(counts(radiusUsage(files))).toEqual([{ step: "lg", count: 1 }, { step: "xl", count: 1 }, { step: "full", count: 1 }]);
    expect(spacingUsage(files, ["hairline"]).map((entry) => entry.step)).toEqual(["px", "1.5", "2", "hairline"]);
    expect(radiusUsage(files)[0].files).toEqual(["components/ui/sheet.tsx"]);
  });

  test("preserves arbitrary values, commas and nested parentheses", () => {
    const { uses } = motionUsage(files);
    expect(uses.map(({ utility }) => utility)).toEqual([
      "[transition:transform_500ms_cubic-bezier(0.22,1,0.36,1),opacity_250ms]",
      "duration-0", "duration-350", "duration-180", "ease-[cubic-bezier(0.22,1,0.36,1)]", "transition-[transform,opacity]",
    ].sort((left, right) => left.localeCompare(right)));
    expect(uses.find(({ utility }) => utility === "duration-0")?.count).toBe(2);
    expect(motion('"duration-[80ms]"')[0].utility).toBe("duration-[80ms]");
  });

  test("counts clsx object keys and real utilities in comparisons and metadata", () => {
    expect(motion('clsx({"duration-200": enabled, "ease-out": true})').map(({ utility }) => utility))
      .toEqual(["duration-200", "ease-out"]);
    expect(motion('<div className={state === "transition" ? "text-sm" : "text-lg"} />').map(({ utility }) => utility))
      .toEqual(["transition"]);
    expect(motion('cva("text-sm", { defaultVariants: { size: "transition" } })')[0].utility).toBe("transition");
  });

  test("matches Tailwind text scanning: a complete interpolation string counts, not a dynamically assembled token", () => {
    expect(motion('`not-${"duration-200"}`').map(({ utility }) => utility)).toEqual(["duration-200"]);
    expect(motion('`duration-${200}`')).toEqual([]);
    expect(motion('`not-duration-200`')).toEqual([]);
    expect(motion('`transition-${kind}`')).toEqual([]);
  });

  test("finds complete tokens through balanced braces and nested templates without parsing operands", () => {
    expect(motion('`${state === "transition" ? fn({x:1}) : "duration-200"}`').map(({ utility }) => utility))
      .toEqual(["duration-200", "transition"]);
    expect(motion('`${ready ? `duration-100` : `duration-200`}`').map(({ utility }) => utility))
      .toEqual(["duration-100", "duration-200"]);
  });

  test("confirms exact escaped variant selectors through grouped and nested CSS rules", () => {
    const cssText = `@media (min-width: 48rem) { .md\\:duration-200 { transition-duration: 200ms; } }
      .hover\\:ease-out { &:hover { transition-timing-function: ease-out; } }
      @media (prefers-reduced-motion: reduce) { .motion-reduce\\:duration-\\[80ms\\] { transition-duration: 80ms; } }`;
    const uses = motionUsage(scan([{ path: "variants.tsx", source: '"md:duration-200 hover:ease-out motion-reduce:duration-[80ms]"' }], cssText)).uses;
    expect(uses.map(({ utility }) => utility)).toEqual(["duration-[80ms]", "duration-200", "ease-out"]);
    expect(uses.find(({ utility }) => utility === "duration-200")?.classes).toEqual(["md:duration-200"]);
  });

  test("counts nested arbitrary variants and parenthesized custom-property utilities", () => {
    const files = scan([{ path: "field.tsx", source: '"[[data-variant=legend]+&]:-mt-1.5 [&[data-x]]:duration-200 duration-(--duration) ease-(--curve)"' }]);
    expect(spacingUsage(files, [])).toEqual([{ step: "1.5", count: 1, files: ["field.tsx"] }]);
    expect(motionUsage(files).uses.map(({ utility }) => utility)).toEqual(["duration-(--duration)", "duration-200", "ease-(--curve)"]);
  });

  test("never confirms a foreign Storybook rule outside the utilities layer", () => {
    const foreign = document.createElement("style");
    foreign.textContent = ".duration-storybook { color: red; }";
    document.head.append(foreign);
    const utilities = { name: "utilities", cssText: "@layer utilities { }", cssRules: [] };
    const owner = { styleSheets: [{ cssRules: [utilities] }, foreign.sheet!], defaultView: window } as unknown as Document;
    try {
      expect(confirmedCandidates(scanLibraryCandidates([{ path: "example.tsx", source: '"duration-storybook"' }], new Scanner({})), owner))
        .toEqual({ status: "available", files: [{ path: "example.tsx", candidates: [] }] });
    } finally { foreign.remove(); }
  });

  test("follows oxide occurrence handling at property-access dot boundaries", () => {
    const source = 'indicator.style.transition = "none"; node.style.transition; "transition"';
    expect(motion(source)).toEqual([{ utility: "transition", count: 2, files: ["example.tsx"], classes: ["transition"] }]);
  });

  test("keeps decimal steps and arbitrary values intact across dot boundaries", () => {
    const names = ["p-0.5", "text-[1.5rem]", "duration-[1.5s]", "[transition:opacity_.2s]"];
    const files = scan([{ path: "decimals.tsx", source: `"${names.join(" ")}"` }]);
    expect(files[0].candidates).toEqual(names);
    expect(spacingUsage(files, [])).toEqual([{ step: "0.5", count: 1, files: ["decimals.tsx"] }]);
    expect(typeUsage(files).arbitrarySizes).toEqual([{ step: "1.5rem", count: 1, files: ["decimals.tsx"] }]);
    expect(motionUsage(files).uses.map(({ utility }) => utility)).toEqual(["[transition:opacity_.2s]", "duration-[1.5s]"]);
  });

  test("excludes absent rules, selector prefixes and class-looking attribute values", () => {
    const cssText = '.duration-2000 { transition-duration: 2s; } [data-label=".duration-200"] { color: red; }';
    const files = scan([{ path: "unknown.tsx", source: '"duration-200 duration-999 text-sm rounded-lg p-2"' }], cssText);
    expect(motionUsage(files).uses).toEqual([]);
    expect(typeUsage(files).sizes).toEqual([]);
    expect(radiusUsage(files)).toEqual([]);
    expect(spacingUsage(files, [])).toEqual([]);
  });

  test("counts separate occurrences twice, single occurrences once and each file once", () => {
    const source = '<button className={cn(clsx("duration-150"))} /><button className={cn("duration-150")} />';
    expect(motionUsage(scan([{ path: "button.tsx", source }, { path: "other.tsx", source: 'clsx("duration-150")' }])).uses)
      .toEqual([{ utility: "duration-150", count: 3, files: ["button.tsx", "other.tsx"], classes: ["duration-150"] }]);
    expect(motion('cn(clsx("duration-150"))')[0].count).toBe(1);
    expect(motion('cn([["duration-150"], ["duration-150"]])')[0].count).toBe(2);
  });

  test("counts helper-return tokens Tailwind can see without reconstructing composed timing", () => {
    const source = 'function labelClass() { return "delay-[80ms] duration-[100ms]"; } <div className={labelClass()} />';
    expect(motion(source).map(({ utility }) => utility)).toEqual(["delay-[80ms]", "duration-[100ms]"]);
    expect(motion('cva("transition-opacity", { variants: { size: { small: "duration-100", large: "duration-200" } } })')
      .map(({ utility, count }) => ({ utility, count })))
      .toEqual([{ utility: "duration-100", count: 1 }, { utility: "duration-200", count: 1 }, { utility: "transition-opacity", count: 1 }]);
  });

  test("distinguishes inaccessible CSSOM, no stylesheets and available empty candidates", () => {
    const denied = { styleSheets: [{ get cssRules() { throw new Error("Access denied"); } }] } as unknown as Document;
    expect(confirmedCandidates([], denied)).toEqual({ status: "unavailable", files: [] });
    expect(confirmedCandidates([], { styleSheets: [] } as unknown as Document)).toEqual({ status: "unavailable", files: [] });
    expect(scan([{ path: "empty.tsx", source: "" }])).toEqual([{ path: "empty.tsx", candidates: [] }]);
    expect(confirmedCandidates(null)).toEqual({ status: "unavailable", files: [] });
  });

  test("parses cubic-bezier and keyword easings", () => {
    expect(cubicBezier("cubic-bezier(0.22, 1, 0.36, 1)")).toEqual([0.22, 1, 0.36, 1]);
    expect(cubicBezier("ease")).toEqual([0.25, 0.1, 0.25, 1]);
    expect(cubicBezier("steps(4)")).toBeNull();
  });
});

describe("measurement availability and discovered scales", () => {
  const token = colorTokens(":root { --secondary: white; --secondary-foreground: white; }", (value) => value === "white")
    .find(({ name }) => name === "secondary-foreground")!;
  const convert = (value: string) => ({ white, black, tint: { ...black, a: 0.5 } })[value as "white" | "black" | "tint"] ?? null;
  const values = { card: "white", muted: "white", secondary: "white", "secondary-foreground": "white" };

  test("fails equal secondary pairs while retaining surface references", () => {
    expect(measureColor(token, values, convert)).toMatchObject({ status: "measured", verdict: "fail",
      checks: [{ label: "On --secondary", ratio: 1 }, { label: "Card", ratio: 1 }, { label: "Page", ratio: 1 }] });
  });

  test("composites a translucent paired fill over the theme page", () => {
    const result = measureColor(token, { ...values, muted: "black", secondary: "tint" }, convert);
    expect(result.verdict).toBe("pass");
    expect(result.checks[0].ratio).toBe(21);
  });

  test("reports missing, invalid and throwing measurements as unavailable", () => {
    for (const overrides of [{ card: "" }, { muted: "invalid" }, { secondary: "" }, { "secondary-foreground": "invalid" }]) {
      const result = measureColor(token, { ...values, ...overrides }, convert);
      expect(result).toMatchObject({ status: "unavailable", verdict: null });
      expect(measurementSummary([result])).toBe("no contrast checks measured; 1 unmeasured tokens");
    }
    expect(measureColor(token, values, () => { throw new Error("reader failed"); }).status).toBe("unavailable");
  });

  test("preserves the authored registry and pair judgment when primary resolves invalid or missing", () => {
    const valid = (value: string) => ["white", "black"].includes(value);
    const authored = ":root { --card: white; --muted: white; --primary: black; --primary-foreground: white; }";
    const baseline = colorTokens(authored, valid);
    for (const primary of ["invalid", ""]) {
      const theme = { card: "white", muted: "white", primary, "primary-foreground": "white" };
      const registry = colorTokens(authored, valid, [theme, theme]);
      expect(registry).toEqual(baseline);
      expect(registry.find(({ name }) => name === "primary-foreground")?.rule)
        .toEqual({ use: "text", min: 4.5, against: { pair: "primary" } });
      const results = registry.map((entry) => measureColor(entry, theme, convert));
      expect(results.filter(({ status }) => status === "unavailable")).toHaveLength(2);
      expect(measurementSummary(results)).toBe("no contrast checks measured; 2 unmeasured tokens");
    }
  });

  test("does not mistake length expressions with variables for authored colors", () => {
    const registry = colorTokens(":root { --color: #fff; --offset: calc(var(--space) + 1rem); --inset: max(var(--space),1px); }",
      (value) => value === "#fff" || value.includes("var("), [{ offset: "calc(1px + 1rem)", inset: "max(1px,1px)" }]);
    expect(registry.map(({ name }) => name)).toEqual(["color"]);
  });

  test("keeps color-like unresolved declarations and discovers a color resolved only in dark", () => {
    const registry = colorTokens(":root { --alias: var(--missing); --new: invalid; --size: 2px; --pattern: linear-gradient(red,blue); } .dark { --new: white; }",
      (value) => value === "white", [{}, { new: "white" }]);
    expect(registry.map(({ name }) => name)).toEqual(["alias", "new", "pattern"]);
    expect(registry.find(({ name }) => name === "pattern")?.pattern).toBe(true);
  });

  test("cleans up motion probes on inaccessible CSSOM", () => {
    let removed = false;
    const element = { style: {}, remove: () => { removed = true; } };
    const owner = { createElement: () => element, body: { append: () => undefined },
      styleSheets: [{ get cssRules() { throw new Error("Access denied"); } }] } as unknown as Document;
    expect(readMotionReference([], owner)).toBeNull();
    expect(removed).toBe(true);
  });

  test("reports CSSOM denial and reader exceptions as a whole-probe failure", () => {
    const sheet = { get cssRules(): CSSRuleList { throw new Error("Access denied"); } } as CSSStyleSheet;
    const owner = { styleSheets: [sheet] } as unknown as Document;
    expect(probeThemes(["card"], (names) => readThemeValues(names, owner))).toEqual({ status: "unavailable" });
    expect(probeThemes([], () => { throw new Error("reader failed"); })).toEqual({ status: "unavailable" });
    expect(probeThemes([], () => ({ light: {}, dark: {} }))).toEqual({ status: "measured", values: { light: {}, dark: {} } });
  });

  test("reports a null canvas as unmeasured, not a pass", () => {
    const result = measureColor(token, values, (value) => toRgba(value, () => true, () => null));
    expect(result.status).toBe("unavailable");
    expect(measurementSummary([result])).not.toContain("pass");
  });

  test("registers named and resolved colors without registering lengths", () => {
    const tokens = colorTokens(":root { --red: red; --purple: rebeccapurple; --clear: transparent; --alias: var(--red); --size: 2px; }",
      (value) => ["red", "rebeccapurple", "transparent"].includes(value), { alias: "red" });
    expect(tokens.map(({ name }) => name)).toEqual(["red", "purple", "clear", "alias"]);
  });

  test("keeps discovered custom radii after stock ranks in alphabetical order", () => {
    expect(radiusSteps(["dialog", "xl", "banner", "sm"], ["full", "xl"]))
      .toEqual(["sm", "xl", "full", "banner", "dialog"]);
  });

  test("reads computed utility values without requiring a custom property and removes its probe", () => {
    let removed = false;
    const element = { style: {}, className: "", remove: () => { removed = true; } };
    const owner = { createElement: () => element, body: { append: () => undefined },
      defaultView: { getComputedStyle: () => ({ lineHeight: "16px" }) } } as unknown as Document;
    expect(utilityValues(["leading-none"], "lineHeight", owner)).toEqual({ "leading-none": "16px" });
    expect(removed).toBe(true);
  });

  test("distinguishes a missing virtual module from an available empty inventory", async () => {
    expect(componentCandidateSet).toEqual({ status: "unavailable", files: [] });
    expect(await loadCandidateSet(async () => { throw new Error("Plugin unavailable"); }))
      .toEqual({ status: "unavailable", files: [] });
    expect(await loadCandidateSet(async () => ({ default: [] }))).toEqual({ status: "available", files: [] });
    expect(await loadCandidateSet(async () => ({ default: { status: "unavailable", reason: "Tailwind candidate scanner unavailable." } })))
      .toEqual({ status: "unavailable", files: [] });
    const files = [{ path: "components/ui/example.tsx", candidates: ["duration-200", "duration-200"] }];
    expect(await loadCandidateSet(async () => ({ default: files }))).toEqual({ status: "available", files });
  });
});

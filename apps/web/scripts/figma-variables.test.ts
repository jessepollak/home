import { describe, expect, test } from "bun:test";
import fixture from "./figma-variables.fixture.json";
import { buildPayload, buildPlan, colorToFigma, formatPlan, loadCssTokens, parseCss } from "./figma-variables.mjs";

type PlannedEntry = {
  id: string; name: string; variableId: string; variableCollectionId: string;
  cssReference: string; resolvedType: string; modeId: string; after: unknown;
  code: unknown; figma: unknown; mode: string; codeSyntax: { WEB: string };
};
type TestPlan = Record<"creates" | "updates" | "skippedProposed" | "figmaOnly" | "unmatched", PlannedEntry[]> & {
  variableUpdates: { id: string; name: string; codeSyntax: { WEB: string } }[];
  skippedAliases: { name: string; mode: string }[];
  unchanged: number;
};
const parsed = await loadCssTokens();
const typedPlan = (snapshot: typeof fixture) => buildPlan(parsed, snapshot) as unknown as TestPlan;
const token = (name: string) => parsed.tokens.find((entry: { name: string }) => entry.name === name)!;

describe("CSS extraction", () => {
  test("reads only theme declarations and root/dark blocks, not media or unrelated vars", () => {
    const result = parseCss(`@theme inline { --font-sans: Arial; --color-foreground: var(--foreground); --radius-lg: var(--radius); --spacing-hairline: 1px; }
      :root { --foreground: #123; --radius: 0.25rem; --shell-safe-area-bottom: 0px; }
      @media (display-mode: standalone) { :root { --foreground: #fff; } }
      .dark { --foreground: rgb(255 0 0 / 50%); }`);
    expect(result.tokens.map((entry: { name: string }) => entry.name)).toEqual(["color/foreground", "radius/lg", "space/hairline"]);
    expect(result.tokens[0].light).toEqual({ r: 0x11 / 255, g: 0x22 / 255, b: 0x33 / 255, a: 1 });
    expect(result.tokens[0].dark).toEqual({ r: 1, g: 0, b: 0, a: 0.5 });
    expect(result.tokens[1].light).toBe(4);
    expect(result.skippedFonts).toHaveLength(1);
    expect(result.notDefined).toContain("font sizes");
  });

  test("single-mode CSS with no dark selector", () => {
    const result = parseCss("@theme inline { --color-foreground: var(--foreground); } :root { --foreground: #fff; }");
    expect(result.hasDark).toBe(false);
    expect(buildPlan(result).modes.map((mode: { name: string }) => mode.name)).toEqual(["Light"]);
  });

  test("reads actual Home colors, radii, spacing and skips typography values", () => {
    expect(token("color/foreground").light.r).toBeCloseTo(10 / 255, 2);
    expect(token("color/border").dark.a).toBeCloseTo(0.1, 5);
    expect(token("radius/lg").light).toBe(4);
    expect(token("radius/xl").light).toBeCloseTo(5.6);
    expect(token("space/hairline").light).toBe(1);
    expect(parsed.tokens.filter((entry: { name: string }) => entry.name.startsWith("color/sidebar-"))).toHaveLength(7);
    expect(parsed.skippedFonts.map((entry: { cssName: string }) => entry.cssName)).toEqual(["--font-heading", "--font-sans", "--font-mono"]);
    expect(parsed.tokens.some((entry: { name: string }) => entry.name.startsWith("font/"))).toBe(false);
  });
});

test("oklch conversion uses gamma-encoded sRGB with alpha and gamut clamping", () => {
  expect(colorToFigma("oklch(0.145 0 0)").r).toBeCloseTo(10 / 255, 2);
  const white = colorToFigma("oklch(1 0 0 / 10%)");
  expect(white.r).toBeCloseTo(1, 5);
  expect(white.a).toBe(0.1);
  expect(colorToFigma("oklch(0.62 0.2 255)").b).toBeGreaterThan(0.9);
  expect(Object.values(colorToFigma("oklch(0.62 0.2 255)")).every((channel) => channel >= 0 && channel <= 1)).toBe(true);
  expect(colorToFigma("#12345680").a).toBeCloseTo(128 / 255);
});

test("existing codeSyntax wins over name; proposals and Figma-only entries are not written", () => {
  const plan = typedPlan(fixture);
  expect(plan.creates.some((entry) => entry.name === "space/shell-mobile-navigation")).toBe(false);
  expect(plan.unchanged).toBeGreaterThan(0);
  expect(plan.skippedProposed.some((entry) => entry.name === "color/destructive" && !!entry.code && !!entry.figma)).toBe(true);
  expect(plan.updates.some((entry) => entry.name === "color/destructive")).toBe(false);
  expect(plan.figmaOnly.some((entry) => entry.name === "color/chart-gain")).toBe(true);
  expect(plan.creates.some((entry) => entry.name === "color/sidebar-ring")).toBe(true);
  expect(plan.creates.find((entry) => entry.name === "space/tab-indicator-offset")?.variableCollectionId).toBe("VariableCollectionId:155:1653");
  expect(plan.unmatched.some((entry) => entry.name === "space/0_5")).toBe(true);
  expect(plan.skippedAliases).toContainEqual({ name: "color/sidebar", mode: "Dark" });
  expect(plan.updates.some((entry) => entry.name === "color/sidebar" && entry.mode === "Dark")).toBe(false);
  expect(plan.updates.some((entry) => entry.name === "color/ring")).toBe(true);
  expect(plan.skippedProposed.some((entry) => entry.name === "color/ring")).toBe(false);
  expect(plan.variableUpdates).toContainEqual({ id: "VariableID:155:1688", name: "color/ring", codeSyntax: { WEB: "var(--ring)" } });
  expect(buildPayload(plan).variables).toContainEqual({ action: "UPDATE", id: "VariableID:155:1688", codeSyntax: { WEB: "var(--ring)" } });
  const output = formatPlan(plan);
  expect(output).toContain("SKIP ALIAS color/sidebar  Dark");
  expect(output).toContain("UNMATCHED space/0_5");
  expect(output).toContain("FIGMA-ONLY color/chart-gain");
  expect(output).toContain("UPDATE color/ring  WEB var(--ring)");
  expect(output).not.toContain("\"updates\":");
});

test("idempotency after applying every planned create and value", () => {
  const plan = typedPlan(fixture);
  const applied = structuredClone(fixture);
  const variables = applied.meta.variables as unknown as Record<string, { valuesByMode: Record<string, unknown>; codeSyntax?: { WEB: string } }>;
  for (const entry of plan.creates) {
    variables[entry.id] = {
      id: entry.id, name: entry.name, variableCollectionId: entry.variableCollectionId,
      codeSyntax: { WEB: entry.cssReference }, resolvedType: entry.resolvedType, valuesByMode: {},
    } as { valuesByMode: Record<string, unknown> };
  }
  for (const entry of plan.updates) variables[entry.variableId].valuesByMode[entry.modeId] = entry.after;
  for (const entry of plan.variableUpdates) variables[entry.id].codeSyntax = entry.codeSyntax;
  const again = typedPlan(applied);
  expect(again.creates).toHaveLength(0);
  expect(again.updates).toHaveLength(0);
  expect(again.variableUpdates).toHaveLength(0);
});

test("metadata-only name match produces an UPDATE without changing mode values", () => {
  const css = parseCss("@theme inline { --color-foreground: var(--foreground); } :root { --foreground: #000; }");
  const snapshot = { meta: {
    variableCollections: { home: { id: "home", name: "Home tokens", modes: [{ modeId: "light", name: "Light" }] } },
    variables: { foreground: { id: "foreground", name: "color/foreground", variableCollectionId: "home", resolvedType: "COLOR", valuesByMode: { light: { r: 0, g: 0, b: 0, a: 1 } } } },
  } };
  const plan = buildPlan(css, snapshot) as unknown as TestPlan;
  expect(plan.updates).toHaveLength(0);
  expect(plan.variableUpdates).toEqual([{ id: "foreground", name: "color/foreground", codeSyntax: { WEB: "var(--foreground)" } }]);
  expect(buildPayload(plan).variables).toEqual([{ action: "UPDATE", id: "foreground", codeSyntax: { WEB: "var(--foreground)" } }]);
});

test("adds missing Dark mode and includes mode values in a single POST payload", () => {
  const snapshot = structuredClone(fixture);
  snapshot.meta.variableCollections["VariableCollectionId:4:3"].modes.pop();
  const plan = buildPlan(parsed, snapshot);
  const payload = buildPayload(plan);
  expect(payload.variableModes).toEqual([{ action: "CREATE", id: "temp:dark", name: "Dark", variableCollectionId: "VariableCollectionId:4:3" }]);
  expect(payload.variableModeValues.some((entry: { modeId: string; variableId: string }) => entry.modeId === "temp:dark" && entry.variableId === "VariableID:4:5")).toBe(true);
  expect(payload.variables.find((entry: { name: string }) => entry.name === "space/tab-indicator-offset")).toMatchObject({
    action: "CREATE", resolvedType: "FLOAT", scopes: ["GAP", "WIDTH_HEIGHT"], codeSyntax: { WEB: "var(--spacing-tab-indicator-offset)" },
  });
  expect(payload.variableModeValues.every((entry: { value: unknown }) => entry.value !== undefined)).toBe(true);
  expect(payload.variables.some((entry: { name: string }) => entry.name === "color/destructive")).toBe(false);
});

test("dry-run without a token plans against an empty file and writes nothing", () => {
  const { FIGMA_ACCESS_TOKEN: _omitted, ...env } = process.env;
  const result = Bun.spawnSync(["node", new URL("./figma-variables.mjs", import.meta.url).pathname, "--dry-run"], { env });
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toContain("CREATE color/sidebar");
  expect(result.stdout.toString()).toContain("Not defined in CSS:");
  const json = Bun.spawnSync(["node", new URL("./figma-variables.mjs", import.meta.url).pathname, "--dry-run", "--json"], { env });
  expect(json.exitCode).toBe(0);
  expect(JSON.parse(json.stdout.toString())).toMatchObject({ creates: expect.any(Array), updates: expect.any(Array), skippedAliases: [], unmatched: [] });
});

test("empty snapshot creates the token collection with Light and Dark temporary modes", () => {
  const payload = buildPayload(buildPlan(parsed));
  expect(payload.variableCollections).toEqual([{ action: "CREATE", id: "temp:home-tokens", initialModeId: "temp:light", name: "Home tokens" }]);
  expect(payload.variableModes).toEqual([
    { action: "UPDATE", id: "temp:light", variableCollectionId: "temp:home-tokens", name: "Light" },
    { action: "CREATE", id: "temp:dark", variableCollectionId: "temp:home-tokens", name: "Dark" },
  ]);
});

export type Declaration = { name: string; value: string };
export type CssBlock = { prelude: string; declarations: Declaration[] };

export type ColorFamily = "surface" | "text" | "primary" | "status" | "market" | "balance" | "payout" | (string & {});
export type ContrastRule =
  | { use: "text" | "graphic"; min: number; against: "surfaces" }
  | { use: "text"; min: number; against: { pair: string } }
  | { use: "surface" | "brand" | "illustration" | "pattern" };
export type ColorToken = { name: string; family: ColorFamily; rule: ContrastRule; pattern: boolean; rootOnly: boolean };

const TEXT_MIN = 4.5;
const GRAPHIC_MIN = 3;
const FAMILY_ORDER = ["surface", "text", "primary", "status", "market", "balance", "payout"];
const PATTERN_VALUE = /gradient\(/i;

export function topLevelBlocks(css: string): CssBlock[] {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const blocks: CssBlock[] = [];
  let depth = 0;
  let start = 0;
  let prelude = "";
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "{") {
      if (depth === 0) {
        prelude = source.slice(start, index).split(";").at(-1)!.trim();
        start = index + 1;
      }
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        blocks.push({ prelude, declarations: declarations(source.slice(start, index)) });
        start = index + 1;
      }
    }
  }
  return blocks;
}

function declarations(body: string): Declaration[] {
  if (body.includes("{")) return [];
  return body.split(";").flatMap((part) => {
    const match = /^\s*(--[\w-]+)\s*:\s*([\s\S]+?)\s*$/.exec(part);
    return match ? [{ name: match[1].slice(2), value: match[2] }] : [];
  });
}

export function blockDeclarations(css: string, prelude: string): Declaration[] {
  return topLevelBlocks(css).filter((block) => block.prelude === prelude).flatMap((block) => block.declarations);
}

export function colorFamily(name: string): ColorFamily {
  if (name === "foreground" || name.endsWith("-foreground")) {
    const base = name.slice(0, -"foreground".length).replace(/-$/, "");
    if (base.startsWith("payout-")) return "payout";
    return base === "primary" ? "primary" : "text";
  }
  if (name === "primary" || name === "ring") return "primary";
  if (name === "destructive" || name === "warning" || name.startsWith("status-")) return "status";
  return name.includes("-") ? name.split("-")[0] : "surface";
}

export function contrastRule(name: string, family: ColorFamily, pattern: boolean, names: Set<string>): ContrastRule {
  if (pattern) return { use: "pattern" };
  const pair = name.endsWith("-foreground") ? name.slice(0, -"-foreground".length) : null;
  if (pair && names.has(pair)) {
    return { use: "text", min: TEXT_MIN, against: { pair } };
  }
  if (family === "surface") return { use: "surface" };
  if (family === "payout") return { use: "brand" };
  if (family === "text" || family === "market" || name === "primary" || name === "destructive" || name === "warning") {
    return { use: "text", min: TEXT_MIN, against: "surfaces" };
  }
  if (family === "status" || family === "balance" || name === "ring") {
    return { use: "graphic", min: GRAPHIC_MIN, against: "surfaces" };
  }
  return { use: "illustration" };
}

export function colorTokens(css: string, isColor = (value: string) => typeof CSS !== "undefined" && CSS.supports("color", value), resolved?: Record<string, string>): ColorToken[] {
  const root = blockDeclarations(css, ":root");
  const dark = new Set(blockDeclarations(css, ".dark").map((declaration) => declaration.name));
  const colors = root.filter(({ name, value }) => isColor(resolved?.[name] ?? value) || PATTERN_VALUE.test(value));
  const names = new Set(colors.map((declaration) => declaration.name));
  const tokens = colors.map(({ name, value }) => {
    const family = colorFamily(name);
    const pattern = PATTERN_VALUE.test(value);
    return { name, family, pattern, rule: contrastRule(name, family, pattern, names), rootOnly: !dark.has(name) };
  });
  const rank = (family: string) => {
    const index = FAMILY_ORDER.indexOf(family);
    return index === -1 ? FAMILY_ORDER.length : index;
  };
  return tokens.map((token, index) => ({ token, index }))
    .sort((left, right) => rank(left.token.family) - rank(right.token.family) || left.index - right.index)
    .map(({ token }) => token);
}

export function themeScale(css: string, prefix: string): Declaration[] {
  return blockDeclarations(css, "@theme inline").filter((declaration) => declaration.name.startsWith(`${prefix}-`))
    .map((declaration) => ({ name: declaration.name.slice(prefix.length + 1), value: declaration.value }));
}

const RADIUS_ORDER = ["xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl", "full"];

export function radiusSteps(declared: string[], used: string[]): string[] {
  const rank = (step: string) => {
    const index = RADIUS_ORDER.indexOf(step);
    return index < 0 ? RADIUS_ORDER.length : index;
  };
  return [...new Set([...declared, ...used])].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

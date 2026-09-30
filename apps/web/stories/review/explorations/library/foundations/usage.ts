export type SourceFile = { path: string; source: string };
export type Usage = { step: string; count: number };

const TYPE_SIZES = ["xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl", "7xl", "8xl", "9xl"];
const WEIGHTS = ["thin", "extralight", "light", "normal", "medium", "semibold", "bold", "extrabold", "black"];
const LEADINGS = ["none", "tight", "snug", "normal", "relaxed", "loose"];
const TRACKINGS = ["tighter", "tight", "normal", "wide", "wider", "widest"];
const RADII = ["xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl", "full"];
const SPACING_UTILITIES = "p|px|py|pt|pr|pb|pl|ps|pe|m|mx|my|mt|mr|mb|ml|ms|me|gap|gap-x|gap-y|space-x|space-y";

function utilityPattern(stem: string, steps: string): RegExp {
  return new RegExp(`(?<![\\w-])(?:[\\w\\-[\\]&>*=.()/:]+:)?-?(?:${stem})-(${steps})!?(?![\\w\\-[/])`, "g");
}

function tally(files: SourceFile[], pattern: RegExp, order?: string[]): Usage[] {
  const counts = new Map<string, number>();
  for (const { source } of files) {
    for (const match of source.matchAll(pattern)) counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
  }
  const rank = (step: string) => order ? order.indexOf(step) : Number.parseFloat(step);
  return [...counts].map(([step, count]) => ({ step, count }))
    .sort((left, right) => rank(left.step) - rank(right.step) || left.step.localeCompare(right.step));
}

const words = (values: string[]) => values.join("|");

export function typeUsage(files: SourceFile[]) {
  return {
    sizes: tally(files, utilityPattern("text", words(TYPE_SIZES)), TYPE_SIZES),
    arbitrarySizes: tally(files, /(?<![\w-])(?:[\w\-[\]&>*=.()/:]+:)?text-\[(\d+(?:\.\d+)?(?:px|rem))\]/g),
    weights: tally(files, utilityPattern("font", words(WEIGHTS)), WEIGHTS),
    leadings: tally(files, utilityPattern("leading", words(LEADINGS)), LEADINGS),
    trackings: tally(files, utilityPattern("tracking", words(TRACKINGS)), TRACKINGS),
    tabular: count(files, /(?<![\w-])(?:[\w\-[\]&>*=.()/:]+:)?tabular-nums(?![\w-])/g),
    mono: count(files, /(?<![\w-])(?:[\w\-[\]&>*=.()/:]+:)?font-mono(?![\w-])/g),
  };
}

function count(files: SourceFile[], pattern: RegExp): number {
  return files.reduce((total, { source }) => total + [...source.matchAll(pattern)].length, 0);
}

export function radiusUsage(files: SourceFile[]): Usage[] {
  return tally(files, utilityPattern("rounded(?:-[trblse]{1,2})?", words(RADII)), RADII);
}

export function spacingUsage(files: SourceFile[], named: string[]): Usage[] {
  const steps = ["\\d+(?:\\.\\d+)?", "px", ...named].join("|");
  const usage = tally(files, utilityPattern(SPACING_UTILITIES, steps));
  const numeric = (step: string) => step === "px" ? 0.25 : Number.parseFloat(step);
  return usage.sort((left, right) => {
    const [a, b] = [numeric(left.step), numeric(right.step)];
    if (Number.isNaN(a) || Number.isNaN(b)) return Number.isNaN(a) ? (Number.isNaN(b) ? left.step.localeCompare(right.step) : 1) : -1;
    return a - b;
  });
}

export type MotionUse = {
  component: string;
  properties: string;
  duration: number | null;
  easing: string | null;
  variant: string;
};
export type PressScale = { component: string; variant: string; scale: number };

const REDUCED_VARIANT = /(?:^|:)(?:motion-reduce|data-\[immediate\]|data-swiping|group-data-\[immediate\]\/[\w-]+|active)(?::|$)/;

function componentName(path: string): string {
  return path.split("/").at(-1)!.replace(/\.tsx?$/, "");
}

function expressionEnd(source: string, start: number): number {
  const closing: Record<string, string> = { "(": ")", "{": "}", "[": "]" };
  const stack: string[] = [];
  let quote = "";
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) {
        quote = "";
        if (!stack.length) return index + 1;
      }
    } else if (char === '"' || char === "'" || char === "`") quote = char;
    else if (closing[char]) stack.push(closing[char]);
    else if (char === stack.at(-1)) {
      stack.pop();
      if (!stack.length) return index + 1;
    }
  }
  return source.length;
}

function classLiterals(source: string): string[] {
  const groups: string[] = [];
  let scannedUntil = 0;
  const starts = /\bclassName\s*=\s*(?=[{"'`])|\b(?:cn|cva)\s*(?=\()/g;
  for (const match of source.matchAll(starts)) {
    if (match.index < scannedUntil) continue;
    const start = match.index + match[0].length;
    scannedUntil = expressionEnd(source, start);
    const expression = source.slice(start, scannedUntil);
    groups.push([...expression.matchAll(/(["'`])((?:(?!\1)[^\\]|\\.)*)\1/g)].map((literal) => literal[2]).join(" "));
  }
  return groups;
}

function tokens(literal: string): { variant: string; utility: string }[] {
  return literal.split(/\s+/).filter(Boolean).map((token) => {
    let depth = 0;
    let split = -1;
    for (let index = 0; index < token.length; index += 1) {
      if (token[index] === "[" || token[index] === "(") depth += 1;
      else if (token[index] === "]" || token[index] === ")") depth -= 1;
      else if (token[index] === ":" && depth === 0) split = index;
    }
    return split === -1 ? { variant: "", utility: token } : { variant: token.slice(0, split), utility: token.slice(split + 1) };
  });
}

function topLevelSplit(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "(") depth += 1;
    else if (value[index] === ")") depth -= 1;
    else if (value[index] === "," && depth === 0) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  return [...parts, value.slice(start)];
}

export function motionUsage(files: SourceFile[]): { uses: MotionUse[]; press: PressScale[] } {
  const uses: MotionUse[] = [];
  const press: PressScale[] = [];
  const seen = new Set<string>();
  const add = (use: MotionUse) => {
    const key = JSON.stringify(use);
    if (seen.has(key)) return;
    seen.add(key);
    uses.push(use);
  };
  for (const { path, source } of files) {
    const component = componentName(path);
    for (const literal of classLiterals(source)) {
      const parts = tokens(literal);
      const arbitrary = parts.find((part) => part.utility.startsWith("[transition:"));
      if (arbitrary) {
        for (const segment of topLevelSplit(arbitrary.utility.slice("[transition:".length, arbitrary.utility.lastIndexOf("]")))) {
          const [property, time, ...curve] = segment.split("_");
          const duration = /^(\d+)ms$/.exec(time ?? "");
          add({ component, properties: property, duration: duration ? Number(duration[1]) : null,
            easing: curve.length ? curve.join(" ") : "ease", variant: arbitrary.variant });
        }
      }
      for (const part of parts) {
        const scale = /^scale-\[(\d*\.\d+)\]!?$/.exec(part.utility);
        if (scale && part.variant.split(":").includes("active") && !REDUCED_VARIANT.test(part.variant.replace(/(^|:)active(:|$)/, "$1$2"))) {
          press.push({ component, variant: part.variant, scale: Number(scale[1]) });
        }
      }
      const base = parts.filter((part) => !REDUCED_VARIANT.test(part.variant));
      const transitions = base.filter((part) => /^transition(?:-|$)/.test(part.utility) && part.utility !== "transition-none");
      if (!transitions.length) continue;
      const durations = base.filter((part) => part.utility.startsWith("duration-")).map((part) => {
        const match = /^duration-(\d+)!?$/.exec(part.utility);
        return { variant: part.variant, value: match ? Number(match[1]) : null };
      });
      const easings = base.filter((part) => part.utility.startsWith("ease-")).map((part) => {
        const arbitraryEase = /^ease-\[(.+)\]!?$/.exec(part.utility);
        const stock = /^ease-(linear|in|out|in-out)!?$/.exec(part.utility);
        return { variant: part.variant, value: arbitraryEase ? arbitraryEase[1].replaceAll("_", " ")
          : stock ? stock[1] === "linear" ? "linear" : `--ease-${stock[1]}` : null };
      });
      const variants = new Set([...transitions, ...durations, ...easings].map((entry) => entry.variant));
      const inherited = <T extends { variant: string }>(entries: T[], variant: string): T | undefined =>
        entries.filter((entry) => entry.variant === "" || entry.variant === variant || variant.startsWith(`${entry.variant}:`))
          .sort((a, b) => b.variant.length - a.variant.length).at(0);
      for (const variant of variants) {
        const transition = inherited(transitions, variant);
        if (!transition) continue;
        const duration = inherited(durations, variant);
        const easing = inherited(easings, variant);
        if (duration?.value === 0) continue;
        const properties = /^transition-\[(.+)\]!?$/.exec(transition.utility)?.[1].replaceAll(",", ", ") ??
          (transition.utility === "transition" ? "default" : transition.utility.slice("transition-".length));
        add({ component, properties, duration: duration?.value ?? null, easing: easing?.value ?? null, variant });
      }
    }
  }
  return { uses, press };
}

export function cubicBezier(easing: string): [number, number, number, number] | null {
  const keyword: Record<string, [number, number, number, number]> = {
    linear: [0, 0, 1, 1], ease: [0.25, 0.1, 0.25, 1], "ease-in": [0.42, 0, 1, 1],
    "ease-out": [0, 0, 0.58, 1], "ease-in-out": [0.42, 0, 0.58, 1],
  };
  if (keyword[easing.trim()]) return keyword[easing.trim()];
  const match = /cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/.exec(easing);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])] : null;
}

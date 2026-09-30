import { classOperands } from "./class-operands";

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

export type MotionUse = { utility: string; count: number; files: string[]; classes: string[] };

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

export function motionUsage(files: SourceFile[]): { uses: MotionUse[] } {
  const uses = new Map<string, MotionUse>();
  for (const { path, source } of files) {
    for (const literal of classOperands(source)) {
      for (const part of tokens(literal)) {
        const utility = part.utility.replace(/!$/, "");
        if (!/^(?:transition(?:-|$)|(?:duration|ease|delay)-.+|\[transition:)/.test(utility)) continue;
        const use = uses.get(utility) ?? { utility, count: 0, files: [], classes: [] };
        use.count += 1;
        if (!use.files.includes(path)) use.files.push(path);
        const name = `${part.variant ? `${part.variant}:` : ""}${part.utility}`;
        if (!use.classes.includes(name)) use.classes.push(name);
        uses.set(utility, use);
      }
    }
  }
  return { uses: [...uses.values()].sort((left, right) => left.utility.localeCompare(right.utility)) };
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

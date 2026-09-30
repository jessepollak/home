import type { CandidateFile } from "./candidates";

export type Usage = { step: string; count: number; files: string[] };

const TYPE_SIZES = ["xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl", "7xl", "8xl", "9xl"];
const WEIGHTS = ["thin", "extralight", "light", "normal", "medium", "semibold", "bold", "extrabold", "black"];
const LEADINGS = ["none", "tight", "snug", "normal", "relaxed", "loose"];
const TRACKINGS = ["tighter", "tight", "normal", "wide", "wider", "widest"];
const RADII = ["xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl", "full"];
const SPACING_UTILITIES = "p|px|py|pt|pr|pb|pl|ps|pe|m|mx|my|mt|mr|mb|ml|ms|me|gap|gap-x|gap-y|space-x|space-y";

function utilityPattern(stem: string, steps: string): RegExp {
  return new RegExp(`^-?(?:${stem})-(${steps})$`);
}

function tally(files: CandidateFile[], pattern: RegExp, order?: string[]): Usage[] {
  const counts = new Map<string, Usage>();
  for (const { path, candidates } of files) {
    for (const candidate of candidates) {
      const match = utility(candidate).match(pattern);
      if (!match) continue;
      const entry = counts.get(match[1]) ?? { step: match[1], count: 0, files: [] };
      entry.count += 1;
      if (!entry.files.includes(path)) entry.files.push(path);
      counts.set(match[1], entry);
    }
  }
  const rank = (step: string) => order ? order.indexOf(step) : Number.parseFloat(step);
  return [...counts.values()]
    .sort((left, right) => rank(left.step) - rank(right.step) || left.step.localeCompare(right.step));
}

const words = (values: string[]) => values.join("|");

export function typeUsage(files: CandidateFile[]) {
  return {
    sizes: tally(files, utilityPattern("text", words(TYPE_SIZES)), TYPE_SIZES),
    arbitrarySizes: tally(files, /^text-\[(\d+(?:\.\d+)?(?:px|rem))\]$/),
    weights: tally(files, utilityPattern("font", words(WEIGHTS)), WEIGHTS),
    leadings: tally(files, utilityPattern("leading", words(LEADINGS)), LEADINGS),
    trackings: tally(files, utilityPattern("tracking", words(TRACKINGS)), TRACKINGS),
    tabular: tally(files, /^(tabular-nums)$/)[0] ?? { step: "tabular-nums", count: 0, files: [] },
    mono: tally(files, /^(font-mono)$/)[0] ?? { step: "font-mono", count: 0, files: [] },
  };
}

export function radiusUsage(files: CandidateFile[]): Usage[] {
  return tally(files, utilityPattern("rounded(?:-[trblse]{1,2})?", words(RADII)), RADII);
}

export function spacingUsage(files: CandidateFile[], named: string[]): Usage[] {
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

function utility(candidate: string): string {
  let depth = 0;
  let split = -1;
  for (let index = 0; index < candidate.length; index += 1) {
    if (candidate[index] === "[" || candidate[index] === "(") depth += 1;
    else if (candidate[index] === "]" || candidate[index] === ")") depth -= 1;
    else if (candidate[index] === ":" && depth === 0) split = index;
  }
  return candidate.slice(split + 1).replace(/^!|!$/g, "");
}

export function motionUsage(files: CandidateFile[]): { uses: MotionUse[] } {
  const uses = new Map<string, MotionUse>();
  for (const { path, candidates } of files) {
    for (const candidate of candidates) {
      const name = utility(candidate);
      if (!/^(?:transition(?:-|$)|(?:duration|ease|delay)-.+|\[transition:)/.test(name)) continue;
      const use = uses.get(name) ?? { utility: name, count: 0, files: [], classes: [] };
      use.count += 1;
      if (!use.files.includes(path)) use.files.push(path);
      if (!use.classes.includes(candidate)) use.classes.push(candidate);
      uses.set(name, use);
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

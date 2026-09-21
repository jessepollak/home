import { readFile } from "node:fs/promises";

export type ReachStep =
  | { kind: "goto"; path: string }
  | { kind: "click"; label: string }
  | { kind: "fill"; label: string; value: string }
  | { kind: "press"; key: string }
  | { kind: "expect"; text: string };

export type LiveAccess = "read-only" | "up-to-review" | "confirm";

export type Surface = {
  id: string;
  reach: ReachStep[];
  liveReach?: ReachStep[];
  confirmLabels: string[];
  budgets: Record<string, number>;
  manual: boolean;
  live?: LiveAccess;
};

export type FeatureMap = {
  surfaces: Map<string, Surface>;
  liveHosts: string[];
};

export const bareHostnamePattern = /^(?=.{1,253}$)(?:localhost|(?:(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)\.)*(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?))$/;

const stepPattern = /^(goto|click|fill|press|expect)\s+"([^"]*)"(?:\s+"([^"]*)")?$/;

export async function readFeatureMap(path: string): Promise<FeatureMap> {
  return parseFeatureMap(await readFile(path, "utf8"));
}

export function parseFeatureMap(markdown: string): FeatureMap {
  const surfaces = new Map<string, Surface>();
  const sections = markdown.split(/^###\s+/m).slice(1);
  for (const section of sections) {
    const [heading = "", ...bodyLines] = section.split("\n");
    const id = heading.match(/^`([^`]+)`/)?.[1];
    if (!id) continue;
    const body = bodyLines.join("\n");
    const reach = parseReachBlock(body, "Reach");
    const parsedLiveReach = parseReachBlock(body, "Reach \\(live\\)");
    const liveReach = parsedLiveReach.length > 0 ? parsedLiveReach : undefined;
    const confirmText = body.match(/^- \*\*Confirm labels\*\*:\s*(.*)$/m)?.[1] ?? "";
    const confirmLabels = [...confirmText.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    const budgets: Record<string, number> = {};
    for (const match of body.matchAll(/`([a-z][a-z:-]+)`\s*(?:≤|<=)\s*([\d_]+)\s*ms/g)) {
      budgets[match[1]] = Number(match[2].replaceAll("_", ""));
    }
    const manual = /^- \*\*Verify\*\*:\s*manual\s*$/m.test(body);
    const live = body.match(/^- \*\*Live\*\*:\s*(read-only|up-to-review|confirm)\s*$/m)?.[1] as LiveAccess | undefined;
    surfaces.set(id, { id, reach, ...(liveReach ? { liveReach } : {}), confirmLabels, budgets, manual, live });
  }
  return { surfaces, liveHosts: parseLiveHosts(markdown) };
}

export function parseLiveHosts(markdown: string): string[] {
  const section = markdown.split(/^## /m).find((part) => part.startsWith("Live hosts"));
  if (!section) return [];
  return [...new Set([...section.matchAll(/`([^`]+)`/g)]
    .map((match) => match[1].trim().toLowerCase())
    .filter((value) => bareHostnamePattern.test(value)))];
}

function parseReachBlock(body: string, heading: string): ReachStep[] {
  const reachText = body.match(new RegExp(`- \\*\\*${heading}\\*\\*[^\\n]*\\n([\\s\\S]*?)(?=\\n- \\*\\*[A-Z]|\\n## |$)`))?.[1] ?? "";
  return [...reachText.matchAll(/`([^`]+)`/g)].flatMap((match) => {
    const parsed = parseReachStep(match[1]);
    return parsed ? [parsed] : [];
  });
}

export function matchesConfirmLabel(patterns: string[], label: string): boolean {
  return patterns.some((pattern) => {
    const escaped = pattern.split("$<amount>").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const digits = "(?:[0-9]{1,3}(?:,[0-9]{3})*|[0-9]+)(?:\\.[0-9]+)?";
    const source = escaped.join(`(?:\\$${digits}|${digits}\\s+[A-Z][A-Z0-9]{1,9})`);
    return new RegExp(`^${source}$`).test(label);
  });
}

export function parseReachStep(source: string): ReachStep | null {
  const match = source.trim().match(stepPattern);
  if (!match) return null;
  const [, kind, first, second] = match;
  if (kind === "goto") return { kind, path: first };
  if (kind === "click") return { kind, label: first };
  if (kind === "fill" && second !== undefined) return { kind, label: first, value: second };
  if (kind === "press") return { kind, key: first };
  if (kind === "expect") return { kind, text: first };
  return null;
}

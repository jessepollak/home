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
  confirmLabels: string[];
  budgets: Record<string, number>;
  manual: boolean;
  live?: LiveAccess;
};

const stepPattern = /^(goto|click|fill|press|expect)\s+"([^"]*)"(?:\s+"([^"]*)")?$/;

export async function readFeatureMap(path: string): Promise<Map<string, Surface>> {
  return parseFeatureMap(await readFile(path, "utf8"));
}

export function parseFeatureMap(markdown: string): Map<string, Surface> {
  const surfaces = new Map<string, Surface>();
  const sections = markdown.split(/^###\s+/m).slice(1);
  for (const section of sections) {
    const [heading = "", ...bodyLines] = section.split("\n");
    const id = heading.match(/^`([^`]+)`/)?.[1];
    if (!id) continue;
    const body = bodyLines.join("\n");
    const reachText = body.match(/- \*\*Reach\*\*[^\n]*\n([\s\S]*?)(?=\n- \*\*[A-Z]|\n## |$)/)?.[1] ?? "";
    const reach = [...reachText.matchAll(/`([^`]+)`/g)].flatMap((match) => {
      const parsed = parseReachStep(match[1]);
      return parsed ? [parsed] : [];
    });
    const confirmText = body.match(/^- \*\*Confirm labels\*\*:\s*(.*)$/m)?.[1] ?? "";
    const confirmLabels = [...confirmText.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    const budgets: Record<string, number> = {};
    for (const match of body.matchAll(/`([a-z][a-z:-]+)`\s*(?:≤|<=)\s*([\d_]+)\s*ms/g)) {
      budgets[match[1]] = Number(match[2].replaceAll("_", ""));
    }
    const manual = /^- \*\*Verify\*\*:\s*manual\s*$/m.test(body);
    const live = body.match(/^- \*\*Live\*\*:\s*(read-only|up-to-review|confirm)\s*$/m)?.[1] as LiveAccess | undefined;
    surfaces.set(id, { id, reach, confirmLabels, budgets, manual, live });
  }
  return surfaces;
}

export function matchesConfirmLabel(patterns: string[], label: string): boolean {
  return patterns.some((pattern) => {
    const escaped = pattern.split("$<amount>").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const source = escaped.join("\\$(?:[0-9]{1,3}(?:,[0-9]{3})*|[0-9]+)(?:\\.[0-9]{1,2})?");
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

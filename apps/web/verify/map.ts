export type ReachStep =
  | { kind: "goto"; path: string }
  | { kind: "click"; label: string }
  | { kind: "fill"; label: string; value: string }
  | { kind: "press"; key: string }
  | { kind: "expect"; text: string };

export type Surface = {
  id: string;
  reach: ReachStep[];
  budgets: Record<string, number>;
};

const stepPattern = /^(goto|click|fill|press|expect)\s+"([^"]*)"(?:\s+"([^"]*)")?$/;

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
    const budgets: Record<string, number> = {};
    for (const match of body.matchAll(/`([a-z][a-z:-]+)`\s*(?:≤|<=)\s*([\d_]+)\s*ms/g)) {
      budgets[match[1]] = Number(match[2].replaceAll("_", ""));
    }
    surfaces.set(id, { id, reach, budgets });
  }
  return surfaces;
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

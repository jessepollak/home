import { readFile } from "node:fs/promises";
import { bareHostnamePattern } from "./live";

export type ReachStep =
  | { kind: "goto"; path: string }
  | { kind: "click"; label: string }
  | { kind: "click-prefix"; prefix: string }
  | { kind: "fill"; label: string; value: string }
  | { kind: "press"; key: string }
  | { kind: "expect"; text: string };

export type Surface = { id: string; reach: ReachStep[]; manual: boolean };
export type FeatureMap = { surfaces: Map<string, Surface>; liveHosts: string[] };

const stepPattern = /^(goto|click|click-prefix|fill|press|expect)\s+"([^"]*)"(?:\s+"([^"]*)")?$/;

export async function readFeatureMap(path: string): Promise<FeatureMap> {
  return parseFeatureMap(await readFile(path, "utf8"));
}

export function parseFeatureMap(markdown: string): FeatureMap {
  const surfaces = new Map<string, Surface>();
  for (const section of markdown.split(/^###\s+/m).slice(1)) {
    const [heading = "", ...lines] = section.split("\n");
    const id = heading.match(/^`([^`]+)`/)?.[1];
    if (!id) continue;
    const body = lines.join("\n");
    const reach = parseReachBlock(body);
    const manual = /^- \*\*Verify\*\*:\s*manual\s*$/m.test(body);
    surfaces.set(id, { id, reach, manual });
  }
  return { surfaces, liveHosts: parseLiveHosts(markdown) };
}

function parseReachBlock(body: string): ReachStep[] {
  const text = body.match(/- \*\*Reach\*\*[^\n]*\n([\s\S]*?)(?=\n- \*\*[A-Z]|\n## |$)/)?.[1] ?? "";
  return [...text.matchAll(/`([^`]+)`/g)].flatMap((match) => {
    const step = parseReachStep(match[1]);
    return step ? [step] : [];
  });
}

export function parseLiveHosts(markdown: string): string[] {
  const section = markdown.split(/^## /m).find((part) => part.startsWith("Live hosts"));
  if (!section) return [];
  return [...new Set([...section.matchAll(/`([^`]+)`/g)]
    .map((match) => match[1].trim().toLowerCase())
    .filter((value) => bareHostnamePattern.test(value)))];
}

export function parseReachStep(source: string): ReachStep | null {
  const match = source.trim().match(stepPattern);
  if (!match) return null;
  const [, kind, first, second] = match;
  if (kind === "goto") return { kind, path: first };
  if (kind === "click") return { kind, label: first };
  if (kind === "click-prefix") return { kind, prefix: first };
  if (kind === "fill" && second !== undefined) return { kind, label: first, value: second };
  if (kind === "press") return { kind, key: first };
  if (kind === "expect") return { kind, text: first };
  return null;
}

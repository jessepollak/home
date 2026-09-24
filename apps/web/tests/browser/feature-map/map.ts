import { readFile } from "node:fs/promises";

export type ReachStep =
  | { kind: "goto"; path: string }
  | { kind: "click"; label: string }
  | { kind: "click-prefix"; prefix: string }
  | { kind: "fill"; label: string; value: string }
  | { kind: "press"; key: string }
  | { kind: "expect"; text: string };

export type Surface = { id: string; reach: ReachStep[]; manual: boolean };

export async function readFeatureMap(path: string): Promise<{ surfaces: Map<string, Surface> }> {
  const markdown = await readFile(path, "utf8");
  const surfaces = new Map<string, Surface>();
  for (const section of markdown.split(/^###\s+/m).slice(1)) {
    const id = section.match(/^`([^`]+)`/)?.[1];
    if (!id) continue;
    const body = section.slice(section.indexOf("\n") + 1);
    const block = body.match(/- \*\*Reach\*\*[^\n]*\n([\s\S]*?)(?=\n- \*\*[A-Z]|\n## |$)/)?.[1] ?? "";
    const reach: ReachStep[] = [...block.matchAll(/`([^`]+)`/g)].flatMap((match): ReachStep[] => {
      const parts = match[1].match(/^(goto|click|click-prefix|fill|press|expect)\s+"([^"]*)"(?:\s+"([^"]*)")?$/);
      if (!parts) return [];
      const [, kind, value, extra] = parts;
      if (kind === "goto") return [{ kind, path: value }];
      if (kind === "click") return [{ kind, label: value }];
      if (kind === "click-prefix") return [{ kind, prefix: value }];
      if (kind === "fill" && extra !== undefined) return [{ kind, label: value, value: extra }];
      if (kind === "press") return [{ kind, key: value }];
      if (kind === "expect") return [{ kind, text: value }];
      return [];
    });
    surfaces.set(id, { id, reach, manual: /^- \*\*Verify\*\*:\s*manual\s*$/m.test(body) });
  }
  return { surfaces };
}

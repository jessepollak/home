import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

export type ReachStep =
  | { kind: "goto"; path: string }
  | { kind: "click"; label: string }
  | { kind: "click-prefix"; prefix: string }
  | { kind: "fill"; label: string; value: string }
  | { kind: "press"; key: string }
  | { kind: "expect"; text: string };

export type ReachVariant = { name: string; reach: ReachStep[] };

export type Surface = { id: string; reach: ReachStep[]; variants: ReachVariant[]; manual: boolean };

const nextField = String.raw`(?=\n- \*\*[A-Z]|\n## |$)`;

const reachCommand = /^(goto|click|click-prefix|fill|press|expect)((?:\s+"[^"]*")*)$/;
const commandWord = /^[a-z][a-z-]*/;
const commandWords = ["goto", "click", "click-prefix", "fill", "press", "expect"];
const commandArity = new Map([["goto", 1], ["click", 1], ["click-prefix", 1], ["fill", 2], ["press", 1], ["expect", 1]]);

function looksLikeCommand(token: string): boolean {
  const word = token.match(commandWord)?.[0];
  if (!word) return false;
  return commandWords.some((command) => command.startsWith(word) || word.startsWith(command.slice(0, 3)));
}

function reachStep(token: string): ReachStep | null {
  const parts = token.match(reachCommand);
  if (!parts) {
    if (looksLikeCommand(token)) throw new Error(`Unreadable Reach step: ${token}`);
    return null;
  }
  const [, kind, args] = parts;
  const values = [...args.matchAll(/"([^"]*)"/g)].map((match) => match[1]);
  if (values.length !== commandArity.get(kind)) throw new Error(`Unreadable Reach step: ${token}`);
  if (kind === "goto") return { kind, path: values[0] };
  if (kind === "click") return { kind, label: values[0] };
  if (kind === "click-prefix") return { kind, prefix: values[0] };
  if (kind === "fill") return { kind, label: values[0], value: values[1] };
  if (kind === "press") return { kind, key: values[0] };
  return { kind: "expect", text: values[0] };
}

function parseReachSteps(block: string): ReachStep[] {
  return block.split("\n").flatMap((line): ReachStep[] => [...line.matchAll(/`([^`]+)`/g)]
    .map((match) => reachStep(match[1]))
    .filter((step): step is ReachStep => step !== null));
}

export function parseSurface(file: string, markdown: string): Surface {
  const section = markdown.split(/^###\s+/m)[1];
  const id = section?.match(/^`([^`]+)`/)?.[1];
  if (!id || file !== `${id}.md` || markdown.split(/^###\s+/m).length !== 2) {
    throw new Error(`Invalid feature-map surface: ${file}`);
  }
  const body = section.slice(section.indexOf("\n") + 1);
  const block = body.match(new RegExp(String.raw`- \*\*Reach\*\*[^\n]*\n([\s\S]*?)${nextField}`))?.[1] ?? "";
  const variants = [...body.matchAll(new RegExp(String.raw`- \*\*Reach \(replay: ([a-z0-9-]+)\)\*\*[^\n]*\n([\s\S]*?)${nextField}`, "g"))]
    .map((match) => ({ name: match[1], reach: parseReachSteps(match[2]) }));
  const replayHeadings = body.match(/- \*\*Reach \(replay:/g)?.length ?? 0;
  if (replayHeadings !== variants.length || new Set(variants.map((variant) => variant.name)).size !== variants.length) {
    throw new Error(`Invalid or duplicate replay Reach in feature-map surface: ${file}`);
  }
  return { id, reach: parseReachSteps(block), variants, manual: /^- \*\*Verify\*\*:\s*manual\s*$/m.test(body) };
}

export async function readFeatureMap(path: string): Promise<{ surfaces: Map<string, Surface> }> {
  const files = (await readdir(path)).filter((name) => name.endsWith(".md")).sort();
  const surfaces = new Map<string, Surface>();
  for (const file of files) {
    const surface = parseSurface(file, await readFile(join(path, file), "utf8"));
    surfaces.set(surface.id, surface);
  }
  return { surfaces };
}

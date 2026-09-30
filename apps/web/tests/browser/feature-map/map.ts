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
const stepVerbWords = [...commandWords].sort((left, right) => right.length - left.length).join("|");
function maskCodeSpans(file: string, text: string): string {
  const lineAt = (index: number) => text.split("\n")[text.slice(0, index).split("\n").length - 1].trim();
  let masked = "";
  let inside = false;
  let opened = 0;
  let wrapped = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === "\\") {
      masked += character + (text[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (character === "\n" && inside) wrapped = true;
    if (character === "`") {
      inside = !inside;
      if (inside) opened = index;
      else if (wrapped) throw new Error(`Wrapped code span in feature-map surface ${file}: ${lineAt(opened)}`);
      masked += "\u0000";
      continue;
    }
    masked += inside ? "\u0000" : character;
  }
  if (inside) throw new Error(`Unclosed code span in feature-map surface ${file}: ${lineAt(opened)}`);
  return masked;
}
const proseStep = new RegExp(String.raw`(?<![\w-])(?:${stepVerbWords})(?:\s+(?:the|a|an|this|that|these|those|your|our|their|its|my|any|each|every|all|another|some))?\s*\u0000|^[ \t:>]*\d+[.)]\s*(?:${stepVerbWords})(?!\w|-(?=[\p{L}\p{N}_]|\s+(?:and|or)\b))`, "mu");
const headingPrefix = /^- \*\*Reach(?: \([^()]*\))?\*\*(?: \([^()]*\))? ?: ?/;
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

function assertMachineReadableReach(file: string, block: string, heading: string): void {
  const content = heading.replace(headingPrefix, "");
  if (content === heading) throw new Error(`Unsupported Reach heading in feature-map surface ${file}: ${heading.trim()}`);
  const lines = [heading, ...block.split("\n")];
  const masked = maskCodeSpans(file, `${content}\n${block}`).toLowerCase();
  const match = proseStep.exec(masked);
  if (match) {
    const index = masked.slice(0, match.index).split("\n").length - 1;
    throw new Error(`Prose Reach step in feature-map surface ${file}: ${(index === 0 ? heading : lines[index] ?? heading).trim()}`);
  }
  if (heading.includes("`")) throw new Error(`Code span in Reach heading of feature-map surface ${file}: ${heading.trim()}`);
}

export function parseSurface(file: string, markdown: string): Surface {
  const section = markdown.split(/^###\s+/m)[1];
  const id = section?.match(/^`([^`]+)`/)?.[1];
  if (!id || file !== `${id}.md` || markdown.split(/^###\s+/m).length !== 2) {
    throw new Error(`Invalid feature-map surface: ${file}`);
  }
  const body = section.slice(section.indexOf("\n") + 1);
  const manual = /^- \*\*Verify\*\*:\s*manual\s*$/m.test(body);
  const reachBlock = body.match(new RegExp(String.raw`(- \*\*Reach\*\*[^\n]*)\n([\s\S]*?)${nextField}`));
  const block = reachBlock?.[2] ?? "";
  const variantBlocks = [...body.matchAll(new RegExp(String.raw`(- \*\*Reach \(replay: ([a-z0-9-]+)\)\*\*[^\n]*)\n([\s\S]*?)${nextField}`, "g"))]
    .map((match) => ({ heading: match[1], name: match[2], block: match[3] }));
  const replayHeadings = body.match(/- \*\*Reach \(replay:/g)?.length ?? 0;
  if (replayHeadings !== variantBlocks.length || new Set(variantBlocks.map((variant) => variant.name)).size !== variantBlocks.length) {
    throw new Error(`Invalid or duplicate replay Reach in feature-map surface: ${file}`);
  }
  if (!manual) {
    if (reachBlock) assertMachineReadableReach(file, reachBlock[2], reachBlock[1]);
    for (const variant of variantBlocks) assertMachineReadableReach(file, variant.block, variant.heading);
  }
  const variants = variantBlocks.map((variant) => ({ name: variant.name, reach: parseReachSteps(variant.block) }));
  return { id, reach: parseReachSteps(block), variants, manual };
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

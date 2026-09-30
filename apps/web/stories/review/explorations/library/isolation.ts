export type StoryAnnotations = {
  args?: Record<string, unknown>;
  globals?: Record<string, unknown>;
  loaders?: unknown;
  beforeEach?: unknown;
  play?: unknown;
  parameters?: Record<string, unknown>;
};

export type FrameReason = "Loaders" | "Network mocks" | "Setup hook" | "Play function" | "Pinned globals" |
  "Opens an overlay" | "Portals outside the sheet" | "Couldn't read component source" | "Library override" | "Declared viewport";

function present(value: unknown): boolean {
  return Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null;
}

export function hasPinnedTheme(meta: StoryAnnotations, story: StoryAnnotations): boolean {
  return Object.hasOwn(meta.globals ?? {}, "theme") || Object.hasOwn(story.globals ?? {}, "theme");
}

export function frameReason(meta: StoryAnnotations, story: StoryAnnotations, portals = false, sourceReadable = true): FrameReason | null {
  if (present(story.loaders) || present(meta.loaders)) return "Loaders";
  if (present(story.parameters?.msw) || present(meta.parameters?.msw)) return "Network mocks";
  if (present(story.beforeEach) || present(meta.beforeEach)) return "Setup hook";
  if (present(story.play) || present(meta.play)) return "Play function";
  if (Object.keys({ ...meta.globals, ...story.globals }).some((key) => key !== "theme")) return "Pinned globals";
  const args = { ...meta.args, ...story.args };
  if (args.open === true || args.defaultOpen === true) return "Opens an overlay";
  const library = story.parameters?.library;
  const render = library && typeof library === "object" && "render" in library ? library.render : undefined;
  if (render === "frame") return "Library override";
  if (!sourceReadable) return "Couldn't read component source";
  if (portals && render !== "document") return "Portals outside the sheet";
  return null;
}

export function rendersPortal(source: string): boolean {
  return /\bPortal\b|[\w$]+Portal\b|createPortal/.test(source);
}

export function componentModulePaths(source: string, storyPath: string): string[] {
  const paths = new Set<string>();
  for (const match of source.matchAll(/(?=\b(?:from|import)\s*(?:"([^"]*)"|'([^']*)')|\bimport\s*\(\s*(?:"([^"]*)"|'([^']*)')\s*\))/g)) {
    const specifier = match.slice(1).find((value) => value !== undefined)!;
    const path = specifier.startsWith("@/") ? specifier.slice(2) : specifier.startsWith(".")
      ? `${storyPath.slice(0, storyPath.lastIndexOf("/"))}/${specifier}` : specifier;
    const parts: string[] = [];
    for (const part of path.split("/")) {
      if (part === "..") parts.pop();
      else if (part && part !== ".") parts.push(part);
    }
    const normalized = parts.join("/");
    if (normalized.startsWith("components/ui/")) paths.add(normalized);
  }
  return [...paths];
}

export function resolveComponentPath(path: string, keys: readonly string[]): string | undefined {
  const base = path.replace(/\.(?:js|jsx|ts|tsx)$/, "");
  return [path, `${base}.tsx`, `${base}.ts`, `${base}/index.tsx`].find((candidate) => keys.includes(candidate));
}

export type PortalRule = { portals: boolean; sourceReadable: boolean };

export async function readPortalRule(key: string, sources: Record<string, () => Promise<string>>): Promise<PortalRule> {
  try {
    const keys = Object.keys(sources);
    const pending = [key];
    const visited = new Set<string>();
    let portals = false;
    while (pending.length) {
      const current = pending.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);
      const source = await sources[current]();
      for (const match of source.matchAll(/\bimport\s*\(/g)) {
        if (!/^\s*(?:"[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*')\s*\)/.test(source.slice(match.index + match[0].length))) {
          throw new Error("Unsupported import expression");
        }
      }
      portals ||= rendersPortal(source);
      for (const path of componentModulePaths(source, current)) {
        const resolved = resolveComponentPath(`../../../../${path}`, keys);
        if (!resolved) throw new Error("Missing component source");
        pending.push(resolved);
      }
    }
    return { portals, sourceReadable: true };
  } catch {
    return { portals: false, sourceReadable: false };
  }
}

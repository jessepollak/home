export type StoryAnnotations = {
  args?: Record<string, unknown>;
  globals?: Record<string, unknown>;
  loaders?: unknown;
  beforeEach?: unknown;
  play?: unknown;
  parameters?: Record<string, unknown>;
};

export type FrameReason = "Loaders" | "Network mocks" | "Setup hook" | "Play function" | "Pinned globals" |
  "Opens an overlay" | "Portals outside the sheet" | "Couldn't read component source" | "Library override";

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
  const tokens = (source.match(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|[\w$]+|[^\s]/g) ?? [])
    .filter((token) => !token.startsWith("//") && !token.startsWith("/*"));
  let depth = 0;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (["{", "(", "["].includes(token)) depth++;
    if (["}", ")", "]"].includes(token)) depth--;
    if (depth !== 0 || !["import", "export"].includes(token) || tokens[index + 1] === "type") continue;
    const next = tokens[index + 1];
    if (token === "import" && ["(", "."].includes(next)) continue;
    if (token === "export" && !["{", "*"].includes(next)) continue;
    let literal = token === "import" && /^["']/.test(next) ? next : undefined;
    for (let cursor = index + 1; !literal && cursor < tokens.length; cursor++) {
      if ([";", "import", "export"].includes(tokens[cursor])) break;
      if (tokens[cursor] === "from" && /^["']/.test(tokens[cursor + 1] ?? "")) literal = tokens[cursor + 1];
    }
    if (!literal) continue;
    const specifier = literal.slice(1, -1);
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
    const source = await sources[key]();
    const paths = componentModulePaths(source, key);
    const keys = Object.keys(sources);
    const components = await Promise.all(paths.map((path) => {
      const resolved = resolveComponentPath(`../../../../${path}`, keys);
      if (!resolved) throw new Error("Missing component source");
      return sources[resolved]();
    }));
    return { portals: components.some(rendersPortal), sourceReadable: true };
  } catch {
    return { portals: false, sourceReadable: false };
  }
}

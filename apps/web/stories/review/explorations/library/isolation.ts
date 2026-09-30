export type StoryAnnotations = {
  args?: Record<string, unknown>;
  globals?: Record<string, unknown>;
  loaders?: unknown;
  beforeEach?: unknown;
  play?: unknown;
  parameters?: Record<string, unknown>;
};

export type FrameReason = "Loaders" | "Network mocks" | "Setup hook" | "Play function" | "Pinned globals" |
  "Opens an overlay" | "Portals outside the sheet" | "Library override";

function present(value: unknown): boolean {
  return Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null;
}

export function frameReason(meta: StoryAnnotations, story: StoryAnnotations, portals = false): FrameReason | null {
  if (present(story.loaders) || present(meta.loaders)) return "Loaders";
  if (present(story.parameters?.msw) || present(meta.parameters?.msw)) return "Network mocks";
  if (present(story.beforeEach) || present(meta.beforeEach)) return "Setup hook";
  if (present(story.play) || present(meta.play)) return "Play function";
  if (Object.keys({ ...meta.globals, ...story.globals }).length) return "Pinned globals";
  const args = { ...meta.args, ...story.args };
  if (args.open === true || args.defaultOpen === true) return "Opens an overlay";
  const library = story.parameters?.library;
  const render = library && typeof library === "object" && "render" in library ? library.render : undefined;
  if (render === "frame") return "Library override";
  if (portals && render !== "document") return "Portals outside the sheet";
  return null;
}

export function rendersPortal(source: string): boolean {
  const code = source.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g, " ");
  return /<\s*(?:[\w$]+\.)*[\w$]*Portal\b|\bcreatePortal\s*\(/.test(code);
}

export function componentModulePaths(source: string, storyPath: string): string[] {
  const paths = new Set<string>();
  const imports = source.matchAll(/\bimport\s+(?!\s*type\b)[^;]*?\bfrom\s*["']([^"']+)["']/g);
  for (const [, specifier] of imports) {
    const path = specifier.startsWith("@/") ? specifier.slice(2) : specifier.startsWith(".")
      ? `${storyPath.slice(0, storyPath.lastIndexOf("/"))}/${specifier}` : specifier;
    const parts: string[] = [];
    for (const part of path.split("/")) {
      if (part === "..") parts.pop();
      else if (part && part !== ".") parts.push(part);
    }
    const normalized = parts.join("/").replace(/\.tsx$/, "");
    if (/^components\/ui\/[^/]+$/.test(normalized)) paths.add(`${normalized}.tsx`);
  }
  return [...paths];
}

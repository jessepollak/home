export type StoryAnnotations = {
  args?: Record<string, unknown>;
  globals?: Record<string, unknown>;
  loaders?: unknown;
  beforeEach?: unknown;
  play?: unknown;
  parameters?: Record<string, unknown>;
};

export type FrameReason = "Loaders" | "Network mocks" | "Setup hook" | "Play function" | "Pinned globals" |
  "Opens an overlay" | "Portals outside the sheet";

function present(value: unknown): boolean {
  return Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null;
}

export function frameReason(meta: StoryAnnotations, story: StoryAnnotations): FrameReason | null {
  if (present(story.loaders) || present(meta.loaders)) return "Loaders";
  if (present(story.parameters?.msw) || present(meta.parameters?.msw)) return "Network mocks";
  if (present(story.beforeEach) || present(meta.beforeEach)) return "Setup hook";
  if (present(story.play) || present(meta.play)) return "Play function";
  if (Object.keys({ ...meta.globals, ...story.globals }).length) return "Pinned globals";
  const args = { ...meta.args, ...story.args };
  if (args.open === true || args.defaultOpen === true) return "Opens an overlay";
  return null;
}

export function escapesLibrary(node: Node, root: Node): boolean {
  if (node.nodeType !== 1 || root.contains(node) || node.contains(root)) return false;
  const element = node as Element;
  return !["storybook-root", "storybook-docs"].includes(element.id) &&
    !["SCRIPT", "STYLE", "LINK"].includes(element.tagName);
}

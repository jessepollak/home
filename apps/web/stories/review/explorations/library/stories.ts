import type { composeStory as ComposeStory, Preview } from "@storybook/nextjs-vite";
import type { ComponentType } from "react";
import type { StoryIndexEntry } from "../board/review-build";
import type { ArgType } from "./controls";
import { frameReason, hasPinnedTheme, readPortalRule, type FrameReason, type PortalRule, type StoryAnnotations } from "./isolation";
import { declaredViewport, type FrameViewport } from "./sheet-state";

export type StoryModule = Record<string, unknown> & { default?: StoryAnnotations };

export type SheetStory = {
  id: string;
  name: string;
  Story: ComponentType<Record<string, unknown>>;
  argTypes: Record<string, ArgType>;
  initialArgs: Record<string, unknown>;
  layout: string;
  frame: FrameReason | null;
  portals: boolean;
  themePinned: boolean;
  viewport?: FrameViewport;
};

type Runtime = { composeStory: typeof ComposeStory; preview: Preview };

const modules = (() => {
  try {
    return import.meta.glob("../../../../components/ui/*.stories.tsx") as Record<string, () => Promise<StoryModule>>;
  } catch {
    return {};
  }
})();
const sources = (() => {
  try {
    return import.meta.glob("../../../../components/ui/{*.tsx,*.ts,*/index.tsx}", { query: "?raw", import: "default" }) as Record<string, () => Promise<string>>;
  } catch {
    return {};
  }
})();
const modulePortals = new WeakMap<StoryModule, PortalRule>();

function loadPortalRule(key: string): Promise<PortalRule> {
  return readPortalRule(key, sources);
}
let runtime: Runtime | undefined;
let runtimeRequest: Promise<Runtime> | undefined;

function loadRuntime(): Promise<Runtime> {
  runtimeRequest ??= Promise.all([import("@storybook/nextjs-vite"), import("../../../../.storybook/preview")])
    .then(([storybook, project]) => (runtime = { composeStory: storybook.composeStory, preview: project.default }));
  return runtimeRequest;
}
const loaded = new Map<string, StoryModule>();
const pending = new Map<string, Promise<StoryModule>>();
const composed = new WeakMap<StoryModule, Map<string, SheetStory[]>>();

function moduleKey(importPath: string): string | undefined {
  const file = importPath.split("/").at(-1);
  return file ? Object.keys(modules).find((key) => key.endsWith(`/components/ui/${file}`)) : undefined;
}

export function peekStoryModule(importPath: string): StoryModule | undefined {
  return runtime && loaded.get(importPath);
}

export function loadStoryModule(importPath: string): Promise<StoryModule> {
  const cached = pending.get(importPath);
  if (cached) return cached;
  const key = moduleKey(importPath);
  const request = key ? Promise.all([modules[key](), loadRuntime(), loadPortalRule(key)]).then(([module, , portals]) => {
    modulePortals.set(module, portals);
    return module;
  })
    : Promise.reject(new Error(`No story module for ${importPath}`));
  const tracked = request.then((module) => {
    loaded.set(importPath, module);
    return module;
  }, (error: unknown) => {
    pending.delete(importPath);
    throw error;
  });
  pending.set(importPath, tracked);
  return tracked;
}

export function sheetStories(module: StoryModule, entries: StoryIndexEntry[], theme: string): SheetStory[] {
  if (!runtime) throw new Error("Story runtime is not loaded");
  const { composeStory, preview } = runtime;
  const byTheme = composed.get(module) ?? new Map<string, SheetStory[]>();
  composed.set(module, byTheme);
  const key = `${theme}\u0000${entries.map((entry) => entry.id).join("\u0000")}`;
  const cached = byTheme.get(key);
  if (cached) return cached;
  const meta = module.default ?? {};
  const component = meta as Parameters<typeof composeStory>[1];
  const rule = modulePortals.get(module) ?? { portals: false, sourceReadable: false };
  const annotations = { ...preview, initialGlobals: { ...preview.initialGlobals, theme } };
  const exports = new Map(Object.entries(module).flatMap(([name, value]) => {
    if (name === "default" || !value || typeof value !== "object") return [];
    const story = composeStory(value, component, annotations, name);
    return [[story.id, { story, annotation: value as StoryAnnotations }] as const];
  }));
  const stories = entries.flatMap((entry): SheetStory[] => {
    const match = exports.get(entry.id);
    if (!match) return [];
    const { story, annotation } = match;
    const viewport = declaredViewport(story.parameters, story.globals);
    return [{
      id: entry.id,
      name: entry.name,
      Story: story as unknown as ComponentType<Record<string, unknown>>,
      argTypes: story.argTypes as Record<string, ArgType>,
      initialArgs: story.args,
      layout: typeof story.parameters.layout === "string" ? story.parameters.layout : "padded",
      frame: frameReason(meta, annotation, rule.portals, rule.sourceReadable) ?? (viewport ? "Declared viewport" : null),
      portals: rule.portals || !rule.sourceReadable,
      themePinned: hasPinnedTheme(meta, annotation),
      viewport,
    }];
  });
  byTheme.set(key, stories);
  return stories;
}

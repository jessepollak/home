/// <reference types="vite/client" />
import globalsCss from "../../../../../app/globals.css?raw";
import type { SourceFile } from "./usage";

function componentModules(): Record<string, string> | null {
  if (!import.meta.env?.MODE && typeof import.meta.glob !== "function") return null;
  return import.meta.glob(
    ["../../../../../components/**/*.tsx", "!../../../../../components/**/*.stories.tsx", "!../../../../../components/**/*.test.tsx"],
    { query: "?raw", import: "default", eager: true },
  ) as Record<string, string>;
}

export function sourceSet(modules: Record<string, string> | null) {
  return modules === null ? { status: "unavailable" as const, files: [] } : {
    status: "available" as const,
    files: Object.entries(modules).map(([path, source]) => ({ path: path.replace(/^(?:\.\.\/)+/, ""), source }))
      .sort((left, right) => left.path.localeCompare(right.path)),
  };
}

export const componentSourceSet = sourceSet(componentModules());

export const globalsSource = globalsCss;

export const componentSources: SourceFile[] = componentSourceSet.files;

export const ownedSources = componentSources.filter((file) => file.path.startsWith("components/ui/"));

/// <reference types="vite/client" />
import globalsCss from "../../../../../app/globals.css?raw";
import type { SourceFile } from "./usage";

function componentModules(): Record<string, string> {
  try {
    return import.meta.glob(
      ["../../../../../components/**/*.tsx", "!../../../../../components/**/*.stories.tsx", "!../../../../../components/**/*.test.tsx"],
      { query: "?raw", import: "default", eager: true },
    ) as Record<string, string>;
  } catch {
    return {};
  }
}

const modules = componentModules();

export const globalsSource = globalsCss;

export const componentSources: SourceFile[] = Object.entries(modules)
  .map(([path, source]) => ({ path: path.replace(/^(?:\.\.\/)+/, ""), source }))
  .sort((left, right) => left.path.localeCompare(right.path));

export const ownedSources = componentSources.filter((file) => file.path.startsWith("components/ui/"));

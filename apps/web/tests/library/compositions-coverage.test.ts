import { describe, expect, test } from "bun:test";
import { compositionUiImports } from "../../.storybook/library-imports-plugin";
import type { ReviewBuild, StoryIndexEntry } from "@/stories/review/explorations/board/review-build";
import { libraryCatalog } from "@/stories/review/explorations/library/catalog";

const root = `${import.meta.dir}/../..`;
const build: ReviewBuild = { revision: "fixture", deployment: "", branch: "", repo: null, pr: null, changedFiles: null };

const pending = new Set([
  "ui-button-group", "ui-combobox", "ui-coverage-status-preview", "ui-coverage-table", "ui-data-table", "ui-dialog",
  "ui-empty", "ui-feature-intro", "ui-input", "ui-input-otp", "ui-kbd", "ui-popover", "ui-radio-group", "ui-rail-nav",
  "ui-select", "ui-switch", "ui-table", "ui-toast", "ui-toggle",
]);

async function catalogComponents(): Promise<Map<string, string>> {
  const files = [...new Bun.Glob("components/ui/*.stories.tsx").scanSync({ cwd: root })].sort();
  const metas = await Promise.all(files.map(async (file) => {
    const meta: { id?: string; title: string } = (await import(`@/${file}`)).default;
    return { file, id: meta.id ?? meta.title.toLowerCase().replace(/[^a-z0-9]+/g, "-"), title: meta.title };
  }));
  const index: Record<string, StoryIndexEntry> = Object.fromEntries(metas.map(({ file, id, title }) =>
    [`${id}--default`, { id: `${id}--default`, title, name: "Default", type: "story", importPath: `./${file}` }]));
  const ids = new Set(libraryCatalog(index, build).items.map((item) => item.id));
  return new Map(metas.filter((meta) => ids.has(meta.id))
    .map((meta) => [meta.file.slice("components/ui/".length, -".stories.tsx".length), meta.id]));
}

describe("library compositions", () => {
  test("cover every catalog component except the pending set", async () => {
    const components = await catalogComponents();
    const compositions = Object.values(await compositionUiImports());
    expect(components.size).toBeGreaterThan(0);
    expect(compositions.length).toBeGreaterThan(0);
    const covered = new Set(compositions.flat()
      .flatMap((name) => components.get(name) ?? []));
    const uncovered = [...components.values()].filter((id) => !covered.has(id)).sort();
    expect(uncovered.filter((id) => !pending.has(id))).toEqual([]);
    expect([...pending].filter((id) => covered.has(id)).sort()).toEqual([]);
    expect([...pending].filter((id) => ![...components.values()].includes(id)).sort()).toEqual([]);
  });

  test("render each composition in its own frame", async () => {
    const files = [...new Bun.Glob("stories/review/compositions/*.stories.tsx").scanSync({ cwd: root })].sort();
    for (const file of files) {
      const meta: { title: string; parameters?: { library?: { render?: string } } } = (await import(`@/${file}`)).default;
      expect(meta.title.startsWith("Compositions/")).toBe(true);
      expect(meta.parameters?.library?.render).toBe("frame");
    }
  });
});

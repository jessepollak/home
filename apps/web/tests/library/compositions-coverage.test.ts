import { describe, expect, test } from "bun:test";
import { compositionUiImports, lexCompositionUiImports } from "../../.storybook/library-imports-plugin";
import type { ReviewBuild, StoryIndexEntry } from "@/stories/review/explorations/board/review-build";
import { libraryCatalog } from "@/stories/review/explorations/library/catalog";

const root = `${import.meta.dir}/../..`;
const build: ReviewBuild = { revision: "fixture", deployment: "", branch: "", repo: null, pr: null, changedFiles: null };

function requireCompositionCoverage(components: Map<string, string>, compositions: string[][]): number {
  const covered = new Set(compositions.flat().flatMap((name) => components.get(name) ?? []));
  const uncovered = [...components.values()].filter((id) => !covered.has(id)).sort();
  if (uncovered.length) throw new Error(`Uncovered catalog components: ${uncovered.join(", ")}`);
  return covered.size;
}

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
  test("cover every catalog component", async () => {
    const components = await catalogComponents();
    const compositions = Object.values(await compositionUiImports());
    expect(components.size).toBeGreaterThan(0);
    expect(compositions.length).toBeGreaterThan(0);
    expect(requireCompositionCoverage(components, compositions)).toBe(components.size);
  });

  test("fail when a catalog component is uncovered", () => {
    const components = new Map([["button", "ui-button"], ["input", "ui-input"]]);
    expect(() => requireCompositionCoverage(components, [["button"]])).toThrow("Uncovered catalog components: ui-input");
  });

  for (const [name, source, covered] of [
    ["inline type-only", 'import { type InputOTP } from "@/components/ui/input-otp";', false],
    ["all inline type-only", 'import { type InputOTP, type InputOTPGroup } from "@/components/ui/input-otp";', false],
    ["statement type-only", 'import type { InputOTP } from "@/components/ui/input-otp";', false],
    ["default type-only", 'import type InputOTP from "@/components/ui/input-otp";', false],
    ["mixed default", 'import InputOTP, { type InputOTPGroup } from "@/components/ui/input-otp";', true],
    ["mixed named", 'import { type InputOTPGroup, InputOTP } from "@/components/ui/input-otp";', true],
    ["namespace", 'import * as OTP from "@/components/ui/input-otp";', true],
    ["multiline commented", 'import { /* type */ InputOTP,\n type InputOTPGroup } from\n "@/components/ui/input-otp";', true],
    ["empty", 'import {} from "@/components/ui/input-otp";', false],
    ["side effect", 'import "@/components/ui/input-otp";', false],
  ] as const) {
    test(`coverage counts value bindings only: ${name}`, async () => {
      expect(await lexCompositionUiImports(source, "probe.stories.tsx")).toEqual(covered ? ["input-otp"] : []);
    });
  }

  test("render each composition in its own frame", async () => {
    const files = [...new Bun.Glob("stories/review/compositions/*.stories.tsx").scanSync({ cwd: root })].sort();
    for (const file of files) {
      const meta: { title: string; parameters?: { library?: { render?: string } } } = (await import(`@/${file}`)).default;
      expect(meta.title.startsWith("Compositions/")).toBe(true);
      expect(meta.parameters?.library?.render).toBe("frame");
    }
  });
});

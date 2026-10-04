import { describe, expect, test } from "bun:test";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { Scanner } from "@tailwindcss/oxide";
import { libraryCandidateSources, scanLibraryCandidates } from "../../.storybook/library-candidates";

const root = fileURLToPath(new URL("../../", import.meta.url));

describe("build-time oxide candidates", () => {
  test.each([
    ['"[[data-variant=legend]+&]:-mt-1.5"', ["[[data-variant=legend]+&]:-mt-1.5"]],
    ['"[&[data-x]]:duration-200"', ["[&[data-x]]:duration-200"]],
    ['"duration-(--duration)"', ["duration-(--duration)"]],
    ['"ease-(--curve)"', ["ease-(--curve)"]],
    ['clsx({"duration-200": enabled, "ease-out": true})', ["duration-200", "ease-out"]],
    ['`not-${"duration-200"}`', ["duration-200"]],
    ['`duration-${200}`', []],
    ['`transition-${kind}`', []],
    ['`${state === "transition" ? fn({x:1}) : "duration-200"}`', ["transition", "duration-200"]],
    ['`${ready ? `duration-100` : `duration-200`}`', ["duration-100", "duration-200"]],
  ] satisfies [string, string[]][])("preserves native candidates in %s", (source, expected) => {
    const [{ candidates }] = scanLibraryCandidates([{ path: "fixture.tsx", source }], new Scanner({}));
    expect(candidates.filter((name) => name.includes("duration") || name.includes("ease-") || name.includes("mt-1.5") || name === "transition"))
      .toEqual(expected);
  });

  test("emits one candidate entry for each occurrence and keeps files separate", () => {
    const output = scanLibraryCandidates([
      { path: "first.tsx", source: '"duration-200 duration-200"' },
      { path: "second.tsx", source: '"duration-200"' },
    ], new Scanner({}));
    expect(output).toEqual([
      { path: "first.tsx", candidates: ["duration-200", "duration-200"] },
      { path: "second.tsx", candidates: ["duration-200"] },
    ]);
  });

  test("matches oxide directly for the complete non-story/non-test component corpus", () => {
    const base = fileURLToPath(new URL("../../components", import.meta.url));
    const scanner = new Scanner({ sources: [
      { base, pattern: "**/*.tsx", negated: false },
      { base, pattern: "**/*.stories.tsx", negated: true },
      { base, pattern: "**/*.test.tsx", negated: true },
    ] });
    scanner.scan();
    const paths = scanner.files.map((path) => relative(root, path)).sort((left, right) => left.localeCompare(right));
    const native = paths.map((path) => ({ path, candidates: scanner.getCandidatesWithPositions({
      file: fileURLToPath(new URL(`../../${path}`, import.meta.url)), extension: "tsx",
    }).map(({ candidate }) => candidate) }));
    const sources = libraryCandidateSources(root);
    expect(sources.map(({ path }) => path)).toEqual(paths);
    expect(scanLibraryCandidates(sources, new Scanner({}))).toEqual(native);
    expect(native.find(({ path }) => path === "components/ui/field.tsx")?.candidates)
      .toContain("[[data-variant=legend]+&]:-mt-1.5");
  });
});

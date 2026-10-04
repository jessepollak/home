import { expect, test } from "bun:test";
import type { StoryIndexEntry } from "@/stories/review/explorations/board/review-build";
import { orderedCompositionEntries, type StoryModule } from "@/stories/review/explorations/library/stories";

function entry(file: string, name: string): StoryIndexEntry {
  return { id: `${file}--${name}`, title: `Compositions/${file}`, name, type: "story", importPath: `${file}.stories.tsx` };
}

function module(order?: unknown): StoryModule {
  return { default: { parameters: { library: { order } } } };
}

test("composition meta order wins over title, with stable index order inside each file", () => {
  const entries = [entry("Invest", "OrbitDetail"), entry("Home", "Home"), entry("Invest", "Invest")];
  const original = [...entries];
  const modules = new Map([["Invest.stories.tsx", module(2)], ["Home.stories.tsx", module(1)]]);
  expect(orderedCompositionEntries(entries, modules).map(({ id }) => id))
    .toEqual(["Home--Home", "Invest--OrbitDetail", "Invest--Invest"]);
  expect(entries).toEqual(original);
});

test("equal and absent orders fall back to title; invalid orders behave as absent", () => {
  const entries = [entry("Zulu", "Default"), entry("Beta", "Default"), entry("Alpha", "Default"),
    entry("Gamma", "Default"), entry("Delta", "Default"), entry("Epsilon", "Default"), entry("Finite", "Default")];
  const modules = new Map([
    ["Beta.stories.tsx", module(3)], ["Alpha.stories.tsx", module(3)], ["Gamma.stories.tsx", module("1")],
    ["Delta.stories.tsx", module(NaN)], ["Epsilon.stories.tsx", module(Infinity)], ["Finite.stories.tsx", module(0)],
  ]);
  expect(orderedCompositionEntries(entries, modules).map(({ id }) => id)).toEqual([
    "Finite--Default", "Alpha--Default", "Beta--Default", "Delta--Default", "Epsilon--Default", "Gamma--Default", "Zulu--Default",
  ]);
});

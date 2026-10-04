import "@/client/account/dom-test-harness";
import { expect, test } from "bun:test";
import { createElement } from "react";
import { composeStory } from "storybook/preview-api";
import preview from "../../.storybook/preview";
import { compositionA11yExemptions } from "./fixtures/composition-a11y-exemptions";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

test("every composition resolves to strict a11y unless tracked by an issue", async () => {
  const files = [...new Bun.Glob("stories/review/compositions/*.stories.tsx").scanSync({ cwd: `${import.meta.dir}/../..` })].sort();
  const seen = new Set<string>();
  const exemptions = new Map(compositionA11yExemptions.map(({ storyId, issue }) => {
    expect(Number.isSafeInteger(issue) && issue > 0).toBe(true);
    return [storyId, issue];
  }));
  expect(exemptions.size).toBe(compositionA11yExemptions.length);
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    const storyModule: unknown = await import(`@/${file}`);
    if (!isRecord(storyModule) || !isRecord(storyModule.default)) throw new Error(`Missing composition meta: ${file}`);
    for (const [name, value] of Object.entries(storyModule)) {
      if (name === "default" || !isRecord(value)) continue;
      const story = composeStory(value, storyModule.default, preview, { render: () => createElement("div") }, name);
      seen.add(story.id);
      const a11y: unknown = story.parameters.a11y;
      if (!isRecord(a11y)) throw new Error(`Missing a11y parameters: ${story.id}`);
      expect(a11y.test, story.id).toBe(exemptions.has(story.id) ? "todo" : "error");
    }
  }
  expect(seen.size).toBeGreaterThan(0);
  expect(compositionA11yExemptions.filter(({ storyId }) => !seen.has(storyId))).toEqual([]);
});

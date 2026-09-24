import { expect, test } from "bun:test";
import config from "./.storybook/main";
import mapping from "./figma-components.json";

type StoryDesigns = Record<string, { meta: unknown; stories: unknown[] }>;

// Story modules pull in MSW handlers, storybook/test and browser globals.
// Importing them in this process would leak into every later test file, so a
// child Bun process imports them and reports only their design parameters.
const collectScript = `
const designs = {};
for await (const story of new Bun.Glob("{client,components,stories}/**/*.stories.{js,jsx,mjs,ts,tsx}").scan({ cwd: process.cwd() })) {
  const storyModule = await import(process.cwd() + "/" + story);
  const stories = [];
  for (const [name, value] of Object.entries(storyModule)) {
    if (name === "default" || typeof value !== "object" || value === null) continue;
    const design = value.parameters?.design;
    if (design !== undefined) stories.push(design);
  }
  designs[story] = { meta: storyModule.default?.parameters?.design ?? null, stories };
}
process.stdout.write(JSON.stringify(designs));
`;

function collectDesigns(): StoryDesigns {
  const result = Bun.spawnSync([process.execPath, "--preload", "./tests/server-only-preload.ts", "--eval", collectScript], {
    cwd: import.meta.dir,
    env: { ...process.env, NODE_ENV: "test" },
  });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return JSON.parse(result.stdout.toString()) as StoryDesigns;
}

const designs = collectDesigns();
const entries = [...mapping.components, ...mapping.frames];
const storyUrls = new Map<string, string>();

for (const entry of entries) {
  for (const story of entry.stories) {
    const url = `${mapping.fileUrl}?node-id=${entry.nodeId.replaceAll(":", "-")}`;
    storyUrls.set(story, url);

    test(`${story} links to ${entry.figmaName}`, () => {
      expect(designs[story]?.meta).toEqual({ type: "figma", url });
    });
  }
}

test("only mapped stories link to Figma designs", () => {
  expect(Object.keys(designs).length).toBeGreaterThan(0);
  for (const [story, { meta, stories }] of Object.entries(designs)) {
    const url = storyUrls.get(story);
    if (!url) expect(meta).toBeNull();
    for (const design of stories) expect(design).toEqual({ type: "figma", url });
  }
});

test("Storybook registers the Designs addon", () => {
  expect(config.addons).toContain("@storybook/addon-designs");
});

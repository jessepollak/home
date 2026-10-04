import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { compositionA11yFindings, coverageFindings, libraryWalkers, repositoryLibraryCatalogFindings } from "../library-catalog.mjs";

const preview = 'export default { parameters: { a11y: { test: "todo" } } };';
const file = (content) => ({ path: "fixture.stories.tsx", content });
const strict = 'export default { title: "Compositions/Fixture", parameters: { a11y: { test: "error" } } };';
const components = new Map([["button", "ui-button"], ["input", "ui-input"]]);

test("coverage and the reviewed product-unused list are exact in both directions", () => {
  assert.deepEqual(coverageFindings(components, { demo: ["button"] }, ["button"], ["input"]), []);
  assert.match(coverageFindings(components, { demo: ["button"] }, ["button", "input"], []).join("\n"), /not reached by any composition: input/);
  assert.match(coverageFindings(components, { demo: ["button", "input"] }, ["button"], []).join("\n"), /missing from reviewed list: input/);
  assert.match(coverageFindings(components, { demo: ["button", "input"] }, ["button", "input"], ["input"]).join("\n"), /Listed component is used in product: input/);
  assert.match(coverageFindings(components, {}, [], ["unknown"]).join("\n"), /Unknown product-unused catalog component/);
  assert.match(coverageFindings(components, {}, [], ["input", "input"]).join("\n"), /Duplicate/);
});

test("effective a11y parameters inherit preview and meta, but a story override wins", () => {
  assert.deepEqual(compositionA11yFindings([file(`${strict} export const Demo = {};`)], preview, []), []);
  assert.match(compositionA11yFindings([file(`${strict} export const Demo = { parameters: { a11y: { test: "todo" } } };`)], preview, []).join("\n"), /resolves to a11y.test "todo", expected error/);
  assert.match(compositionA11yFindings([file('export default {title:"Compositions/Fixture"}; export const Demo = {};')], preview, []).join("\n"), /resolves to a11y.test "todo"/);
  assert.deepEqual(compositionA11yFindings([file(`${strict} export const Demo = { parameters: { a11y: { config: {} } } };`)], preview, []), []);
  assert.deepEqual(compositionA11yFindings([file('const parameters = { a11y: { test: "error" } }; export default {title: "Compositions/Fixture", parameters}; const base = {}; export const Demo = {...base};')], preview, []), []);
});

test("a11y exemptions require an issue, the exempt story must be todo, and stale entries fail", () => {
  const exemption = [{ storyId: "compositions-fixture--demo", issue: 123 }];
  const stories = [file(`${strict} export const Demo = {parameters:{a11y:{test:"todo"}}};`)];
  assert.deepEqual(compositionA11yFindings(stories, preview, exemption), []);
  assert.match(compositionA11yFindings(stories, preview, [{ ...exemption[0], issue: 0 }]).join("\n"), /Invalid/);
  assert.match(compositionA11yFindings(stories, preview, [...exemption, ...exemption]).join("\n"), /duplicate/);
  assert.match(compositionA11yFindings(stories, preview, [{ storyId: "absent", issue: 123 }]).join("\n"), /Stale/);
  assert.match(compositionA11yFindings([file(`${strict} export const Demo = {};`)], preview, exemption).join("\n"), /expected todo/);
});

test("unmodeled a11y spreads, computed keys, and runtime mutations fail closed", () => {
  for (const source of [
    `${strict} export const Demo = {...imported};`,
    `${strict} export const Demo = { parameters: { [key]: {} } };`,
    `${strict} export const Demo = {}; Demo.parameters = {a11y:{test:'todo'}};`,
    `${strict} export const Demo = {}; Demo.parameters.a11y.test = 'todo';`,
    `const a11y = {test:'error'}; a11y.test = 'todo'; export default {title:'Compositions/Fixture', parameters:{a11y}}; export const Demo = {};`,
  ]) assert.match(compositionA11yFindings([file(source)], preview, []).join("\n"), /Unmodeled/);
});

test("the plugin walker ignores type-only imports and follows transitive value imports and cycles", async () => {
  const { walkCompositionUiImports } = await libraryWalkers();
  const graph = new Map([
    ["/fixture/story.tsx", 'import type { Missing } from "./missing"; import { type Input } from "@/components/ui/input"; import { View } from "./view";'],
    ["/fixture/view.tsx", 'export { Button } from "@/components/ui/button"; export * from "./story";'],
    ["/fixture/components/ui/button.tsx", "export const Button = 1;"],
  ]);
  assert.deepEqual(await walkCompositionUiImports("story.tsx", "/fixture", async (path) => graph.get(path)), ["button"]);
});

test("temporary-copy canaries reject missing coverage, both unused-list directions, and loose a11y", async () => {
  const temporary = mkdtempSync(join(tmpdir(), "library-catalog-gate-"));
  const root = join(temporary, "web");
  const policy = join(temporary, "policy");
  const write = (path, content) => { const parts = path.split("/"); parts.pop(); mkdirSync(join(root, ...parts), { recursive: true }); writeFileSync(join(root, path), content); };
  const repositoryPolicy = fileURLToPath(new URL("../", import.meta.url));
  mkdirSync(policy);
  cpSync(join(repositoryPolicy, "library-catalog-not-used.json"), join(policy, "library-catalog-not-used.json"));
  cpSync(join(repositoryPolicy, "library-composition-a11y-exemptions.json"), join(policy, "library-composition-a11y-exemptions.json"));
  // Match the checked-in unused-list policy without copying or editing the working tree.
  const unused = JSON.parse(readFileSync(join(policy, "library-catalog-not-used.json"), "utf8"));
  for (const name of ["button", ...unused]) {
    write(`components/ui/${name}.tsx`, `export const UI = 1;`);
    write(`components/ui/${name}.stories.tsx`, `export default {title:"UI/${name}"}; export const Default = {};`);
  }
  const route = 'import { UI } from "@/components/ui/button";';
  const composition = `${strict} export const Demo = {};`;
  write("app/page.tsx", route);
  write("stories/review/compositions/demo.stories.tsx", `${route} ${composition}`);
  write(".storybook/preview.tsx", preview);
  const check = () => repositoryLibraryCatalogFindings(root, policy);
  try {
    assert.deepEqual(await check(), []);
    write("stories/review/compositions/demo.stories.tsx", `import type { UI } from "@/components/ui/button"; ${composition}`);
    assert.match((await check()).join("\n"), /not reached by any composition: button/);
    write("stories/review/compositions/demo.stories.tsx", `${route} ${composition}`);
    write("app/page.tsx", "export const page = 1;");
    assert.match((await check()).join("\n"), /missing from reviewed list: button/);
    write("app/page.tsx", `${route} import { UI as Dialog } from "@/components/ui/dialog";`);
    assert.match((await check()).join("\n"), /Listed component is used in product: dialog/);
    write("app/page.tsx", route);
    write("stories/review/compositions/demo.stories.tsx", `${route} ${strict} export const Demo = {parameters:{a11y:{test:"todo"}}};`);
    assert.match((await check()).join("\n"), /resolves to a11y.test "todo", expected error/);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});

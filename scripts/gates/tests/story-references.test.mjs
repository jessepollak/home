import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  repositoryStoryIds, repositoryStoryReferenceFindings, storyGlobs, storyGlobFindings, storyIdsFromFiles,
  storyReferenceFindings,
} from "../story-references.mjs";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const requireWeb = createRequire(new URL("../../../apps/web/package.json", import.meta.url));
const { loadCsf } = requireWeb("storybook/internal/csf-tools");
const { normalizeStory } = requireWeb("storybook/internal/preview-api");
const file = (path, content) => ({ path, content });
const storyFiles = [
  file("apps/web/stories/review/review-boards.stories.tsx", `const meta = { id: "review-boards", title: "Review/Boards" }; export default meta;
export const Demo = {}; export const Changes = {};`),
  file("apps/web/stories/demo.stories.tsx", `const meta = { id: "demo-kind", title: "Different/Title", parameters: { id: "wrong-kind" } }; export default meta;
export const Step2Review = {}; export function USDCBalance() {};
const Original = {}; export { Original as RenamedStory };`),
];
const board = (story = "demo-kind--step-2-review") => file("apps/web/stories/review/boards/demo.json", JSON.stringify({
  id: "demo", sections: [{ id: "section", frames: [{ id: "first", story }] }],
}, null, 2));
const doc = (content) => file("docs/design-system/stories/demo.md", content);
const findings = ({ boards = [board()], docs = [], stories = storyFiles } = {}) =>
  storyReferenceFindings({ storyFiles: stories, boards, docs });

test("resolves explicit meta id, exported aliases, digit boundaries, and nested meta safely", () => {
  const { ids, findings: metaFindings } = storyIdsFromFiles(storyFiles);
  assert.deepEqual(metaFindings, []);
  for (const id of ["demo-kind--step-2-review", "demo-kind--usdc-balance", "demo-kind--renamed-story"]) assert.ok(ids.has(id), id);
  assert.ok(!ids.has("wrong-kind--step-2-review"));
  assert.ok(!ids.has("different-title--step-2-review"));
});

test("finds missing board stories and repeated frame IDs", () => {
  assert.match(findings({ boards: [board("demo-kind--missing")] }).join("\n"), /demo\.json:\d+: unresolved story demo-kind--missing/);
  const unregistered = file("apps/web/stories/review/boards/unknown.json", JSON.stringify({ id: "unknown", sections: [] }));
  assert.match(findings({ boards: [unregistered] }).join("\n"), /unresolved board review-boards--unknown/);
  const missingBefore = file("apps/web/stories/review/boards/demo.json", JSON.stringify({ id: "demo", sections: [{ frames: [{ id: "first", story: "demo-kind--step-2-review", before: "demo-kind--absent" }] }] }));
  assert.match(findings({ boards: [missingBefore] }).join("\n"), /unresolved before demo-kind--absent/);
  const duplicate = file("apps/web/stories/review/boards/demo.json", JSON.stringify({ id: "demo", sections: [
    { frames: [{ id: "first", story: "demo-kind--step-2-review" }, { id: "first", story: "demo-kind--usdc-balance" }] },
  ] }, null, 2));
  assert.match(findings({ boards: [duplicate] }).join("\n"), /duplicate frame first/);
});

test("reports duplicate board IDs on the later manifest and preserves the first frame set", () => {
  const later = file("apps/web/stories/review/boards/later.json", JSON.stringify({
    id: "demo", sections: [{ frames: [{ id: "later", story: "demo-kind--step-2-review" }] }],
  }, null, 2));
  assert.deepEqual(findings({ boards: [board(), later], docs: [doc("/iframe.html?id=review-boards--demo&frame=first")] }), [
    "apps/web/stories/review/boards/later.json:2: duplicate board demo",
  ]);
  assert.match(findings({ boards: [board(), later], docs: [doc("/iframe.html?id=review-boards--demo&frame=later")] }).join("\n"), /unresolved frame later on review-boards--demo/);
});

test("checks literal links and curated or changes-board frames", () => {
  assert.match(findings({ docs: [doc("/iframe.html?id=demo-kind--absent")] }).join("\n"), /unresolved link id demo-kind--absent/);
  assert.match(findings({ docs: [doc("/iframe.html?id=review-boards--demo&frame=absent")] }).join("\n"), /unresolved frame absent on review-boards--demo/);
  assert.match(findings({ docs: [doc("/iframe.html?id=review-boards--changes&frame=absent")] }).join("\n"), /unresolved frame absent on review-boards--changes/);
  const brokenStory = file("apps/web/stories/broken.stories.ts", `export default { id: "broken" }; export const Example = { note: "/iframe.html?id=demo-kind--absent" };`);
  assert.match(findings({ stories: [...storyFiles, brokenStory] }).join("\n"), /broken\.stories\.ts:\d+: unresolved link id demo-kind--absent/);
});

test("resolves complete Unicode story IDs in links", () => {
  const stories = [...storyFiles, file("apps/web/stories/unicode.stories.ts", `export default { id: "demo-kind" }; export const Café = {};`)];
  assert.deepEqual(findings({ stories, docs: [doc("/iframe.html?id=demo-kind--café")] }), []);
  assert.deepEqual(findings({ stories, docs: [doc("/iframe.html?id=demo-kind--caf%C3%A9")] }), []);
  assert.deepEqual(findings({ stories, docs: [doc("/iframe.html?id=demo-kind--café, see below")] }), []);
  assert.deepEqual(findings({ stories, docs: [doc("/iframe.html?id=review-boards--changes&frame=demo-kind--caf%C3%A9")] }), []);
});

test("reports full Unicode IDs for broken links, including non-ASCII starts", () => {
  assert.deepEqual(findings({ docs: [doc("/iframe.html?id=demo-kind--élise-missing /iframe.html?id=demo-kind--éclair")] }), [
    "docs/design-system/stories/demo.md:1: unresolved link id demo-kind--élise-missing",
    "docs/design-system/stories/demo.md:1: unresolved link id demo-kind--éclair",
  ]);
});

test("reports malformed percent escapes in story link IDs and frames", () => {
  assert.deepEqual(findings({ docs: [doc("/iframe.html?id=demo-kind--caf%ZZ /iframe.html?id=review-boards--changes&frame=demo-kind--caf%ZZ")] }), [
    "docs/design-system/stories/demo.md:1: unmodeled link id demo-kind--caf%ZZ",
    "docs/design-system/stories/demo.md:1: unmodeled frame demo-kind--caf%ZZ on review-boards--changes",
  ]);
});

test("decodes link IDs before deciding the story ID shape", () => {
  assert.deepEqual(findings({ docs: [doc("/iframe.html?id=demo-kind%2D%2Dabsent")] }), [
    "docs/design-system/stories/demo.md:1: unresolved link id demo-kind--absent",
  ]);
  assert.deepEqual(findings({ docs: [doc("/iframe.html?id=50%")] }), []);
});

test("ignores a fragment and prose punctuation after a board frame", () => {
  assert.deepEqual(findings({ docs: [doc("/iframe.html?id=review-boards--demo&frame=first#selection")] }), []);
  assert.deepEqual(findings({ docs: [doc("/iframe.html?id=review-boards--demo&frame=first.")] }), []);
  assert.deepEqual(findings({ docs: [doc("/iframe.html?id=review-boards--demo&frame=absent#selection")] }), [
    "docs/design-system/stories/demo.md:1: unresolved frame absent on review-boards--demo",
  ]);
});

test("decodes complete Unicode frame IDs in curated board links", () => {
  const curated = file("apps/web/stories/review/boards/demo.json", JSON.stringify({ id: "demo", sections: [{ frames: [{ id: "étape", story: "demo-kind--step-2-review" }] }] }));
  assert.deepEqual(findings({ boards: [curated], docs: [doc("/iframe.html?id=review-boards--demo&amp;frame=%C3%A9tape")] }), []);
});

test("checks absent inventory IDs and wildcard kinds", () => {
  assert.match(findings({ docs: [doc("`demo-kind--absent` and `absent-kind--*`")] }).join("\n"), /unresolved inventory id demo-kind--absent/);
  assert.match(findings({ docs: [doc("`demo-kind--absent` and `absent-kind--*`")] }).join("\n"), /unresolved inventory id absent-kind--\*/);
});

test("checks complete Unicode inventory IDs and preserves case-sensitive matching", () => {
  const stories = [...storyFiles, file("apps/web/stories/unicode.stories.ts", `export default { id: "demo-kind" }; export const Café = {};`)];
  assert.deepEqual(findings({ stories, docs: [doc("`demo-kind--café` `--café`")] }), []);
  assert.deepEqual(findings({ stories, docs: [doc("`demo-kind--élise-missing` `demo-kind--Café`")] }), [
    "docs/design-system/stories/demo.md:1: unresolved inventory id demo-kind--élise-missing",
    "docs/design-system/stories/demo.md:1: unresolved inventory id demo-kind--Café",
  ]);
});

test("resolves shorthand inventory against the latest full kind, including wildcards", () => {
  assert.deepEqual(findings({ docs: [doc("`demo-kind--step-2-review` `--renamed-story` `review-boards--*` `--demo` `demo-kind--usdc-balance` `--step-2-review`")] }), []);
  assert.match(findings({ docs: [doc("`demo-kind--step-2-review` `--absent`")] }).join("\n"), /unresolved inventory id demo-kind--absent/);
  assert.match(findings({ docs: [doc("`--absent` `demo-kind--step-2-review`")] }).join("\n"), /orphan inventory shorthand --absent/);
});

test("accepts valid board frames, links, inventory, wildcard and aliased exports", () => {
  assert.deepEqual(findings({ docs: [doc("`demo-kind--renamed-story` `demo-kind--*` /iframe.html?id=review-boards--demo&frame=first /iframe.html?id=review-boards--changes&frame=demo-kind--usdc-balance") ] }), []);
});

test("only top-level literal meta fields count and comments/templates cannot leak braces", () => {
  const stories = [file("apps/web/stories/edge.stories.ts", `const meta = { parameters: { id: "nested" }, title: "Actual/Title", note: \`{ } // title: 'false'\` }; export default meta;
/* export const Fake = {}; */ export const Real = {};`)];
  assert.deepEqual([...storyIdsFromFiles(stories).ids], ["actual-title--real"]);
  const direct = [file("direct.stories.ts", `export default { title: 'Direct/Kind', parameters: { title: 'Nested/Kind' } }; export function Good() {}`)];
  assert.deepEqual([...storyIdsFromFiles(direct).ids], ["direct-kind--good"]);
  assert.match(storyIdsFromFiles([file("no.stories.ts", "export default { parameters: { id: 'nested' } }; export const Real = {};")]).findings[0], /no literal id or title/);
});

test("includeStories and excludeStories array literals filter exports", () => {
  const stories = [file("x.stories.ts", `export default { id: "filter", includeStories: ["A", "B"], excludeStories: ["B"] }; export const A = {}; export const B = {}; export const C = {};`)];
  assert.deepEqual([...storyIdsFromFiles(stories).ids], ["filter--a"]);
});

test("string story filters use unanchored regular expressions and invalid patterns fail closed", () => {
  for (const [id, pattern, exports] of [
    ["probe-filter", "Helper$", "export const Helper = {}, Primary = {};"],
    ["probe-str", "Helper", "export const Helper = {}, HelperTwo = {}, Primary = {};"],
  ]) {
    const stories = [file("filter.stories.ts", `export default { id: "${id}", excludeStories: "${pattern}" }; ${exports}`)];
    assert.deepEqual(storyIdsFromFiles(stories).findings, []);
    assert.deepEqual([...storyIdsFromFiles(stories).ids], [`${id}--primary`]);
  }
  const invalid = [file("filter.stories.ts", `export default { id: "probe-invalid", excludeStories: "[" }; export const Primary = {};`)];
  assert.deepEqual([...storyIdsFromFiles(invalid).ids], []);
  assert.match(storyIdsFromFiles(invalid).findings.join("\n"), /filter\.stories\.ts: Invalid regular expression/);
});

test("spread and computed meta fields fail closed without indexing phantom stories", () => {
  for (const [content, line] of [
    ['export default {title:"Probe",...{excludeStories:["A"]}}; export const A={}, B={};', 1],
    ['const excludeStories="parameters";\nexport default {title:"Probe",\n[excludeStories]:["A"]}; export const A={}, B={};', 2],
  ]) {
    const result = storyIdsFromFiles([file("meta.stories.ts", content)]);
    assert.deepEqual([...result.ids], [], content);
    assert.deepEqual(result.findings, [`meta.stories.ts:${line}: unmodeled story meta`], content);
  }
});

test("unsupported story filter values retain fail-closed findings with field locations", () => {
  for (const key of ["includeStories", "excludeStories"]) {
    for (const value of ["hidden", "getHidden()", "config.hidden", "`A`", '["A", hidden]', '[...hidden]', "[,]", "null", "42", "{}"]) {
      const content = `export default {\n  title:"Probe",\n  ${key}: ${value}\n}; export const A={}, B={};`;
      const result = storyIdsFromFiles([file("filter.stories.ts", content)]);
      assert.deepEqual([...result.ids], [], content);
      assert.deepEqual(result.findings, [`filter.stories.ts:3: unmodeled ${key} filter`], content);
    }
  }
});

const unmodeledId = "unmodeled story __id";
const nestedExport = "unmodeled nested export";
const parityCases = [
    ["csf2", 'export function A() {}; A.parameters = { __id: "special--a" };', unmodeledId],
    ["direct", 'export function A() {}; A.parameters = {}; A.parameters.__id = "special--a";', unmodeledId],
    ["alias", 'function X() {} X.parameters = { __id: "special--a" }; export { X as A };', unmodeledId],
    ["typed wrapped", 'export const A = ({ parameters: { __id: "special--a" } }) satisfies StoryObj;'],
    ["typed inner", 'export const A = ({ parameters: { __id: "special--a" } } as StoryObj);'],
    ["typed wrapped ASI", 'export const A = ({ parameters: { __id: "special--a" } }) as StoryObj\nexport const B = {};'],
    ["plain wrapped", 'export const A = ({ parameters: { __id: "special--a" } });'],
    ["params quoted key", 'export function A() {} A.parameters = { "__id": "special--a" };', unmodeledId],
    ["conditional arrow", 'export function A() {} const f = () => A.parameters = { __id: "special--a" };', unmodeledId],
    ["conditional function", 'export function A() {} function f() { A.parameters = { __id: "special--a" }; }', unmodeledId],
    ["nested invoked", 'export function A() {} (() => { A.parameters = { __id: "special--a" }; })();', unmodeledId],
    ["namespace invoked", 'export function A() {} namespace H { A.parameters = { __id: "special--a" }; }', unmodeledId],
    ["computed parameters", 'export function A() {} A["parameters"] = { __id: "special--a" };', unmodeledId],
    ["compound", 'export function A() {} A.parameters ||= { __id: "special--a" };', unmodeledId],
    ["empty assigned id", 'export function A() {} A.parameters = { __id: "" };', unmodeledId],
    ["empty inline id", 'export const A = { parameters: { __id: "" } };', unmodeledId],
    ["null replaced", 'export const A = {parameters: {__id: "special--a"}}; A.parameters = {};', unmodeledId],
    ["annotation after alias", 'const X = {}; export { X as A }; X.parameters = { __id: "special--a" };', unmodeledId],
    ["namespace export", 'namespace H { export const Ghost = {}; } export const A = {};', nestedExport],
    ["wrapped at comma", 'export const A = ({ parameters: { __id: "special--a" } }), B = ({parameters: {__id: "special--b"}});'],
    ["wrapped after comment", 'export const A = ({ parameters: { __id: "special--a" } }) /* hi */\nexport const B = {};'],
    ["excluded function annotation", 'export const A = {}; export function Helper() {} Helper.parameters = shared;', undefined, 'title: "Probe", excludeStories: ["Helper"]'],
    ["excluded inline id", 'export const A = {}; export const Helper = {parameters: {__id: dynamic}};', undefined, 'title: "Probe", includeStories: ["A"]'],
    ["reserved annotation", 'export const A = {}; export const __namedExportsOrder = ["A"]; __namedExportsOrder.parameters = shared;'],
    ["inline shorthand parameters annotation", 'export const A = {parameters:{__id:"special--a"}}; A.parameters = { layout: "centered" };', unmodeledId],
    ["newline wrapped followed annotation", 'export const A = ({parameters:{__id:"special--a"}})\nA.parameters = {layout:"centered"};', unmodeledId],
    ["params equality expression", 'export const A = {}; A.parameters == {__id:"fake--a"};'],
    ["compound direct", 'export const A = {}; A.parameters.__id ||= "special--a";', unmodeledId],
    ["spread assigned", 'export const A = {}; A.parameters = {...shared,__id:"special--a"};', unmodeledId],
    ["trailing comma assigned", 'export const A = {}; A.parameters = { __id: "special--a", layout: "centered", };', unmodeledId],
    ["typed semicolonless multiple", 'export const A: Record<string, unknown> = (({parameters:{__id:"special--a"}})), B = (({parameters:{__id:"special--b"}}))\nexport let C = {};'],
    ["ASI then const", 'export const A = (({parameters:{__id:"special--a"}}))\nconst C = {}; export {C as B};'],
    ["namespace mutation", 'export const A = ({ parameters: { __id: "special--a" } }); namespace H { A.parameters.__id = "second--a"; }', unmodeledId],
    ["parenthesized call", 'function create(x){return x}; export const A = (create({ parameters: { __id: "special--a" } }));'],
    ["nested parens", 'export const A = ((({ parameters: { __id: "special--a" } })));'],
    ["ASI wrappers", 'export const A = (({parameters:{__id:"special--a"}}))\nexport const B = (({parameters:{__id:"special--b"}}));'],
    ["asserted ASI annotation", 'export const A = ({ parameters: { __id: "special--a" } }) as StoryObj\nA.parameters = {layout: "centered"};', unmodeledId],
    ["generic asserted type", 'export const A = ({parameters: {__id: "special--a"}}) satisfies Record<string, unknown>;'],
    ["conditional asserted type", 'export const A = ({parameters: {__id: "special--a"}}) as X extends Y ? X : Y;'],
    ["function asserted type", 'export const A = ({parameters: {__id: "special--a"}}) as (args: X) => Y;'],
    ["asserted call", 'export const A = (({parameters: {__id: "special--wrong"}}) as X)();'],
    ["double assertion fallback", 'export const A = ({parameters: {__id: "special--wrong"}}) as const as StoryObj;', unmodeledId],
    ["plain satisfies", 'export const A = { parameters: { __id: "special--a" } } satisfies StoryObj;'],
    ["plain asserted", 'export const A = { parameters: { __id: "special--a" } } as StoryObj;'],
    ["satisfies then asserted", 'export const A = (({ parameters: { __id: "special--a" } }) satisfies StoryObj) as StoryObj;'],
    ["comma expression", 'export const A = ({parameters: {__id: "special--wrong"}}, {});'],
    ["nonliteral assignment", 'export const A = {}; A.parameters = shared;', unmodeledId],
    ["safe shorthand assignment", 'export const A = {}; A.parameters = { layout };'],
    ["wrapped safe assignment", 'export const A = {}; A.parameters = ({ layout: "centered" });'],
    ["module export", 'module H { export const Ghost = {}; } export const A = {};', nestedExport],
    ["export text is opaque", 'const text = "export const Ghost = {}"; const template = `export const Ghost = {}`; /* export const Ghost = {} */ export const A = {note: "export"};'],
    ["export property is not a declaration", 'export const A = {export: "value", render: () => obj.export()};'],
    ["original multiple declarators", 'export const A = {}, B = {parameters: {__id: "special--b"}};'],
    ["original aliased inline id", 'const X = {parameters: {__id: "special--wrong"}}; export { X as A };', unmodeledId],
    ["original Unicode", 'export const Café = {}, Élise = {};'],
    ["generic arrow comma", 'export const A = ({parameters:{__id:"special--a"}}) satisfies Foo<() => X, Y>;'],
    ["generic arrow followed nested", 'export const A = ({parameters:{__id:"special--a"}}) as Foo<() => Bar<X>>;'],
    ["generic arrow comma unwrapped", 'export const A = {parameters:{__id:"special--a"}} satisfies Foo<() => X, Y>;'],
    ["generic type after arrow", 'export const A = ({parameters:{__id:"special--a"}}) as () => Foo<X>;'],
    ["multiline conditional qualified", 'export const A = ({parameters:{__id:"special--a"}}) as T extends\nU.X ? T : U.X;'],
    ["type optional export", 'type X = {export?: string}; export const A = {};'],
    ["type generic export", 'type X = {export<T>(): T}; export const A = {};'],
    ["object generic export", 'const helper = {export<T>(x:T) {return x}}; export const A = {};'],
    ["class export field", 'class Helper {export = true} export const A = {};'],
    ["class export method", 'class Helper {export() {}} export const A = {};'],
    ["declare module empty", 'declare module "x" { export {}; } export const A = {};', nestedExport],
    ["declared type exports", 'declare module "x" {export type X = string} export const A = {};', nestedExport],
    ["nested default", 'namespace H { export default { title: "Ghost" }; } export const A = {};', nestedExport],
    ["ambient default", 'declare module "x" { export default { title: "Ghost" }; } export const A = {};', nestedExport],
    ["nested export all", 'declare module "x" { export * from "y"; } export const A = {};', nestedExport],
    ["same named reexport", 'export {A} from "./helper";'],
    ["aliased reexport", 'export {A as B} from "./helper";'],
    ["empty reexport", 'export {} from "./helper"; export const A = {};'],
    ["computed safe assign", 'export function A(){}; A["parameters"] = {layout:"centered"};', unmodeledId],
    ["typed safe assign", 'export function A(){}; A.parameters = {layout:"centered"} as Parameters;'],
    ["satisfies safe assign", 'export function A(){}; A.parameters = {layout:"centered"} satisfies Parameters;'],
    ["non-null safe assign", 'export function A(){}; A.parameters = (({layout:"centered"} as Parameters)!) satisfies Parameters;'],
    ["safe computed key assign", 'export function A(){}; A.parameters = { ["layout"]:"centered" };', unmodeledId],
    ["computed parameters subfield assign", 'export function A(){}; A.parameters["layout"] = "centered";'],
    ["multiple safe assignments", 'export function A(){}; A.parameters = {}, A.storyName = "Story";'],
    ["ASI unary", 'export const A = {parameters:{__id:"special--a"}}\n!A;\nexport const B = {};'],
    ["ASI if", 'export const A = {parameters:{__id:"special--a"}}\nif (true) {}\nexport const B = {};'],
    ["ASI do", 'export const A = {parameters:{__id:"special--a"}}\ndo {} while(false); export const B = {};'],
    ["ASI unrelated bare", 'export const A = {parameters:{__id:"special--a"}} as X\nfoo()\nexport const B = {};'],
    ["multiple destructuring", 'export const {C} = obj, A = {parameters:{__id:"special--a"}};'],
    ["asserted generic defaults", 'export const A = ({parameters:{__id:"special--a"}}) as <T = X>() => T;'],
    ["asserted JSX TS keyword", 'export const A = ({parameters:{__id:"special--a"}}) as { as: X };'],
    ["excluded relational helper", 'export const Helper=(value as number)<0; export const A = {};', undefined, 'title: "Probe", excludeStories: ["Helper"]'],
    ["grouped assignment", 'export const A = {}; (A.parameters={__id:"special--a"});', unmodeledId],
    ["parenthesized target", 'export const A = {}; (A.parameters).__id="special--a";', unmodeledId],
    ["computed direct id", 'export const A = {}; A["parameters"]["__id"]="special--a";', unmodeledId],
    ["compound parameters", 'export const A = {}; A.parameters += shared;', unmodeledId],
    ["logical parameters", 'export const A = {}; A.parameters ??= shared;', unmodeledId],
    ["conditional parameters", 'export const A = {}; false && (A.parameters={__id:"special--a"});', unmodeledId],
    ["conditional safe parameters", 'export const A = {}; if(false) A.parameters={layout:"centered"};'],
    ["shorthand assigned id", 'export const A = {}; A.parameters={__id};', unmodeledId],
    ["assigned method id", 'export const A = {}; A.parameters={__id(){}};', unmodeledId],
    ["assigned spread", 'export const A = {}; A.parameters={...shared};', unmodeledId],
    ["parameter shadow", 'export const A = {}; function f(A){A.parameters={__id:"not-a-story"}}'],
    ["block shadow", 'export const A = {}; {const A={}; A.parameters={__id:"not-a-story"}}'],
    ["alias shadow", 'const Local={}; export {Local as A}; function f(Local){Local.parameters=shared}'],
    ["alias before nested mutation", 'const Local={}; function f(){Local.parameters=shared} export {Local as A};', unmodeledId],
    ["alias indexed beside excluded local", 'export const Local={}; export {Local as A}; Local.parameters=shared;', unmodeledId, 'title: "Probe", excludeStories: ["Local"]'],
    ["excluded alias", 'const Local={}; export {Local as Helper}; Local.parameters=shared;', undefined, 'title: "Probe", excludeStories: ["Helper"]'],
    ["reserved esModule annotation", 'export const A={}; export const __esModule=true; __esModule.parameters=shared;'],
    ["Object.assign out of scope", 'export const A={}; Object.assign(A.parameters,{__id:"special--a"});'],
    ["type-only exports", 'type X=string; type Y=string; export type {X}; export {type Y, Real as A}; const Real={};'],
    ["explicit meta id", 'export const A={};', undefined, 'id: "explicit", title: "Probe"'],
    ["let var and class exports", 'export let A={}; export var B={}; export class Helper{}'],
    ["generator exports", 'export function* A(){} export async function* B(){}'],
    ["multiple typed declarators", 'export const A: Record<string, unknown>={}, B: Map<string, Record<string, unknown>>={parameters:{__id:"special--b"}};'],
    ["quoted meta keys", 'export const A={}, B={};', undefined, 'title: "Probe", "id": "other", "includeStories": ["A"], "excludeStories": ["A"]'],
    ["inline nonliteral id", 'export const A={parameters:{__id:dynamic}};', unmodeledId],
    ["quoted inline id", 'export const A={parameters:{"__id":"special--a"}};', unmodeledId],
    ["shorthand inline id", 'const __id="special--a"; export const A={parameters:{__id}};', unmodeledId],
    ["concatenated inline id", 'export const A={parameters:{__id:"special"+"--a"}};', unmodeledId],
    ["template inline id", "export const A={parameters:{__id:`special--a`}};", unmodeledId],
    ["conditional inline id", 'const flag=true; export const A={parameters:{__id:flag?"special--a":"other--a"}};', unmodeledId],
    ["call inline id", 'const read=()=>"special--a"; export const A={parameters:{__id:read()}};', unmodeledId],
    ["asserted inline id", 'export const A={parameters:{__id:"special--a" as const}};', unmodeledId],
    ["duplicate inline id", 'export const A={parameters:{__id:"special--a",__id:"other--a"}};', unmodeledId],
    ["computed inline id key", 'export const A={parameters:{["__id"]:"special--a"}};', unmodeledId],
    ["dynamic inline id key", 'const key="__id"; export const A={parameters:{[key]:"special--a"}};', unmodeledId],
    ["identifier parameters id", 'const shared={__id:"special--a"}; export const A={parameters:shared};', unmodeledId],
    ["spread parameters id", 'const shared={__id:"special--a"}; export const A={parameters:{...shared}};', unmodeledId],
    ["annotation spread id", 'const base={parameters:{__id:"special--a"}}; export const A={...base};', unmodeledId],
    ["inline legacy story id", 'export const A={story:{parameters:{__id:"special--a"}}};', unmodeledId],
    ["identifier annotation id", 'const base={parameters:{__id:"special--a"}}; export const A=base;', unmodeledId],
    ["mixed inline ids in one file", 'const dynamic="special--a"; export const A={parameters:{__id:"special--a"}}, B={parameters:{__id:dynamic}};', unmodeledId],
    ["inline legacy story nonliteral id", 'const dynamic="special--a"; export const A={story:{parameters:{__id:dynamic}}};', unmodeledId],
    ["later spread replaces parameters", 'export const A={parameters:{__id:"special--a"},...{parameters:{}}};', unmodeledId],
    ["duplicate parameters properties", 'export const A={parameters:{__id:"special--a"},parameters:{}};', unmodeledId],
    ["shared object in two annotation positions", 'const base={parameters:{__id:"special--a"}}; export const A={parameters:base,...base};', unmodeledId],
    ["shadowed undefined value", 'const undefined="special--a"; export const A={parameters:{__id:undefined}};', unmodeledId],
    ["reassigned parameters spread", 'let shared={}; shared={parameters:{__id:"special--a"}}; export const A={...shared};', unmodeledId],
    ["member write on parameters object", 'const shared={}; shared.__id="special--a"; export const A={parameters:shared};', unmodeledId],
    ["safe spread before literal id", 'const base={}; export const A={...base,parameters:{__id:"special--a"}};'],
    ["safe trailing args after literal id", 'export const A={parameters:{__id:"special--a"},args:{}};'],
    ["safe constant parameters identifier", 'const base={layout:"centered"}; export const A={parameters:base};'],
    ["safe let parameters identifier", 'let base={layout:"centered"}; export const A={parameters:base};'],
    ["cyclic spread parameters", 'const a={...b}; const b={...a}; export const A={parameters:a};', unmodeledId],
    ["alias member write", 'const base={}; const alias=base; alias.__id="special--a"; export const A={parameters:base};', unmodeledId],
    ["parameters call spread", 'const read=()=>({__id:"special--a"}); export const A={parameters:{...read()}};', unmodeledId],
    ["prototype annotation", 'export const A={__proto__:{parameters:{__id:"special--a"}}};', unmodeledId],
    ["prototype parameters", 'export const A={parameters:{__proto__:{__id:"special--a"}}};', unmodeledId],
    ["duplicate export name", 'export const A={parameters:{__id:"special--a"}}; export {A};', unmodeledId],
    ["conditional annotation id", 'const flag=true; export const A = flag ? {parameters:{__id:"special--a"}} : {};', unmodeledId],
    ["logical annotation id", 'const base={}; export const A = base && {parameters:{__id:"special--a"}};', unmodeledId],
    ["sequence annotation id", 'export const A = (0, {parameters:{__id:"special--a"}});', unmodeledId],
    ["safe conditional annotation without id", 'const flag=true; export const A = flag ? {args:{}} : {args:{x:1}};'],
    ["assignment annotation id", 'let base; export const A = (base = {parameters:{__id:"special--a"}});', unmodeledId],
    ["member selection annotation id", 'export const A = ({value:{parameters:{__id:"special--a"}}}).value;', unmodeledId],
    ["array selection annotation id", 'export const A = [{parameters:{__id:"special--a"}}][0];', unmodeledId],
    ["safe identifier annotation", 'const base={args:{}}; export const A = base;'],
    ["unresolved branch annotation id", 'const flag=true; export const A = flag ? ({value:{parameters:{__id:"special--a"}}}).value : {};', unmodeledId],
    ["mutated identifier annotation id", 'const base={}; base.parameters={__id:"special--a"}; export const A = (0, base);', unmodeledId],
    ["class parameters annotation id", 'export const A={parameters:class {static __id="special--a"},render:()=>null};', unmodeledId],
    ["class annotation id", 'export const A=class {static parameters={__id:"special--a"}};', unmodeledId],
    ["destructured parameters binding", 'const {p}={p:{__id:"special--a"}}; export const A={parameters:p};', unmodeledId],
    ["sequence alias mutation", 'const p={}; const alias=(0,p); alias.__id="special--a"; export const A={parameters:p};', unmodeledId],
    ["safe repeated branch annotation", 'const base={args:{}}; export const A=true?base:base;'],
    ["safe unrelated member write", 'const helper={args:{}}; helper.args.label="x"; export const A={...helper};'],
    ["inline parameters call", 'const read=()=>({}); export const A={parameters:read()};', unmodeledId],
    ["safe identifier parameters", 'const railViewport={viewport:{}}; export const A={parameters:railViewport};'],
    ["safe null inline id", 'export const A={parameters:{__id:null}};'],
    ["safe undefined inline id", 'export const A={parameters:{__id:undefined}};'],
    ["safe neutral annotation spread", 'const base={args:{}}; export const A={...base};'],
    ["safe neutral parameters spread", 'const base={layout:"centered"}; export const A={parameters:{...base}};'],
    ["safe call annotation", 'const detail=(value)=>value; export const A=detail({args:{}});'],
    ["safe call annotation spread", 'const withItems=(items)=>({args:{items}}); export const A={...withItems([1])};'],
    ["safe string parameters key", 'export const A={"parameters":{layout:"centered"}};'],
    ["safe inline legacy story name", 'export const A={story:{name:"Renamed"}};'],
    ["safe meta parameters id", 'export const A={};', undefined, 'title: "Probe", parameters: {__id: dynamic}'],
    ["safe spread beside literal id", 'const rest={layout:"centered"}; export const A={parameters:{...rest,__id:"special--a"}};'],
    ["regex statement", 'if(true) {} /export const Ghost = {}/.test("x"); export const A={};'],
    ["regex arrow", 'const f=()=>/export const Ghost = {}/.test("x"); export const A={};'],
    ["division", 'export const A=a / b; export const B=(a + b) / 2;'],
    ["JSX content", 'const sample=<code title=">">export const Ghost = {}<span>{"export const Phantom = {}"}</span></code>; export const A={};'],
    ["JSX fragments", 'const sample=<><div><Story /></div></>; export const A={};'],
    ["TSX generic arrow", 'const identity=<T extends Record<string,unknown>>(x:T)=>x; export const A={};'],
    ["escaped identifier", String.raw`export const C\u0061f={};`],
    ["codepoint identifier", String.raw`export const C\u{61}f={};`],
    ["literal array include filter", 'export const A={}, B={};', undefined, 'title: "Probe", includeStories: ["A"]'],
    ["literal array exclude filter", 'export const A={}, B={};', undefined, 'title: "Probe", excludeStories: ["A"]'],
    ["literal regex include filter", 'export const A={}, B={};', undefined, 'title: "Probe", includeStories: /^A$/i'],
    ["literal regex exclude filter", 'export const A={}, B={};', undefined, 'title: "Probe", excludeStories: /^A$/i'],
    ["literal string include filter", 'export const A={}, B={};', undefined, 'title: "Probe", includeStories: "A"'],
    ["literal string exclude filter", 'export const A={}, B={};', undefined, 'title: "Probe", excludeStories: "A"'],
    ["legacy story annotation", 'export function A(){}; A.story={parameters:{__id:"special--a"}};', unmodeledId],
    ["legacy story parameters", 'export function A(){}; A.story.parameters={};', unmodeledId],
    ["computed legacy story", 'export const A={}; A["story"]={};', unmodeledId],
    ["legacy story compound", 'export const A={}; A.story ||= {};', unmodeledId],
    ["direct story id", 'export const A={}; A.__id="special--a";', unmodeledId],
    ["nested parameters member", 'export const A={}; A.args.parameters.layout="centered";', unmodeledId],
    ["nested story member", 'export const A={}; A.args.story={};', unmodeledId],
    ["nested id member", 'export const A={}; A.args["__id"]="special--a";', unmodeledId],
    ["dynamic root member", 'export const A={}; A[key]={};', unmodeledId],
    ["dynamic nested member", 'export const A={}; A.args[key]={};', unmodeledId],
    ["numeric computed member", 'export const A={}; A[0]={};', unmodeledId],
    ["array destructuring write", 'export function A(){}; [A.parameters]=[{__id:"special--a"}];', unmodeledId],
    ["object destructuring write", 'export function A(){}; ({id:A.parameters.__id}={id:"special--a"});', unmodeledId],
    ["array default write", 'export const A={}; [A.parameters={}]=[];', unmodeledId],
    ["object default write", 'export const A={}; ({id:A.parameters={}}=value);', unmodeledId],
    ["array rest write", 'export const A={}; [...A.parameters]=values;', unmodeledId],
    ["object rest write", 'export const A={}; ({...A.parameters}=value);', unmodeledId],
    ["nested destructuring write", 'export const A={}; ({items:[{id:A.parameters.__id}]}=value);', unmodeledId],
    ["postfix id update", 'export const A={}; A.parameters.__id++;', unmodeledId],
    ["prefix id update", 'export const A={}; --A.parameters.__id;', unmodeledId],
    ["legacy story update", 'export const A={}; A.story++;', unmodeledId],
    ["dynamic member update", 'export const A={}; A[key]++;', unmodeledId],
    ["for of parameters", 'export const A={}; for(A.parameters of values){}', unmodeledId],
    ["for in parameters", 'export const A={}; for(A.parameters in values){}', unmodeledId],
    ["for of destructuring", 'export const A={}; for([A.parameters] of values){}', unmodeledId],
    ["for of object destructuring", 'export const A={}; for({id:A.parameters.__id} of values){}', unmodeledId],
    ["wrapped target root", 'export const A={}; (A as Story).story={};', unmodeledId],
    ["wrapped target member", 'export const A={}; (A.parameters as Parameters).__id="special--a";', unmodeledId],
    ["wrapped assignment target", 'export const A={}; (A.parameters as Parameters)={};'],
    ["safe args assignment", 'export const A={}; A.args={};'],
    ["safe play assignment", 'export const A={}; A.play=()=>{};'],
    ["safe storyName assignment", 'export function A(){}; A.storyName="Renamed";'],
    ["safe parameters assignment", 'export const A={}; A.parameters={layout:"centered"};'],
    ["safe parameters field assignment", 'export const A={parameters:{layout:"centered"}}; A.parameters.layout="fullscreen";'],
    ["safe inline id parameters field assignment", 'export const A={parameters:{__id:"special--a"}}; A.parameters.layout="fullscreen";'],
    ["safe inline id parameters field delete", 'export const A={parameters:{__id:"special--a"}}; delete A.parameters.layout;'],
    ["safe parameters field delete", 'export const A={}; delete A.parameters.layout;'],
    ["safe optional parameters field delete", 'export const A={parameters:{__id:"special--a"}}; delete A?.parameters?.layout;'],
    ["safe parameters deeper field assignment", 'export const A={}; A.parameters.docs.source=shared;'],
    ["safe parameters deeper dynamic field assignment", 'export const A={parameters:{__id:"special--a"}}; A.parameters.docs[key]={__id:"nested"};'],
    ["safe parameters nested reserved fields", 'export const A={}; A.parameters.docs.story.__id=shared;'],
    ["safe parameters field update", 'export const A={parameters:{__id:"special--a"}}; A.parameters.count++;'],
    ["safe parameters field compound assignment", 'export const A={}; A.parameters.count+=shared;'],
    ["safe parameters field logical assignment", 'export const A={parameters:{__id:"special--a"}}; A.parameters.docs??={...shared};'],
    ["safe alias parameters field assignment", 'export const A={parameters:{__id:"special--a"}}; const Alias=A; Alias["parameters"]["layout"]="fullscreen";'],
    ["safe parameters field destructuring", 'export const A={parameters:{__id:"special--a"}}; [A.parameters.layout]=values; ({source:A.parameters.docs.source}=value);'],
    ["safe parameters field default and rest targets", 'export const A={}; [A.parameters.layout=shared]=values; ({...A.parameters.docs}=value);'],
    ["safe parameters field loop target", 'export const A={parameters:{__id:"special--a"}}; for([A.parameters.layout] of values){}'],
    ["dynamic parameters field assignment", 'export const A={}; A.parameters[k]=shared;', unmodeledId],
    ["dynamic parameters field destructuring", 'export const A={}; ({layout:A.parameters[k]}=value);', unmodeledId],
    ["identity field deeper assignment", 'export const A={}; A.parameters.__id.value=shared;', unmodeledId],
    ["legacy parameters field assignment", 'export const A={}; A.story.parameters.layout="fullscreen";', unmodeledId],
    ["safe computed args assignment", 'export const A={}; A["args"]={};'],
    ["safe args destructuring", 'export const A={}; [A.args]=[{}]; ({args:A.args}=value);'],
    ["safe args loop", 'export const A={}; for(A.args of values){}'],
    ["safe args update", 'export const A={}; A.args.count++;'],
    ["destructuring key is a read", 'export const A={}; ({[A.parameters.__id]:local}=value);'],
    ["destructuring default is a read", 'export const A={}; [local=A.parameters.__id]=values;'],
    ["shadowed destructuring writes", 'export const A={}; function f(A){[A.parameters]=values; ({id:A.story}=value)}'],
    ["shadowed update and loop writes", 'export const A={}; function f(A){A.parameters.__id++; for(A.parameters of values){}}'],
    ["aliased destructuring write", 'const Local={}; export {Local as A}; [Local.story]=values;', unmodeledId],
    ["inline default id replacement", 'export const A={parameters:{__id:"probe--a"}}; A.parameters={layout:"centered"};', unmodeledId],
    ["quoted inline id replacement", 'export const A={"parameters":{"__id":"special--a"}}; A.parameters={};', unmodeledId],
    ["deleted inline id", 'export const A={parameters:{__id:"special--a"}}; delete A.parameters.__id;', unmodeledId],
    ["deleted parameters", 'export const A={parameters:{__id:"special--a"}}; delete A.parameters;', unmodeledId],
    ["optional deleted id", 'export const A={parameters:{__id:"special--a"}}; delete A?.parameters?.__id;', unmodeledId],
    ["optional deleted parameters", 'export const A={parameters:{__id:"special--a"}}; delete A?.parameters;', unmodeledId],
    ["optional nested delete", 'export const A={}; delete (A?.parameters).__id;', unmodeledId],
    ["wrapped optional delete", 'export const A={}; delete ((A as Story)?.parameters as Parameters)?.__id;', unmodeledId],
    ["computed optional delete", 'export const A={}; delete A?.["parameters"]?.["__id"];', unmodeledId],
    ["story binding alias", 'export function A(){}; const Alias=A; Alias.parameters={__id:"special--a"};', unmodeledId],
    ["story binding alias chain", 'export const A={}; const First=A; const Second=First; Second.parameters={__id:"special--a"};', unmodeledId],
    ["reverse ordered alias chain", 'const Second=First; const First=A; export function A(){}; Second.parameters={__id:"special--a"};', unmodeledId],
    ["wrapped binding aliases", 'export const A={}; const First=(A as Story); const Second=(First satisfies Story); Second.parameters={__id:"special--a"};', unmodeledId],
    ["assignment binding alias", 'export const A={}; let Alias; Alias=(A as Story); Alias.parameters={__id:"special--a"};', unmodeledId],
    ["assignment alias chain", 'export const A={}; let First, Second; Second=(First satisfies Story); First=(A as Story); Second.parameters={__id:"special--a"};', unmodeledId],
    ["export initializer binding", 'const Internal={}; export const A=Internal; Internal.parameters={__id:"special--a"};', unmodeledId],
    ["wrapped export initializer binding", 'const Internal={}; export const A=((Internal as Story) satisfies Story); Internal.parameters={__id:"special--a"};', unmodeledId],
    ["export initializer alias chain", 'const Internal={}; export const A=Internal; const Alias=Internal; Alias.parameters={__id:"special--a"};', unmodeledId],
    ["inline id alias replacement", 'export const A={parameters:{__id:"special--a"}}; const Alias=A; Alias.parameters={layout:"centered"};', unmodeledId],
    ["inline source id replacement", 'const Internal={parameters:{__id:"special--a"}}; export const A=Internal; A.parameters={layout:"centered"};', unmodeledId],
    ["story reassignment", 'export let A={}; A={parameters:{__id:"special--a"}};', unmodeledId],
    ["story binding update", 'export let A={}; A++;', unmodeledId],
    ["story for in rebinding", 'export let A={}; for(A in values){}', unmodeledId],
    ["story for of rebinding", 'export let A={}; for(A of values){}', unmodeledId],
    ["story destructuring rebinding", 'export let A={}; [A]=values;', unmodeledId],
    ["story alias reassignment", 'export const A={}; let Alias=A; Alias={};', unmodeledId],
    ["safe alias parameters", 'export const A={}; const Alias=A; Alias.parameters={layout:"centered"};'],
    ["safe inline id args", 'export const A={parameters:{__id:"special--a"}}; A.args={};'],
    ["safe alias args", 'export const A={}; const Alias=A; Alias.args={};'],
    ["safe optional args delete", 'export const A={}; delete A?.args;'],
    ["shadowed alias binding", 'export const A={}; function f(A){const Alias=A; Alias.parameters={__id:"special--a"};}'],
    ["shadowed alias target", 'export const A={}; const Alias=A; function f(){const Alias={}; Alias.parameters={__id:"special--a"};}'],
    ["mutating call out of scope", 'export const A={}; mutate(A);'],
];
for (const [name, story, expectedFinding, meta = 'title: "Probe"'] of parityCases) {
  test(`CSF parity: ${name}`, () => {
    const storyFile = file("probe.stories.tsx", `export default { ${meta} }; ${story}`);
    const indexedIds = loadCsf(storyFile.content, { fileName: storyFile.path, makeTitle: (title) => title }).parse().indexInputs.map((story) => story.__id);
    const actual = storyIdsFromFiles([storyFile]);
    if (expectedFinding) {
      assert.deepEqual([...actual.ids], [], name);
      assert.ok(actual.findings.some((finding) => finding.endsWith(`: ${expectedFinding}`)), name);
    } else {
      assert.deepEqual(actual.findings, [], name);
      assert.deepEqual([...actual.ids].sort(), [...new Set(indexedIds)].sort(), name);
    }
  });
}

test("upstream two-hop and three-hop aliases cannot validate stale story links", () => {
  for (const declarations of [
    'const base={}; const mid=base; export const A=mid;',
    'const base={}; const first=base; const second=first; export const A=second;',
  ]) {
    const story = `${declarations} base.parameters={__id:"special--a"};`;
    const storyFile = file("probe.stories.js", `export default {title:"Probe"}; ${story}`);
    const indexedIds = loadCsf(storyFile.content, { fileName: storyFile.path, makeTitle: (title) => title }).parse().indexInputs.map((input) => input.__id);
    const A = new Function(`${story.replaceAll("export ", "")}; return A;`)();
    assert.deepEqual(indexedIds, ["probe--a"], declarations);
    assert.equal(normalizeStory("A", A, { id: "probe", title: "Probe" }).id, "special--a", declarations);
    assert.deepEqual([...storyIdsFromFiles([storyFile]).ids], [], declarations);
    assert.deepEqual(storyIdsFromFiles([storyFile]).findings, ["probe.stories.js:1: unmodeled story __id"], declarations);
    assert.deepEqual(findings({ stories: [storyFile], boards: [], docs: [doc("/iframe.html?id=probe--a")] }), [
      "probe.stories.js:1: unmodeled story __id",
      "docs/design-system/stories/demo.md:1: unresolved link id probe--a",
    ], declarations);
  }
});

test("helper rebinding before and between exports fails closed even with unchanged identity", () => {
  for (const [story, expectedIds] of [
    ['let base={}; base={args:{label:"Button"}}; export const A=base;', ["probe--a"]],
    ['let base={args:{label:"A"}}; export const A=base; base={args:{label:"B"}}; export const B=base;', ["probe--a", "probe--b"]],
  ]) {
    const storyFile = file("probe.stories.js", `export default {title:"Probe"}; ${story}`);
    const indexedIds = loadCsf(storyFile.content, { fileName: storyFile.path, makeTitle: (title) => title }).parse().indexInputs.map((input) => input.__id);
    const stories = new Function(`${story.replaceAll("export ", "")}; return {A, B:typeof B!=="undefined"?B:undefined};`)();
    const runtimeIds = Object.entries(stories).filter(([, story]) => story).map(([name, story]) =>
      normalizeStory(name, story, { id: "probe", title: "Probe" }).id);
    assert.deepEqual(indexedIds, expectedIds, story);
    assert.deepEqual(runtimeIds, expectedIds, story);
    const actual = storyIdsFromFiles([storyFile]);
    assert.deepEqual(actual.findings, ["probe.stories.js:1: unmodeled story __id"], story);
    assert.deepEqual([...actual.ids], [], story);
  }
});

test("helper identity rebinding before and between exports cannot validate stale story links", () => {
  for (const story of [
    'let base={}; base={parameters:{__id:"special--a"}}; export const A=base;',
    'let base={}; export const B=base; base={parameters:{__id:"special--a"}}; export const A=base;',
  ]) {
    const storyFile = file("probe.stories.js", `export default {title:"Probe"}; ${story}`);
    const indexedIds = loadCsf(storyFile.content, { fileName: storyFile.path, makeTitle: (title) => title }).parse().indexInputs.map((input) => input.__id);
    const A = new Function(`${story.replaceAll("export ", "")}; return A;`)();
    assert.ok(indexedIds.includes("probe--a"), story);
    assert.equal(normalizeStory("A", A, { id: "probe", title: "Probe" }).id, "special--a", story);
    const actual = storyIdsFromFiles([storyFile]);
    assert.deepEqual(actual.findings, ["probe.stories.js:1: unmodeled story __id"], story);
    assert.deepEqual([...actual.ids], [], story);
    assert.deepEqual(findings({ stories: [storyFile], boards: [], docs: [doc("/iframe.html?id=probe--a")] }), [
      "probe.stories.js:1: unmodeled story __id",
      "docs/design-system/stories/demo.md:1: unresolved link id probe--a",
    ], story);
  }
});

test("inline story IDs disable safe parameter replacement throughout alias components", () => {
  for (const [story, expectedWrites] of [
    ['const base={parameters:{__id:"special--a"}}; const mid=base; export const A=mid; A.parameters={};', 1],
    ['const base={}; const mid=base; export const A=mid; const inline={parameters:{__id:"special--a"}}; let alias=inline; alias=mid; base.parameters={};', 2],
    ['const base={}; const inline=({parameters:{__id:"special--a"}} as Story)!; let alias=(inline satisfies Story); alias=((base as Story)!); export const A=base; A.parameters={};', 2],
  ]) {
    const actual = storyIdsFromFiles([file("probe.stories.ts", `export default {title:"Probe"}; ${story}`)]);
    assert.deepEqual([...actual.ids], [], story);
    assert.deepEqual(actual.findings, Array(expectedWrites).fill("probe.stories.ts:1: unmodeled story __id"), story);
  }
});

test("storyName changes the runtime label without changing indexed or runtime identity", () => {
  const storyFile = file("probe.stories.ts", 'export default {title:"Probe"}; export function A(){}; A.storyName="Renamed";');
  const indexedIds = loadCsf(storyFile.content, { fileName: storyFile.path, makeTitle: (title) => title }).parse().indexInputs.map((story) => story.__id);
  function A() {}
  A.storyName = "Renamed";
  const runtime = normalizeStory("A", A, { id: "probe", title: "Probe" });
  assert.deepEqual(indexedIds, ["probe--a"]);
  assert.equal(runtime.id, indexedIds[0]);
  assert.equal(runtime.name, "Renamed");
  assert.deepEqual(storyIdsFromFiles([storyFile]).findings, []);
});

test("legacy and destructuring annotations cannot validate stale indexed links", () => {
  for (const annotation of [
    'A.story={parameters:{__id:"special--a"}};',
    '[A.parameters]=[{__id:"special--a"}];',
    'A.parameters={}; ({id:A.parameters.__id}={id:"special--a"});',
  ]) {
    const errors = findings({
      stories: [file("probe.stories.ts", `export default {title:"Probe"}; export function A(){}; ${annotation}`)],
      boards: [], docs: [doc("/iframe.html?id=probe--a")],
    });
    assert.ok(errors.some((finding) => finding.endsWith(`: ${unmodeledId}`)), annotation);
    assert.ok(errors.some((finding) => finding.endsWith("unresolved link id probe--a")), annotation);
  }
});

test("binding writes cannot validate stale indexed links despite runtime identity changes", () => {
  for (const [story, indexedId, runtimeId] of [
    ['export const A={parameters:{__id:"special--a"}}; A.parameters={layout:"centered"};', "special--a", "probe--a"],
    ['export const A={parameters:{__id:"special--a"}}; delete A.parameters.__id;', "special--a", "probe--a"],
    ['export const A={parameters:{__id:"special--a"}}; delete A.parameters;', "special--a", "probe--a"],
    ['export const A={parameters:{__id:"special--a"}}; delete A?.parameters?.__id;', "special--a", "probe--a"],
    ['export function A(){}; const Alias=A; Alias.parameters={__id:"special--a"};', "probe--a", "special--a"],
    ['export const A={}; const First=A; const Second=First; Second.parameters={__id:"special--a"};', "probe--a", "special--a"],
    ['const Internal={}; export const A=Internal; Internal.parameters={__id:"special--a"};', "probe--a", "special--a"],
    ['export let A={}; A={parameters:{__id:"special--a"}};', "probe--a", "special--a"],
  ]) {
    const storyFile = file("probe.stories.js", `export default {title:"Probe"}; ${story}`);
    const index = loadCsf(storyFile.content, { fileName: storyFile.path, makeTitle: (title) => title }).parse().indexInputs;
    const A = new Function(`${story.replaceAll("export ", "")}; return A;`)();
    assert.deepEqual(index.map((input) => input.__id), [indexedId], story);
    assert.equal(normalizeStory("A", A, { id: "probe", title: "Probe" }).id, runtimeId, story);
    const actual = storyIdsFromFiles([storyFile]);
    assert.deepEqual([...actual.ids], [], story);
    assert.ok(actual.findings.some((finding) => finding.endsWith(`: ${unmodeledId}`)), story);
    const errors = findings({ stories: [storyFile], boards: [], docs: [doc(`/iframe.html?id=${indexedId}`)] });
    assert.ok(errors.some((finding) => finding.endsWith(`: ${unmodeledId}`)), story);
    assert.ok(errors.some((finding) => finding.endsWith(`unresolved link id ${indexedId}`)), story);
  }
});

test("phantom CSF2 and asserted-object references cannot pass the gate", () => {
  for (const [story, id] of [
    ['export function A() {} A.parameters = {__id: "special--a"};', "special--a"],
    ['export const A = ({parameters: {__id: "special--a"}}) satisfies StoryObj;', "probe--a"],
  ]) {
    const errors = findings({
      stories: [file("probe.stories.ts", `export default {title: "Probe"}; ${story}`)],
      boards: [], docs: [doc(`/iframe.html?id=${id}`)],
    });
    assert.ok(errors.some((finding) => finding.endsWith(`unresolved link id ${id}`)));
  }
});

test("local, aliased, typed and shadowed meta match the Storybook index", () => {
  for (const content of [
    'const meta={id:"probe",title:"Probe"}; export default meta; export const A={};',
    'const meta={id:"probe",title:"Probe"}; export {meta as default}; export const A={};',
    'const meta:Meta={id:"probe",title:"Probe"}; export default meta; export const A={};',
    'const meta={id:"probe",title:"Probe"} satisfies Meta; export {meta as default}; export const A={};',
    'const meta={id:"probe"}; {const meta={id:"phantom"};} export default meta; export const A={};',
    'const meta={id:"probe"}; function f(){const meta={id:"phantom"}; return meta;} export default meta; export const A={};',
    'const meta={id:"probe"}; const sample=<div>{(()=>{const meta={id:"phantom"}; return meta;})()}</div>; export default meta; export const A={};',
  ]) {
    const storyFile = file("meta.stories.tsx", content);
    const indexedIds = loadCsf(content, { fileName: storyFile.path, makeTitle: (title) => title }).parse().indexInputs.map((story) => story.__id);
    const actual = storyIdsFromFiles([storyFile]);
    assert.deepEqual(actual.findings, [], content);
    assert.deepEqual([...actual.ids], indexedIds, content);
  }
});

test("literal meta policy rejects missing and nonliteral identity even when Storybook could resolve it", () => {
  for (const [content, message] of [
    ['export default {}; export const A={};', "story meta has no literal id or title"],
    ['export default {parameters:{id:"nested"}}; export const A={};', "story meta has no literal id or title"],
    ['export default {id:" ",title:""}; export const A={};', "story meta has no literal id or title"],
    ['export default {id:dynamic,title:"Probe"}; export const A={};', "story meta has nonliteral id"],
    ['export default {id:"probe",title:null}; export const A={};', "story meta has nonliteral title"],
    ['const title="Probe"; export default {title}; export const A={};', "story meta has nonliteral title"],
  ]) {
    const result = storyIdsFromFiles([file("literal.stories.ts", content)]);
    assert.deepEqual([...result.ids], [], content);
    assert.deepEqual(result.findings, [`literal.stories.ts:1: ${message}`], content);
  }
});

test("non-string inline story ids fail closed without breaking wildcard inventory checks", () => {
  for (const value of ["42", "true"]) {
    const stories = [
      file("bad.stories.ts", `export default {title:"Probe"}; export const A={parameters:{__id:${value}}};`),
      file("valid.stories.ts", 'export default {title:"Valid"}; export const Present={};'),
    ];
    assert.deepEqual([...storyIdsFromFiles(stories).ids], ["valid--present"], value);
    assert.deepEqual(storyReferenceFindings({ storyFiles: stories, boards: [], docs: [doc("`valid--*`")] }),
      ["bad.stories.ts:1: unmodeled story __id"], value);
  }
});


test("CSF4 identifier meta errors become findings and other files still index", () => {
  const result = storyIdsFromFiles([
    file("factory.stories.ts", 'import preview from "./preview"; const definition={title:"Probe"}; const meta=preview.meta(definition); export const A=meta.story({});'),
    file("valid.stories.ts", 'export default {title:"Valid"}; export const Present={};'),
  ]);
  assert.deepEqual([...result.ids], ["valid--present"]);
  assert.equal(result.findings.length, 1);
  assert.match(result.findings[0], /^factory\.stories\.ts(?::\d+)?: /);
});

test("Storybook errors become findings and do not prevent indexing other files", () => {
  for (const [content, message, line] of [
    ['export default {title:"Probe",excludeStories:hidden}; export const A={};', /unmodeled excludeStories filter/, 1],
    ['export default {title:"Probe",includeStories:allowed}; export const A={};', /unmodeled includeStories filter/, 1],
    ['export default {title:"Probe",excludeStories:["A",hidden]}; export const A={};', /unmodeled excludeStories filter/, 1],
    ['export default {title:"Probe"};\nexport const A = ({}) as X < Y\nexport const B={};', /Unexpected token/, 3],
    ['export default {title:"Probe"}; const identity=<T, (x:T)=>x;', /Unexpected token/, 1],
    [String.raw`export default {title:"Probe"}; export const C\u12GGf={};`, /Bad character escape/, 1],
  ]) {
    const result = storyIdsFromFiles([file("broken.stories.tsx", content), file("valid.stories.ts", 'export default {title:"Valid"}; export const Present={};')]);
    assert.deepEqual([...result.ids], ["valid--present"], content);
    assert.equal(result.findings.length, 1, content);
    assert.ok(result.findings[0].startsWith(`broken.stories.tsx${line ? `:${line}` : ""}: `), result.findings[0]);
    assert.match(result.findings[0], message);
  }
});

test("fail-closed findings locate nested exports and every assignment in any scope", () => {
  assert.deepEqual(storyIdsFromFiles([file("nested.stories.ts", 'export default {title:"Probe"};\nnamespace H {\nexport const Ghost={};\nexport function Phantom(){}\n}')]).findings, [
    "nested.stories.ts:3: unmodeled nested export",
    "nested.stories.ts:4: unmodeled nested export",
  ]);
  const result = storyIdsFromFiles([file("assigned.stories.ts", `export default {title:"Probe"};
const Local={}; export {Local as A};
(Local.parameters={__id:"special--a"});
function f() {
  Local.parameters.__id ||= "special--a";
}`)]);
  assert.deepEqual([...result.ids], []);
  assert.deepEqual(result.findings, [
    "assigned.stories.ts:3: unmodeled story __id",
    "assigned.stories.ts:5: unmodeled story __id",
  ]);
});

test("Unicode story identifiers use the complete export name, not a phantom ASCII prefix", () => {
  const stories = [file("unicode.stories.ts", `export default { id: "probe-unicode" }; export const Café = {};`)];
  const { ids, findings: errors } = storyIdsFromFiles(stories);
  assert.deepEqual(errors, []);
  assert.deepEqual([...ids], ["probe-unicode--café"]);
  assert.ok(!ids.has("probe-unicode--caf"));
  assert.match(findings({ stories: [...storyFiles, ...stories], boards: [board("probe-unicode--caf")], docs: [doc("/iframe.html?id=probe-unicode--caf")] }).join("\n"), /unresolved story probe-unicode--caf/);
  assert.match(findings({ stories: [...storyFiles, ...stories], docs: [doc("/iframe.html?id=probe-unicode--caf")] }).join("\n"), /unresolved link id probe-unicode--caf/);
  const initial = [file("initial.stories.ts", `export default { id: "probe-unicode" }; export const Élise = {};`)];
  assert.deepEqual([...storyIdsFromFiles(initial).ids], ["probe-unicode--élise"]);
});

test("aliased story exports fail closed when a local __id cannot render", () => {
  const alias = file("probe-alias.stories.ts", `const Internal = { parameters: { __id: "special--one" } };
    export default { id: "probe-alias", title: "Probe/Alias" }; export { Internal as Aliased };`);
  // The index keys the story by `probe-alias--aliased` while the preview keys it by
  // `special--one` and then looks the story up under the index id, so it cannot render.
  assert.deepEqual(storyIdsFromFiles([alias]).findings, ["probe-alias.stories.ts:1: unmodeled story __id"]);
  assert.deepEqual([...storyIdsFromFiles([alias]).ids], []);
  const errors = findings({ stories: [...storyFiles, alias], boards: [board("special--one")], docs: [doc("/iframe.html?id=special--one")] });
  assert.match(errors.join("\n"), /unresolved story special--one/);
  assert.match(errors.join("\n"), /unresolved link id special--one/);
});

test("regex excludeStories removes matching exports and rejects excluded board frames", () => {
  const stories = [file("filter.stories.ts", `export default { id: "filter", excludeStories: /Helper$/ };
    export const Primary = {}; export const PrimaryHelper = {}; export const Secondary = {};`)];
  assert.deepEqual([...storyIdsFromFiles(stories).ids], ["filter--primary", "filter--secondary"]);
  assert.match(findings({ stories: [...storyFiles, ...stories], boards: [board("filter--primary-helper")] }).join("\n"), /unresolved story filter--primary-helper/);
});

test("regex includeStories keeps only matching export names", () => {
  const stories = [file("filter.stories.ts", `export default { id: "filter", includeStories: /Story$/ };
    export const GoodStory = {}; export const StoryHelper = {}; export const Other = {};`)];
  assert.deepEqual([...storyIdsFromFiles(stories).ids], ["filter--good-story"]);
});

test("regex story filters preserve flags and escaped pattern text", () => {
  const stories = [file("filter.stories.ts", String.raw`export default { id: "filter", excludeStories: /^helper/i, includeStories: /^Hel\x70|^Primary/ };
    export const Helper = {}; export const HelperTwo = {}; export const HelpStory = {}; export const Primary = {}; export const Other = {};`)];
  assert.deepEqual([...storyIdsFromFiles(stories).ids], ["filter--help-story", "filter--primary"]);
});

test("global-flag regex filters match every export independently like Storybook", () => {
  const stories = [file("filter.stories.ts", `export default { id: "filter", excludeStories: /^[A-Z]/g };
    export const A = {}; export const B = {}; export const C = {};`)];
  assert.deepEqual(storyIdsFromFiles(stories).findings, []);
  assert.deepEqual([...storyIdsFromFiles(stories).ids], []);
  const included = [file("filter.stories.ts", `export default { id: "filter", includeStories: /^[A-Z]/g };
    export const A = {}; export const B = {}; export const C = {};`)];
  assert.deepEqual([...storyIdsFromFiles(included).ids], ["filter--a", "filter--b", "filter--c"]);
});

test("the gate checks literal Storybook globs", () => {
  const config = (value) => `export default { stories: ${value} };`;
  assert.deepEqual(storyGlobFindings("main.ts", config(JSON.stringify(storyGlobs))), []);
  assert.deepEqual(storyGlobFindings("main.ts", config(JSON.stringify(storyGlobs).replace("../stories/", String.raw`../\u0073tories/`))), []);
  assert.match(storyGlobFindings("main.ts", config(JSON.stringify(storyGlobs).replace("../stories/", String.raw`../\u{110000}stories/`))).join("\n"), /literal array matching gate globs/);
  for (const value of [
    JSON.stringify([...storyGlobs, "../extra/**/*.stories.tsx"]),
    JSON.stringify(["../wrong/**/*.stories.tsx", storyGlobs[1]]),
    "storyPatterns",
    `[${storyGlobs.map((glob) => JSON.stringify(glob)).join(", ")}, ...extra]`,
    `${JSON.stringify(storyGlobs)}.concat(extra)`,
    "[...storyPatterns]",
    "undefined",
  ]) assert.match(storyGlobFindings("main.ts", config(value)).join("\n"), /main\.ts:1: Storybook stories must be a literal array matching gate globs/);
  assert.match(storyGlobFindings("main.ts", "export default {};").join("\n"), /literal array/);
  assert.match(storyGlobFindings("main.ts", `export default { stories: ${JSON.stringify(storyGlobs)}, stories: ${JSON.stringify(storyGlobs)} };`).join("\n"), /literal array/);
  assert.match(storyGlobFindings("main.ts", `export default { stories: [${JSON.stringify(storyGlobs[0])},,${JSON.stringify(storyGlobs[1])}] };`).join("\n"), /literal array/);
});

test("deep alias chains resolve without recursion", () => {
  const chain = Array.from({ length: 10000 }, (_, index) => `const x${index} = ${index === 0 ? "{}" : `x${index - 1}`};`).join(" ");
  const result = storyIdsFromFiles([file("deep.stories.ts", `export default {title:"Probe"}; ${chain} export const A = { parameters: x9999 };`)]);
  assert.deepEqual(result.findings, []);
  assert.deepEqual([...result.ids], ["probe--a"]);
  const spread = Array.from({ length: 5000 }, (_, index) => `const y${index} = {${index === 0 ? "" : `...y${index - 1}`}};`).join(" ");
  assert.doesNotThrow(() => storyIdsFromFiles([file("spread.stories.ts", `export default {title:"Probe"}; ${spread} export const A = { parameters: y4999 };`)]));
});


test("real repository story references all resolve", () => {
  assert.deepEqual(repositoryStoryReferenceFindings(root), []);
  assert.ok(repositoryStoryIds(root).size > 0);
});

test("every repository story file keeps exactly the indexed ids", () => {
  const directory = join(root, "apps/web");
  const files = readdirSync(directory, { recursive: true })
    .filter((path) => typeof path === "string" && /\.stories\.[cm]?[jt]sx?$/.test(path) && !path.includes("node_modules"))
    .map((path) => path.split("\\").join("/"))
    .sort()
    .map((path) => ({ path: `apps/web/${path}`, content: readFileSync(join(directory, path), "utf8") }));
  assert.ok(files.length > 0);
  const { ids, findings } = storyIdsFromFiles(files);
  assert.deepEqual(findings, []);
  const indexed = files.flatMap((file) => loadCsf(file.content, { fileName: file.path, makeTitle: (title) => title }).parse().indexInputs.map((input) => input.__id));
  assert.deepEqual([...ids].sort(), [...new Set(indexed)].sort());
});

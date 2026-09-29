import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  repositoryStoryIds, repositoryStoryReferenceFindings, storyGlobs, storyGlobFindings, storyIdsFromFiles,
  storyReferenceFindings, toId,
} from "../story-references.mjs";

const root = fileURLToPath(new URL("../../..", import.meta.url));
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
  assert.deepEqual(storyIdsFromFiles(invalid).findings, ["filter.stories.ts:1: unmodeled excludeStories filter"]);
});

test("indexes every top-level const declarator, not destructured or nested names", () => {
  const stories = [file("multi.stories.ts", `export default { id: "probe-multi" };
    export const A = { nested: [1, { value: 2 }] }, B = { fn: () => ({ value: 3 }) };
    export const { C, D } = obj; export const E = {}, F = {};`)];
  assert.deepEqual(storyIdsFromFiles(stories).findings, []);
  assert.deepEqual([...storyIdsFromFiles(stories).ids], ["probe-multi--a", "probe-multi--b", "probe-multi--e", "probe-multi--f"]);
});

test("namespace member exports are indexed like Storybook", () => {
  const stories = [file("namespace.stories.ts", `export default { id: "probe" }; export namespace Helpers { export const Ghost = {}; }`)];
  assert.deepEqual(storyIdsFromFiles(stories).findings, []);
  assert.deepEqual([...storyIdsFromFiles(stories).ids], ["probe--ghost"]);
});

test("CSF2 parameter assignments do not override Storybook story IDs", () => {
  const stories = [file("assignment.stories.ts", `export default { id: "probe" }; export function Assigned() {}; Assigned.parameters = { __id: "special--assigned" };`)];
  assert.deepEqual(storyIdsFromFiles(stories).findings, []);
  assert.deepEqual([...storyIdsFromFiles(stories).ids], ["probe--assigned"]);
});

test("typed declarators keep generic commas inside the annotation and resolve object initializers", () => {
  const stories = [file("typed.stories.ts", `export default { id: "probe-typed", title: "Probe/Typed" };
    export const Actual: Record<string, unknown> = {}, Nested: Map<string, Record<string, unknown>> = { parameters: { __id: "special--nested" } }, Callback: Record<string, (value: string) => Record<string, unknown>> = {};`)];
  const { ids, findings: errors } = storyIdsFromFiles(stories);
  assert.deepEqual(errors, []);
  assert.deepEqual([...ids], ["probe-typed--actual", "special--nested", "probe-typed--callback"]);
  assert.ok(!ids.has("probe-typed--unknown"));
});

test("semicolonless variable declarations stop at the next depth-zero statement", () => {
  const stories = [file("asi.stories.ts", `export default { id: "probe-asi", title: "Probe/Asi" };
    export const A = {}
    export const B = {}
    export let C = {}
    export var D = {}`)];
  const { ids, findings: errors } = storyIdsFromFiles(stories);
  assert.deepEqual(errors, []);
  const multiline = [file("multiline.stories.ts", `export default { id: "probe-multiline" };
    export const Arrow = () =>
    function Inner() { return {}; }
    export const Next = {}`)];
  assert.deepEqual([...storyIdsFromFiles(multiline).ids], ["probe-multiline--arrow", "probe-multiline--next"]);
  assert.deepEqual([...ids], ["probe-asi--a", "probe-asi--b", "probe-asi--c", "probe-asi--d"]);
});

test("export async function is a story", () => {
  const stories = [file("async.stories.ts", `export default { id: "probe-async", title: "Probe/Async" }; export async function Async() { return {}; }`)];
  assert.deepEqual(storyIdsFromFiles(stories).findings, []);
  assert.deepEqual([...storyIdsFromFiles(stories).ids], ["probe-async--async"]);
});

test("empty or whitespace-only meta id falls back to title, but two empty fields fail loudly", () => {
  for (const id of ["", "   "]) {
    const stories = [file("fallback.stories.ts", `export default { id: "${id}", title: "Probe/Fallback" }; export const Present = {};`)];
    assert.deepEqual(storyIdsFromFiles(stories).findings, []);
    assert.deepEqual([...storyIdsFromFiles(stories).ids], ["probe-fallback--present"]);
  }
  const empty = [file("empty.stories.ts", `export default { id: " ", title: "" }; export const Present = {};`)];
  assert.deepEqual([...storyIdsFromFiles(empty).ids], []);
  assert.match(storyIdsFromFiles(empty).findings.join("\n"), /story meta has no literal id or title/);
});

test("explicit nonliteral meta id does not fall back to a literal title", () => {
  const stories = [file("dynamic.stories.ts", `const dynamic = "else"; export default { id: dynamic, title: "Probe/Dynamic" }; export const Ghost = {};`)];
  const { ids, findings: errors } = storyIdsFromFiles(stories);
  assert.deepEqual([...ids], []);
  assert.deepEqual(errors, ["dynamic.stories.ts:1: story meta has nonliteral id"]);
  assert.ok(!ids.has("probe-dynamic--ghost"));
});

test("explicit nonliteral meta title fails even with a literal id", () => {
  const stories = [file("nulltitle.stories.ts", `export default { id: "probe-nulltitle", title: null }; export const A = {};`)];
  const { ids, findings: errors } = storyIdsFromFiles(stories);
  assert.deepEqual([...ids], []);
  assert.deepEqual(errors, ["nulltitle.stories.ts:1: story meta has nonliteral title"]);
  assert.ok(!ids.has("probe-nulltitle--a"));
});

test("exported let and var declarations create stories, but classes do not", () => {
  const stories = [file("probe-variable.stories.ts", `export default { id: "probe-variable" };
    export let Live = {}; export var Legacy = {}; export const Constant = {}; export class Klass {}`)];
  assert.deepEqual(storyIdsFromFiles(stories).findings, []);
  assert.deepEqual([...storyIdsFromFiles(stories).ids], ["probe-variable--live", "probe-variable--legacy", "probe-variable--constant"]);
});

test("default export aliases resolve the local const meta object", () => {
  const stories = [file("probe-defalias.stories.ts", `const meta = { id: "probe-defalias", title: "Probe/Defalias" }; export { meta as default }; export const A = {};`)];
  assert.deepEqual(storyIdsFromFiles(stories).findings, []);
  assert.deepEqual([...storyIdsFromFiles(stories).ids], ["probe-defalias--a"]);
});

test("block-shadowed meta cannot override the top-level default export", () => {
  const stories = [file("block-shadow.stories.ts", `const meta={id:"probe",title:"Probe"}; {const meta={id:"phantom"};} export default meta; export const Real={};`)];
  const { ids, findings: errors } = storyIdsFromFiles(stories);
  assert.deepEqual(errors, []);
  assert.deepEqual([...ids], ["probe--real"]);
  assert.ok(!ids.has("phantom--real"));
});

test("function-shadowed meta cannot override the top-level default export", () => {
  const stories = [file("function-shadow.stories.ts", `const meta = { id: "probe" }; function example() { const meta = { id: "phantom" }; return meta; } export default meta; export const Real = {};`)];
  const { ids, findings: errors } = storyIdsFromFiles(stories);
  assert.deepEqual(errors, []);
  assert.deepEqual([...ids], ["probe--real"]);
  assert.ok(!ids.has("phantom--real"));
});

test("JSX-expression-shadowed meta cannot override the top-level default export", () => {
  const stories = [file("jsx-shadow.stories.tsx", `const meta = { id: "probe" }; const sample = <div>{(() => { const meta = { id: "phantom" }; return meta.id; })()}</div>; export default meta; export const Real = {};`)];
  const { ids, findings: errors } = storyIdsFromFiles(stories);
  assert.deepEqual(errors, []);
  assert.deepEqual([...ids], ["probe--real"]);
  assert.ok(!ids.has("phantom--real"));
});

test("missing top-level meta binding fails loudly instead of resolving a nested declaration", () => {
  const stories = [file("missing-meta.stories.ts", `{ const meta = { id: "phantom" }; } export default meta; export const Real = {};`)];
  const { ids, findings: errors } = storyIdsFromFiles(stories);
  assert.deepEqual([...ids], []);
  assert.match(errors.join("\n"), /story meta has no literal id or title/);
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

test("Unicode escapes in identifiers decode before deriving IDs, and malformed escapes fail closed", () => {
  for (const escaped of [String.raw`C\u0061f`, String.raw`C\u{61}f`]) {
    const stories = [file("escape.stories.ts", `export default { id: "probe-escape" }; export const ${escaped} = {};`)];
    const { ids, findings: errors } = storyIdsFromFiles(stories);
    assert.deepEqual(errors, []);
    assert.deepEqual([...ids], ["probe-escape--caf"]);
    assert.ok(!ids.has("probe-escape--c"));
  }
  for (const escaped of [String.raw`C\u12GGf`, String.raw`C\u{110000}f`, String.raw`\u{}f`]) {
    const stories = [file("escape.stories.ts", `export default { id: "probe-escape" }; export const ${escaped} = {}; export const Valid = {};`)];
    const { ids, findings: errors } = storyIdsFromFiles(stories);
    assert.deepEqual([...ids], [], escaped);
    assert.match(errors.join("\n"), /escape\.stories\.ts:1: unmodeled identifier escape/, escaped);
  }
});

test("regex literals after control-condition parentheses cannot invent story exports", () => {
  for (const condition of ["if (true)", "while (true)", "for (;;)", "with (obj)", "if ((true))"]) {
    const stories = [file("regex.stories.ts", `export default { id: "probe-regex" }; ${condition} /export const Ghost = []/.test("x"); export const Real = {};`)];
    const { ids, findings: errors } = storyIdsFromFiles(stories);
    assert.deepEqual(errors, [], condition);
    assert.deepEqual([...ids], ["probe-regex--real"], condition);
    assert.ok(!ids.has("probe-regex--ghost"), condition);
    assert.match(findings({ stories: [...storyFiles, ...stories], boards: [board("probe-regex--ghost")] }).join("\n"), /unresolved story probe-regex--ghost/);
    assert.match(findings({ stories: [...storyFiles, ...stories], docs: [doc("/iframe.html?id=probe-regex--ghost")] }).join("\n"), /unresolved link id probe-regex--ghost/);
  }
});

test("regex after a statement block is not mistaken for an exported story", () => {
  const stories = [file("block.stories.ts", `export default { id: "probe" }; if (true) {} /export const Ghost = {}/.test('x'); export const Real = {};`)];
  const { ids, findings: errors } = storyIdsFromFiles(stories);
  assert.deepEqual(errors, []);
  assert.deepEqual([...ids], ["probe--real"]);
  assert.ok(!ids.has("probe--ghost"));
  assert.match(findings({ stories: [...storyFiles, ...stories], boards: [board("probe--ghost")] }).join("\n"), /unresolved story probe--ghost/);
});

test("regex after throw is not mistaken for an exported story", () => {
  const stories = [file("throw.stories.ts", `export default { id: "probe" }; function fail() { throw /export const Ghost = {}/; } export const Real = {};`)];
  const { ids, findings: errors } = storyIdsFromFiles(stories);
  assert.deepEqual(errors, []);
  assert.deepEqual([...ids], ["probe--real"]);
  assert.ok(!ids.has("probe--ghost"));
});

test("regex after spread is not mistaken for an exported story", () => {
  const stories = [file("spread.stories.ts", `export default { id: "probe" }; const matches = [... /export const Ghost = {}/.exec('x')]; export const Real = {};`)];
  const { ids, findings: errors } = storyIdsFromFiles(stories);
  assert.deepEqual(errors, []);
  assert.deepEqual([...ids], ["probe--real"]);
  assert.ok(!ids.has("probe--ghost"));
});

test("TSX generic arrows do not swallow following story exports", () => {
  for (const expression of ["<T,>(x: T) => x", "<T extends Record<string, unknown>>(x: T) => x", "<T extends { value: string }>(x: T) => x"]) {
    const stories = [file("generic.stories.tsx", `export default { id: "probe" }; const identity = ${expression}; export const Real = {};`)];
    const { ids, findings: errors } = storyIdsFromFiles(stories);
    assert.deepEqual(errors, [], expression);
    assert.deepEqual([...ids], ["probe--real"], expression);
  }
});

test("unmodeled JSX or type-parameter syntax fails visibly without phantom IDs", () => {
  const stories = [file("broken.stories.tsx", `export default { id: "probe" }; const identity = <T, (x: T) => x; export const Real = {};`)];
  const { ids, findings: errors } = storyIdsFromFiles(stories);
  assert.deepEqual([...ids], []);
  assert.match(errors.join("\n"), /broken\.stories\.tsx:1: unmodeled JSX or type-parameter syntax/);
});

test("JSX children are opaque but following real exports are indexed", () => {
  const stories = [file("jsx.stories.tsx", `export default { id: "probe" }; const sample = <code>export const Ghost = {}</code>; export const Real = {};`)];
  const { ids, findings: errors } = storyIdsFromFiles(stories);
  assert.deepEqual(errors, []);
  assert.deepEqual([...ids], ["probe--real"]);
  assert.ok(!ids.has("probe--ghost"));
  assert.match(findings({ stories: [...storyFiles, ...stories], docs: [doc("/iframe.html?id=probe--ghost")] }).join("\n"), /unresolved link id probe--ghost/);
  const nested = [file("nested.stories.tsx", `export default { id: "probe" }; const sample = <code title=">">export const Ghost = {}<span>{'export const Phantom = {}'}</span></code>; export const Real = {};`)];
  assert.deepEqual(storyIdsFromFiles(nested).findings, []);
  assert.deepEqual([...storyIdsFromFiles(nested).ids], ["probe--real"]);
  const unknown = [file("broken.stories.tsx", `export default { id: "probe" }; const sample = <code>export const Ghost = {}; export const Real = {};`)];
  assert.deepEqual([...storyIdsFromFiles(unknown).ids], []);
  assert.match(storyIdsFromFiles(unknown).findings.join("\n"), /unmodeled JSX or type-parameter syntax/);
});

test("regex after else is not mistaken for an exported story", () => {
  const stories = [file("else.stories.ts", `export default { id: "probe-else", title: "Probe/Else" }; if (false) {} else /export const Ghost = {}/.test("x"); export const Real = {};`)];
  const { ids, findings: errors } = storyIdsFromFiles(stories);
  assert.deepEqual(errors, []);
  assert.deepEqual([...ids], ["probe-else--real"]);
  assert.ok(!ids.has("probe-else--ghost"));
});

test("regex after a tokenized arrow is not mistaken for an exported story", () => {
  const stories = [file("arrow.stories.ts", `export default { id: "probe-arrow", title: "Probe/Arrow" }; const f = () => /export const Ghost2 = {}/.test("y"); export const Real = {};`)];
  const { ids, findings: errors } = storyIdsFromFiles(stories);
  assert.deepEqual(errors, []);
  assert.deepEqual([...ids], ["probe-arrow--real"]);
  assert.ok(!ids.has("probe-arrow--ghost-2"));
});

test("expression-position regex prefixes do not change plain division", () => {
  const contexts = [
    ["=", "const value =", ";"], ["!", "const value = !", ";"],
    ["&", "const value = 1 &", ";"], ["|", "const value = 1 |", ";"],
    ["?", "const value = true ?", ": false;"], ["+", "const value = 1 +", ";"],
    ["-", "const value = 1 -", ";"], ["*", "const value = 1 *", ";"],
    ["%", "const value = 1 %", ";"], ["^", "const value = 1 ^", ";"],
    ["~", "const value = ~", ";"], ["<", "const value = 1 <", ";"],
    [">", "const value = 1 >", ";"], [",", "const value = [0,", "];"],
    [":", "const value = { key:", "};"], [";", "const value = 0;", ";"],
    ["[", "const value = [", "];"], ["(", "const value = (", ");"],
    ["{", "const value = () => {", "; };"],
    ["return", "function context() { return", "; }"],
    ["typeof", "const value = typeof", ";"],
    ["case", "switch (0) { case", ": break; }"],
    ["in", "const value = 1 in", ";"],
    ["of", "for (const value of", ") {}"],
    ["do", "do", "; while (false);"],
    ["else", "if (false) {} else", ";"],
    ["yield", "function* context() { yield", "; }"],
    ["await", "async function context() { await", "; }"],
    ["void", "const value = void", ";"],
    ["delete", "const value = delete", ";"],
    ["instanceof", "const value = 1 instanceof", ";"],
    ["new", "function context() { new", "; }"],
  ];
  for (const [prefix, before, after] of contexts) {
    const expression = `${before} /export const Ghost = {}/.test("x")${after}`;
    assert.doesNotThrow(() => new Function(`"use strict"; ${expression}`), prefix);
    const stories = [file("position.stories.ts", `export default { id: "probe-position" }; ${expression} export const Real = {};`)];
    const { ids, findings: errors } = storyIdsFromFiles(stories);
    assert.deepEqual(errors, [], prefix);
    assert.deepEqual([...ids], ["probe-position--real"], prefix);
    assert.ok(!ids.has("probe-position--ghost"), prefix);
  }
  const divided = [file("division.stories.ts", `export default { id: "probe-division" }; export const A = a / b; export const B = (a + b) / 2;`)];
  assert.deepEqual(storyIdsFromFiles(divided).findings, []);
  assert.deepEqual([...storyIdsFromFiles(divided).ids], ["probe-division--a", "probe-division--b"]);
});

test("JSX closing tags and fragments are not regex starters", () => {
  const stories = [file("jsx.stories.tsx", `const meta = { id: "probe-jsx", decorators: [(Story) => <><div><Story /></div></>] }; export default meta; export const Real = {};`)];
  const { ids, findings: errors } = storyIdsFromFiles(stories);
  assert.deepEqual(errors, []);
  assert.deepEqual([...ids], ["probe-jsx--real"]);
});

test("generator function exports retain their story names", () => {
  const stories = [file("star.stories.ts", `export default { id: "probe-star" }; export function* Generator() {}; export async function* AsyncGenerator() {}; export function Plain() {}; export let Mutable = {};`)];
  assert.deepEqual(storyIdsFromFiles(stories).findings, []);
  assert.deepEqual([...storyIdsFromFiles(stories).ids], ["probe-star--generator", "probe-star--async-generator", "probe-star--plain", "probe-star--mutable"]);
});

test("typed local meta resolves through default and aliased default exports", () => {
  for (const defaultExport of ["export default meta", "export { meta as default }"]) {
    const stories = [file("typedmeta.stories.ts", `const meta: { id: string; title: string } = { id: "probe-typedmeta", title: "Probe/Typedmeta" }; ${defaultExport}; export const A = {};`)];
    assert.deepEqual(storyIdsFromFiles(stories).findings, [], defaultExport);
    assert.deepEqual([...storyIdsFromFiles(stories).ids], ["probe-typedmeta--a"], defaultExport);
  }
});

test("quoted meta keys have no effect and produce no findings", () => {
  const stories = [file("quoted.stories.ts", `export default { title: "Probe/Quoted", "id": "probe-other", "includeStories": ["A"], "excludeStories": ["A"] }; export const A = {}, B = {};`)];
  const { ids, findings: errors } = storyIdsFromFiles(stories);
  assert.deepEqual(errors, []);
  assert.deepEqual([...ids], ["probe-quoted--a", "probe-quoted--b"]);
});

test("reserved CSF exports are not stories", () => {
  const stories = [file("reserved.stories.ts", `export default { id: "probe-reserved" }; export const A = {}, __namedExportsOrder = ["A"], __esModule = true;`)];
  assert.deepEqual([...storyIdsFromFiles(stories).ids], ["probe-reserved--a"]);
});

test("only direct story parameters.__id changes the story ID; unsupported values fail the whole file closed", () => {
  const stories = [file("idforms.stories.ts", `export default { id: "probe-idforms", parameters: { __id: "special--meta" } };
    export const A = {}, B = { parameters: { id: "special--ignored" } };
    export const C = { id: "special--c" }, D = { __id: "special--d" }, F = { __id: 42 };
    export const E: Story = { parameters: { __id: "special--e" } };
    const Original = { parameters: { __id: "special--renamed" } }; export { Original as Renamed };`)];
  const { ids, findings: errors } = storyIdsFromFiles(stories);
  assert.deepEqual(errors, []);
  assert.deepEqual([...ids], ["probe-idforms--a", "probe-idforms--b", "probe-idforms--c", "probe-idforms--d", "probe-idforms--f", "special--e", "probe-idforms--renamed"]);
  for (const value of ["42", "undefined", "`dynamic`", String.raw`"\u{110000}"`]) {
    const bad = [file("bad.stories.ts", `export default { id: "probe-idforms" }; export const A = {}, B = { parameters: { __id: ${value} } };`)];
    const result = storyIdsFromFiles(bad);
    assert.deepEqual([...result.ids], [], value);
    assert.deepEqual(result.findings, ["bad.stories.ts:1: unmodeled story __id"], value);
  }
});

test("aliased story exports do not inherit local __id or validate phantom references", () => {
  const alias = file("probe-alias.stories.ts", `const Internal = { parameters: { __id: "special--one" } };
    export default { id: "probe-alias", title: "Probe/Alias" }; export { Internal as Aliased };`);
  assert.deepEqual(storyIdsFromFiles([alias]).findings, []);
  assert.deepEqual([...storyIdsFromFiles([alias]).ids], ["probe-alias--aliased"]);
  const errors = findings({ stories: [...storyFiles, alias], boards: [board("special--one")], docs: [doc("/iframe.html?id=special--one")] });
  assert.match(errors.join("\n"), /unresolved story special--one/);
  assert.match(errors.join("\n"), /unresolved link id special--one/);
});

test("Unicode line continuations decode, but raw Unicode line terminators do not", () => {
  for (const terminator of ["\u2028", "\u2029"]) {
    const continued = [file("unicode.stories.ts", `export default { id: "probe\\${terminator}unicode" }; export const A = {};`)];
    assert.deepEqual(storyIdsFromFiles(continued).findings, []);
    assert.deepEqual([...storyIdsFromFiles(continued).ids], ["probeunicode--a"]);
    const raw = [file("unicode.stories.ts", `export default { id: "probe${terminator}unicode" }; export const A = {};`)];
    assert.deepEqual([...storyIdsFromFiles(raw).ids], []);
    assert.match(storyIdsFromFiles(raw).findings.join("\n"), /no literal id or title/);
    const filter = [file("unicode.stories.ts", `export default { id: "probe", excludeStories: ["A${terminator}"] }; export const A = {};`)];
    assert.deepEqual([...storyIdsFromFiles(filter).ids], []);
    assert.match(storyIdsFromFiles(filter).findings.join("\n"), /unmodeled excludeStories filter/);
  }
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

test("escaped filter array elements match decoded export names, including identity escapes", () => {
  for (const [expression, excluded] of [
    [String.raw`"Hel\x70er"`, "Helper"], [String.raw`"\u0048elper"`, "Helper"],
    [String.raw`"Hel\per"`, "Helper"], [String.raw`"Hel\qer"`, "Helqer"],
  ]) {
    const stories = [file("filter.stories.ts", `export default { id: "filter", excludeStories: [${expression}] }; export const ${excluded} = {}; export const Primary = {};`)];
    assert.deepEqual(storyIdsFromFiles(stories).findings, [], expression);
    assert.deepEqual([...storyIdsFromFiles(stories).ids], ["filter--primary"], expression);
  }
});

test("escaped id and title literals yield decoded kinds", () => {
  for (const field of ["id", "title"]) {
    const stories = [file("kind.stories.ts", String.raw`export default { ${field}: "demo\u002Dkind" }; export const Primary = {};`)];
    assert.deepEqual([...storyIdsFromFiles(stories).ids], ["demo-kind--primary"], field);
  }
});

test("non-decodable literals fail closed in filters, kinds and Storybook globs", () => {
  for (const key of ["excludeStories", "includeStories"]) {
    const stories = [file("filter.stories.ts", String.raw`export default { id: "filter", ${key}: ["\u{110000}"] }; export const Helper = {};`)];
    const { ids, findings: errors } = storyIdsFromFiles(stories);
    assert.deepEqual([...ids], []);
    assert.match(errors.join("\n"), new RegExp(`unmodeled ${key} filter`));
  }
  for (const field of ["id", "title"]) {
    const stories = [file("kind.stories.ts", String.raw`export default { ${field}: "\u{110000}" }; export const Helper = {};`)];
    const { ids, findings: errors } = storyIdsFromFiles(stories);
    assert.deepEqual([...ids], []);
    assert.match(errors.join("\n"), /story meta has no literal id or title/);
  }
  for (const invalid of [String.raw`"\xGG"`, String.raw`"\u12ZZ"`, String.raw`"\101"`, String.raw`"\08"`]) {
    const stories = [file("filter.stories.ts", `export default { id: "filter", excludeStories: [${invalid}] }; export const Helper = {};`)];
    const { ids, findings: errors } = storyIdsFromFiles(stories);
    assert.deepEqual([...ids], [], invalid);
    assert.match(errors.join("\n"), /unmodeled excludeStories filter/, invalid);
  }
  const trailingBackslash = [file("filter.stories.ts", 'export default { id: "filter", excludeStories: ["Hel' + "\\")];
  const trailingResult = storyIdsFromFiles(trailingBackslash);
  assert.deepEqual([...trailingResult.ids], []);
  assert.ok(trailingResult.findings.length > 0);
  const badId = [file("kind.stories.ts", String.raw`export default { id: "\u{110000}", title: "fallback" }; export const Helper = {};`)];
  assert.deepEqual([...storyIdsFromFiles(badId).ids], []);
  assert.match(storyIdsFromFiles(badId).findings.join("\n"), /story meta has no literal id or title/);
  const config = (glob) => `export default { stories: ${JSON.stringify(storyGlobs).replace("../stories/", glob)} };`;
  assert.deepEqual(storyGlobFindings("main.ts", config(String.raw`../\u0073tories/`)), []);
  assert.match(storyGlobFindings("main.ts", config(String.raw`../\u{110000}stories/`)).join("\n"), /literal array matching gate globs/);
});

test("quoted string escapes and line continuations decode as JavaScript values", () => {
  const stories = [file("filter.stories.ts", String.raw`export default { id: "demo\x2dkind", excludeStories: ["Hel\
per", "\u{0048}elper", 'A\\B', 'A\'B', "A\"B", "A\nB", "A\rB", "A\tB", "A\bB", "A\fB", "A\vB", "A\0B"] };
    export const Helper = {}; export const Primary = {};`)];
  const { ids, findings: errors } = storyIdsFromFiles(stories);
  assert.deepEqual(errors, []);
  assert.deepEqual([...ids], ["demo-kind--primary"]);
});

test("identity escapes decode slash, quote and space in literal meta kinds", () => {
  const stories = [file("kind.stories.ts", String.raw`export default { id: 'A\/B\" C\ D' }; export const Primary = {};`)];
  assert.deepEqual(storyIdsFromFiles(stories).findings, []);
  assert.deepEqual([...storyIdsFromFiles(stories).ids], ["a-b-c-d--primary"]);
});

test("unsupported story filters produce findings instead of unfiltered IDs", () => {
  for (const expression of ["hidden", "getHidden()", "config.hidden", "`Helper`", "[\"A\", hidden]", "[\"A\" \"B\"]", "/unterminated"]) {
    const stories = [file("filter.stories.ts", `export default { id: "filter", excludeStories: ${expression}${expression === "/unterminated" ? "\n" : ""} }; export const Helper = {};`)];
    const { ids, findings: errors } = storyIdsFromFiles(stories);
    assert.deepEqual([...ids], [], expression);
    assert.match(errors.join("\n"), /filter\.stories\.ts:1: unmodeled excludeStories filter/, expression);
  }
  assert.match(storyIdsFromFiles([file("filter.stories.ts", `export default { id: "filter", excludeStories: /unterminated }; export const Helper = {};`)]).findings.join("\n"), /unmodeled excludeStories filter/);
  assert.match(storyIdsFromFiles([file("filter.stories.ts", `export default { id: "filter", includeStories: allowed }; export const A = {};`)]).findings.join("\n"), /unmodeled includeStories filter/);
});

test("shorthand story filters report unmodeled filters without indexing exports", () => {
  for (const key of ["includeStories", "excludeStories"]) {
    const stories = [file("filter.stories.ts", `export default { id: "filter", ${key} }; export const Helper = {};`)];
    const { ids, findings: errors } = storyIdsFromFiles(stories);
    assert.deepEqual([...ids], [], key);
    assert.deepEqual(errors, [`filter.stories.ts:1: unmodeled ${key} filter`], key);
  }
});

test("unrelated shorthand meta fields stay ignored", () => {
  const stories = [file("filter.stories.ts", `export default { id: "filter", title }; export const Helper = {};`)];
  const { ids, findings: errors } = storyIdsFromFiles(stories);
  assert.deepEqual(errors, []);
  assert.deepEqual([...ids], ["filter--helper"]);
});

test("nested parameters.excludeStories does not filter exports or produce findings", () => {
  const stories = [file("filter.stories.ts", `export default { id: "filter", parameters: { excludeStories: hidden } }; export const Helper = {};`)];
  const { ids, findings: errors } = storyIdsFromFiles(stories);
  assert.deepEqual(errors, []);
  assert.deepEqual([...ids], ["filter--helper"]);
});

test("type-only exports never create story IDs, even in mixed named exports", () => {
  const stories = [file("demo.stories.ts", `export default { id: "demo" };
export type { A, B }; export { type Helper }; export { type Ignored as Alias, Real as Actual };
export type TypeAlias = string; export interface Interface {} const Real = {};`)];
  assert.deepEqual([...storyIdsFromFiles(stories).ids], ["demo--actual"]);
  assert.match(findings({ stories: [...storyFiles, ...stories], boards: [board("demo--helper")] }).join("\n"), /unresolved story demo--helper/);
});

test("Storybook sanitization matches known repo IDs", () => {
  assert.equal(toId("Review/Boards", "BorrowIllustration"), "review-boards--borrow-illustration");
  assert.equal(toId("UI/Feature Intro", "BorrowNotStartedDark"), "ui-feature-intro--borrow-not-started-dark");
  assert.equal(toId("Journeys/Cash Out", "Step2Review"), "journeys-cash-out--step-2-review");
});

test("the gate checks literal Storybook globs", () => {
  const config = (value) => `export default { stories: ${value} };`;
  assert.deepEqual(storyGlobFindings("main.ts", config(JSON.stringify(storyGlobs))), []);
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
});

test("real repository story references all resolve", () => {
  assert.deepEqual(repositoryStoryReferenceFindings(root), []);
  assert.ok(repositoryStoryIds(root).size > 0);
});

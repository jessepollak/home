import assert from "node:assert/strict";
import test from "node:test";
import { evaluateKnipExemptions, readKnipExemptionInput } from "../knip-exemptions.mjs";
import { designLane, ts } from "../knip-source.mjs";

const file = (path, content = "") => ({ path, content });
const fixture = (config, files, baseline = []) => evaluateKnipExemptions({ config, files, baseline, configPaths: ["knip.json"] });
const clean = { unlisted: [], stale: [], invalid: [], unknownKeys: [], extraConfigs: [] };

test("repository exemptions match their reasoned baseline", () => {
  const input = readKnipExemptionInput();
  assert.ok(input.files.length > 0, "real web source paths must not be empty");
  const parsed = ts.parseConfigFileTextToJson("knip.json", input.config);
  assert.equal(parsed.error, undefined);
  assert.ok(parsed.config.entry.length > 0, "real knip entry patterns must not be empty");
  assert.ok(parsed.config.ignore.length > 0, "real knip ignore patterns must not be empty");
  assert.ok(input.baseline.length > 0, "reasoned baseline must not be empty");
  const result = evaluateKnipExemptions(input);
  assert.deepEqual(result, clean);
});

test("a story-only production entry is unlisted with its importer", () => {
  const result = fixture('{"entry":["components/ui/foo.tsx!"],"ignore":[]}', [
    file("components/ui/foo.tsx", "export const Foo = () => null"),
    file("components/ui/foo.stories.tsx", 'import { Foo } from "./foo"; void Foo'),
  ]);
  assert.deepEqual(result.unlisted, [{ pattern: "components/ui/foo.tsx!", matches: [{ path: "components/ui/foo.tsx", importers: ["components/ui/foo.stories.tsx"] }] }]);
});

test("a story's concatenated dynamic import makes its component exemption unlisted", () => {
  const result = fixture('{"entry":["components/ui/candidate.tsx!"],"ignore":[]}', [
    file("components/ui/candidate.tsx", "export const Candidate = 1"),
    file("components/ui/candidate.stories.tsx", 'void import("./cand" + "idate")'),
  ]);
  assert.deepEqual(result.unlisted, [{ pattern: "components/ui/candidate.tsx!", matches: [{ path: "components/ui/candidate.tsx", importers: ["components/ui/candidate.stories.tsx"] }] }]);
});

test("a story type-query import makes its component exemption unlisted", () => {
  const result = fixture('{"entry":["components/ui/candidate.tsx!"],"ignore":[]}', [
    file("components/ui/candidate.tsx", "export const Candidate = 1"),
    file("components/ui/candidate.stories.ts", 'type Candidate = typeof import("./candidate").Candidate;'),
  ]);
  assert.deepEqual(result.unlisted, [{ pattern: "components/ui/candidate.tsx!", matches: [{ path: "components/ui/candidate.tsx", importers: ["components/ui/candidate.stories.ts"] }] }]);
});

test("a story type query on the module namespace makes its component exemption unlisted", () => {
  const result = fixture('{"entry":["components/ui/candidate.tsx!"],"ignore":[]}', [
    file("components/ui/candidate.tsx", "export const Candidate = 1"),
    file("components/ui/candidate.stories.tsx", 'type Module = typeof import(`./cand${"idate"}`);'),
  ]);
  assert.deepEqual(result.unlisted, [{ pattern: "components/ui/candidate.tsx!", matches: [{ path: "components/ui/candidate.tsx", importers: ["components/ui/candidate.stories.tsx"] }] }]);
});

test("a production type query keeps the exemption clean while a test-only one does", () => {
  const result = fixture('{"entry":["components/ui/candidate.tsx!"],"ignore":[]}', [
    file("components/ui/candidate.tsx", "export const Candidate = 1"),
    file("components/ui/candidate.stories.ts", 'type Candidate = typeof import("./candidate").Candidate;'),
    file("client/view.ts", 'type Candidate = typeof import("@/components/ui/candidate").Candidate;'),
  ]);
  assert.deepEqual(result, clean);
  assert.deepEqual(fixture('{"entry":["server/cli.ts!"],"ignore":[]}', [
    file("server/cli.ts"),
    file("server/cli.test.ts", 'type Cli = typeof import("./cli");'),
  ]), clean);
});

test("a JS story JSDoc type import makes its component exemption unlisted", () => {
  const result = fixture('{"entry":["components/ui/candidate.tsx!"],"ignore":[]}', [
    file("components/ui/candidate.tsx", "export const Candidate = 1"),
    file("components/ui/candidate.stories.js", '/** @type {import("./candidate").Candidate} */\nexport const probe = {};'),
  ]);
  assert.deepEqual(result.unlisted, [{ pattern: "components/ui/candidate.tsx!", matches: [{ path: "components/ui/candidate.tsx", importers: ["components/ui/candidate.stories.js"] }] }]);
});

test("a production-path .figma.ts module is not exempt design-lane code", () => {
  const result = fixture('{"entry":["components/ui/candidate.figma.ts!"],"ignore":[]}', [
    file("components/ui/candidate.figma.ts", "export const Candidate = 1"),
    file("components/ui/candidate.figma.stories.tsx", 'import { Candidate } from "./candidate.figma"; void Candidate'),
  ]);
  assert.deepEqual(result.unlisted, [{ pattern: "components/ui/candidate.figma.ts!", matches: [{ path: "components/ui/candidate.figma.ts", importers: ["components/ui/candidate.figma.stories.tsx"] }] }]);
});

test("design-lane classification follows the documented locations, not name suffixes", () => {
  for (const file of ["components/ui/x.stories.tsx", "client/account/explorations/row.ts", "client/explorations/x.figma.ts", "stories/journeys/x.tsx", ".storybook/main.ts"]) {
    assert.ok(designLane(file), `${file} must be design-lane`);
  }
  for (const file of ["components/ui/candidate.figma.ts", "components/ui/candidate.figma.tsx", "components/ui/candidate.figma.d.ts", "figma.ts", "components/figma.ts", "client/view.tsx"]) {
    assert.ok(!designLane(file), `${file} must be a production path`);
  }
});

test("statically evaluable template expressions can contain concatenation", () => {
  const result = fixture('{"entry":["components/ui/candidate.tsx!"],"ignore":[]}', [
    file("components/ui/candidate.tsx", "export const Candidate = 1"),
    file("components/ui/candidate.stories.tsx", 'void import(`./${"cand" + "idate"}`)'),
  ]);
  assert.equal(result.unlisted.length, 1);
});

test("TypeScript-style extension substitution resolves story imports", () => {
  const result = fixture('{"entry":["components/ui/foo.ts!"],"ignore":[]}', [
    file("components/ui/foo.ts", "export const Foo = 1"),
    file("components/ui/foo.stories.tsx", 'import { Foo } from "./foo.js"; void Foo'),
  ]);
  assert.deepEqual(result.unlisted, [{ pattern: "components/ui/foo.ts!", matches: [{ path: "components/ui/foo.ts", importers: ["components/ui/foo.stories.tsx"] }] }]);
});

test("a story-only re-export chain flags the transitive exemption with its direct importer", () => {
  const result = fixture('{"entry":["components/ui/candidate.tsx!"],"ignore":[]}', [
    file("components/ui/candidate.tsx", "export const Candidate = 1"),
    file("components/ui/helper.tsx", 'export { Candidate } from "./candidate"'),
    file("components/ui/helper.stories.tsx", 'import { Candidate } from "./helper"; void Candidate'),
  ]);
  assert.deepEqual(result.unlisted, [{ pattern: "components/ui/candidate.tsx!", matches: [{ path: "components/ui/candidate.tsx", importers: ["components/ui/helper.tsx"] }] }]);
});


test("an angle-bracket asserted dynamic import makes the story-only exemption unlisted", () => {
  const result = fixture('{"entry":["components/ui/cand.tsx!"],"ignore":[]}', [
    file("components/ui/cand.tsx", "export const Cand = 1"),
    file("components/ui/cand.stories.ts", 'void import(<string>"./cand")'),
  ]);
  assert.deepEqual(result.unlisted, [{ pattern: "components/ui/cand.tsx!", matches: [{ path: "components/ui/cand.tsx", importers: ["components/ui/cand.stories.ts"] }] }]);
});

test("TypeScript substitution wins over a literal JS file for story imports", () => {
  const result = fixture('{"entry":["components/ui/foo.tsx!"],"ignore":[]}', [
    file("components/ui/foo.js", "export const Foo = 0"),
    file("components/ui/foo.tsx", "export const Foo = 1"),
    file("components/ui/foo.stories.tsx", 'void import("./foo.js")'),
  ]);
  assert.deepEqual(result.unlisted, [{ pattern: "components/ui/foo.tsx!", matches: [{ path: "components/ui/foo.tsx", importers: ["components/ui/foo.stories.tsx"] }] }]);
});

test("literal JS files remain resolvable when no TypeScript substitution exists", () => {
  const result = fixture('{"entry":["components/ui/foo.js!"],"ignore":[]}', [
    file("components/ui/foo.js", "export const Foo = 1"),
    file("components/ui/foo.stories.tsx", 'void import("./foo.js")'),
  ]);
  assert.deepEqual(result.unlisted, [{ pattern: "components/ui/foo.js!", matches: [{ path: "components/ui/foo.js", importers: ["components/ui/foo.stories.tsx"] }] }]);
});
test("a story-entered re-export cycle is unlisted with sorted direct importers", () => {
  const result = fixture('{"entry":["components/ui/a.tsx!"],"ignore":[]}', [
    file("components/ui/a.tsx", 'export { B } from "./b"; export const A = 1'),
    file("components/ui/b.tsx", 'export { A } from "./a"; export const B = 1'),
    file("components/ui/a.stories.tsx", 'import { A } from "./a"; void A'),
  ]);
  assert.deepEqual(result.unlisted, [{ pattern: "components/ui/a.tsx!", matches: [{ path: "components/ui/a.tsx", importers: ["components/ui/a.stories.tsx", "components/ui/b.tsx"] }] }]);
});

test("a story-entered re-export cycle without exemptions stays clean", () => {
  const result = fixture('{"entry":[],"ignore":[]}', [
    file("components/ui/a.tsx", 'export { B } from "./b"; export const A = 1'),
    file("components/ui/b.tsx", 'export { A } from "./a"; export const B = 1'),
    file("components/ui/a.stories.tsx", 'import { A } from "./a"; void A'),
  ]);
  assert.deepEqual(result, clean);
});

test("a test-entered re-export cycle is not exploration-only", () => {
  const result = fixture('{"entry":["components/ui/a.tsx!"],"ignore":[]}', [
    file("components/ui/a.tsx", 'export { B } from "./b"; export const A = 1'),
    file("components/ui/b.tsx", 'export { A } from "./a"; export const B = 1'),
    file("components/ui/a.test.ts", 'import { A } from "./a"; void A'),
  ]);
  assert.deepEqual(result, clean);
});

test("a re-export chain entered only by tests is not exploration-only", () => {
  const result = fixture('{"entry":["components/ui/candidate.tsx!"],"ignore":[]}', [
    file("components/ui/candidate.tsx", "export const Candidate = 1"),
    file("components/ui/helper.tsx", 'export { Candidate } from "./candidate"'),
    file("components/ui/helper.test.ts", 'import { Candidate } from "./helper"; void Candidate'),
  ]);
  assert.deepEqual(result, clean);
});

test("a production screen entering a story re-export chain keeps the exemption clean", () => {
  const result = fixture('{"entry":["components/ui/candidate.tsx!"],"ignore":[]}', [
    file("components/ui/candidate.tsx", "export const Candidate = 1"),
    file("components/ui/helper.tsx", 'export { Candidate } from "./candidate"'),
    file("components/ui/helper.stories.tsx", 'import { Candidate } from "./helper"; void Candidate'),
    file("app/page.tsx", 'import { Candidate } from "@/components/ui/helper"; void Candidate'),
  ]);
  assert.deepEqual(result, clean);
});

test("an exploration-only exemption reports every direct importer in sorted order", () => {
  const result = fixture('{"entry":["components/ui/candidate.tsx!"],"ignore":[]}', [
    file("components/ui/candidate.tsx", "export const Candidate = 1"),
    file("components/ui/helper.tsx", 'export { Candidate } from "./candidate"'),
    file("components/ui/helper.stories.tsx", 'import { Candidate } from "./helper"; import "./candidate"; void Candidate'),
  ]);
  assert.deepEqual(result.unlisted, [{ pattern: "components/ui/candidate.tsx!", matches: [{ path: "components/ui/candidate.tsx", importers: ["components/ui/helper.stories.tsx", "components/ui/helper.tsx"] }] }]);
});

test("an exploration-only ignore pattern follows alias, relative and index imports", () => {
  const result = fixture('{"entry":[],"ignore":["components/ui/foo/**"]}', [
    file("components/ui/foo/index.tsx", "export const Foo = 1"),
    file("client/x/explorations/board.tsx", 'import { Foo } from "@/components/ui/foo"; void Foo'),
    file("client/x/explorations/relative.tsx", 'export { Foo } from "../../../components/ui/foo"'),
  ]);
  assert.deepEqual(result.unlisted[0].matches, [{ path: "components/ui/foo/index.tsx", importers: ["client/x/explorations/board.tsx", "client/x/explorations/relative.tsx"] }]);
});

test("production importers and zero-importer scripts are not flagged", () => {
  const result = fixture('{"entry":["components/ui/foo.tsx!","scripts/cli.ts!"],"ignore":[]}', [
    file("components/ui/foo.tsx"), file("components/ui/foo.stories.tsx", 'import "./foo"'),
    file("client/page.tsx", 'const foo = require("@/components/ui/foo"); void foo'), file("scripts/cli.ts"),
  ]);
  assert.deepEqual(result, clean);
});

test("test-only importers do not make an exemption exploration-only", () => {
  const result = fixture('{"entry":["server/cli.ts!"],"ignore":["client/harness.ts"]}', [
    file("server/cli.ts"), file("server/cli.test.ts", 'import "./cli"'),
    file("client/harness.ts"), file("client/tests/flow.test.ts", 'import "@/client/harness"'),
  ]);
  assert.deepEqual(result, clean);
});

test("malformed entry and ignore arrays fail closed before pattern filtering", () => {
  for (const config of ['{"entry":["a.tsx!",42],"ignore":[]}', '{"entry":[],"ignore":[" "]}']) {
    assert.deepEqual(fixture(config, []).invalid, ["knip.json: entry/ignore must be string arrays"]);
  }
});

test("matched paths and diagnostics are independent of source file order", () => {
  const config = '{"entry":["components/ui/*.tsx!"],"ignore":[]}';
  const files = [
    file("components/ui/b.tsx"), file("components/ui/a.tsx"),
    file("components/ui/b.stories.tsx", 'import "./b"'),
    file("components/ui/a.stories.tsx", 'import "./a"'),
  ];
  const result = fixture(config, files);
  assert.deepEqual(result.unlisted[0].matches.map((match) => match.path), ["components/ui/a.tsx", "components/ui/b.tsx"]);
  assert.deepEqual(result, fixture(config, files.toReversed()));
});

test("stale and malformed baseline entries fail", () => {
  const result = fixture('{"entry":[],"ignore":[]}', [], [{ pattern: "gone.ts!", reason: " " }, { pattern: "gone.ts!", reason: "duplicate" }]);
  assert.deepEqual(result.stale, ["gone.ts!", "gone.ts!"]);
  assert.deepEqual(result.invalid, ["gone.ts!", "gone.ts!"]);
});

test("an existing exemption becomes stale after a production consumer appears", () => {
  const config = '{"entry":["components/ui/foo.tsx!"],"ignore":[]}';
  const baseline = [{ pattern: "components/ui/foo.tsx!", reason: "story-only" }];
  const files = [file("components/ui/foo.tsx", "export const Foo = 1"), file("components/ui/foo.stories.tsx", 'import "./foo"')];
  assert.deepEqual(fixture(config, files, baseline), clean);
  files.push(file("app/page.tsx", 'export { Foo } from "@/components/ui/foo"'));
  assert.deepEqual(fixture(config, files, baseline).stale, ["components/ui/foo.tsx!"]);
});

test("literal dynamic imports count as importers", () => {
  const result = fixture('{"entry":["components/ui/foo.tsx!"],"ignore":[]}', [
    file("components/ui/foo.tsx"), file("components/ui/foo.stories.tsx", 'void import("./foo")'),
  ]);
  assert.deepEqual(result.unlisted[0].matches[0].importers, ["components/ui/foo.stories.tsx"]);
});

test("statically evaluable template dynamic imports count as story importers", () => {
  const result = fixture('{"entry":["components/ui/candidate.tsx!"],"ignore":[]}', [
    file("components/ui/candidate.tsx", "export const Candidate = 1"),
    file("components/ui/candidate.stories.tsx", 'void import(`./candidate${""}`)'),
  ]);
  assert.deepEqual(result.unlisted, [{ pattern: "components/ui/candidate.tsx!", matches: [{ path: "components/ui/candidate.tsx", importers: ["components/ui/candidate.stories.tsx"] }] }]);
});

test("unknown keys and alternate configs fail closed", () => {
  const result = evaluateKnipExemptions({ config: '{// JSONC\n"entry":[],"ignore":[],"ignoreFiles":["**/*"]}', files: [], baseline: [], packageJson: { knip: {} }, configPaths: ["knip.json", "knip.jsonc", "knip.config.ts", ".knip.json"] });
  assert.deepEqual(result.unknownKeys, ["ignoreFiles"]);
  assert.deepEqual(result.extraConfigs, [".knip.json", "knip.config.ts", "knip.jsonc", "package.json#knip"]);
});

test("extended Knip glob syntax flags a story-only exemption", () => {
  const result = fixture('{"entry":["components/ui/@(dialog|kbd).tsx!"],"ignore":[]}', [
    file("components/ui/dialog.tsx", "export const Dialog = 1"),
    file("components/ui/dialog.stories.tsx", 'import "./dialog"'),
  ]);
  assert.deepEqual(result.invalid, []);
  assert.deepEqual(result.unlisted, [{ pattern: "components/ui/@(dialog|kbd).tsx!", matches: [{ path: "components/ui/dialog.tsx", importers: ["components/ui/dialog.stories.tsx"] }] }]);
});

test("a wildcard exemption matches a dot-prefixed story-only module", () => {
  const result = fixture('{"entry":["components/ui/*.tsx!"],"ignore":[]}', [
    file("components/ui/.candidate.tsx", "export const Candidate = 1"),
    file("components/ui/.candidate.stories.tsx", 'import "./.candidate"'),
  ]);
  assert.deepEqual(result.invalid, []);
  assert.deepEqual(result.unlisted, [{ pattern: "components/ui/*.tsx!", matches: [{ path: "components/ui/.candidate.tsx", importers: ["components/ui/.candidate.stories.tsx"] }] }]);
});

test("bracket negation follows Knip's Picomatch semantics", () => {
  const result = fixture('{"entry":["components/ui/[!d]ialog.tsx!"],"ignore":[]}', [
    file("components/ui/dialog.tsx", "export const Dialog = 1"),
    file("components/ui/dialog.stories.tsx", 'import "./dialog"'),
  ]);
  assert.deepEqual(result.invalid, []);
  assert.deepEqual(result.unlisted, [{ pattern: "components/ui/[!d]ialog.tsx!", matches: [{ path: "components/ui/dialog.tsx", importers: ["components/ui/dialog.stories.tsx"] }] }]);
});

test("supported brace alternation still flags a story-only exemption", () => {
  const result = fixture('{"entry":["components/ui/{dialog,kbd}.tsx!"],"ignore":[]}', [
    file("components/ui/dialog.tsx", "export const Dialog = 1"),
    file("components/ui/kbd.tsx", "export const Kbd = 1"),
    file("components/ui/dialog.stories.tsx", 'import "./dialog"; import "./kbd"'),
  ]);
  assert.deepEqual(result.invalid, []);
  assert.deepEqual(result.unlisted, [{ pattern: "components/ui/{dialog,kbd}.tsx!", matches: [
    { path: "components/ui/dialog.tsx", importers: ["components/ui/dialog.stories.tsx"] },
    { path: "components/ui/kbd.tsx", importers: ["components/ui/dialog.stories.tsx"] },
  ] }]);
});

test("an ignore negation does not suppress an entry exemption", () => {
  const result = fixture('{"entry":["components/ui/foo.tsx!"],"ignore":["components/ui/other/**","!components/ui/foo.tsx"]}', [
    file("components/ui/foo.tsx", "export const Foo = 1"),
    file("components/ui/foo.stories.tsx", 'import "./foo"'),
  ]);
  assert.deepEqual(result.invalid, []);
  assert.deepEqual(result.unlisted, [{ pattern: "components/ui/foo.tsx!", matches: [{ path: "components/ui/foo.tsx", importers: ["components/ui/foo.stories.tsx"] }] }]);
});

test("a negation-only ignore list fails closed", () => {
  const result = fixture('{"entry":[],"ignore":["!components/ui/kept.tsx"]}', [
    file("components/ui/kept.tsx", "export const Kept = 1"),
    file("components/ui/kept.stories.tsx", 'import "./kept"'),
  ]);
  assert.deepEqual(result.unlisted, []);
  assert.deepEqual(result.invalid, ["knip.json: ignore with only negated patterns is unsupported"]);
});

test("a negated ignore pattern excludes the module it re-includes", () => {
  const result = fixture('{"entry":[],"ignore":["components/ui/**","!components/ui/kept/**"]}', [
    file("components/ui/hidden.tsx", "export const Hidden = 1"),
    file("components/ui/hidden.stories.tsx", 'import "./hidden"'),
    file("components/ui/kept/visible.tsx", "export const Visible = 1"),
    file("components/ui/kept/visible.stories.tsx", 'import "./visible"'),
  ]);
  assert.deepEqual(result.unlisted, [{ pattern: "components/ui/**", matches: [{ path: "components/ui/hidden.tsx", importers: ["components/ui/hidden.stories.tsx"] }] }]);
});

test("an entry negation excludes the file it subtracts", () => {
  const result = fixture('{"entry":["components/ui/*.tsx!","!components/ui/kept.tsx!"],"ignore":[]}', [
    file("components/ui/kept.tsx", "export const Kept = 1"),
    file("components/ui/kept.stories.tsx", 'import "./kept"'),
    file("components/ui/other.tsx", "export const Other = 1"),
    file("components/ui/other.stories.tsx", 'import "./other"'),
  ]);
  assert.deepEqual(result.invalid, []);
  assert.deepEqual(result.unlisted, [{ pattern: "components/ui/*.tsx!", matches: [{ path: "components/ui/other.tsx", importers: ["components/ui/other.stories.tsx"] }] }]);
});

test("a conditional require in a story still registers the exemption", () => {
  const result = fixture('{"entry":["components/ui/candidate.tsx!"],"ignore":[]}', [
    file("components/ui/candidate.tsx", "export const Candidate = 1"),
    file("components/ui/candidate.stories.tsx", 'void require(flag ? "./candidate" : "./other")'),
  ]);
  assert.deepEqual(result.unlisted, [{ pattern: "components/ui/candidate.tsx!", matches: [{ path: "components/ui/candidate.tsx", importers: ["components/ui/candidate.stories.tsx"] }] }]);
});

test("a logical require in a story still registers the exemption", () => {
  const result = fixture('{"entry":["components/ui/candidate.tsx!"],"ignore":[]}', [
    file("components/ui/candidate.tsx", "export const Candidate = 1"),
    file("components/ui/candidate.stories.tsx", 'void require(value || "./candidate")'),
  ]);
  assert.deepEqual(result.unlisted, [{ pattern: "components/ui/candidate.tsx!", matches: [{ path: "components/ui/candidate.tsx", importers: ["components/ui/candidate.stories.tsx"] }] }]);
});

import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { evaluateKnipExemptions, readKnipExemptionInput } from "../knip-exemptions.mjs";
import { designLane, ts } from "../knip-source.mjs";

const file = (path, content = "") => ({ path, content });
const fixture = (config, files, baseline = [], budgetMs) => evaluateKnipExemptions({ config, files, baseline, configPaths: ["knip.json"], budgetMs });
const clean = { unlisted: [], stale: [], invalid: [], unknownKeys: [], extraConfigs: [], hidden: [] };

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

test("a quoted literal ignore still reports its story-used production match", () => {
  const pattern = 'components/"ui"/*.tsx';
  const result = fixture({ entry: [], ignore: [pattern] }, [
    file("components/ui/candidate.tsx", "export const Candidate = 1"),
    file("components/ui/candidate.stories.tsx", 'import { Candidate } from "./candidate"; void Candidate'),
  ]);
  assert.deepEqual(result, {
    ...clean,
    unlisted: [{ pattern, matches: [{ path: "components/ui/candidate.tsx", importers: ["components/ui/candidate.stories.tsx"] }] }],
  });
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
  const baseline = [{ pattern: "components/ui/foo.tsx!", reason: "story-only", kind: "exploration-only" }];
  const files = [file("components/ui/foo.tsx", "export const Foo = 1"), file("components/ui/foo.stories.tsx", 'import "./foo"')];
  assert.deepEqual(fixture(config, files, baseline), clean);
  files.push(file("app/page.tsx", 'export { Foo } from "@/components/ui/foo"'));
  assert.deepEqual(fixture(config, files, baseline).stale, ["components/ui/foo.tsx!"]);
});

test("an exploration-only exemption reports its hidden import with the chain", () => {
  const result = fixture('{"entry":["components/ui/dialog.tsx!"],"ignore":[]}', [
    file("components/ui/dialog.tsx", 'import { Helper } from "./dialog-helper"; export const Dialog = Helper'),
    file("components/ui/dialog-helper.tsx", "export const Helper = 1"),
    file("components/ui/dialog.stories.tsx", 'import { Dialog } from "./dialog"; void Dialog'),
  ], [{ pattern: "components/ui/dialog.tsx!", reason: "story-only", kind: "exploration-only" }]);
  assert.deepEqual(result, { ...clean, hidden: [{ pattern: "components/ui/dialog.tsx!", path: "components/ui/dialog-helper.tsx", chain: ["components/ui/dialog.tsx", "components/ui/dialog-helper.tsx"] }] });
});

test("a two-hop hidden subtree reports each module with its own chain", () => {
  const result = fixture('{"entry":["components/ui/dialog.tsx!"],"ignore":[]}', [
    file("components/ui/dialog.tsx", 'export { Helper as Dialog } from "./wrapper"'),
    file("components/ui/wrapper.tsx", 'export { Helper } from "./helper"'),
    file("components/ui/helper.tsx", "export const Helper = 1"),
    file("components/ui/dialog.stories.tsx", 'import { Dialog } from "./dialog"; void Dialog'),
  ], [{ pattern: "components/ui/dialog.tsx!", reason: "story-only", kind: "exploration-only" }]);
  assert.deepEqual(result, { ...clean, hidden: [
    { pattern: "components/ui/dialog.tsx!", path: "components/ui/helper.tsx", chain: ["components/ui/dialog.tsx", "components/ui/wrapper.tsx", "components/ui/helper.tsx"] },
    { pattern: "components/ui/dialog.tsx!", path: "components/ui/wrapper.tsx", chain: ["components/ui/dialog.tsx", "components/ui/wrapper.tsx"] },
  ] });
});

test("a production consumer of a subtree module keeps that module out of hidden", () => {
  const result = fixture('{"entry":["components/ui/dialog.tsx!"],"ignore":[]}', [
    file("components/ui/dialog.tsx", 'export { Helper as Dialog } from "./helper"'),
    file("components/ui/helper.tsx", "export const Helper = 1"),
    file("components/ui/dialog.stories.tsx", 'import { Dialog } from "./dialog"; void Dialog'),
    file("app/page.tsx", 'import { Helper } from "@/components/ui/helper"; void Helper'),
  ], [{ pattern: "components/ui/dialog.tsx!", reason: "story-only", kind: "exploration-only" }]);
  assert.deepEqual(result, clean);
});

test("a subtree module with its own exploration-only exemption is already reviewed", () => {
  const result = fixture('{"entry":["components/ui/dialog.tsx!","components/ui/helper.tsx!"],"ignore":[]}', [
    file("components/ui/dialog.tsx", 'export { Helper as Dialog } from "./helper"'),
    file("components/ui/helper.tsx", "export const Helper = 1"),
    file("components/ui/dialog.stories.tsx", 'import { Dialog } from "./dialog"; void Dialog'),
  ], [
    { pattern: "components/ui/dialog.tsx!", reason: "story-only", kind: "exploration-only" },
    { pattern: "components/ui/helper.tsx!", reason: "story-only", kind: "exploration-only" },
  ]);
  assert.deepEqual(result, clean);
});

test("CLI and structural-contract entry subtrees stay clean without baselines", () => {
  const result = fixture('{"entry":["server/db/migrate.ts!","server/balances/price-observation-store.contract.ts!"],"ignore":[]}', [
    file("server/db/migrate.ts", 'import { Migration } from "./migration"; void Migration'),
    file("server/db/migration.ts", "export const Migration = 1"),
    file("server/balances/price-observation-store.contract.ts", 'import { Price } from "./price"; void Price'),
    file("server/balances/price.ts", "export const Price = 1"),
  ]);
  assert.deepEqual(result, clean);
});

test("test-support entries never walk their imports unlike exploration-only entries", () => {
  const config = '{"entry":[],"ignore":["shared/balances/fixtures.ts"]}';
  const files = [
    file("shared/balances/fixtures.ts", 'export { Balance as Fixture } from "./balance"'),
    file("shared/balances/balance.ts", "export const Balance = 1"),
    file("shared/balances/fixtures.stories.tsx", 'import { Fixture } from "./fixtures"; void Fixture'),
  ];
  const entry = { pattern: "shared/balances/fixtures.ts", reason: "shared fixtures", kind: "test-support" };
  assert.deepEqual(fixture(config, files, [entry]), clean);
  assert.deepEqual(fixture(config, files, [{ ...entry, kind: "exploration-only" }]), { ...clean, hidden: [{ pattern: "shared/balances/fixtures.ts", path: "shared/balances/balance.ts", chain: ["shared/balances/fixtures.ts", "shared/balances/balance.ts"] }] });
});

test("an exploration-only root reports an exploration-only module behind another kind", () => {
  const config = '{"entry":["components/ui/dialog.tsx!","shared/fixtures.ts!"],"ignore":[]}';
  const baseline = [
    { pattern: "components/ui/dialog.tsx!", reason: "story-only", kind: "exploration-only" },
    { pattern: "shared/fixtures.ts!", reason: "shared fixtures", kind: "test-support" },
  ];
  const files = [
    file("components/ui/dialog.tsx", 'import "@/shared/fixtures"; export const Dialog = 1'),
    file("shared/fixtures.ts", 'import { rows } from "./rows"; export const fixtures = rows'),
    file("shared/rows.ts", "export const rows = 1"),
    file("components/ui/dialog.stories.tsx", 'import "./dialog"; import "@/shared/fixtures"'),
  ];
  assert.deepEqual(fixture(config, files, baseline), { ...clean, hidden: [{ pattern: "components/ui/dialog.tsx!", path: "shared/rows.ts", chain: ["components/ui/dialog.tsx", "shared/fixtures.ts", "shared/rows.ts"] }] });
});

test("missing and unknown baseline kinds fail closed", () => {
  for (const kind of [undefined, null, true, false, "true", "false", "unknown"]) {
    const entry = { pattern: "server/cli.ts!", reason: "CLI entry", ...(kind === undefined ? {} : { kind }) };
    const result = fixture('{"entry":["server/cli.ts!"],"ignore":[]}', [file("server/cli.ts")], [entry]);
    assert.deepEqual(result.invalid, ["server/cli.ts!"]);
  }
});

test("non-exploration baselines are stale once their knip pattern or file is gone", () => {
  for (const kind of ["test-support", "cli-entry", "structural-contract"]) {
    const baseline = [{ pattern: "server/@(cli|contract).ts!", reason: "non-exploration entry", kind }];
    const config = '{"entry":["server/@(cli|contract).ts!"],"ignore":[]}';
    assert.deepEqual(fixture(config, [file("server/cli.ts")], baseline), clean);
    assert.deepEqual(fixture('{"entry":[],"ignore":[]}', [file("server/cli.ts")], baseline), { ...clean, stale: [baseline[0].pattern] });
    assert.deepEqual(fixture(config, [], baseline), { ...clean, stale: ["server/@(cli|contract).ts!"] });
  }
});

test("non-exploration baseline matches honor negations from their own list only", () => {
  const files = [file("server/cli.ts")];
  const entry = { pattern: "server/*.ts!", reason: "CLI entries", kind: "cli-entry" };
  const ignored = { pattern: "server/*.ts", reason: "test support", kind: "test-support" };
  assert.deepEqual(fixture('{"entry":["server/*.ts!"],"ignore":["other/**","!server/cli.ts"]}', files, [entry]), clean);
  assert.deepEqual(fixture('{"entry":["server/*.ts!","!server/cli.ts!"],"ignore":[]}', files, [entry]), { ...clean, stale: [entry.pattern] });
  assert.deepEqual(fixture('{"entry":["!server/cli.ts!"],"ignore":["server/*.ts"]}', files, [ignored]), clean);
  assert.deepEqual(fixture('{"entry":[],"ignore":["server/*.ts","!server/cli.ts"]}', files, [ignored]), { ...clean, stale: [ignored.pattern] });
});

test("hidden imports include side effects, dynamic imports, require and type queries", () => {
  for (const content of ['import "./helper"', 'void import("./helper")', 'void require("./helper")', 'type Helper = typeof import("./helper")']) {
    const result = fixture('{"entry":["components/ui/dialog.tsx!"],"ignore":[]}', [
      file("components/ui/dialog.tsx", content),
      file("components/ui/helper.tsx", "export const Helper = 1"),
      file("components/ui/dialog.stories.tsx", 'import "./dialog"'),
    ], [{ pattern: "components/ui/dialog.tsx!", reason: "story-only", kind: "exploration-only" }]);
    assert.deepEqual(result, { ...clean, hidden: [{ pattern: "components/ui/dialog.tsx!", path: "components/ui/helper.tsx", chain: ["components/ui/dialog.tsx", "components/ui/helper.tsx"] }] });
  }
});

test("a JSDoc @import edge reaches the module it names", () => {
  for (const clause of ['{ Helper }', "Helper", "* as Helper"]) {
    const result = fixture('{"entry":["components/ui/dialog.js!"],"ignore":[]}', [
      file("components/ui/dialog.js", `/** @import ${clause} from "./helper.js" */\nexport const Dialog = 1`),
      file("components/ui/helper.ts", "export const Helper = 1"),
      file("components/ui/dialog.stories.tsx", 'import "./dialog"'),
    ], [{ pattern: "components/ui/dialog.js!", reason: "story-only", kind: "exploration-only" }]);
    assert.deepEqual(result, { ...clean, hidden: [{ pattern: "components/ui/dialog.js!", path: "components/ui/helper.ts", chain: ["components/ui/dialog.js", "components/ui/helper.ts"] }] });
  }
});

test("a story JSDoc @import registers as the importer it names", () => {
  const result = fixture('{"entry":["components/ui/foo.tsx!"],"ignore":[]}', [
    file("components/ui/foo.tsx", "export const Foo = 1"),
    file("components/ui/foo.stories.js", '/** @import { Foo } from "./foo.js" */\nvoid Foo'),
  ]);
  assert.deepEqual(result.unlisted, [{ pattern: "components/ui/foo.tsx!", matches: [{ path: "components/ui/foo.tsx", importers: ["components/ui/foo.stories.js"] }] }]);
});

test("a JSDoc @import without a resolvable module reference adds no edge", () => {
  for (const tag of ['/** @import "./helper.js" */', '/** @import { Helper } from `./helper.js` */']) {
    const result = fixture('{"entry":["components/ui/dialog.js!"],"ignore":[]}', [
      file("components/ui/dialog.js", `${tag}\nexport const Dialog = 1`),
      file("components/ui/helper.ts", "export const Helper = 1"),
      file("components/ui/dialog.stories.tsx", 'import "./dialog"'),
    ], [{ pattern: "components/ui/dialog.js!", reason: "story-only", kind: "exploration-only" }]);
    assert.deepEqual(result, clean);
  }
});

test("a TypeScript import-equals edge reaches the module it names", () => {
  for (const declaration of ['import Helper = require("./helper")', 'import type Helper = require("./helper")']) {
    const result = fixture('{"entry":["components/ui/dialog.ts!"],"ignore":[]}', [
      file("components/ui/dialog.ts", `${declaration};\nexport const Dialog = 1`),
      file("components/ui/helper.ts", "export const Helper = 1"),
      file("components/ui/dialog.stories.tsx", 'import "./dialog"'),
    ], [{ pattern: "components/ui/dialog.ts!", reason: "story-only", kind: "exploration-only" }]);
    assert.deepEqual(result, { ...clean, hidden: [{ pattern: "components/ui/dialog.ts!", path: "components/ui/helper.ts", chain: ["components/ui/dialog.ts", "components/ui/helper.ts"] }] });
  }
});

test("hidden traversal is deterministic, cycle-safe and reports shared modules once", () => {
  const config = '{"entry":["components/ui/z.tsx!","components/ui/a.tsx!"],"ignore":[]}';
  const baseline = [
    { pattern: "components/ui/z.tsx!", reason: "story-only", kind: "exploration-only" },
    { pattern: "components/ui/a.tsx!", reason: "story-only", kind: "exploration-only" },
  ];
  const files = [
    file("components/ui/z.tsx", 'import "./helper"'),
    file("components/ui/a.tsx", 'import "./wrapper"; import "./helper"; import "./helper"'),
    file("components/ui/wrapper.tsx", 'import "./helper"'),
    file("components/ui/helper.tsx", 'import "./a"'),
    file("components/ui/board.stories.tsx", 'import "./z"; import "./a"'),
  ];
  const expected = { ...clean, hidden: [
    { pattern: "components/ui/a.tsx!", path: "components/ui/helper.tsx", chain: ["components/ui/a.tsx", "components/ui/helper.tsx"] },
    { pattern: "components/ui/a.tsx!", path: "components/ui/wrapper.tsx", chain: ["components/ui/a.tsx", "components/ui/wrapper.tsx"] },
  ] };
  assert.deepEqual(fixture(config, files, baseline), expected);
  assert.deepEqual(fixture(config, files.toReversed(), baseline.toReversed()), expected);
});

test("negated subtree exemptions do not hide an unreviewed module", () => {
  const files = [
    file("components/ui/dialog.tsx", 'import "./helper"'),
    file("components/ui/helper.tsx"),
    file("components/ui/dialog.stories.tsx", 'import "./dialog"'),
  ];
  const root = { pattern: "components/ui/dialog.tsx!", reason: "story-only", kind: "exploration-only" };
  const helper = { pattern: "components/ui/helper.tsx!", reason: "story-only", kind: "exploration-only" };
  assert.deepEqual(fixture('{"entry":["components/ui/dialog.tsx!","components/ui/helper.tsx!","!components/ui/helper.tsx!"],"ignore":[]}', files, [root, helper]), { ...clean,
    stale: [helper.pattern],
    hidden: [{ pattern: root.pattern, path: "components/ui/helper.tsx", chain: ["components/ui/dialog.tsx", "components/ui/helper.tsx"] }],
  });
  assert.deepEqual(fixture('{"entry":["components/ui/dialog.tsx!","components/ui/helper.tsx!"],"ignore":["other/**","!components/ui/helper.tsx"]}', files, [root, helper]), clean);
  const ignored = { ...helper, pattern: "components/ui/helper.tsx" };
  assert.deepEqual(fixture('{"entry":["components/ui/dialog.tsx!","!components/ui/helper.tsx!"],"ignore":["components/ui/helper.tsx"]}', files, [root, ignored]), clean);
  assert.deepEqual(fixture('{"entry":["components/ui/dialog.tsx!"],"ignore":["components/ui/helper.tsx","!components/ui/helper.tsx"]}', files, [root, ignored]), { ...clean,
    stale: [ignored.pattern],
    hidden: [{ pattern: root.pattern, path: "components/ui/helper.tsx", chain: ["components/ui/dialog.tsx", "components/ui/helper.tsx"] }],
  });
});

test("hidden traversal does not cross a story or test module", () => {
  for (const bridge of ["bridge.stories.tsx", "bridge.test.tsx"]) {
    const result = fixture('{"entry":["components/ui/dialog.tsx!"],"ignore":[]}', [
      file("components/ui/dialog.tsx", `import "./${bridge}"`),
      file(`components/ui/${bridge}`, 'import "./helper"'),
      file("components/ui/helper.tsx"),
      file("components/ui/dialog.stories.tsx", 'import "./dialog"'),
    ], [{ pattern: "components/ui/dialog.tsx!", reason: "story-only", kind: "exploration-only" }]);
    assert.deepEqual(result, clean);
  }
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

test("a star-heavy exemption exhausts its budget without stalling the gate", { timeout: 5000 }, () => {
  const basename = "a".repeat(39) + "c";
  const files = [
    file(`components/ui/${basename}.tsx`, "export const Row = 1"),
    file(`components/ui/${basename}.stories.tsx`, `import { Row } from "./${basename}"; void Row`),
  ];
  assert.deepEqual(fixture('{"entry":["components/ui/*.tsx!"],"ignore":[]}', files).unlisted, [{
    pattern: "components/ui/*.tsx!",
    matches: [{ path: `components/ui/${basename}.tsx`, importers: [`components/ui/${basename}.stories.tsx`] }],
  }]);
  for (const pattern of [
    "components/ui/*a*a*a*a*a*a*a*a*a*a*b.tsx",
    "components/ui/a*a*a*a*a*a*a*a*a*a*a*b.tsx",
    "components/ui/?*a*a*a*a*a*a*a*a*a*a*b.tsx",
  ]) {
    const start = performance.now();
    const result = fixture({ entry: [`${pattern}!`], ignore: [] }, files, [], 1000);
    assert.ok(performance.now() - start < 3000, pattern);
    assert.deepEqual(result, {
      ...clean,
      invalid: [`knip.json: pattern "${pattern}" exceeded the 1000 ms pattern evaluation budget`],
    }, pattern);
  }
});

test("degenerate ignore syntax is reported even without source paths", () => {
  const result = fixture('{"entry":[],"ignore":["[z-a]","a{b"]}', []);
  assert.deepEqual(result.invalid.length, 2);
  assert.match(result.invalid[0], /^knip\.json: pattern "\[z-a\]" cannot be compiled: /);
  assert.match(result.invalid[1], /^knip\.json: pattern "a\{b" cannot be compiled: /);
  assert.deepEqual(result.unlisted, []);
  assert.deepEqual(result.stale, []);
});

test("refused entry and ignore negations are reported once and skipped", () => {
  const glob = "components/ui/[z-a].tsx";
  const result = fixture({
    entry: ["components/ui/*.tsx!", `!${glob}!`],
    ignore: ["components/ui/**", `!${glob}`, "!components/ui/kept.tsx"],
  }, [
    file("components/ui/row.tsx", "export const Row = 1"),
    file("components/ui/row.stories.tsx", 'import "./row"'),
    file("components/ui/kept.tsx", "export const Kept = 1"),
    file("components/ui/kept.stories.tsx", 'import "./kept"'),
  ]);
  assert.equal(result.invalid.length, 1);
  assert.match(result.invalid[0], /^knip\.json: pattern "components\/ui\/\[z-a\]\.tsx" cannot be compiled: /);
  assert.deepEqual(result.stale, []);
  assert.deepEqual(result.unlisted, [
    { pattern: "components/ui/**", matches: [{ path: "components/ui/row.tsx", importers: ["components/ui/row.stories.tsx"] }] },
    { pattern: "components/ui/*.tsx!", matches: [
      { path: "components/ui/kept.tsx", importers: ["components/ui/kept.stories.tsx"] },
      { path: "components/ui/row.tsx", importers: ["components/ui/row.stories.tsx"] },
    ] },
  ].sort((a, b) => a.pattern.localeCompare(b.pattern)));
});

test("five-run patterns are evaluated normally and star-heavy ones are reported", { timeout: 5000 }, () => {
  const files = [
    file("components/ui/aaab.tsx", "export const Row = 1"),
    file("components/ui/aaab.stories.tsx", 'import "./aaab"'),
  ];
  const result = fixture({
    entry: ["components/ui/*a*a*a*b*.tsx!"],
    ignore: [],
  }, files, [], 5000);
  assert.deepEqual(result, {
    ...clean,
    unlisted: [{
      pattern: "components/ui/*a*a*a*b*.tsx!",
      matches: [{ path: "components/ui/aaab.tsx", importers: ["components/ui/aaab.stories.tsx"] }],
    }],
  });
  const basename = "a".repeat(39) + "c";
  const pathological = "components/ui/*a*a*a*a*a*a*a*a*a*a*b.tsx";
  const limited = fixture({ entry: [], ignore: [pathological] }, [
    file(`components/ui/${basename}.tsx`),
    file(`components/ui/${basename}.stories.tsx`, `import "./${basename}"`),
  ], [], 1000);
  assert.deepEqual(limited, {
    ...clean,
    invalid: [`knip.json: pattern "${pathological}" exceeded the 1000 ms pattern evaluation budget`],
  });
});

test("literalized extglobs and unsupported brace ranges report invalid exemptions", () => {
  for (const syntax of ["+(a|aa)", "*(a|aa)", "+(ab|)", "+(*(ab))", "+(a|*)", "{10..12}", "{a..z..2}"]) {
    const pattern = `components/ui/${syntax}.tsx`;
    const result = fixture({ entry: [], ignore: [pattern] }, [
      file("components/ui/a.tsx"), file("components/ui/a.stories.tsx", 'import "./a"'),
    ]);
    assert.equal(result.invalid.length, 1, syntax);
    assert.ok(result.invalid[0].startsWith(`knip.json: pattern ${JSON.stringify(pattern)} cannot be interpreted: `), syntax);
    assert.deepEqual(result.unlisted, []);
    assert.deepEqual(result.stale, []);
    assert.equal(fixture({ entry: [], ignore: [pattern] }, []).invalid.length, 1, syntax);
  }
});

test("quoted suffix ranges are invalid with no paths and with wrong runtime matches", () => {
  for (const [syntax, basename] of [['{10..12}"x"', "1"], ['{a..z..2}"x"', "2"]]) {
    const pattern = `components/ui/${syntax}.tsx`;
    for (const files of [[], [
      file(`components/ui/${basename}.tsx`),
      file(`components/ui/${basename}.stories.tsx`, `import "./${basename}"`),
    ]]) {
      const result = fixture({ entry: [], ignore: [pattern] }, files);
      assert.deepEqual(result, {
        ...clean,
        invalid: [`knip.json: pattern ${JSON.stringify(pattern)} cannot be interpreted: brace ranges require single-character endpoints and no step`],
      });
    }
  }
});

test("interpreted extglobs and single-character ranges remain matched and unreported", () => {
  for (const [syntax, basename] of [["@(a|b)", "a"], ["!(a)", "b"], ["+(a)", "a"], ["*(a)", "a"], ["+(*(a))", "aaa"], ["+(*(a)|*(b))", "abba"], ["{1..3}", "2"], ["{a..z}", "b"]]) {
    const pattern = `components/ui/${syntax}.tsx`;
    const result = fixture({ entry: [], ignore: [pattern] }, [
      file(`components/ui/${basename}.tsx`), file(`components/ui/${basename}.stories.tsx`, `import "./${basename}"`),
    ]);
    assert.deepEqual(result.invalid, [], syntax);
    assert.equal(result.unlisted.length, 1, syntax);
    assert.equal(result.unlisted[0].matches[0].path, `components/ui/${basename}.tsx`, syntax);
    assert.deepEqual(fixture({ entry: [], ignore: [pattern] }, [
      file(`components/ui/${basename}.tsx`), file(`components/ui/${basename}.stories.tsx`, `import "./${basename}"`),
    ], [{ pattern, reason: "story-only", kind: "exploration-only" }]), clean, syntax);
  }
});

test("an exact literal with an unbalanced brace preserves its reasoned baseline", () => {
  const pattern = "components/ui/a{b.tsx";
  const config = { entry: [`${pattern}!`], ignore: [] };
  const baseline = [{ pattern: `${pattern}!`, reason: "story-only", kind: "exploration-only" }];
  const files = [file(pattern), file("components/ui/a{b.stories.tsx", 'import "./a{b"')];
  assert.deepEqual(fixture(config, files, baseline), clean);
  assert.equal(fixture(config, []).invalid.length, 1);
  const absent = fixture(config, [file("components/ui/a.tsx"), file("components/ui/a.stories.tsx", 'import "./a"')], baseline);
  assert.equal(absent.invalid.length, 1);
  assert.deepEqual(absent.stale, [`${pattern}!`]);
});

test("a degraded pattern is refused even when a production file is named like it", () => {
  const pattern = "components/ui/{10..12}.tsx";
  const result = fixture({ entry: [], ignore: [pattern] }, [
    file(pattern, "export const Literal = 1"),
    file("components/ui/1.tsx", "export const One = 1"),
    file("components/ui/1.stories.tsx", 'import "./1"'),
  ]);
  assert.deepEqual(result, {
    ...clean,
    invalid: [`knip.json: pattern ${JSON.stringify(pattern)} cannot be interpreted: brace ranges require single-character endpoints and no step`],
  });
});

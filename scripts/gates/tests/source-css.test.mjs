import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { collectSourceCssFindings, importantAllowlist } from "../source-css.mjs";
import { loadSourceFiles } from "../source-files.mjs";

const check = (path, content) => collectSourceCssFindings([{ path, content }]);

test("root subjects fail in product layers even within explorations and story files, but workshop stories are excluded", () => {
  for (const path of ["app/globals.css", "components/explorations/demo.css", "client/demo.stories.css"]) {
    assert.deepEqual(check(path, '@layer base { html[data-x].dark:has(>a), body:has(.x) { color: red } }').map((finding) => finding.kind), ["root", "root"]);
  }
  assert.deepEqual(check("stories/review/explorations/board.module.css", "html:has(.x) { color: red }"), []);
  assert.deepEqual(check("app/globals.css", ".field:has(>input) { color: red }"), []);
  assert.deepEqual(check("client/feature.css", "html:not(.embed):has(>main) { color: red }").map((finding) => finding.kind), ["root"]);
  assert.deepEqual(check("client/feature.css", ":ROOT:has(>main) { color: red }").map((finding) => finding.kind), ["root"]);
  assert.deepEqual(check("client/feature.css", ":is(html):has(.x) { color: red }"), [
    { path: "client/feature.css", kind: "root", selector: ":is(html):has(.x)" },
  ]);
  assert.deepEqual(check("client/feature.css", ":has(>main):root { color: red }").map((finding) => finding.kind), ["root"]);
  assert.deepEqual(check("client/feature.css", ":has(>main):is(html) { color: red }").map((finding) => finding.kind), ["root"]);
});

test("important is rejected in product CSS only; quoted and commented tokens are ignored", () => {
  assert.deepEqual(check("client/demo.css", ".a { color: red !important; }").map((finding) => finding.kind), ["important"]);
  for (const path of ["components/explorations/demo.css", "components/demo.stories.css", "stories/demo.css"]) {
    assert.deepEqual(check(path, ".a { color: red !important; }"), []);
  }
  assert.deepEqual(check("app/strings.css", '.a::after { content: "!important"; color: red /* !important */; }'), []);
  assert.deepEqual(check("app/globals.css", importantAllowlist[0].text), []);
  assert.deepEqual(check("app/globals.css", `${importantAllowlist[0].text}\n.a { color: red !important }`).map((finding) => finding.kind), ["important"]);
});

test("story exemptions and @apply important modifiers are exact", () => {
  assert.deepEqual(check("components/fixture.stories.fake.css", ".a { color: red !important; }").map((finding) => finding.kind), ["important"]);
  assert.deepEqual(check("components/fixture.story.css", ".a { color: red !important; }").map((finding) => finding.kind), ["important"]);
  for (const path of ["components/fixture.stories.css", "components/fixture.stories.module.css", "stories/demo.css"]) {
    assert.deepEqual(check(path, ".a { color: red !important; }"), [], path);
  }
  for (const css of [".a { @apply !p-4; }", ".a { @apply p-4!; }", ".a { @apply hover:!p-4; }"]) {
    assert.deepEqual(check("client/demo.css", css).map((finding) => finding.kind), ["important"], css);
  }
  assert.deepEqual(check("client/demo.css", ".a { @apply content-['!important']; }"), []);
  assert.deepEqual(check("client/demo.css", ".a { @apply p-4 [color:red!important]; }").map((finding) => finding.kind), ["important"]);
  assert.deepEqual(check("components/explorations/demo.css", ".a { @apply !p-4; }"), []);
});

test("an unterminated @apply still reports its important modifier", () => {
  for (const css of [".a { @apply !p-4 }", ".a { @apply p-4! }", ".a { @apply hover:!p-4 }"]) {
    assert.deepEqual(check("client/demo.css", css).map((finding) => finding.kind), ["important"], css);
  }
  assert.deepEqual(check("client/demo.css", "/* @apply p-4! */\n.a { color: red }"), []);
  assert.deepEqual(check("client/demo.css", ".a::after { content: '@apply p-4!' }"), []);
});

test("a brace inside an arbitrary value does not end an @apply body", () => {
  for (const css of [".a { @apply content-[\\}] p-4! }", ".a { @apply content-['}'] p-4! }", ".😀{content:'😀';@apply p-4!}"]) {
    assert.deepEqual(check("client/demo.css", css).map((finding) => finding.kind), ["important"], css);
  }
});

test("escapes, quoted brackets and commented tokens do not confuse an @apply body", () => {
  for (const css of [".a { content: \\[; @apply p-4! bg-(--missing-token); }", ".a { @apply content-['['] p-4!; }"]) {
    assert.deepEqual(check("client/demo.css", css).map((finding) => finding.kind), ["important"], css);
  }
  assert.deepEqual(check("client/demo.css", ".a { @apply p-4 /* p-4! */; }"), []);
});

test("the real source CSS tree passes the CSS selector and important guards", async () => {
  const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
  const files = await loadSourceFiles(`${repoRoot}/apps/web`, { extensions: [".css"] });
  assert.ok(files.some(({ path }) => path === "app/globals.css"));
  assert.ok(files.some(({ path }) => path.startsWith("components/")));
  assert.deepEqual(collectSourceCssFindings(files), []);
});

test("important is detected through CSS escapes, case and comments", () => {
  for (const css of [String.raw`.a { color: red !imp\6f rtant }`, String.raw`.a { color: red !\69mportant; }`, String.raw`.a { color: red ! /* x */ IMPORT\41 NT }`, String.raw`.a { color: red !i\mportant }`]) {
    assert.deepEqual(check("client/demo.css", css).map((finding) => finding.kind), ["important"], css);
  }
  assert.deepEqual(check("client/demo.css", String.raw`.a { color: red !importantx; } .b { content: "!imp\6f rtant" }`), []);
  assert.deepEqual(check("client/demo.css", String.raw`:scope:has(>main) { color: red } @scope (.card) { :scope:has(>main) { color: red } }`).map((finding) => finding.kind), ["root"]);
});

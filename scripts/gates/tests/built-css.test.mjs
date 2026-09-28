import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { checkBuiltCss, collectBuiltCssFindings, firstClassBeforeHas, isHasClassToken } from "../built-css.mjs";

const allowed = new Map([
  ["components/ui/field.tsx", 'className="has-[:focus-visible]:border-ring group/field has-[>[data-slot=field]]:w-full"'],
  ["components/ui/combobox.tsx", 'className="group-has-data-[slot=combobox-clear]/input-group:hidden"'],
  ["components/ui/input-group.tsx", 'className="group/input-group"'],
]);
const find = (css) => collectBuiltCssFindings([{ path: "static/chunks/test.css", content: css }], allowed);

test("built CSS rejects root anchors and disallowed descendants in lists and wrappers", () => {
  const css = '@layer utilities{@media (hover:hover){@supports (display:grid){html.dark:has(>a),body[data-state=x]:has(.x),html:not(.embed):has(>main){color:red}:ROOT:has(>main){color:red}:has(>main):root{color:red}:has(>main):is(html){color:red}.outsider:has(input){padding:0}.parent{&:has(.x){color:red}}}}}';
  assert.deepEqual(find(css).map(({ kind }) => kind), ["root", "root", "root", "root", "root", "root", "descendant", "descendant"]);
  assert.deepEqual(find(".a:has(>input){color:red}"), []);
});

test("only exact CSS-unescaped first class tokens in form-control sources are allowed", () => {
  const css = String.raw`.has-\[\:focus-visible\]\:border-ring:has(:focus-visible){color:red}:is(:where(.group\/field):has(input) *){display:flex}.other:has(input){padding:0}.module_field__hash:has(input){color:red}`;
  assert.deepEqual(find(css).map(({ selector }) => selector), [".other:has(input)", ".module_field__hash:has(input)"]);
  assert.equal(firstClassBeforeHas({ selector: String.raw`.has-\[\3e input\]\:p-0:has(input)`, index: String.raw`.has-\[\3e input\]\:p-0`.length }), "has-[>input]:p-0");
  assert.deepEqual(find(".has-\\[\\:focus-visible\\]\\:border-ringx:has(input){color:red}").map(({ kind }) => kind), ["descendant"]);
  assert.deepEqual(find('.parent{&:has(.group\\/field){color:red}}').map(({ kind }) => kind), ["descendant"]);
  assert.deepEqual(find('.group\\/field:has(input),.outsider:has(input){color:red}').map(({ selector }) => selector), [".outsider:has(input)"]);
  const allowedGroup = String.raw`.group\/field:has(input)`;
  const outsiderAfterGroup = String.raw`.group\/field .outsider:has(input)`;
  assert.deepEqual(find(`${allowedGroup}{color:red}`), []);
  assert.deepEqual(find(`${outsiderAfterGroup}{color:red}`).map(({ kind, selector }) => ({ kind, selector })),
    [{ kind: "descendant", selector: outsiderAfterGroup }]);
  assert.equal(firstClassBeforeHas({ selector: outsiderAfterGroup, index: outsiderAfterGroup.indexOf(":has(") }), "outsider");
  for (const selector of [
    String.raw`:is(.group\/field .outsider:has(input))`,
    String.raw`:where(.group\/field, .outsider:has(input))`,
    String.raw`.group\/field:is(.outsider:has(input))`,
    String.raw`:is(.group\/field, :has(input))`,
    String.raw`/* .group\/field */.outsider:has(input)`,
  ]) {
    assert.deepEqual(find(`${selector}{color:red}`).map(({ kind }) => kind), ["descendant"], selector);
  }
  assert.deepEqual(find(String.raw`:is(:where(.group\/field):has(input) *){color:red}`), []);
  assert.deepEqual(find(String.raw`.group\/field:is(:has(input)){color:red}`), []);
});

test("only an owner class, including a single-compound :is or :where, can allow a descendant", () => {
  for (const selector of [
    String.raw`:is(.group\/field, .outsider):has(input)`,
    String.raw`:not(.group\/field):has(input)`,
    String.raw`:where(.group\/field .outsider):has(input)`,
    String.raw`:is([data-title="not ) > .x"] .group\/field):has(input)`,
    String.raw`:not(.group\/field).outsider:has(input)`,
  ]) {
    assert.deepEqual(find(`${selector}{color:red}`).map(({ kind }) => kind), ["descendant"], selector);
  }
  for (const selector of [
    String.raw`:where(.group\/field):has(input)`,
    String.raw`:is(:where(.group\/field):has(input) *)`,
    String.raw`.group\/field:not(/*note*/:has(input))`,
    String.raw`:where(.group\2f field):has(input)`,
    String.raw`:where([data-title="not ) > .x"].group\/field):has(input)`,
  ]) {
    assert.deepEqual(find(`${selector}{color:red}`), [], selector);
  }
});

test("Tailwind/Next minified CSS shape with escaped utility, group ancestor and nested wrappers", () => {
  const css = String.raw`@layer utilities{.group-has-data-\[slot\=combobox-clear\]\/input-group\:hidden:is(:where(.group\/input-group):has([data-slot=combobox-clear]) *){display:none}@media (width>=48rem){:is(:where(.group\/field):has(input) *){text-wrap:balance}}.has-\[\>input\]\:p-0:has(>input){padding:0}}`;
  assert.deepEqual(find(css), []);
});

test("functional pseudo-class subjects keep the reviewed outer field utility, but not an unreviewed one", () => {
  const token = "has-[>[data-slot=field]]:not-has-[:disabled,[data-disabled]]:hover:bg-muted/50";
  const selector = String.raw`.has-\[\>\[data-slot\=field\]\]\:not-has-\[\:disabled\,\[data-disabled\]\]\:hover\:bg-muted\/50:has(>[data-slot=field]):not(:has(:is(:disabled,[data-disabled]))):hover`;
  const css = `${selector}{color:red}`;
  assert.deepEqual(find(css).map(({ kind }) => kind), ["descendant"]);
  const reviewed = new Map(allowed);
  reviewed.set("components/ui/field.tsx", `className="${token}"`);
  assert.deepEqual(collectBuiltCssFindings([{ path: "static/chunks/test.css", content: css }], reviewed), []);
});

test("empty emitted CSS fails, including the CLI exit code", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "home-css-gate-"));
  try {
    await assert.rejects(checkBuiltCss(dir), /No built CSS found/);
    const cli = fileURLToPath(new URL("../built-css.mjs", import.meta.url));
    const result = spawnSync(process.execPath, [cli, dir], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /No built CSS found/);
    await writeFile(path.join(dir, "empty.css"), "");
    await assert.rejects(checkBuiltCss(dir), /No built CSS found/);
    const empty = spawnSync(process.execPath, [cli, dir], { encoding: "utf8" });
    assert.equal(empty.status, 1);
    assert.match(empty.stderr, /No built CSS found/);
    await writeFile(path.join(dir, "bad.css"), ".bad:has(.x){color:red}");
    const violation = spawnSync(process.execPath, [cli, dir], { encoding: "utf8" });
    assert.equal(violation.status, 1);
    assert.match(violation.stderr, /bad.css: descendant :has\(\) in .bad:has\(.x\)/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("development and cache output never counts as built product CSS", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "home-css-gate-"));
  try {
    for (const stale of ["dev/static/chunks", "cache/css"]) {
      await mkdir(path.join(dir, stale), { recursive: true });
      await writeFile(path.join(dir, stale, "stale.css"), "body:has(.x) .y{color:red}");
    }
    await assert.rejects(checkBuiltCss(dir), /No built CSS found/);
    await mkdir(path.join(dir, "static/chunks"), { recursive: true });
    await writeFile(path.join(dir, "static/chunks/app.css"), ".ok{color:red}");
    const clean = await checkBuiltCss(dir);
    assert.deepEqual(clean.files.map(({ path: file }) => file), ["static/chunks/app.css"]);
    assert.deepEqual(clean.findings, []);
    await mkdir(path.join(dir, "static/dev"), { recursive: true });
    await writeFile(path.join(dir, "static/dev/nested.css"), "body:has(.x) .y{color:red}");
    assert.deepEqual((await checkBuiltCss(dir)).findings.map(({ path: file }) => file), ["static/dev/nested.css"]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("allowlisted sources contribute only has-variant utilities and group markers, not arbitrary strings", () => {
  const sources = new Map([["components/ui/field.tsx", 'import * as React from "react";\nconst slot = "field-label";\nclassName="group/field has-data-checked:border-primary/30"']]);
  const css = ".react:has(input){color:red}.field-label:has(input){color:red}.has-data-checked\\:border-primary\\/30:has([data-checked]){color:red}:is(:where(.group\\/field):has(input) *){display:flex}";
  assert.deepEqual(collectBuiltCssFindings([{ path: "a.css", content: css }], sources).map(({ selector }) => selector), [".react:has(input)", ".field-label:has(input)"]);
  for (const token of ["has-[>svg]:p-0", "group-has-[[aria-invalid=true]]/otp:ring-3", "@md/field-group:has-[>x]:items-start", "not-has-[:disabled]:hover:bg-muted/50", "[&:has(input)]:p-0", "group/field", "peer/field-label"]) {
    assert.equal(isHasClassToken(token), true, token);
  }
  for (const token of ["react", "field-label", "has-flag", "group", "horizontal", "./field"]) assert.equal(isHasClassToken(token), false, token);
});

test("built CSS catches nested root wrappers, top-level :scope and escaped root spellings", () => {
  assert.deepEqual(find(String.raw`:is(:where(html)):has(>main){color:red}:scope:has(>main){color:red}ht\6dl:has(>a){color:red}@scope (.card){:scope:has(>a){color:red}}`).map(({ kind }) => kind), ["root", "root", "root"]);
});

test("built CSS inspects scope-start and scope-end root selectors without treating local :scope as root", () => {
  const css = "@scope (html:has(>main)) {.a{color:red}}@scope (.card) to (body:has(.x)){.a{color:red}}@scope (.card){:scope:has(>a){color:red}}";
  assert.deepEqual(find(css).map(({ kind, selector }) => ({ kind, selector })), [
    { kind: "root", selector: "html:has(>main)" },
    { kind: "root", selector: "body:has(.x)" },
  ]);
});

test("arbitrary has variants must start the token or follow a variant boundary, and hex escapes end only at CSS whitespace", () => {
  assert.equal(isHasClassToken("prefix[&:has(input)]:p-0"), false);
  assert.equal(isHasClassToken("md:[&:has(input)]:p-0"), true);
  const sources = new Map([["components/ui/field.tsx", 'className="group/field prefix[&:has(input)]:p-0"']]);
  const css = ".prefix\\[\\&\\:has\\(input\\)\\]\\:p-0:has(input){color:red}.group\\2f\u00a0field:has(input){color:red}.group\\2f field:has(input){color:red}";
  assert.deepEqual(collectBuiltCssFindings([{ path: "a.css", content: css }], sources).map(({ selector }) => selector),
    [".prefix\\[\\&\\:has\\(input\\)\\]\\:p-0:has(input)", ".group\\2f\u00a0field:has(input)"]);
});

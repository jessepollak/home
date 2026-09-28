import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { evaluateUnusedDeclaredTokens } from "../css-custom-properties.mjs";
import { inventoryGlobalsCss } from "../globals-css-allowlist.mjs";
import { loadSourceFiles } from "../source-files.mjs";

const cssUrl = new URL("../../../apps/web/app/globals.css", import.meta.url);
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const source = () => loadSourceFiles(`${repoRoot}/apps/web`, { extensions: [".css", ".ts", ".tsx", ".js", ".jsx", ".mjs"] });
const evaluate = (css, files, allowlist = []) => evaluateUnusedDeclaredTokens({ inventory: inventoryGlobalsCss(css), files, allowlist });
const clean = { unused: [], staleAllowlist: [], invalidAllowlist: [] };

test("all declared globals.css tokens have a source reference", async () => {
  const css = await readFile(cssUrl, "utf8");
  const files = await source();
  assert.ok(files.some(({ path }) => path === "app/globals.css"));
  assert.deepEqual(evaluate(css, files), clean);
});

test("commented-out JS references do not keep declared tokens live", () => {
  const css = ":root { --orphan: red; }";
  const story = { path: "components/probe.stories.tsx", content: "// var(--orphan)" };
  assert.deepEqual(evaluate(css, [story]).unused, ["--orphan"]);
  assert.deepEqual(evaluate(css, [{ ...story, content: 'const color = "var(--orphan)";' }]), clean);
});

test("commented-out CSS var() and @apply do not keep tokens live", () => {
  const css = "@theme inline { --color-example: red; } :root { --x: red; }";
  const stylesheet = { path: "components/probe.css", content: "/* var(--x); @apply bg-example; */" };
  assert.deepEqual(evaluate(css, [stylesheet]).unused, ["--color-example", "--x"]);
  assert.deepEqual(evaluate(css, [{ ...stylesheet, content: ".x { color: var(--x); @apply bg-example; }" }]), clean);
});

test("theme classes do not keep root-only tokens live", () => {
  const css = ":root { --color-orphan: red; }";
  const story = { path: "components/probe.stories.tsx", content: 'const classes = "bg-orphan";' };
  assert.deepEqual(evaluate(css, [story]).unused, ["--color-orphan"]);
  assert.deepEqual(evaluate(css, [{ ...story, content: 'const classes = "bg-orphan"; const color = "var(--color-orphan)";' }]), clean);
});

test("a new declaration without references fails, including a nested declaration", async () => {
  const css = await readFile(cssUrl, "utf8");
  const files = await source();
  assert.deepEqual(evaluate(css.replace("@theme inline {", "@theme inline { --color-orphan: red;"), files).unused, ["--color-orphan"]);
  assert.deepEqual(evaluate(css.replace("@supports (height: 100dvh) {\n  :root {", "@supports (height: 100dvh) {\n  :root { --nested-orphan: 0;"), files).unused, ["--nested-orphan"]);
});

test("var() and theme utilities in CSS and static class strings count as references", () => {
  const css = `@theme inline { --color-example: red; --font-example: sans-serif; --radius-example: 1rem; --spacing-example: 2px; --text-example: 2rem; --shadow-example: 0 1px black; }
:root { --root-example: blue; }
.dark { --root-example: green; }
@supports (height: 100dvh) { :root { --support-example: 1px; } }
@media (display-mode: standalone) { :root { --media-example: 1px; } }`;
  const files = [
    { path: "app/globals.css", content: "@layer base { body { @apply bg-example; } }" },
    { path: "components/probe.tsx", content: 'const classes = "hover:text-example font-example rounded-example px-example text-example shadow-example"; const value = "var(--root-example) var(--support-example) var(--media-example)";' },
  ];
  assert.deepEqual(evaluate(css, files), clean);
  assert.deepEqual(evaluate(css, files.map((file) => ({ ...file, content: file.content.replace("hover:text-example ", "") }))), clean);
  const colorCss = "@theme inline { --color-tone: red; --color-test-only: blue; }";
  assert.deepEqual(evaluate(colorCss, [
    { path: "components/probe.stories.tsx", content: 'const classes = "dark:fill-tone/50";' },
    { path: "components/probe.test.tsx", content: 'const classes = "bg-test-only";' },
  ]).unused, ["--color-test-only"]);
});

test("a theme utility must match the full prefix and token name", () => {
  const css = "@theme inline { --color-primary: red; --color-brand-primary: blue; }";
  const files = [{ path: "components/probe.tsx", content: 'const classes = "bg-brand-primary";' }];
  assert.deepEqual(evaluate(css, files).unused, ["--color-primary"]);
  assert.deepEqual(evaluate(css, [{ ...files[0], content: 'const classes = "bg-brand-primary bg-primary";' }]), clean);
});

test("the parenthesized custom-property shorthand keeps declared tokens live", () => {
  const css = "@theme inline { --color-probe: red; --text-probe: 2rem; } :root { --root-probe: 1px; }";
  const shorthand = { path: "components/probe.tsx", content: 'const classes = "bg-(--color-probe) text-(length:--text-probe) m-(--root-probe,0px)";' };
  assert.deepEqual(evaluate(css, [shorthand]), clean);
  assert.deepEqual(evaluate(css, [{ path: "components/probe.tsx", content: 'const classes = "p-4";' }]).unused, ["--color-probe", "--root-probe", "--text-probe"]);
  assert.deepEqual(evaluate(css, [{ path: "components/probe.tsx", content: 'const classes = "bg-(--color-probe-extra)";' }]).unused, ["--color-probe", "--root-probe", "--text-probe"]);
});

test("every static utility spelling that consumes a theme token counts as a reference", () => {
  const css = "@theme inline { --color-probe: #123456; --radius-probe: 9px; --spacing-probe: 7px; }";
  const live = { path: "components/probe.tsx", content: 'const classes = `drop-shadow-probe ${ok ? "inset-shadow-probe" : "text-shadow-probe"} rounded-tl-probe rounded-ss-probe basis-probe indent-probe border-spacing-probe !bg-probe`;' };
  assert.deepEqual(evaluate(css, [live]), clean);
  assert.deepEqual(evaluate(css, [{ path: "components/probe.tsx", content: 'const classes = "drop-shadow-other rounded-tl-other basis-other";' }]).unused, ["--color-probe", "--radius-probe", "--spacing-probe"]);
});

test("the consuming spellings Tailwind compiles against a namespace stay live", () => {
  const css = "@theme inline { --color-probe: #123456; --spacing-probe: 7px; }";
  const live = { path: "components/probe.tsx", content: 'const classes = "inset-ring-probe border-bs-probe scrollbar-thumb-probe mask-linear-from-probe translate-probe translate-z-probe inset-s-probe inset-bs-probe leading-probe";' };
  assert.deepEqual(evaluate(css, [live]), clean);
});

test("only the top-level tooling tree is outside the product scan", () => {
  const css = "@theme inline { --color-probe: red; }";
  assert.deepEqual(evaluate(css, [{ path: "oxlint/tokens.tsx", content: 'const classes = "bg-probe";' }]).unused, ["--color-probe"]);
  assert.deepEqual(evaluate(css, [{ path: "client/oxlint/tokens.tsx", content: 'const classes = "bg-probe";' }]), clean);
  assert.deepEqual(evaluate(css, [{ path: "client/oxlint/tokens.tsx", content: 'const classes = "p-4";' }]).unused, ["--color-probe"]);
});

test("allowlist entries fail when referenced, removed, duplicated, or missing reasons", async () => {
  const css = await readFile(cssUrl, "utf8");
  const files = await source();
  assert.deepEqual(evaluate(css, files, [{ name: "--color-background", reason: "external" }]).staleAllowlist, ["--color-background"]);
  assert.deepEqual(evaluate(css, files, [{ name: "--no-longer-declared", reason: "external" }]).staleAllowlist, ["--no-longer-declared"]);
  const orphan = css.replace("@theme inline {", "@theme inline { --color-orphan: red;");
  assert.deepEqual(evaluate(orphan, files, [{ name: "--color-orphan", reason: "" }]).invalidAllowlist, ["--color-orphan"]);
  assert.deepEqual(evaluate(orphan, files, [{ name: "--color-orphan", reason: "external" }, { name: "--color-orphan", reason: "external" }]).invalidAllowlist, ["--color-orphan"]);
  assert.deepEqual(evaluate(orphan, files, [{ name: "--color-orphan", reason: "external" }]), clean);
});

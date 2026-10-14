import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { evaluateDesignSpec } from "../design-spec.mjs";

const cssUrl = new URL("../../../apps/web/app/globals.css", import.meta.url);
const specUrl = new URL("../../../docs/design-system/spec.md", import.meta.url);
const startMarker = "<!-- design-spec:tokens:start -->";
const endMarker = "<!-- design-spec:tokens:end -->";
const clean = { missing: [], undeclared: [], invalid: [] };
const css = `
@theme inline { --theme: var(--shared); --shared: red; }
:root { --root: red; --shared: red; }
.dark { --dark: black; --shared: black; }
@supports (height: 100dvh) { :root { --supports: 100dvh; --shared: red; } }
@media (display-mode: standalone) { :root { --standalone: 1px; --shared: red; } }
@media (prefers-reduced-motion: reduce) { :root { --reduced: 0ms; --shared: red; } }
`;
const names = ["--dark", "--reduced", "--root", "--shared", "--standalone", "--supports", "--theme"];
const tokenBlock = (lines) => `${startMarker}\n${lines.join("\n")}\n${endMarker}`;

test("a spec listing the union of all declaring blocks is clean", () => {
  const spec = `# Spec\n${tokenBlock(names.map((name) => `  ${name}  `)).replaceAll("\n", "\r\n")}\n`;
  assert.deepEqual(evaluateDesignSpec({ css, spec }), clean);
});

test("missing tokens name every declaring block in sorted order", () => {
  const spec = tokenBlock(names.filter((name) => name !== "--shared" && name !== "--root"));
  assert.deepEqual(evaluateDesignSpec({ css, spec }), {
    ...clean,
    missing: [
      "--root (declared in :root)",
      "--shared (declared in .dark, :root, @media (display-mode: standalone) :root, @media (prefers-reduced-motion: reduce) :root, @supports (height: 100dvh) :root, @theme inline)",
    ],
  });
});

test("tokens inside unmodeled nested blocks are reported", () => {
  assert.deepEqual(evaluateDesignSpec({
    css: "@media (prefers-color-scheme: dark) { :root { --hidden: blue; } }",
    spec: tokenBlock([]),
  }), {
    ...clean,
    missing: ["--hidden (declared in @media (prefers-color-scheme: dark) :root)"],
  });
});

test("a malformed custom-property declaration is rejected, not skipped", () => {
  assert.throws(() => evaluateDesignSpec({ css: ":root { --typo red; }", spec: tokenBlock([]) }), /Invalid CSS declaration: --typo red/);
  assert.throws(() => evaluateDesignSpec({ css: ":root { --empty:; }", spec: tokenBlock([]) }), /Invalid CSS declaration: --empty:/);
});

test("undeclared spec tokens are reported in sorted order", () => {
  assert.deepEqual(evaluateDesignSpec({ css, spec: tokenBlock([...names, "--z-retired", "--a-retired"]) }), {
    ...clean,
    undeclared: ["--a-retired", "--z-retired"],
  });
});

test("each invalid nonempty line is reported without treating it as a token", () => {
  assert.deepEqual(evaluateDesignSpec({ css: "", spec: tokenBlock(["--UPPER", "", "  not-a-token  ", "--bad_name"]) }), {
    ...clean,
    invalid: ["Invalid token line 2: --UPPER", "Invalid token line 4: not-a-token", "Invalid token line 5: --bad_name"],
  });
});

test("each repeated token line is invalid", () => {
  assert.deepEqual(evaluateDesignSpec({ css, spec: tokenBlock([...names, "--shared", "--shared"]) }), {
    ...clean,
    invalid: ["Duplicate token line 10: --shared", "Duplicate token line 9: --shared"],
  });
});

test("missing start or end markers are invalid", () => {
  for (const [spec, invalid] of [
    [endMarker, [`Missing token marker: ${startMarker}`]],
    [startMarker, [`Missing token marker: ${endMarker}`]],
    ["", [`Missing token marker: ${endMarker}`, `Missing token marker: ${startMarker}`]],
  ]) {
    assert.deepEqual(evaluateDesignSpec({ css: "", spec }), { ...clean, invalid });
  }
});

test("reversed token markers are invalid", () => {
  assert.deepEqual(evaluateDesignSpec({ css: "", spec: `${endMarker}\n${startMarker}` }), {
    ...clean,
    invalid: ["Token end marker precedes start marker"],
  });
});

test("malformed CSS propagates the structural parser error", () => {
  assert.throws(() => evaluateDesignSpec({ css: ":root { --broken: red;", spec: tokenBlock([]) }), /Unclosed CSS statement or block/);
});

test("the real design spec exactly lists globals.css tokens", async () => {
  const [css, spec] = await Promise.all([readFile(cssUrl, "utf8"), readFile(specUrl, "utf8")]);
  assert.deepEqual(evaluateDesignSpec({ css, spec }), clean, "update the design spec token block in the same change as globals.css tokens");
});

const cli = (...args) => spawnSync(process.execPath, [fileURLToPath(new URL("../design-spec.mjs", import.meta.url)), ...args], {
  cwd: fileURLToPath(new URL("../../..", import.meta.url)),
  encoding: "utf8",
});

test("the CLI defaults to the real repo files and is silent when clean", () => {
  const result = cli();
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});

test("the CLI accepts fixture paths and fails with each drift finding on stderr", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "home-design-spec-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cssPath = path.join(directory, "globals.css");
  const specPath = path.join(directory, "spec.md");
  await writeFile(cssPath, "@media (prefers-color-scheme: dark) { :root { --hidden: blue; } }");
  await writeFile(specPath, tokenBlock(["--hidden"]));
  const matching = cli(cssPath, specPath);
  assert.equal(matching.status, 0);
  assert.equal(matching.stdout, "");
  assert.equal(matching.stderr, "");

  await writeFile(specPath, tokenBlock([]));
  const missing = cli(cssPath, specPath);
  assert.equal(missing.status, 1);
  assert.equal(missing.stdout, "");
  assert.equal(missing.stderr, "--hidden (declared in @media (prefers-color-scheme: dark) :root)\n");

  await writeFile(specPath, tokenBlock(["--retired", "invalid"]));
  const drifted = cli(cssPath, specPath);
  assert.equal(drifted.status, 1);
  assert.equal(drifted.stdout, "");
  assert.equal(drifted.stderr, "--hidden (declared in @media (prefers-color-scheme: dark) :root)\n--retired\nInvalid token line 3: invalid\n");
});

test("the CLI fails and names read and parse errors", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "home-design-spec-errors-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cssPath = path.join(directory, "globals.css");
  const specPath = path.join(directory, "spec.md");
  const unreadable = cli(cssPath, specPath);
  assert.equal(unreadable.status, 1);
  assert.equal(unreadable.stdout, "");
  assert.match(unreadable.stderr, /^Design spec error: Error: ENOENT:/);

  await writeFile(cssPath, ":root { --broken: red;");
  await writeFile(specPath, tokenBlock([]));
  const malformed = cli(cssPath, specPath);
  assert.equal(malformed.status, 1);
  assert.equal(malformed.stdout, "");
  assert.equal(malformed.stderr, "Design spec error: Error: Unclosed CSS statement or block\n");
});

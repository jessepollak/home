import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { evaluateDesignSpec, evaluateDesignSpecReferences, repositoryDesignSpecReferenceFindings } from "../design-spec.mjs";
import { storyIdsFromFiles } from "../story-references.mjs";

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
const textures = ["Settled", "Working", "Needs you", "Can't load", "Failed, recoverable", "Done", "Loading"];
const templates = ["Destination", "Row", "Facts", "Money flow", "First use", "Detail"];
const component = "components/ui/status-texture.tsx";
const story = "ui-status-texture--textures";
const textureRow = (name, file = component, id = story) => `| ${name} | foreground | none | none | Context | \`${file}\` | \`${id}\` |`;
const templateRow = (name, file = component, id = story) => `| ${name} | Structure | \`${file}\` | \`${id}\` |`;
const textureSection = `## Status texture

| Texture | Color | Mark | Motion | Placement and copy | Component | Story |
| --- | --- | --- | --- | --- | --- | --- |
${textures.map((name) => textureRow(name)).join("\n")}`;
const templateSection = `## Templates

| Template | Structure | Component | Story |
| --- | --- | --- | --- |
${templates.map((name) => name === "Destination" ? templateRow(name, "planned: PR 3", "planned: PR 3") : templateRow(name)).join("\n")}`;
const sections = `${textureSection}\n\n${templateSection}\n`;
const references = (spec = sections, overrides = {}) => evaluateDesignSpecReferences({
  spec,
  componentExists: (file) => file === component,
  storyExists: (id) => id === story,
  ...overrides,
});

test("texture and template tables pass with injectable lookups and paired planned references", () => {
  assert.deepEqual(references(sections.replaceAll("\n", "\r\n")), []);
});

for (const [name, content] of [["Status texture", textureSection], ["Templates", templateSection]]) {
  test(`${name} requires its section and table`, () => {
    assert.match(references(sections.replace(content, ""))[0], new RegExp(`${name}: expected one section; add`));
    assert.ok(references(sections.replace(content, `## ${name}\nNo table.`)).some((finding) => finding.startsWith(`${name}: expected one table`)));
    assert.ok(references(sections.replace(`## ${name}`, `## ${name}\n\n## ${name}`)).some((finding) => finding.startsWith(`${name}: expected one section`)));
  });
}

test("a malformed header or separator cannot silently drop table coverage", () => {
  for (const spec of [
    sections.replace("| Component | Story |", "| Component | Preview |"),
    sections.replace("| --- | --- | --- | --- | --- | --- | --- |", "| --- | --- | --- | --- | --- | --- |"),
  ]) assert.ok(references(spec).some((finding) => /Status texture: expected one table.*restore/.test(finding)));
});

test("status textures are exactly the seven named rows in order", () => {
  for (const changed of [
    textureSection.replace(`${textureRow("Working")}\n`, ""),
    `${textureSection}\n${textureRow("Partial")}`,
    textureSection.replace(textureRow("Working"), textureRow("Settled")),
    textureSection.replace(`${textureRow("Working")}\n${textureRow("Needs you")}`, `${textureRow("Needs you")}\n${textureRow("Working")}`),
    textureSection.replace("| Failed, recoverable |", "| Failed |"),
    textureSection.split("\n").slice(0, 4).join("\n"),
  ]) assert.ok(references(sections.replace(textureSection, changed)).some((finding) => /Status texture rows.*restore exactly.*in that order/.test(finding)));
});

for (const name of templates) {
  test(`Templates requires ${name}`, () => {
    const row = name === "Destination" ? templateRow(name, "planned: PR 3", "planned: PR 3") : templateRow(name);
    assert.ok(references(sections.replace(row, "")).some((finding) => finding === `Templates / ${name}: missing template; add its Structure, Component and Story row.`));
  });
}

test("duplicate template rows fail with their name and fix", () => {
  assert.ok(references(`${sections}${templateRow("Row")}\n`).some((finding) => /Templates \/ Row: duplicate template; keep one row/.test(finding)));
});

for (const [row, name] of [[textureRow("Working"), "Status texture / Working"], [templateRow("Row"), "Templates / Row"]]) {
  for (const [column, value] of [["Component", component], ["Story", story]]) {
    test(`${name} requires its ${column} cell`, () => {
      assert.ok(references(sections.replace(row, row.replace(`\`${value}\``, ""))).some((finding) => finding.startsWith(`${name}: missing ${column}; add a backticked`)));
    });
  }
}

test("a truncated row reports its name and missing Story cell", () => {
  const changed = sections.replace(textureRow("Working"), textureRow("Working").replace(` | \`${story}\` |`, " |"));
  assert.ok(references(changed).some((finding) => /Status texture \/ Working: expected 7 cells; restore/.test(finding)));
  assert.ok(references(changed).some((finding) => /Status texture \/ Working: missing Story; add/.test(finding)));
});

test("missing component paths and story ids name the row and fix", () => {
  const changed = sections.replace(textureRow("Working"), textureRow("Working", "components/missing.tsx", "missing--story"));
  assert.deepEqual(references(changed), [
    "Status texture / Working: Component components/missing.tsx does not exist under apps/web; restore the file or update its path.",
    "Status texture / Working: Story missing--story does not resolve to an exported story; update the id from the story meta and export.",
  ]);
});

test("component paths stay relative to apps/web even when a lookup accepts them", () => {
  for (const file of ["../outside.tsx", "/components/ui/status-texture.tsx", "apps/web/components/ui/status-texture.tsx", "components/../outside.tsx", "components\\outside.tsx"]) {
    const changed = sections.replace(textureRow("Working"), textureRow("Working", file));
    assert.ok(references(changed, { componentExists: () => true }).some((finding) => /Status texture \/ Working: Component .*use a path relative to apps\/web without traversal/.test(finding)));
  }
});

test("reference cells must use backticks, not prose or empty inline code", () => {
  for (const cell of [component, `\`${component}\` (example)`, "``"]) {
    const changed = sections.replace(textureRow("Working"), textureRow("Working").replace(`\`${component}\``, cell));
    assert.ok(references(changed).some((finding) => /Status texture \/ Working: invalid Component cell; use backticked paths/.test(finding)));
  }
});

test("all references in multi-component and multi-story cells are checked", () => {
  const changed = sections.replace(templateRow("Money flow"), templateRow("Money flow").replace(`\`${component}\``, `\`${component}\`, \`components/missing.tsx\``).replace(`\`${story}\``, `\`${story}\`, \`missing--story\``));
  assert.ok(references(changed).some((finding) => /Templates \/ Money flow: Component components\/missing.tsx/.test(finding)));
  assert.ok(references(changed).some((finding) => /Templates \/ Money flow: Story missing--story/.test(finding)));
  assert.deepEqual(references(changed, { componentExists: () => true, storyExists: () => true }), []);
});

test("planned references are rejected outside the Templates table", () => {
  for (const spec of [
    `planned: PR 3\n${sections}`,
    `${sections}\n## Later\n\n| Anything | \`planned: PR 3\` |`,
    sections.replace(textureRow("Working"), textureRow("Working", "planned: PR 3", "planned: PR 3")),
    sections.replace("| Context |", "| planned: PR 3 |"),
  ]) assert.ok(references(spec).some((finding) => /planned: PR 3 is allowed only in the Templates table.*replace.*or remove/.test(finding)));
});

test("planned references must occupy both exact backticked template cells", () => {
  const original = templateRow("Destination", "planned: PR 3", "planned: PR 3");
  for (const replacement of [
    templateRow("Destination", component, "planned: PR 3"),
    templateRow("Destination", "planned: PR 3", story),
    original.replace("`planned: PR 3`", "planned: PR 3"),
    original.replace("`planned: PR 3`", "`planned: PR 3`, `extra.tsx`"),
    original.replace("`planned: PR 3`", ""),
  ]) assert.ok(references(sections.replace(original, replacement)).some((finding) => /Templates \/ Destination: use `planned: PR 3` in both Component and Story/.test(finding)));
});

test("planned markers in template names or structure are not placeholders", () => {
  const changed = sections.replace("| Row | Structure |", "| Row | planned: PR 3 |");
  assert.ok(references(changed).some((finding) => /Templates \/ Row: planned: PR 3 belongs only in Component and Story/.test(finding)));
});

test("story resolution uses Storybook meta ids, title-derived ids and export names, not display names", () => {
  const { ids, findings } = storyIdsFromFiles([
    { path: "components/probe.stories.tsx", content: `
      export default { id: "explicit-id", title: "UI/Ignored Title", excludeStories: ["Helper"] };
      export const WorkingRow = { name: "Different display name" };
      export const Helper = {};
    ` },
    { path: "components/title.stories.tsx", content: `
      export default { title: "UI/Status Example" };
      export const NeedsYou = {};
    ` },
  ]);
  assert.deepEqual(findings, []);
  assert.deepEqual([...ids].sort(), ["explicit-id--working-row", "ui-status-example--needs-you"]);
  const spec = sections.replaceAll(`\`${story}\``, "`explicit-id--working-row`, `ui-status-example--needs-you`");
  assert.deepEqual(references(spec, { storyExists: (id) => ids.has(id) }), []);
  for (const bad of ["ui-ignored-title--working-row", "explicit-id--different-display-name", "explicit-id--helper", "ui-status-example--missing"]) {
    assert.ok(references(spec.replace("`explicit-id--working-row`", `\`${bad}\``), { storyExists: (id) => ids.has(id) }).some((finding) => finding.includes(`Story ${bad} does not resolve`)));
  }
});

test("repository spec references match Storybook directories and every supported extension", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "home-design-spec-stories-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directories = ["client", "components", "stories", "app"];
  await Promise.all(directories.map((directory) => mkdir(path.join(root, "apps/web", directory), { recursive: true })));
  for (const directory of directories) {
    for (const extension of ["js", "jsx", "mjs", "ts", "tsx"]) {
      const file = `${directory}/probe.stories.${extension}`;
      const id = `probe-${directory}-${extension}--example`;
      await writeFile(path.join(root, "apps/web", file), `export default { id: "probe-${directory}-${extension}" }; export const Example = {};`);
      const spec = sections.replaceAll(`\`${component}\``, `\`${file}\``).replaceAll(`\`${story}\``, `\`${id}\``);
      const findings = repositoryDesignSpecReferenceFindings(root, spec);
      if (directory === "app") {
        assert.equal(findings.length, textures.length + templates.length - 1);
        assert.ok(findings.every((finding) => finding.includes(`Story ${id} does not resolve`)));
      } else {
        assert.deepEqual(findings, [], file);
      }
    }
  }
});

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
  await writeFile(specPath, `${sections}\n${tokenBlock(["--hidden"])}`);
  const matching = cli(cssPath, specPath);
  assert.equal(matching.status, 0);
  assert.equal(matching.stdout, "");
  assert.equal(matching.stderr, "");

  await writeFile(specPath, `${sections}\n${tokenBlock([])}`);
  const missing = cli(cssPath, specPath);
  assert.equal(missing.status, 1);
  assert.equal(missing.stdout, "");
  assert.equal(missing.stderr, "--hidden (declared in @media (prefers-color-scheme: dark) :root)\n");

  await writeFile(specPath, `${sections}\n${tokenBlock(["--retired", "invalid"])}`);
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

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { prBodyShapeFindings } from "../pr-body-shape.mjs";

const title = "feat(home): change behavior";
const body = "## What changes\n\nThe CI job reports every PR-body finding together.";

for (const type of ["product", "design", "feat", "fix", "test", "ops", "dx", "docs", "chore"]) {
  for (const scope of ["", "(home)"]) {
    test(`${type}${scope} titles require the section, with or without a breaking-change marker`, () => {
      for (const marker of ["", "!"]) {
        const subject = `${type}${scope}${marker}: change`;
        assert.deepEqual(prBodyShapeFindings(subject, ""), ["PR body needs a visible ## What changes section."]);
        assert.deepEqual(prBodyShapeFindings(subject, body), []);
      }
    });
  }
}

test("unrelated, malformed, and differently cased title prefixes skip the gate", () => {
  for (const subject of ["", "Research feat(home): change", "Feat(home): change", "feat(): change", "feature: change", "feat(home) change"]) {
    assert.deepEqual(prBodyShapeFindings(subject, "## Failure modes"), []);
  }
});

for (const [name, value] of [
  ["empty body", ""],
  ["no section", "## Review"],
  ["commented heading", `<!--\n${body}\n-->`],
  ["backtick fence", `\`\`\`md\n${body}\n\`\`\``],
  ["tilde fence", `   ~~~~md\n${body}\n   ~~~~`],
  ["unclosed fence", `\`\`\`\`\n${body}\n\`\`\``],
  ["deeper heading", body.replace("## What changes", "### What changes")],
]) {
  test(`rejects ${name}`, () => {
    assert.deepEqual(prBodyShapeFindings(title, value), ["PR body needs a visible ## What changes section."]);
  });
}

test("What changes must precede every other visible level-two heading", () => {
  assert.deepEqual(prBodyShapeFindings(title, `## Preview\nN/A: docs-only\n${body}`), ["The first visible level-two heading must be ## What changes."]);
  assert.deepEqual(prBodyShapeFindings(title, `# PR\n### Context\nintro\n${body}`), []);
});

test("recognizes Markdown heading indentation, tabs, trailing whitespace and closing hashes", () => {
  const value = body.replace("## What changes", "   ##\tWhat changes  ##  ");
  assert.deepEqual(prBodyShapeFindings(title, `${value}\n  ## Preview ###\nN/A: docs-only`), []);
  assert.deepEqual(prBodyShapeFindings(title, `${value}\n ##\tFailure modes ###  `), []);
  assert.deepEqual(prBodyShapeFindings(title, `${body}\n## `), []);
});

test("comments and fenced code cannot create the first heading", () => {
  const hidden = "## Review";
  const value = `<!-- ${hidden} -->\n\`\`\`md\n${hidden}\n\`\`\`\n${body}\n<!-- ${hidden} -->\n~~~md\n${hidden}\n~~~\n## Preview\nN/A: docs-only`;
  assert.deepEqual(prBodyShapeFindings(title, value.replace(/\n/g, "\r\n")), []);
});

test("the real template passes the body shape check", () => {
  const template = readFileSync(".github/PULL_REQUEST_TEMPLATE.md", "utf8");
  assert.deepEqual(prBodyShapeFindings(title, template), []);
});

test("CLI prints its markdown summary and exits non-zero for findings or extra arguments", () => {
  const run = (prTitle, prBody, args = [], generated = false) => spawnSync(process.execPath, ["scripts/gates/pr-body-shape.mjs", ...args], {
    encoding: "utf8", env: { ...process.env, PR_TITLE: prTitle, PR_BODY: prBody, PR_GENERATED_BODY: String(generated) },
  });
  const pass = run(title, `${body}\n\nCloses #2245`);
  assert.equal(pass.status, 0);
  assert.equal(pass.stdout, "## PR body\nPR body checks passed.\n");
  assert.equal(run("Research", "## Failure modes").status, 0);
  const fail = run("fix(home): repair state", "## Review");
  assert.equal(fail.status, 1);
  assert.equal(fail.stdout, "## PR body\n- An implementation PR body must have a visible Closes #<n>, Fixes #<n>, or Resolves #<n> line, or No issue: <reason>.\n- PR body needs a visible ## What changes section.\n- A scoped fix PR body must name exactly one Caught-by detector: lint, unit, bot, review, browser, or production.\n");
  const generated = run("chore(deps): bump typescript", "Bumps a dependency.", [], true);
  assert.equal(generated.status, 0);
  assert.equal(generated.stdout, "## PR body\nGenerated PR body: closing link and What changes checks skipped.\nPR body checks passed.\n");
  const generatedFix = run("fix(home): repair state", "## Review", [], true);
  assert.equal(generatedFix.status, 1);
  assert.equal(generatedFix.stdout, "## PR body\nGenerated PR body: closing link and What changes checks skipped.\n- A scoped fix PR body must name exactly one Caught-by detector: lint, unit, bot, review, browser, or production.\n");
  const usage = run(title, body, ["extra"]);
  assert.notEqual(usage.status, 0);
  assert.match(usage.stderr, /Usage: node scripts\/gates\/pr-body-shape\.mjs/);
});

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { prBodyShapeFindings } from "../pr-body-shape.mjs";

const title = "feat(home): change behavior";
const labels = ["Before", "After", "Who notices", "Your call", "Risk"];
const rowFor = (label, value = "none") => `| **${label}** | ${value} |`;
const makeSection = (values = {}, omit = []) => `| | Summary |\n| --- | --- |\n${labels.filter((label) => !omit.includes(label)).map((label) => rowFor(label, values[label] ?? "none")).join("\n")}`;
const section = makeSection();
const body = `## What changes\n${section}`;
const findingFor = (label) => `## What changes needs a \`| **${label}** | … |\` row with text that is not a template placeholder.`;
const missingTable = "## What changes needs a `| | Summary |` table with Before, After, Who notices, Your call, and Risk rows.";

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
  assert.deepEqual(prBodyShapeFindings(title, `## Preview\nN/A\n${body}`), ["## What changes must be the first level-two heading."]);
  assert.deepEqual(prBodyShapeFindings(title, `# PR\n### Context\nintro\n${body}`), []);
});

for (const heading of ["What changes", "Preview", "Verification", "State transitions", "Test plan", "Review", "Real money", "Operator action required"]) {
  test(`accepts the ${heading} level-two heading`, () => {
    assert.deepEqual(prBodyShapeFindings(title, `${body}\n## ${heading}\n${section}`), []);
  });
}

test("reports each disallowed level-two heading by name, including inside details", () => {
  const value = `${body}\n## Failure modes\n<details><summary>Evidence</summary>\n\n## Implementation notes\n</details>\n### Arbitrary subsection\n#### Another subsection`;
  assert.deepEqual(prBodyShapeFindings(title, value), [
    "Disallowed level-two heading: Failure modes.",
    "Disallowed level-two heading: Implementation notes.",
  ]);
});

test("recognizes Markdown heading indentation, tabs, trailing whitespace and closing hashes", () => {
  const value = body.replace("## What changes", "   ##\tWhat changes  ##  ");
  assert.deepEqual(prBodyShapeFindings(title, `${value}\n  ## Preview ###\nN/A`), []);
  assert.deepEqual(prBodyShapeFindings(title, `${value}\n ##\tFailure modes ###  `), ["Disallowed level-two heading: Failure modes."]);
  assert.deepEqual(prBodyShapeFindings(title, `${body}\n## `), ["Disallowed level-two heading: (empty)."]);
});

for (const label of labels) {
  for (const [name, value] of [
    ["missing", `## What changes\n${makeSection({}, [label])}`],
    ["empty", `## What changes\n${makeSection({ [label]: " \t " })}`],
    ["comment-only", `## What changes\n${makeSection({ [label]: "<!-- none -->" })}`],
    ["old bold-line", `## What changes\n${makeSection({}, [label])}\n\n**${label}:** none`],
    ["bullet", `## What changes\n${makeSection({}, [label])}\n\n- **${label}:** none`],
  ]) {
    test(`rejects a ${name} ${label} row`, () => {
      assert.deepEqual(prBodyShapeFindings(title, value), [findingFor(label)]);
    });
  }
}

test("rejects the template Who notices placeholder", () => {
  const value = `## What changes\n${makeSection({ "Who notices": "users / developers (name the command, job, or file) / operators / nobody (refactor)" })}`;
  assert.deepEqual(prBodyShapeFindings(title, value), [findingFor("Who notices")]);
});

test("rejects a missing or malformed Summary table and rows after it ends", () => {
  assert.deepEqual(prBodyShapeFindings(title, "## What changes\nprose only"), [missingTable]);
  assert.deepEqual(prBodyShapeFindings(title, body.replace("| | Summary |", "| Field | Value |")), [missingTable]);
  assert.deepEqual(prBodyShapeFindings(title, body.replace("| --- | --- |\n", "")), [missingTable]);
  assert.deepEqual(prBodyShapeFindings(title, body.replace(rowFor("Before"), `${rowFor("Before")}\n`)), labels.slice(1).map(findingFor));
  assert.deepEqual(prBodyShapeFindings(title, `## What changes\n${makeSection()}`.replace(/\n/g, "\r\n")), []);
});

for (const placeholder of ["What happens today, in plain words.", "What happens once this merges."]) {
  test(`rejects the template placeholder: ${placeholder}`, () => {
    assert.deepEqual(prBodyShapeFindings(title, `## What changes\n${makeSection({ Before: `${placeholder}  ` })}`), [findingFor("Before")]);
  });
}

test("required lines must be inside What changes, but deeper subsections do not end it", () => {
  assert.deepEqual(prBodyShapeFindings(title, `## What changes\n## Preview\n${section}`), [missingTable]);
  assert.deepEqual(prBodyShapeFindings(title, `## What changes\n### Details\n${section}`), []);
});

test("accepts 200 visible words and rejects 201, counting labels and prose but not table markup", () => {
  const words = 13;
  const atLimit = `${body}\n${Array(200 - words).fill("word").join(" ")}`;
  assert.deepEqual(prBodyShapeFindings(title, atLimit), []);
  assert.deepEqual(prBodyShapeFindings(title, `${atLimit} extra`), ["## What changes has 201 words; the limit is 200."]);
  assert.deepEqual(prBodyShapeFindings(title, `${atLimit}\n## Preview\n${Array(200).fill("word").join(" ")}`), []);
});

test("comments and fenced code cannot change the first heading, section boundary, word count or allowlist", () => {
  const hidden = `${Array(200).fill("hidden").join(" ")}\n## Failure modes`;
  const value = `<!-- ${hidden} -->\n\`\`\`md\n${hidden}\n\`\`\`\n${body}\n<!-- ${hidden} -->\n~~~md\n${hidden}\n~~~\n## Preview`;
  assert.deepEqual(prBodyShapeFindings(title, value.replace(/\n/g, "\r\n")), []);
  const commentedRisk = `## What changes\n${makeSection({}, ["Risk"])}\n<!-- ${rowFor("Risk")} -->`;
  assert.deepEqual(prBodyShapeFindings(title, commentedRisk), [findingFor("Risk")]);
});

test("the real template fails only for placeholders and passes when they are filled in", () => {
  const template = readFileSync(".github/PULL_REQUEST_TEMPLATE.md", "utf8");
  assert.deepEqual(prBodyShapeFindings(title, template), [findingFor("Before"), findingFor("After"), findingFor("Who notices")]);
  const filled = template
    .replace("What happens today, in plain words.", "The CI job accepts any PR summary.")
    .replace("What happens once this merges.", "The CI job requires a concise, complete summary.")
    .replace("users / developers (name the command, job, or file) / operators / nobody (refactor)", "developers opening PRs");
  assert.deepEqual(prBodyShapeFindings(title, filled), []);
});

test("CLI prints its markdown summary and exits non-zero for findings or extra arguments", () => {
  const run = (prTitle, prBody, args = []) => spawnSync(process.execPath, ["scripts/gates/pr-body-shape.mjs", ...args], {
    encoding: "utf8", env: { ...process.env, PR_TITLE: prTitle, PR_BODY: prBody },
  });
  const pass = run(title, body);
  assert.equal(pass.status, 0);
  assert.equal(pass.stdout, "## PR body shape\nPR body shape gate passed.\n");
  assert.equal(run("Research", "## Failure modes").status, 0);
  const fail = run(title, "## Failure modes");
  assert.equal(fail.status, 1);
  assert.equal(fail.stdout, "## PR body shape\n- PR body needs a visible ## What changes section.\n- Disallowed level-two heading: Failure modes.\n");
  const usage = run(title, body, ["extra"]);
  assert.notEqual(usage.status, 0);
  assert.match(usage.stderr, /Usage:/);
});

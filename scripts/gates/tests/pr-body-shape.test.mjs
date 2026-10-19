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
const attachment = "https://github.com/user-attachments/assets/0f8fad5b-d9cb-469f-a165-70867728950e";
const afterAttachment = "https://github.com/user-attachments/assets/7f8fad5b-d9cb-469f-a165-70867728950e";
const repositoryImage = "docs/qa/checking-97/home-shell-shimmer.png";
const previewBody = (content) => `${body}\n## Preview\n${content}`;
const previewRow = (value, label = "Changed state") => `| **${label}** | ${value} |`;
const missingMedia = (label = "Changed state") => `## Preview row "${label}" needs media or the exact phrase \`Preview unchanged\` with a reason.`;
const unresolvedImage = (reference, label) => `## Preview image ${reference || "(empty reference)"}${label === undefined ? "" : ` in row "${label}"`} does not resolve to a GitHub attachment or an existing repository file.`;

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
  assert.deepEqual(prBodyShapeFindings(title, `## Preview\nN/A: docs-only\n${body}`), ["## What changes must be the first level-two heading."]);
  assert.deepEqual(prBodyShapeFindings(title, `# PR\n### Context\nintro\n${body}`), []);
});

for (const heading of ["What changes", "Preview", "Verification", "State transitions", "Test plan", "Review", "Real money", "Operator action required"]) {
  test(`accepts the ${heading} level-two heading`, () => {
    assert.deepEqual(prBodyShapeFindings(title, `${body}\n## ${heading}\n${heading === "Preview" ? "N/A: docs-only" : section}`), []);
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
  assert.deepEqual(prBodyShapeFindings(title, `${value}\n  ## Preview ###\nN/A: docs-only`), []);
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
  assert.deepEqual(prBodyShapeFindings(title, `## What changes\n## Preview\nN/A: docs-only\n${section}`), [missingTable]);
  assert.deepEqual(prBodyShapeFindings(title, `## What changes\n### Details\n${section}`), []);
});

test("accepts 200 visible words and rejects 201, counting labels and prose but not table markup", () => {
  const words = 13;
  const atLimit = `${body}\n${Array(200 - words).fill("word").join(" ")}`;
  assert.deepEqual(prBodyShapeFindings(title, atLimit), []);
  assert.deepEqual(prBodyShapeFindings(title, `${atLimit} extra`), ["## What changes has 201 words; the limit is 200."]);
  assert.deepEqual(prBodyShapeFindings(title, `${atLimit}\n## Preview\nN/A: docs-only\n${Array(200).fill("word").join(" ")}`), []);
});

test("comments and fenced code cannot change the first heading, section boundary, word count or allowlist", () => {
  const hidden = `${Array(200).fill("hidden").join(" ")}\n## Failure modes`;
  const value = `<!-- ${hidden} -->\n\`\`\`md\n${hidden}\n\`\`\`\n${body}\n<!-- ${hidden} -->\n~~~md\n${hidden}\n~~~\n## Preview\nN/A: docs-only`;
  assert.deepEqual(prBodyShapeFindings(title, value.replace(/\n/g, "\r\n")), []);
  const commentedRisk = `## What changes\n${makeSection({}, ["Risk"])}\n<!-- ${rowFor("Risk")} -->`;
  assert.deepEqual(prBodyShapeFindings(title, commentedRisk), [findingFor("Risk")]);
});

test("the real template fails for placeholders and the sample Preview row, and passes when filled in", () => {
  const template = readFileSync(".github/PULL_REQUEST_TEMPLATE.md", "utf8");
  assert.deepEqual(prBodyShapeFindings(title, template), [findingFor("Before"), findingFor("After"), findingFor("Who notices"), missingMedia("Changed state — 390×844 CSS px")]);
  const filled = template
    .replace("What happens today, in plain words.", "The CI job accepts any PR summary.")
    .replace("What happens once this merges.", "The CI job requires a concise, complete summary.")
    .replace("users / developers (name the command, job, or file) / operators / nobody (refactor)", "developers opening PRs")
    .replace("| State + viewport | Board | Before | After |", "| State + viewport | Board | Evidence |")
    .replace("| --- | --- | --- | --- |", "| --- | --- | --- |")
    .replace("| Changed state — 390×844 CSS px | `story:<story-id>` | PR base attachment | PR head attachment |", `| Changed state — 390×844 CSS px | — | ${attachment} |`);
  assert.deepEqual(prBodyShapeFindings(title, filled), []);
});

for (const [header, row] of [
  ["| State + viewport | Board | Before | After |\n| --- | --- | --- | --- |", `| Changed state | — | ![Before](${attachment}) | ![After](${afterAttachment}) |`],
  ["| State + viewport | Board | Evidence |\n| --- | --- | --- |", `| Changed state | — | ![Before](${attachment}) ![After](${afterAttachment}) |`],
]) {
  test(`accepts a paired Preview row with ${header.split("\n")[0]}`, () => {
    assert.deepEqual(prBodyShapeFindings(title, previewBody(`${header}\n${row}`)), []);
  });
}

for (const media of [
  `![After](${attachment})`,
  `![After](<${attachment}>)`,
  `![After](<${attachment}> "After state")`,
  `![After](${attachment} 'After state')`,
  `![After](${attachment} (After state))`,
  `<img alt="After" src="${attachment}">`,
  `<img src='${attachment}'>`,
  `<IMG SRC=${attachment}>`,
  attachment,
  `\`${attachment}\``,
  "https://user-images.githubusercontent.com/123/after.png",
  `![After](${repositoryImage})`,
  `![After](./${repositoryImage}?raw=1#after)`,
  `![After](${repositoryImage.replace("home-shell", "home%2Dshell")}#after?raw=1)`,
]) {
  test(`accepts Preview media: ${media}`, () => {
    assert.deepEqual(prBodyShapeFindings(title, previewBody(previewRow(media))), []);
  });
}

for (const reference of [
  "docs/qa/checking-97/missing-preview.png",
  "docs/qa/checking-97",
  `/${repositoryImage}`,
  `../${repositoryImage}`,
  `//${repositoryImage}`,
  "https://example.com/after.png",
  "https://github.com/user-attachments/assets/",
  "https://user-images.githubusercontent.com/",
  "https://github.com.example.com/user-attachments/assets/id",
  "http://github.com/user-attachments/assets/id",
  "docs/%ZZ/after.png",
  "%2E%2E/outside.png",
  "",
]) {
  test(`rejects unresolved Preview media: ${reference || "(empty)"}`, () => {
    assert.deepEqual(prBodyShapeFindings(title, previewBody(previewRow(`![After](${reference})`))), [
      unresolvedImage(reference, "Changed state"), missingMedia(),
    ]);
  });
}

test("resolves repository media from the script location rather than cwd", () => {
  const result = spawnSync(process.execPath, [new URL("../pr-body-shape.mjs", import.meta.url).pathname], {
    cwd: "docs", encoding: "utf8", env: { ...process.env, PR_TITLE: title, PR_BODY: previewBody(previewRow(`![After](${repositoryImage})`)) },
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "## PR body shape\nPR body shape gate passed.\n");
});

for (const value of [
  "no capture",
  "Preview unchanged",
  "Preview unchanged | Board",
  "Preview unchanged: —",
  "preview unchanged: no rendered change",
  "`story:journeys-home--loaded` | [Board](https://storybook.example.com) [Vercel](https://home.vercel.app)",
]) {
  test(`rejects a media-less Preview row: ${value}`, () => {
    assert.deepEqual(prBodyShapeFindings(title, previewBody(previewRow(value))), [missingMedia()]);
  });
}

test("accepts the exact unchanged-preview phrase only with a reason", () => {
  for (const value of ["Preview unchanged: no rendered change", "Preview unchanged — 0 rendered changes"]) {
    assert.deepEqual(prBodyShapeFindings(title, previewBody(previewRow(value))), []);
  }
});

test("labels Preview rows, skips headers across invisible lines, and does not require a table", () => {
  assert.deepEqual(prBodyShapeFindings(title, previewBody("| State | Evidence |\n<!-- hidden -->\n\n| --- | --- |\n| | none |")), [missingMedia("(no label)")]);
  assert.deepEqual(prBodyShapeFindings(title, previewBody("A server-only description without a table.")), []);
  assert.deepEqual(prBodyShapeFindings(title, previewBody(`![After](${attachment})`)), []);
  assert.deepEqual(prBodyShapeFindings(title, previewBody("![After](missing.png)")), [unresolvedImage("missing.png")]);
  assert.deepEqual(prBodyShapeFindings(title, `${body}\n## Review\n![After](missing.png)`), []);
});

test("ignores Preview images and rows in comments, fences, later sections and collapsed Evidence", () => {
  const hidden = "| Hidden | ![After](missing.png) |";
  const value = previewBody(`<!-- ${hidden} -->\n\`\`\`md\n${hidden}\n\`\`\`\n~~~md\n${hidden}\n~~~\n${previewRow(attachment)}\n   <DETAILS><summary>Evidence</summary>\n${hidden}\n</details>\n## Review\n${hidden}`);
  assert.deepEqual(prBodyShapeFindings(title, value), []);
});

for (const reason of ["docs-only", "CI-only", "pure server and lint (no rendered surface)"]) {
  test(`N/A: ${reason} exempts the entire Preview surface`, () => {
    assert.deepEqual(prBodyShapeFindings(title, previewBody(`${previewRow("![After](missing.png)")}\n  N/A: ${reason}  `)), []);
  });
}

test("an N/A without a reason produces exactly one finding and skips other Preview checks", () => {
  assert.deepEqual(prBodyShapeFindings(title, previewBody(`N/A:\nN/A: \t\n${previewRow("![After](missing.png)")}`)), [
    "## Preview N/A needs a reason (docs-only, CI-only, or pure server).",
  ]);
});

test("N/A inside collapsed Evidence does not exempt Preview rows", () => {
  assert.deepEqual(prBodyShapeFindings(title, previewBody(`${previewRow("no capture")}\n<details><summary>Evidence</summary>\nN/A: docs-only\n</details>`)), [missingMedia()]);
});

test("orders Preview findings by line, then deduplicated reference order, then the row finding", () => {
  const value = previewBody(`![Outside](missing-outside.png)\n${previewRow("<img src='missing-second.png'> ![First](missing-first.png) ![Again](missing-second.png)", "**Two failures**")}\n${previewRow(`${attachment} ![Broken](missing-with-media.png)`)}\n${previewRow("![Broken](missing-unchanged.png) Preview unchanged: no rendered change", "Unchanged")}`);
  assert.deepEqual(prBodyShapeFindings(title, value), [
    unresolvedImage("missing-outside.png"),
    unresolvedImage("missing-second.png", "Two failures"),
    unresolvedImage("missing-first.png", "Two failures"),
    missingMedia("Two failures"),
    unresolvedImage("missing-with-media.png", "Changed state"),
    unresolvedImage("missing-unchanged.png", "Unchanged"),
  ]);
});

test("accepts pipe-less Markdown tables and rejects their media-less rows", () => {
  assert.deepEqual(prBodyShapeFindings(title, previewBody(`State | Evidence\n--- | ---\nChanged | ${attachment}`)), []);
  assert.deepEqual(prBodyShapeFindings(title, previewBody("State | Evidence\n--- | ---\nChanged | no capture")), [missingMedia("Changed")]);
});

test("resolves nested alt text and reference-style Preview images", () => {
  assert.deepEqual(prBodyShapeFindings(title, previewBody(`| State | Evidence |\n| --- | --- |\n| Changed | ![Home [after]](${attachment}) |`)), []);
  assert.deepEqual(prBodyShapeFindings(title, previewBody("| State | Evidence |\n| --- | --- |\n| Changed | ![Home [after]](missing.png) |")), [unresolvedImage("missing.png", "Changed"), missingMedia("Changed")]);
  assert.deepEqual(prBodyShapeFindings(title, previewBody(`| State | Evidence |\n| --- | --- |\n| Changed | ![After][capture] ![ok](${attachment}) |\n\n[capture]: missing.png`)), [unresolvedImage("missing.png", "Changed")]);
  assert.deepEqual(prBodyShapeFindings(title, previewBody(`| State | Evidence |\n| --- | --- |\n| Changed | ![After][capture] |\n\n[capture]: ${attachment}`)), []);
  assert.deepEqual(prBodyShapeFindings(title, previewBody(`| State | Evidence |\n| --- | --- |\n| Changed | ![capture] |\n\n[capture]: ${attachment}`)), []);
});

test("reads img sources past quoted angle brackets and strips markup from an unchanged reason", () => {
  assert.deepEqual(prBodyShapeFindings(title, previewBody('| State | Evidence |\n| --- | --- |\n| Changed | <img alt="After > Before" src="docs/qa/checking-97/home-shell-shimmer.png"> |')), []);
  assert.deepEqual(prBodyShapeFindings(title, previewBody('| State | Evidence |\n| --- | --- |\n| Changed | <img alt="After > Before" src="missing.png"> |')), [unresolvedImage("missing.png", "Changed"), missingMedia("Changed")]);
});

test("rejects an unchanged declaration whose reason is only markup", () => {
  for (const value of ["Preview unchanged: <br>", "Preview unchanged: &nbsp;", "Preview unchangedness: no change"]) {
    assert.deepEqual(prBodyShapeFindings(title, previewBody(previewRow(value))), [missingMedia()]);
  }
});

test("resolves continuation, collapsed and first-wins reference definitions", () => {
  const table = "| State | Evidence |\n| --- | --- |\n| Changed | ![After][capture] |";
  assert.deepEqual(prBodyShapeFindings(title, previewBody(`${table}\n\n[capture]:\n  ${repositoryImage}`)), []);
  assert.deepEqual(prBodyShapeFindings(title, previewBody(`${table}\n\n[capture]:\n${repositoryImage}`)), []);
  assert.deepEqual(prBodyShapeFindings(title, previewBody(`${table}\n\n[capture]:\nhello world`)), [missingMedia("Changed")]);
  assert.deepEqual(prBodyShapeFindings(title, previewBody(`${table}\n\n[capture]: missing.png\n[capture]: ${repositoryImage}`)), [unresolvedImage("missing.png", "Changed"), missingMedia("Changed")]);
  assert.deepEqual(prBodyShapeFindings(title, previewBody(`${table}\n\n[capture]: ${repositoryImage}\n[capture]: missing.png`)), []);
  assert.deepEqual(prBodyShapeFindings(title, previewBody(`| State | Evidence |\n| --- | --- |\n| Changed | ![capture][] |\n\n[capture]: ${repositoryImage}`)), []);
  assert.deepEqual(prBodyShapeFindings(title, previewBody("| State | Evidence |\n| --- | --- |\n| Changed | ![capture][] |\n\n[capture]: missing.png")), [unresolvedImage("missing.png", "Changed"), missingMedia("Changed")]);
});

test("uses the real img src rather than src text inside another attribute", () => {
  assert.deepEqual(prBodyShapeFindings(title, previewBody(`| State | Evidence |\n| --- | --- |\n| Changed | <img alt="After > Before src='${repositoryImage}'" src="missing.png"> |`)), [unresolvedImage("missing.png", "Changed"), missingMedia("Changed")]);
  assert.deepEqual(prBodyShapeFindings(title, previewBody(`| State | Evidence |\n| --- | --- |\n| Changed | <img alt="After > Before src='missing.png'" src="${repositoryImage}"> |`)), []);
});

test("strips a quoted angle bracket from a markup-only unchanged reason", () => {
  assert.deepEqual(prBodyShapeFindings(title, previewBody(previewRow('Preview unchanged: <br title=" >x">'))), [missingMedia()]);
});

test("does not let one image token swallow a later shortcut image", () => {
  const value = `| State | Evidence |\n| --- | --- |\n| Changed | ![ok](${repositoryImage}) ![bad] |\n\n[bad]: missing.png`;
  assert.deepEqual(prBodyShapeFindings(title, previewBody(value)), [unresolvedImage("missing.png", "Changed")]);
});

test("continues a pipe-less table through a single-cell row and a second separator", () => {
  assert.deepEqual(prBodyShapeFindings(title, previewBody("State | Evidence\n--- | ---\nChanged")), [missingMedia("Changed")]);
  const value = `State | Evidence\n--- | ---\n| ok | ![ok](${repositoryImage}) |\n| bad | no capture |\n--- | ---\n| after | no capture |`;
  assert.deepEqual(prBodyShapeFindings(title, previewBody(value)), [missingMedia("bad"), missingMedia("after")]);
});

test("requires a reference definition to start a block", () => {
  const value = `| State | Evidence |\n| --- | --- |\n| Changed | ![After][capture] |\n\nSome paragraph\n[capture]: ${repositoryImage}\n\n[capture]: missing.png`;
  assert.deepEqual(prBodyShapeFindings(title, previewBody(value)), [unresolvedImage("missing.png", "Changed"), missingMedia("Changed")]);
});

test("reads only visible link text and decodes entities in an unchanged reason", () => {
  assert.deepEqual(prBodyShapeFindings(title, previewBody(previewRow("Preview unchanged: [](#empty)"))), [missingMedia()]);
  assert.deepEqual(prBodyShapeFindings(title, previewBody(previewRow("Preview unchanged: &#110;o UI delta"))), []);
  assert.deepEqual(prBodyShapeFindings(title, previewBody(previewRow("Preview unchanged: [no visual change](https://example.com)"))), []);
});

test("resolves escaped reference labels", () => {
  const value = `| State | Evidence |\n| --- | --- |\n| Changed | ![ok](${repositoryImage}) ![bad][cap\\]ture] |\n\n[cap\\]ture]: missing.png`;
  assert.deepEqual(prBodyShapeFindings(title, previewBody(value)), [unresolvedImage("missing.png", "Changed")]);
});

test("keeps escaped and unescaped reference labels distinct", () => {
  const value = `| State | Evidence |\n| --- | --- |\n| Changed | ![bad][cap_ture] |\n\n[cap\\_ture]: ${repositoryImage}\n[cap_ture]: missing.png`;
  assert.deepEqual(prBodyShapeFindings(title, previewBody(value)), [unresolvedImage("missing.png", "Changed"), missingMedia("Changed")]);
});

test("reads adjacent reference definitions in one block", () => {
  const value = `| State | Evidence |\n| --- | --- |\n| Changed | ![bad][after] |\n\n[before]: ${repositoryImage}\n[after]: missing.png`;
  assert.deepEqual(prBodyShapeFindings(title, previewBody(value)), [unresolvedImage("missing.png", "Changed"), missingMedia("Changed")]);
  const passing = `| State | Evidence |\n| --- | --- |\n| Changed | ![ok][before] |\n\n[before]: ${repositoryImage}\n[after]: missing.png`;
  assert.deepEqual(prBodyShapeFindings(title, previewBody(passing)), []);
});

test("keeps inline-HTML table rows and stops at block HTML", () => {
  assert.deepEqual(prBodyShapeFindings(title, previewBody("State | Evidence\n--- | ---\n<strong>Changed</strong> | no capture\nNext | no capture")), [missingMedia("<strong>Changed</strong>"), missingMedia("Next")]);
  assert.deepEqual(prBodyShapeFindings(title, previewBody("State | Evidence\n--- | ---\n<div>block</div>\nNext | no capture")), []);
});

test("recognizes definitions after headings and thematic breaks but not lazy list or quote continuations", () => {
  const table = `| State | Evidence |\n| --- | --- |\n| Changed | ![ok](${repositoryImage}) ![capture] |\n\n`;
  const real = "[capture]: missing.png";
  assert.deepEqual(prBodyShapeFindings(title, previewBody(`${table}- Captures\n[capture]: ${repositoryImage}\n\n${real}`)), [unresolvedImage("missing.png", "Changed")]);
  assert.deepEqual(prBodyShapeFindings(title, previewBody(`${table}> quote\n[capture]: ${repositoryImage}\n\n${real}`)), [unresolvedImage("missing.png", "Changed")]);
  assert.deepEqual(prBodyShapeFindings(title, previewBody(`${table}### Heading\n${real}`)), [unresolvedImage("missing.png", "Changed")]);
  assert.deepEqual(prBodyShapeFindings(title, previewBody(`${table}---\n${real}`)), [unresolvedImage("missing.png", "Changed")]);
});

test("consumes a multiline definition title without ending the definition block", () => {
  const value = `| State | Evidence |\n| --- | --- |\n| Changed | ![ok](${repositoryImage}) ![bad][after] |\n\n[before]: ${repositoryImage}\n  "Before"\n[after]: missing.png`;
  assert.deepEqual(prBodyShapeFindings(title, previewBody(value)), [unresolvedImage("missing.png", "Changed")]);
  const passing = `| State | Evidence |\n| --- | --- |\n| Changed | ![ok][after] |\n\n[before]: missing.png\n  "Before"\n[after]: ${repositoryImage}`;
  assert.deepEqual(prBodyShapeFindings(title, previewBody(passing)), []);
});

test("recognizes definitions after an empty quote or list item", () => {
  const table = `| State | Evidence |\n| --- | --- |\n| Changed | ![ok](${repositoryImage}) ![capture] |\n\n`;
  assert.deepEqual(prBodyShapeFindings(title, previewBody(`${table}> Reviewer note\n>\n[capture]: missing.png`)), [unresolvedImage("missing.png", "Changed")]);
  assert.deepEqual(prBodyShapeFindings(title, previewBody(`${table}- item\n-\n[capture]: missing.png`)), [unresolvedImage("missing.png", "Changed")]);
});

test("does not consume a second title line after a same-line title", () => {
  const value = `| State | Evidence |\n| --- | --- |\n| Changed | ![ok](${repositoryImage}) ![capture] |\n\n[before]: ${repositoryImage} "Before"\n  "After"\n[capture]: ${repositoryImage}\n\n[capture]: missing.png`;
  assert.deepEqual(prBodyShapeFindings(title, previewBody(value)), [unresolvedImage("missing.png", "Changed")]);
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
  const previewFail = run(title, previewBody(previewRow("no capture")));
  assert.equal(previewFail.status, 1);
  assert.equal(previewFail.stdout, `## PR body shape\n- ${missingMedia()}\nPreview media: a GitHub attachment (github.com/user-attachments/assets or user-images.githubusercontent.com) or an existing repository-relative file; a row without media needs the exact phrase "Preview unchanged" plus a reason.\n`);
  const usage = run(title, body, ["extra"]);
  assert.notEqual(usage.status, 0);
  assert.match(usage.stderr, /Usage:/);
});

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const CHECK_PATH = fileURLToPath(new URL("../check-commit-metadata.mjs", import.meta.url));
const PUBLIC_EMAIL = "1097953+jessepollak@users.noreply.github.com";
const PRIVATE_AUTHOR_EMAIL = "author@example.test";
const PRIVATE_COMMITTER_EMAIL = "committer@example.test";
const TRAILER_EMAIL = "collaborator@example.test";

function git(directory, args, environment = {}) {
  return execFileSync("git", args, {
    cwd: directory,
    encoding: "utf8",
    env: { ...process.env, ...environment },
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

async function withRepository(run) {
  const directory = await mkdtemp(join(tmpdir(), "commit-metadata-"));
  try {
    git(directory, ["init", "--quiet"]);
    git(directory, ["config", "user.name", "Jesse Pollak"]);
    git(directory, ["config", "user.email", PUBLIC_EMAIL]);
    await writeFile(join(directory, "fixture.txt"), "base\n");
    git(directory, ["add", "fixture.txt"]);
    git(directory, ["commit", "--quiet", "-m", "test: add base"]);
    await run(directory, git(directory, ["rev-parse", "HEAD"]));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function addCommit(directory, message, environment = {}) {
  await writeFile(join(directory, "fixture.txt"), "change\n", { flag: "a" });
  git(directory, ["add", "fixture.txt"]);
  git(directory, ["commit", "--quiet", "-m", message], environment);
  return git(directory, ["rev-parse", "HEAD"]);
}

function check(directory, range) {
  return spawnSync(process.execPath, [CHECK_PATH, range], {
    cwd: directory,
    encoding: "utf8",
  });
}

test("accepts public metadata across a real commit range", async () => {
  await withRepository(async (directory, base) => {
    await addCommit(directory, "test: add GitHub web-flow commit", {
      GIT_AUTHOR_EMAIL: "noreply@github.com",
      GIT_COMMITTER_EMAIL: "noreply@github.com",
    });
    const result = check(directory, `${base}..HEAD`);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
  });
});

test("reports only the SHA and author metadata field", async () => {
  await withRepository(async (directory, base) => {
    const sha = await addCommit(directory, "test: add private author", {
      GIT_AUTHOR_NAME: "Private Author",
      GIT_AUTHOR_EMAIL: PRIVATE_AUTHOR_EMAIL,
    });
    const result = check(directory, `${base}..HEAD`);
    assert.equal(result.status, 1);
    assert.equal(result.stderr, `${sha} author.email\n`);
    assert.doesNotMatch(result.stderr, /private author/i);
    assert.doesNotMatch(result.stderr, new RegExp(PRIVATE_AUTHOR_EMAIL));
  });
});

test("reports only the SHA and committer metadata field", async () => {
  await withRepository(async (directory, base) => {
    const sha = await addCommit(directory, "test: add private committer", {
      GIT_COMMITTER_NAME: "Private Committer",
      GIT_COMMITTER_EMAIL: PRIVATE_COMMITTER_EMAIL,
    });
    const result = check(directory, `${base}..HEAD`);
    assert.equal(result.status, 1);
    assert.equal(result.stderr, `${sha} committer.email\n`);
    assert.doesNotMatch(result.stderr, /private committer/i);
    assert.doesNotMatch(result.stderr, new RegExp(PRIVATE_COMMITTER_EMAIL));
  });
});

test("reports a Co-authored-by trailer without exposing its value or body", async () => {
  await withRepository(async (directory, base) => {
    const body = "private body marker";
    const sha = await addCommit(
      directory,
      `test: add attributed commit\n\n${body}\n\nCo-authored-by: Collaborator <${TRAILER_EMAIL}>`,
    );
    const result = check(directory, `${base}..HEAD`);
    assert.equal(result.status, 1);
    assert.equal(result.stderr, `${sha} trailer.Co-authored-by\n`);
    assert.doesNotMatch(result.stderr, new RegExp(body));
    assert.doesNotMatch(result.stderr, new RegExp(TRAILER_EMAIL));
  });
});

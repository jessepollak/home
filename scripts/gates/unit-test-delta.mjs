import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const layers = ["app", "client", "components", "server", "shared"];

export function isUnitTestPath(path) {
  return /^apps\/web\/(?:app|client|components|server|shared)\/(?:[^/]+\/)*[^/]+\.test\.(?:ts|tsx)$/.test(path);
}

export function parseUnitTestNumstat(output) {
  const delta = { addedLines: 0, deletedLines: 0 };
  for (const record of output.split("\0").filter(Boolean)) {
    const match = /^(\d+|-)\t(\d+|-)\t([\s\S]+)$/.exec(record);
    if (!match) throw new Error("malformed numstat output");
    const [, added, deleted, path] = match;
    if (!isUnitTestPath(path)) continue;
    if (added === "-" || deleted === "-") throw new Error("unit-test diff contains binary files");
    delta.addedLines += Number(added);
    delta.deletedLines += Number(deleted);
  }
  return delta;
}

export function parseUnitTestFileChanges(output) {
  const delta = { addedFiles: 0, deletedFiles: 0 };
  const records = output.split("\0");
  if (records.at(-1) === "") records.pop();
  for (let index = 0; index < records.length; index += 2) {
    const status = records[index];
    const path = records[index + 1];
    if (!path || !["A", "D"].includes(status)) throw new Error("malformed file-status output");
    if (!isUnitTestPath(path)) continue;
    delta[status === "A" ? "addedFiles" : "deletedFiles"] += 1;
  }
  return delta;
}

function git(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args[0]} failed`);
  return result.stdout;
}

export function collectUnitTestDelta({ cwd = process.cwd(), base = "origin/main" } = {}) {
  const mergeBase = git(["merge-base", base, "HEAD"], cwd).trim();
  const args = ["diff", "--no-ext-diff", "--no-textconv", "--no-renames", "-z"];
  const paths = layers.map((layer) => `apps/web/${layer}`);
  const lines = git([...args, "--numstat", mergeBase, "HEAD", "--", ...paths], cwd);
  const files = git([...args, "--name-status", "--diff-filter=AD", mergeBase, "HEAD", "--", ...paths], cwd);
  return { ...parseUnitTestNumstat(lines), ...parseUnitTestFileChanges(files) };
}

export function renderUnitTestDelta({ addedLines, deletedLines, addedFiles, deletedFiles }) {
  return `Unit-test lines: +${addedLines} / −${deletedLines} (files +${addedFiles} / −${deletedFiles})`;
}

export function run({ cwd = process.cwd(), env = process.env, stdout = process.stdout } = {}) {
  let summary;
  try {
    const base = env.BASE_REF || `origin/${env.GITHUB_BASE_REF || "main"}`;
    summary = renderUnitTestDelta(collectUnitTestDelta({ cwd, base }));
  } catch (error) {
    summary = `Unit-test delta: unavailable (informational): ${error instanceof Error ? error.message : String(error)}`;
  }
  stdout.write(`${summary}\n`);
  if (env.GITHUB_STEP_SUMMARY) {
    try {
      appendFileSync(env.GITHUB_STEP_SUMMARY, `${summary}\n`);
    } catch (error) {
      stdout.write(`Unit-test delta: could not append step summary (informational): ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run();

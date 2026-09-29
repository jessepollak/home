import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseJunit } from "./test-runtime.mjs";

const web = fileURLToPath(new URL("../../apps/web/", import.meta.url));
const testFile = /(?:\.test\.|_test\.|\.spec\.|_spec\.)(?:js|jsx|ts|tsx|mjs|cjs|mts|cts)$/;
const clientDirs = new Set(["client", "components", "app", "tests"]);
const shards = ["server", "client"];

export function discoverFiles(paths) {
  return paths.filter((path) => !path.split("/").includes("node_modules") && testFile.test(path)).sort();
}

export function shardFor(file) {
  return clientDirs.has(file.split("/")[0]) ? "client" : "server";
}

export function partition(files) {
  return Object.fromEntries(shards.map((shard) => [shard, files.filter((file) => shardFor(file) === shard)]));
}

export function shardArgs(files, shard) {
  return [...new Set(partition(files)[shard].map((file) => `./${file.split("/")[0]}`))].sort();
}

export function verifyReports(files, reports) {
  const expected = new Set(files);
  const seen = new Set();
  const findings = [];
  const counts = Object.fromEntries(shards.map((shard) => [shard, { files: 0, testcases: 0 }]));
  const reported = new Set();
  for (const { shard, timings } of reports) {
    if (!shards.includes(shard)) {
      findings.push(`Unknown shard: ${shard}`);
      continue;
    }
    if (reported.has(shard)) findings.push(`Duplicate report for ${shard}`);
    reported.add(shard);
    counts[shard].files += timings.files.length;
    counts[shard].testcases += timings.testcaseCount;
    for (const { file } of timings.files) {
      if (!expected.has(file)) findings.push(`Untracked test file: ${file}`);
      if (shardFor(file) !== shard) findings.push(`File in wrong shard (${shard}): ${file}`);
      if (seen.has(file)) findings.push(`File in multiple reports: ${file}`);
      seen.add(file);
    }
  }
  for (const file of files) if (!seen.has(file)) findings.push(`Missing test file (zero testcases or not run): ${file}`);
  return { counts, findings };
}

function trackedFiles() {
  const result = spawnSync("git", ["ls-files", "-z", "--", "."], { cwd: web });
  if (result.status !== 0) throw new Error(result.stderr.toString().trim() || "git ls-files failed");
  return discoverFiles(result.stdout.toString().split("\0").filter(Boolean));
}

function usage() {
  console.error("Usage: node scripts/gates/unit-test-shards.mjs run <server|client> | verify --junit <server|client>=<path> [--junit <server|client>=<path>...] ");
  return 1;
}

export function run(argv = process.argv.slice(2)) {
  if (argv[0] === "run") {
    if (argv.length !== 2 || !shards.includes(argv[1])) return usage();
    const paths = shardArgs(trackedFiles(), argv[1]);
    if (!paths.length) throw new Error(`Empty ${argv[1]} shard`);
    const output = resolve(web, "unit-test-results");
    rmSync(output, { recursive: true, force: true });
    mkdirSync(output, { recursive: true });
    const result = spawnSync("bun", ["test", "--max-concurrency", "1", "--reporter=junit", "--reporter-outfile=unit-test-results/junit.xml", ...paths], { cwd: web, stdio: "inherit" });
    if (result.error) throw result.error;
    return result.status ?? 1;
  }
  if (argv[0] !== "verify" || argv.length < 3 || argv.length % 2 !== 1) return usage();
  const reports = [];
  try {
    for (let i = 1; i < argv.length; i += 2) {
      if (argv[i] !== "--junit") return usage();
      const match = argv[i + 1].match(/^(server|client)=(.+)$/);
      if (!match) return usage();
      reports.push({ shard: match[1], timings: parseJunit(readFileSync(match[2], "utf8")) });
    }
    const { counts, findings } = verifyReports(trackedFiles(), reports);
    console.log("## Unit-test shard coverage\n\n| Shard | Files | Testcases |\n| --- | ---: | ---: |");
    for (const shard of shards) console.log(`| ${shard} | ${counts[shard].files} | ${counts[shard].testcases} |`);
    console.log(`| Total | ${shards.reduce((sum, shard) => sum + counts[shard].files, 0)} | ${shards.reduce((sum, shard) => sum + counts[shard].testcases, 0)} |`);
    for (const finding of findings) console.error(finding);
    return findings.length ? 1 : 0;
  } catch (error) {
    console.error(`Unit-test coverage unavailable: ${error.message}`);
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) process.exitCode = run();

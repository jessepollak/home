import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDomTestSource } from "../../apps/web/scripts/dom-test-source.mjs";
import { partition, trackedFiles } from "./unit-test-shards.mjs";

const web = fileURLToPath(new URL("../../apps/web/", import.meta.url));
const shards = ["server", "client"];
const GROUP_BUDGET_MS = 240_000;

export const DEFAULT_GROUP_SIZE = 10;
export const DOM_PRELOAD = "./client/account/dom-test-harness.ts";

export function shardFiles(files, shard) {
  return partition(files)[shard].map((file) => `./${file}`);
}

export function partitions(files, readSource = (file) => readFileSync(join(web, file), "utf8")) {
  const dom = [];
  const nonDom = [];
  for (const file of files) (isDomTestSource(readSource(file), file) ? dom : nonDom).push(file);
  return [
    { name: "non-DOM", files: nonDom, preload: [] },
    { name: "DOM", files: dom, preload: ["--preload", DOM_PRELOAD] },
  ].filter((group) => group.files.length > 0);
}

export function groupFiles(files, size) {
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new Error("HOME_UNIT_TEST_FILE_ORDER_GROUP_SIZE must be a positive integer");
  }
  return Array.from({ length: Math.ceil(files.length / size) }, (_, i) => files.slice(i * size, (i + 1) * size));
}

export function spawnGroup(args, cwd, budgetMs = GROUP_BUDGET_MS) {
  return spawnSync("bun", args, { cwd, stdio: "inherit", timeout: budgetMs, killSignal: "SIGKILL" });
}

function usage() {
  console.error("Usage: node scripts/gates/unit-test-file-order.mjs [server|client]");
  return 1;
}

export function run(argv = process.argv.slice(2), options = {}) {
  if (argv.length > 1 || (argv[0] !== undefined && !shards.includes(argv[0]))) return usage();
  const env = options.env ?? process.env;
  const shard = argv[0] ?? "client";
  const files = shardFiles(trackedFiles(), shard);
  if (!files.length) throw new Error(`Empty ${shard} shard`);
  const configuredSize = env.HOME_UNIT_TEST_FILE_ORDER_GROUP_SIZE;
  const size = configuredSize === undefined || configuredSize.trim() === "" ? DEFAULT_GROUP_SIZE : Number(configuredSize);
  const command = options.command ?? ((args, cwd) => spawnGroup(args, cwd));
  for (const partition of partitions(files, options.readSource)) {
    const groups = groupFiles(partition.files, size);
    for (const [index, group] of groups.entries()) {
      console.log(`File-order ${partition.name} group ${index + 1}/${groups.length}: ${group.length} files`);
      const result = command(["test", "--max-concurrency", "1", ...partition.preload, ...group], web);
      if (result.error?.code === "ETIMEDOUT") {
        console.error(`File-order ${partition.name} group ${index + 1}/${groups.length} exceeded its ${GROUP_BUDGET_MS / 1000}s budget: ${group.join(" ")}`);
        return 1;
      }
      if (result.error) throw result.error;
      const status = result.status ?? 1;
      if (status !== 0) {
        const outcome = result.signal ? `was killed by ${result.signal}` : `failed with exit code ${status}`;
        console.error(`File-order ${partition.name} group ${index + 1}/${groups.length} ${outcome}: ${group.join(" ")}`);
        return status;
      }
    }
  }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = run();

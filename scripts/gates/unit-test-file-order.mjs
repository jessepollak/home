import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDomTestSource } from "../../apps/web/scripts/dom-test-source.mjs";
import { partition, trackedFiles } from "./unit-test-shards.mjs";

const web = fileURLToPath(new URL("../../apps/web/", import.meta.url));
const shards = ["server", "client"];
const domPreload = ["--preload", "./client/account/dom-test-harness.ts"];

export function shardFiles(files, shard) {
  return partition(files)[shard].map((file) => `./${file}`);
}

export function partitions(files, readSource = (file) => readFileSync(join(web, file), "utf8")) {
  const dom = [];
  const nonDom = [];
  for (const file of files) (isDomTestSource(readSource(file), file) ? dom : nonDom).push(file);
  return [
    { name: "non-DOM", files: nonDom, preload: [] },
    { name: "DOM", files: dom, preload: domPreload },
  ].filter((group) => group.files.length > 0);
}

function usage() {
  console.error("Usage: node scripts/gates/unit-test-file-order.mjs [server|client]");
  return 1;
}

export function run(argv = process.argv.slice(2), options = {}) {
  if (argv.length > 1 || (argv[0] !== undefined && !shards.includes(argv[0]))) return usage();
  const shard = argv[0] ?? "client";
  const files = shardFiles(trackedFiles(), shard);
  if (!files.length) throw new Error(`Empty ${shard} shard`);
  const command = options.command ?? ((args) => spawnSync("bun", args, { cwd: web, stdio: "inherit" }));
  for (const group of partitions(files, options.readSource)) {
    console.log(`File-order ${group.name} partition: ${group.files.length} files`);
    const result = command(["test", "--max-concurrency", "1", ...group.preload, ...group.files]);
    if (result.error) throw result.error;
    const status = result.status ?? 1;
    if (status !== 0) return status;
  }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = run();

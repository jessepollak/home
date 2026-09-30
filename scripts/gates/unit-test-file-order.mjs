import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { partition, trackedFiles } from "./unit-test-shards.mjs";

const web = fileURLToPath(new URL("../../apps/web/", import.meta.url));
const shards = ["server", "client"];

export function shardFiles(files, shard) {
  return partition(files)[shard].map((file) => `./${file}`);
}

function usage() {
  console.error("Usage: node scripts/gates/unit-test-file-order.mjs [server|client]");
  return 1;
}

export function run(argv = process.argv.slice(2)) {
  if (argv.length > 1 || (argv[0] !== undefined && !shards.includes(argv[0]))) return usage();
  const shard = argv[0] ?? "client";
  const files = shardFiles(trackedFiles(), shard);
  if (!files.length) throw new Error(`Empty ${shard} shard`);
  const result = spawnSync("bun", ["test", "--max-concurrency", "1", ...files], { cwd: web, stdio: "inherit" });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = run();

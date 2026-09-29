import assert from "node:assert/strict";
import test from "node:test";
import { discoverFiles, partition, shardArgs, shardFor, verifyReports } from "../unit-test-shards.mjs";
import { parseJunit } from "../test-runtime.mjs";

const client = "app/example.test.tsx";
const server = "server/example.spec.mts";
const junit = (file) => parseJunit(`<testsuites tests="1"><testsuite file="${file}"><testcase name="test" time="0" file="${file}"/></testsuite></testsuites>`);
const reports = [{ shard: "client", timings: junit(client) }, { shard: "server", timings: junit(server) }];

test("shard assignment covers owned client layers, root files and new directories", () => {
  for (const dir of ["client", "components", "app", "tests"]) assert.equal(shardFor(`${dir}/example.test.ts`), "client");
  for (const path of ["server/a.test.ts", "shared/a.test.ts", "config/a.test.ts", "scripts/a.test.ts", "oxlint/a.test.ts", "root.test.ts", "new-dir/a.test.ts"]) {
    assert.equal(shardFor(path), "server");
  }
});

test("discovery matches Bun extensions and names and partitions disjointly and completely", () => {
  const names = ["x.test.js", "x_test.jsx", "x.spec.ts", "x_spec.tsx", "x.test.mjs", "x_test.cjs", "x.spec.mts", "x_spec.cts"];
  const paths = [...names.map((name) => `client/${name}`), server, "root.test.ts", "new-dir/x.spec.ts"];
  assert.deepEqual(discoverFiles([...paths, "node_modules/x.test.ts", "client/not-a-test.ts", "client/x.test.json"]), [...paths].sort());
  const groups = partition(paths);
  assert.deepEqual(groups.client, names.map((name) => `client/${name}`));
  assert.deepEqual(groups.server, [server, "root.test.ts", "new-dir/x.spec.ts"]);
  assert.deepEqual(new Set([...groups.client, ...groups.server]), new Set(paths));
});

test("shards run as top-level paths so Bun keeps its discovery order", () => {
  const paths = ["client/b/x.test.ts", "client/a.test.ts", "app/x.test.tsx", "server/x.test.ts", "root.test.ts", "new-dir/x.spec.ts"];
  assert.deepEqual(shardArgs(paths, "client"), ["./app", "./client"]);
  assert.deepEqual(shardArgs(paths, "server"), ["./new-dir", "./root.test.ts", "./server"]);
  assert.deepEqual(shardArgs([], "client"), []);
});

test("valid split passes with testcase counts", () => {
  assert.deepEqual(verifyReports([client, server], reports), {
    counts: { server: { files: 1, testcases: 1 }, client: { files: 1, testcases: 1 } }, findings: [],
  });
});

test("missing file, duplicate across reports, and wrong shard fail", () => {
  assert.match(verifyReports([client, server, "root.test.ts"], reports).findings.join("\n"), /Missing test file.*root.test.ts/);
  assert.match(verifyReports([client, server], [...reports, reports[0]]).findings.join("\n"), /File in multiple reports: app\/example.test.tsx/);
  assert.match(verifyReports([client, server], [{ shard: "server", timings: junit(client) }, reports[1]]).findings.join("\n"), /File in wrong shard.*app\/example.test.tsx/);
  assert.match(verifyReports([client, server], [{ shard: "client", timings: junit("app/untracked.test.ts") }, reports[1]]).findings.join("\n"), /Untracked test file/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { shardFiles, run } from "../unit-test-file-order.mjs";

const paths = ["app/a.test.tsx", "client/b.test.ts", "components/c.test.tsx", "tests/d.test.ts", "server/e.test.ts", "root.test.ts"].sort();

test("the file-order check lists one shard as explicit paths in discovery order", () => {
  assert.deepEqual(shardFiles(paths, "client"), ["./app/a.test.tsx", "./client/b.test.ts", "./components/c.test.tsx", "./tests/d.test.ts"]);
  assert.deepEqual(shardFiles(paths, "server"), ["./root.test.ts", "./server/e.test.ts"]);
  assert.deepEqual(shardFiles([], "client"), []);
});

test("every file of the shard is listed once as an explicit path", () => {
  const args = shardFiles(paths, "client");
  assert.equal(new Set(args).size, args.length);
  assert.equal(args.length + shardFiles(paths, "server").length, paths.length);
  for (const arg of args) assert.match(arg, /^\.\/[^/]+\//);
});

test("an unknown shard and extra arguments fail with usage", () => {
  const logged = [];
  const original = console.error;
  console.error = (message) => logged.push(message);
  try {
    assert.equal(run(["clientish"]), 1);
    assert.equal(run(["client", "extra"]), 1);
  } finally {
    console.error = original;
  }
  assert.equal(logged.length, 2);
});

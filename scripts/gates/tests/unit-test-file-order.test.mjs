import assert from "node:assert/strict";
import test from "node:test";
import { partitions, shardFiles, run } from "../unit-test-file-order.mjs";

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

test("a shard is split into non-DOM first and DOM with the harness preload", () => {
  const sources = new Map([
    ["./a.test.ts", "export {};"],
    ["./b.test.tsx", 'import { render } from "@testing-library/react";'],
    ["./c.test.ts", 'import "@/client/account/dom-test-harness";'],
  ]);
  assert.deepEqual(partitions([...sources.keys()], (file) => sources.get(file)), [
    { name: "non-DOM", files: ["./a.test.ts"], preload: [] },
    { name: "DOM", files: ["./b.test.tsx", "./c.test.ts"], preload: ["--preload", "./client/account/dom-test-harness.ts"] },
  ]);
  assert.deepEqual(partitions(["./a.test.ts"], () => "export {};"), [{ name: "non-DOM", files: ["./a.test.ts"], preload: [] }]);
  assert.deepEqual(partitions(["./b.test.tsx"], () => 'import "@testing-library/react";'), [{ name: "DOM", files: ["./b.test.tsx"], preload: ["--preload", "./client/account/dom-test-harness.ts"] }]);
});

function quiet(callback) {
  const original = console.log;
  console.log = () => {};
  try {
    return callback();
  } finally {
    console.log = original;
  }
}

function alternatingSources() {
  let first = true;
  return () => {
    const source = first ? 'import "@testing-library/react";' : "export {};";
    first = false;
    return source;
  };
}

test("a failing partition stops the run and reports its status", () => {
  const calls = [];
  const status = quiet(() => run(["client"], {
    readSource: alternatingSources(),
    command: (args) => {
      calls.push(args);
      return { status: 3 };
    },
  }));
  assert.equal(status, 3);
  assert.equal(calls.length, 1);
});

test("a spawn error propagates out of the run", () => {
  const failure = new Error("spawn failed");
  assert.throws(() => quiet(() => run(["client"], {
    readSource: () => "export {};",
    command: () => ({ error: failure }),
  })), (error) => error === failure);
});

test("an unreadable source fails before any test process starts", () => {
  const calls = [];
  const failure = new Error("unreadable");
  assert.throws(() => quiet(() => run(["client"], {
    readSource: () => { throw failure; },
    command: (args) => {
      calls.push(args);
      return { status: 0 };
    },
  })), (error) => error === failure);
  assert.equal(calls.length, 0);
});

test("both partitions run in order and only the DOM partition carries the harness preload", () => {
  const calls = [];
  const status = quiet(() => run(["client"], {
    readSource: alternatingSources(),
    command: (args) => {
      calls.push(args);
      return { status: 0 };
    },
  }));
  assert.equal(status, 0);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].slice(0, 3), ["test", "--max-concurrency", "1"]);
  assert.ok(!calls[0].includes("--preload"));
  assert.deepEqual(calls[1].slice(0, 5), ["test", "--max-concurrency", "1", "--preload", "./client/account/dom-test-harness.ts"]);
});

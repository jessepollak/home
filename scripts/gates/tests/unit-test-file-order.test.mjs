import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { DEFAULT_GROUP_SIZE, DOM_PRELOAD, groupFiles, partitions, run, shardFiles, spawnGroup } from "../unit-test-file-order.mjs";
import { trackedFiles } from "../unit-test-shards.mjs";

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

test("groups are contiguous, complete and preserve file order", () => {
  const files = Array.from({ length: 23 }, (_, i) => `./file-${i}.test.ts`);
  const groups = groupFiles(files, 10);
  assert.deepEqual(groups, [files.slice(0, 10), files.slice(10, 20), files.slice(20, 30)]);
  assert.deepEqual(groups.flat(), files);
  assert.equal(new Set(groups.flat()).size, files.length);
  assert.deepEqual(groupFiles([], 10), []);
  assert.deepEqual(groupFiles(files, 1), files.map((file) => [file]));
  assert.deepEqual(groupFiles(files, 25), [files]);
});

test("group size must be a positive safe integer", () => {
  for (const size of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "10", null, undefined]) {
    assert.throws(() => groupFiles(paths, size), {
      message: "HOME_UNIT_TEST_FILE_ORDER_GROUP_SIZE must be a positive integer",
    });
  }
  assert.deepEqual(groupFiles(paths, Number.MAX_SAFE_INTEGER), [paths]);
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

test("a failing group stops the run and reports its status", () => {
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
    env: { HOME_UNIT_TEST_FILE_ORDER_GROUP_SIZE: String(Number.MAX_SAFE_INTEGER) },
    command: (args) => {
      calls.push(args);
      return { status: 0 };
    },
  }));
  assert.equal(status, 0);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].slice(0, 3), ["test", "--max-concurrency", "1"]);
  assert.ok(!calls[0].includes("--preload"));
  assert.deepEqual(calls[1].slice(0, 5), ["test", "--max-concurrency", "1", "--preload", DOM_PRELOAD]);
});

test("run executes each explicit client group sequentially in the web directory", () => {
  const files = shardFiles(trackedFiles(), "client");
  const calls = [];
  const result = run(["client"], {
    env: { HOME_UNIT_TEST_FILE_ORDER_GROUP_SIZE: "25" },
    command: (args, cwd) => {
      calls.push({ args, cwd });
      return { status: 0 };
    },
  });
  assert.equal(result, 0);
  const web = fileURLToPath(new URL("../../../apps/web/", import.meta.url));
  const parts = partitions(files);
  assert.deepEqual(calls, parts.flatMap((partition) => groupFiles(partition.files, 25).map((group) => ({
    args: ["test", "--max-concurrency", "1", ...partition.preload, ...group],
    cwd: web,
  }))));
  const commandFiles = calls.flatMap(({ args }) => args.slice(args.includes("--preload") ? 5 : 3));
  assert.deepEqual(commandFiles, parts.flatMap((partition) => partition.files));
  assert.deepEqual([...commandFiles].sort(), [...files].sort());
});

test("every DOM group carries the harness preload", () => {
  const files = shardFiles(trackedFiles(), "client");
  const calls = [];
  const result = run(["client"], {
    env: { HOME_UNIT_TEST_FILE_ORDER_GROUP_SIZE: "25" },
    readSource: () => 'import "@testing-library/react";',
    command: (args) => {
      calls.push(args);
      return { status: 0 };
    },
  });
  assert.equal(result, 0);
  assert.deepEqual(calls, groupFiles(files, 25).map((group) => ["test", "--max-concurrency", "1", "--preload", DOM_PRELOAD, ...group]));
});

test("run defaults to client groups of ten files", () => {
  assert.equal(DEFAULT_GROUP_SIZE, 10);
  const files = shardFiles(trackedFiles(), "client");
  const calls = [];
  assert.equal(run([], {
    env: {},
    readSource: () => "export {};",
    command: (args) => {
      calls.push(args);
      return { status: 0 };
    },
  }), 0);
  assert.deepEqual(calls, groupFiles(files, 10).map((group) => ["test", "--max-concurrency", "1", ...group]));
});

test("a failing second group reports its files and stops later groups", (t) => {
  const groups = groupFiles(shardFiles(trackedFiles(), "client"), 1);
  assert.ok(groups.length > 2);
  const logged = [];
  t.mock.method(console, "error", (message) => logged.push(message));
  let calls = 0;
  const result = run(["client"], {
    env: { HOME_UNIT_TEST_FILE_ORDER_GROUP_SIZE: "1" },
    readSource: () => "export {};",
    command: () => ({ status: ++calls === 2 ? 7 : 0 }),
  });
  assert.equal(result, 7);
  assert.equal(calls, 2);
  assert.deepEqual(logged, [
    `File-order non-DOM group 2/${groups.length} failed with exit code 7: ${groups[1].join(" ")}`,
  ]);
});

test("a killed group reports its signal and files", (t) => {
  const groups = groupFiles(shardFiles(trackedFiles(), "client"), 25);
  const logged = [];
  t.mock.method(console, "error", (message) => logged.push(message));
  const result = run(["client"], {
    env: { HOME_UNIT_TEST_FILE_ORDER_GROUP_SIZE: "25" },
    readSource: () => "export {};",
    command: () => ({ status: null, signal: "SIGKILL" }),
  });
  assert.equal(result, 1);
  assert.deepEqual(logged, [
    `File-order non-DOM group 1/${groups.length} was killed by SIGKILL: ${groups[0].join(" ")}`,
  ]);
});

test("a timed-out group reports its budget and files and stops later groups", (t) => {
  const groups = groupFiles(shardFiles(trackedFiles(), "client"), 25);
  const logged = [];
  t.mock.method(console, "error", (message) => logged.push(message));
  let calls = 0;
  const result = run(["client"], {
    env: { HOME_UNIT_TEST_FILE_ORDER_GROUP_SIZE: "25" },
    readSource: () => "export {};",
    command: () => {
      calls++;
      return { status: null, error: Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }) };
    },
  });
  assert.equal(result, 1);
  assert.equal(calls, 1);
  assert.deepEqual(logged, [
    `File-order non-DOM group 1/${groups.length} exceeded its 240s budget: ${groups[0].join(" ")}`,
  ]);
});

test("the default group command kills a child that ignores the budget", () => {
  const result = spawnGroup(["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"], process.cwd(), 300);
  assert.equal(result.error?.code, "ETIMEDOUT");
  assert.equal(result.signal, "SIGKILL");
});

test("a command error other than a timeout is thrown", () => {
  const error = Object.assign(new Error("missing executable"), { code: "ENOENT" });
  assert.throws(() => run(["client"], {
    env: {},
    command: () => ({ status: null, error }),
  }), (caught) => caught === error);
});

test("an invalid group-size environment value throws before running a command", () => {
  for (const value of ["0", "-1", "1.5", "invalid", "Infinity", "9007199254740992"]) {
    assert.throws(() => run(["client"], {
      env: { HOME_UNIT_TEST_FILE_ORDER_GROUP_SIZE: value },
      readSource: () => "export {};",
      command: () => assert.fail("invalid group size must not run a command"),
    }), { message: "HOME_UNIT_TEST_FILE_ORDER_GROUP_SIZE must be a positive integer" });
  }
});

test("a blank group-size environment value uses the default", () => {
  const files = shardFiles(trackedFiles(), "client");
  const calls = [];
  assert.equal(run(["client"], {
    env: { HOME_UNIT_TEST_FILE_ORDER_GROUP_SIZE: "  " },
    readSource: () => "export {};",
    command: (args) => {
      calls.push(args);
      return { status: 0 };
    },
  }), 0);
  assert.equal(calls.length, Math.ceil(files.length / DEFAULT_GROUP_SIZE));
});

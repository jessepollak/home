import { expect, test } from "bun:test";
import { isRecord } from "@/shared/guards";
import { makeDirectory, readFixture, withUnitTestFixture, writeFixture } from "./unit-tests-fixture";
import { parseJunit } from "../../../scripts/gates/test-runtime.mjs";
import { DEFAULT_BATCH_SIZE, batchTests, classifyBatch, discoverTests, filterTests, isDomTestSource, mergeJunit, normalizeRss, run, splitArgs, summarize, type Command } from "./unit-tests";

async function readMemoryBatches(cwd: string) {
  const memory: unknown = JSON.parse(await readFixture(cwd, "unit-test-results/memory.json"));
  if (!isRecord(memory) || !Array.isArray(memory.batches)) throw new Error("Missing memory batches");
  const batches: unknown[] = memory.batches;
  return batches.map((batch) => {
    if (!isRecord(batch)) throw new Error("Invalid memory batch");
    return batch;
  });
}

const xml = (name: string, failures = 0) => `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="bun test" tests="1" assertions="2" failures="${failures}" skipped="0" time="0.2">
  <testsuite name="${name}" file="${name}" tests="1" assertions="2" failures="${failures}" skipped="0" time="0.1">
    <testcase name="case" file="${name}" time="0.1" />
  </testsuite>
</testsuites>`;

test("discovery uses Bun suffixes and skips hidden, generated and dependency directories", async () => {
  await withUnitTestFixture(async (cwd) => {
    for (const directory of [".next", ".hidden", "node_modules", "storybook-static"]) {
      await makeDirectory(cwd, directory);
      await writeFixture(cwd, `${directory}/bad.test.ts`, "");
    }
    await writeFixture(cwd, "nested/extra.test.cts", "");
    await writeFixture(cwd, "nested/invalid.test.txt", "");
    expect(await discoverTests(cwd)).toEqual(["./nested/extra.test.cts", "./nested/one.test.ts", "./nested/two_spec.js"]);
  });
});

test("batches, substring filters and option values", () => {
  expect(batchTests(["a", "b", "c", "d", "e"], 2)).toEqual([["a", "b"], ["c", "d"], ["e"]]);
  expect(() => batchTests(["a"], 0)).toThrow();
  const files = ["./a/one.test.ts", "./b/two.test.ts"];
  expect(filterTests(files, ["two"])).toEqual([files[1]]);
  expect(filterTests(files, ["none"])).toEqual([]);
  expect(filterTests(files, ["./b"])).toEqual([files[1]]);
  expect(filterTests(files, ["./a/one.test.ts"])).toEqual([files[0]]);
  expect(filterTests(files, ["./b/one.test.ts"])).toEqual([]);
  expect(splitArgs(["two", "-t", "case name", "--timeout", "100", "--retry=2", "a/"])).toEqual({ filters: ["two", "a/"], flags: ["-t", "case name", "--timeout", "100", "--retry=2"] });
  expect(() => splitArgs(["-t"])).toThrow();
  expect(() => splitArgs(["--watch"])).toThrow("not supported across batches");
  expect(() => splitArgs(["--bail=1"])).toThrow("not supported across batches");
  expect(() => splitArgs(["--hot"])).toThrow("not supported across batches");
  expect(() => splitArgs(["--coverage"])).toThrow("run bun test directly");
  expect(() => splitArgs(["--coverage-reporter=lcov"])).toThrow("run bun test directly");
  expect(() => splitArgs(["--coverage-dir", "coverage"])).toThrow("run bun test directly");
});

test("only the operator inbox suite is isolated from default 25-file batches", () => {
  const inbox = "./client/operator-support/operator-support-inbox.test.tsx";
  const files = Array.from({ length: 26 }, (_, index) => `./client/suite-${index}.test.tsx`);
  const batches = batchTests([...files.slice(0, 13), inbox, ...files.slice(13)], DEFAULT_BATCH_SIZE);
  expect(batches).toEqual([files.slice(0, 25), files.slice(25), [inbox]]);
  expect(batchTests([inbox], DEFAULT_BATCH_SIZE)).toEqual([[inbox]]);
});

test("DOM partition scan recognizes runtime imports but not comments or type-only imports", () => {
  expect(isDomTestSource('import "@/client/account/dom-test-harness";')).toBe(true);
  expect(isDomTestSource('import { render } from "@testing-library/react";')).toBe(true);
  expect(isDomTestSource('const library = await import("@testing-library/react");')).toBe(true);
  expect(isDomTestSource('import { page } from "@/tests/helpers/dom";')).toBe(true);
  expect(isDomTestSource('// import "@/client/account/dom-test-harness";')).toBe(false);
  expect(isDomTestSource('import type { Foo } from "@testing-library/react";')).toBe(false);
});

test("runner separates DOM tests and preloads only their batches", async () => {
  await withUnitTestFixture(async (cwd) => {
    await writeFixture(cwd, "nested/three.test.tsx", 'import "@/client/account/dom-test-harness";');
    const seen: string[][] = [];
    const command: Command = async (args) => {
      seen.push(args);
      const outfile = args.find((arg) => arg.startsWith("--reporter-outfile="))!.split("=")[1];
      const file = args.at(-1)!;
      await writeFixture(cwd, outfile, xml(file));
      return { exit: 0, signal: null, seconds: 0 };
    };
    expect(await run([], { cwd, command, log: () => {} })).toBe(0);
    expect(seen).toHaveLength(2);
    expect(seen[0]).not.toContain("--preload");
    expect(seen[1]).toContain("./client/account/dom-test-harness.ts");
    const batches = await readMemoryBatches(cwd);
    expect(batches.map((batch) => batch.partition)).toEqual(["non-dom", "dom"]);
  });
});

test("blank optional overrides from a copied env template use the defaults", async () => {
  await withUnitTestFixture(async (cwd) => {
    const sizes: number[] = [];
    const command: Command = async (args) => {
      const outfile = args.find((arg) => arg.startsWith("--reporter-outfile="))!.split("=")[1];
      sizes.push(args.filter((arg) => arg.startsWith("./")).length);
      await writeFixture(cwd, outfile, xml("one.test.ts"));
      return { exit: 0, signal: null, seconds: 0 };
    };
    expect(await run([], { cwd, env: { HOME_UNIT_TEST_BATCH_SIZE: "", HOME_UNIT_TEST_MAX_RSS_MB: " " }, command, log: () => {} })).toBe(0);
    expect(sizes).toEqual([2]);
  });
});

test("merged JUnit sums counts and preserves nested suites for runtime gate", () => {
  const merged = mergeJunit([xml("a.test.ts"), xml("b.test.ts", 1)]);
  expect(merged).toContain('tests="2" assertions="4" failures="1" skipped="0" time="0.4"');
  expect(parseJunit(merged).files.map((entry: { file: string }) => entry.file)).toEqual(["a.test.ts", "b.test.ts"]);
  expect(merged).toContain('  <testsuite name="a.test.ts"');
  expect(merged).toContain('  <testsuite name="b.test.ts"');
  expect(() => mergeJunit([xml("a.test.ts").replace('tests="1"', 'tests="2"')])).toThrow();
});

test("classification distinguishes test failure, crash and missing JUnit", () => {
  expect(classifyBatch(0, null, xml("one"), false)).toBe("pass");
  expect(classifyBatch(1, null, xml("one", 1), false)).toBe("test failures");
  expect(classifyBatch(1, null, xml("one"), false)).toBe("runtime error");
  expect(classifyBatch(1, null, null, false)).toBe("runtime crash");
  expect(classifyBatch(133, "SIGTRAP", xml("one"), false)).toBe("runtime crash");
  expect(classifyBatch(0, "SIGSEGV", xml("one"), false)).toBe("runtime crash");
  expect(classifyBatch(0, null, "bad xml", false)).toBe("runtime crash");
  expect(normalizeRss(1048576, "darwin")).toBe(1048576);
  const skipped = xml("one").replace('skipped="0"', 'skipped="1"');
  expect(classifyBatch(1, null, skipped, true)).toBe("no matching tests");
  expect(normalizeRss(1024, "linux")).toBe(1048576);
  expect(summarize([{ index: 1, partition: "non-dom", files: ["one"], exit: 133, signal: "SIGTRAP", status: "runtime crash", peakRssBytes: 1024 ** 3, seconds: 3, overLimit: false }])).toContain("1 Bun runtime crashes");
  expect(summarize([{ index: 1, partition: "dom", files: ["one"], exit: 1, signal: null, status: "runtime error", peakRssBytes: null, seconds: 1, overLimit: false }])).toContain("1 Bun runtime errors");
});

test("runner continues past failures, records RSS ceiling and merges available JUnit", async () => {
  await withUnitTestFixture(async (cwd) => {
    const logs: string[] = [];
    let invoked = 0;
    const command: Command = async (args) => {
      invoked++;
      const path = args.find((arg) => arg.startsWith("--reporter-outfile="))!.split("=")[1];
      if (invoked === 1) {
        await writeFixture(cwd, path, xml("one.test.ts", 1));
        return { exit: 1, signal: null, maxRSS: process.platform === "darwin" ? 3 * 1024 ** 2 : 3 * 1024, seconds: 0.1 };
      }
      return { exit: 133, signal: "SIGTRAP", seconds: 0.2 };
    };
    expect(await run([], { cwd, env: { HOME_UNIT_TEST_BATCH_SIZE: "1", HOME_UNIT_TEST_MAX_RSS_MB: "2" }, command, log: (message) => logs.push(message) })).toBe(1);
    expect(invoked).toBe(2);
    const batches = await readMemoryBatches(cwd);
    expect(batches.map((batch) => batch.status)).toEqual(["test failures", "runtime crash"]);
    expect(batches[0].overLimit).toBe(true);
    expect(parseJunit(await readFixture(cwd, "unit-test-results/junit.xml")).tests).toHaveLength(1);
    expect(logs.join("\n")).toContain("Bun runtime crash, not a test failure");
    expect(logs.join("\n")).toContain("RSS ceiling exceeded");
    expect(await run(["missing"], { cwd, command, log: () => {} }).catch((error: Error) => error.message)).toContain("No unit test files match");
    expect(await readFixture(cwd, "unit-test-results/junit.xml").catch(() => "removed")).toBe("removed");
  });
});

test("a batch report with no failing testcase is a runtime error, not a test failure", async () => {
  await withUnitTestFixture(async (cwd) => {
    const logs: string[] = [];
    const command: Command = async (args) => {
      const outfile = args.find((arg) => arg.startsWith("--reporter-outfile="))!.split("=")[1];
      await writeFixture(cwd, outfile, xml("nested/one.test.ts"));
      return { exit: 1, signal: null, seconds: 0.1 };
    };
    expect(await run([], { cwd, command, log: (message) => logs.push(message) })).toBe(1);
    const batches = await readMemoryBatches(cwd);
    expect(batches.map((batch) => batch.status)).toEqual(["runtime error"]);
    expect(logs.join("\n")).toContain("Bun runtime error, not a test failure");
    expect(parseJunit(await readFixture(cwd, "unit-test-results/junit.xml")).tests).toHaveLength(1);
  });
});

test("real spawned SIGSEGV is classified as a runtime crash", async () => {
  await withUnitTestFixture(async (cwd) => {
    const command: Command = async () => {
      const child = Bun.spawn(["/bin/sh", "-c", "ulimit -c 0 2>/dev/null; kill -s SEGV $$"], { stdout: "ignore", stderr: "ignore" });
      const exit = await child.exited;
      return { exit, signal: child.signalCode ?? null, maxRSS: child.resourceUsage()?.maxRSS, seconds: 0 };
    };
    const logs: string[] = [];
    expect(await run(["one.test.ts"], { cwd, command, log: (line) => logs.push(line) })).toBe(1);
    const batches = await readMemoryBatches(cwd);
    expect(batches[0].status).toBe("runtime crash");
    expect(batches[0].signal).toBe("SIGSEGV");
    expect(logs.join("\n")).toContain("Bun runtime crash, not a test failure");
  });
});

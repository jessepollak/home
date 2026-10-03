import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { removeFixture } from "./fixture-cleanup.mjs";

test("removes a nested fixture tree", () => {
  const fixture = mkdtempSync(path.join(tmpdir(), "fixture-cleanup-nested-"));
  try {
    const nested = path.join(fixture, "nested", "deeper");
    mkdirSync(nested, { recursive: true });
    writeFileSync(path.join(fixture, "seed.txt"), "seed\n");
    writeFileSync(path.join(nested, "leaf.txt"), "leaf\n");
    removeFixture(fixture);
    assert.equal(existsSync(fixture), false);
  } finally {
    removeFixture(fixture);
  }
});

test("names the fixture and preserves the final cleanup error cause", { skip: process.getuid?.() === 0 }, () => {
  const parent = mkdtempSync(path.join(tmpdir(), "fixture-cleanup-permissions-"));
  const fixture = path.join(parent, "fixture");
  try {
    mkdirSync(fixture);
    writeFileSync(path.join(fixture, "seed.txt"), "seed\n");
    chmodSync(parent, 0o500);
    assert.throws(() => removeFixture(fixture), (error) => {
      assert.ok(error.message.includes(fixture));
      assert.ok(error.message.endsWith(": EACCES"));
      assert.equal(error.cause.code, "EACCES");
      return true;
    });
  } finally {
    chmodSync(parent, 0o700);
    removeFixture(parent);
  }
});

const writerSource = `
const { writeFileSync } = require("node:fs");
const path = require("node:path");
let index = 0;
function write() {
  const before = Date.now();
  try {
    writeFileSync(path.join(process.env.FIXTURE_DIR, "writer-" + index++), "writer\\n");
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error("fixture writer failed: " + error.message);
      process.exit(1);
    }
    return;
  }
  process.stdout.write("write " + before + " " + Date.now() + "\\n");
  setTimeout(write, 0);
}
write();
`;

function overlapsRemoval(spans, startedAt, finishedAt) {
  return spans.some(([before, after]) => before > startedAt && after < finishedAt);
}

function startWriter(directory, executable = process.execPath) {
  const writer = spawn(executable, ["-e", writerSource], { env: { ...process.env, FIXTURE_DIR: directory }, stdio: ["ignore", "pipe", "inherit"] });
  let output = "";
  let spawnError = null;
  let ended = null;
  writer.stdout.setEncoding("utf8");
  writer.stdout.on("data", (chunk) => {
    output += chunk;
  });
  const exited = new Promise((resolve) => {
    writer.once("error", (error) => {
      spawnError = error;
      resolve();
    });
    writer.once("exit", (code, signal) => {
      ended = { code, signal };
      resolve();
    });
  });
  const spans = () => output.split("\n").slice(0, -1).flatMap((line) => {
    const match = line.match(/^write (\d+) (\d+)$/);
    return match ? [[Number(match[1]), Number(match[2])]] : [];
  });
  const waitForData = (timeoutMs) => new Promise((resolve) => {
    const onData = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      writer.stdout.off("data", onData);
      resolve(false);
    }, timeoutMs);
    writer.stdout.once("data", onData);
  });
  const waitFor = async (predicate, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
      if (spawnError) return false;
      const remaining = deadline - Date.now();
      if (remaining <= 0) return false;
      const received = await waitForData(Math.min(remaining, 100));
      if (!received && ended) return false;
    }
    return true;
  };
  return { writer, exited, spans, waitFor, spawnError: () => spawnError, ended: () => ended };
}

async function raceRemoval(executable) {
  const fixture = mkdtempSync(path.join(tmpdir(), "fixture-cleanup-writer-"));
  for (let index = 0; index < 250; index += 1) writeFileSync(path.join(fixture, `seed-${index}`), "seed\n");
  const writer = startWriter(fixture, executable);
  try {
    assert.ok(await writer.waitFor(() => writer.spans().length >= 2, 5000), "the fixture writer never started");
    const startedAt = Date.now();
    let failure = null;
    try {
      removeFixture(fixture);
    } catch (error) {
      failure = error;
    }
    const finishedAt = Date.now();
    const overlapped = await writer.waitFor(() => overlapsRemoval(writer.spans(), startedAt, finishedAt), 1000);
    if (failure) {
      assert.ok(failure.message.startsWith("fixture cleanup failed for "), failure.message);
      assert.ok(failure.message.includes(fixture), failure.message);
      assert.ok(["EBUSY", "EMFILE", "ENFILE", "ENOTEMPTY", "EPERM"].includes(failure.cause?.code), `unexpected cause: ${failure.cause?.code}`);
    } else {
      assert.equal(existsSync(fixture), false);
    }
    return overlapped;
  } finally {
    writer.writer.kill("SIGKILL");
    await writer.exited;
    removeFixture(fixture);
    assert.ok(!writer.spawnError(), `fixture writer failed to start: ${writer.spawnError()?.message}`);
    assert.ok(!writer.ended() || writer.ended().signal === "SIGKILL" || writer.ended().code === 0, `fixture writer failed: ${JSON.stringify(writer.ended())}`);
  }
}

test("accepts only a write bracket inside the removal window", () => {
  assert.equal(overlapsRemoval([[50, 60]], 100, 200), false);
  assert.equal(overlapsRemoval([[150, 160]], 100, 200), true);
  assert.equal(overlapsRemoval([[90, 110]], 100, 200), false);
  assert.equal(overlapsRemoval([[150, 250]], 100, 200), false);
});

test("handles a concurrent fixture writer with removal or a named retryable error", async () => {
  for (let attempt = 0; ; attempt += 1) {
    if (await raceRemoval()) return;
    assert.ok(attempt < 2, "the fixture writer never wrote during removal");
  }
});

test("cleans up when the writer cannot start", async () => {
  await assert.rejects(raceRemoval("/nonexistent/node-binary"), /fixture writer failed to start/);
});

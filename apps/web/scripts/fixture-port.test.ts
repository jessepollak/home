import { afterEach, expect, test } from "bun:test";
import { spawn } from "node:child_process";
// oxlint-disable-next-line home/no-source-reads -- Lock tests only read their own system-temp scratch files.
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import {
  probeFixturePort,
  releaseFixturePort,
  reserveFixturePort,
  selectFixturePort,
} from "./fixture-port";

let testDirectory: string | undefined;
let testSibling: ReturnType<typeof spawn> | undefined;

afterEach(() => {
  testSibling?.kill();
  testSibling = undefined;
  if (testDirectory) {
    chmodSync(testDirectory, 0o700);
    rmSync(testDirectory, { recursive: true, force: true });
  }
  testDirectory = undefined;
});

function scratchDirectory(): string {
  testDirectory = mkdtempSync(join(tmpdir(), "home-fixture-port-test-"));
  return testDirectory;
}

test("an explicit HOME_FIXTURE_PORT is used as given", () => {
  const probe = () => {
    throw new Error("probe must not run for an explicit port");
  };
  expect(selectFixturePort("4500", probe, () => {
    throw new Error("reserve must not run for an explicit port");
  })).toBe("4500");
});

test("an invalid HOME_FIXTURE_PORT is rejected", () => {
  const probe = () => null;
  const reserve = () => "unused";
  expect(() => selectFixturePort("0", probe, reserve)).toThrow(/valid TCP port/);
  expect(() => selectFixturePort("70000", probe, reserve)).toThrow(/valid TCP port/);
  expect(() => selectFixturePort("abc", probe, reserve)).toThrow(/valid TCP port/);
});

test("an unset port always takes a freshly bound ephemeral port", () => {
  const ports = [52341, 52342];
  const probe = () => ports.shift() ?? null;
  const reserve = () => "reserved";
  expect(selectFixturePort(undefined, probe, reserve)).toBe("52341");
  expect(selectFixturePort(undefined, probe, reserve)).toBe("52342");
});

test("no free port is a hard error", () => {
  expect(() => selectFixturePort(undefined, () => null, () => "unused")).toThrow(/free port/);
});

test("reservation attempts stop after 32 busy ports", () => {
  let probes = 0;
  expect(() => selectFixturePort(undefined, () => {
    probes++;
    return 52341;
  }, () => undefined)).toThrow(/reserve a free port/);
  expect(probes).toBe(32);
});

test("probing binds a real port", () => {
  const port = probeFixturePort();
  expect(port).not.toBeNull();
  expect(port).toBeGreaterThanOrEqual(1);
  expect(port).toBeLessThanOrEqual(65535);
});

test("a port reserved by a live sibling is skipped for the next free port", async () => {
  const directory = scratchDirectory();
  const sibling = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  testSibling = sibling;
  await new Promise<void>((resolve, reject) => {
    sibling.once("spawn", resolve);
    sibling.once("error", reject);
  });
  const siblingPath = join(directory, `52341.${sibling.pid}.lock`);
  writeFileSync(siblingPath, `${sibling.pid}\n`);
  const ports = [52341, 52342];
  let ownPath: string | undefined;
  expect(selectFixturePort(
    undefined,
    () => ports.shift() ?? null,
    (port) => {
      ownPath = reserveFixturePort(port, directory);
      return ownPath;
    },
  )).toBe("52342");
  if (!ownPath) throw new Error("Expected a fixture port reservation");
  expect(basename(ownPath)).toMatch(new RegExp(`^52342\\.${process.pid}\\.[0-9a-f]+\\.lock$`));
  expect(readFileSync(siblingPath, "utf8")).toBe(`${sibling.pid}\n`);
  expect(readFileSync(ownPath, "utf8")).toBe(`${process.pid}\n`);
  releaseFixturePort(ownPath);
});

test("a free port returns a generation-unique claim and blocks re-reserving in this process", () => {
  const directory = scratchDirectory();
  const path = reserveFixturePort(52343, directory);
  if (!path) throw new Error("Expected a fixture port reservation");
  expect(basename(path)).toMatch(new RegExp(`^52343\\.${process.pid}\\.[0-9a-f]+\\.lock$`));
  expect(readFileSync(path, "utf8")).toBe(`${process.pid}\n`);
  expect(reserveFixturePort(52343, directory)).toBeUndefined();
  expect(readdirSync(directory)).toEqual([basename(path)]);
  releaseFixturePort(path);
});

test("releasing a generation-unique claim removes it and allows the port to be claimed again", () => {
  const directory = scratchDirectory();
  const path = reserveFixturePort(52344, directory);
  if (!path) throw new Error("Expected a fixture port reservation");
  releaseFixturePort(path);
  expect(existsSync(path)).toBe(false);
  const nextPath = reserveFixturePort(52344, directory);
  if (!nextPath) throw new Error("Expected a fixture port reservation");
  expect(basename(nextPath)).toMatch(new RegExp(`^52344\\.${process.pid}\\.[0-9a-f]+\\.lock$`));
  expect(nextPath).not.toBe(path);
  expect(readFileSync(nextPath, "utf8")).toBe(`${process.pid}\n`);
  releaseFixturePort(nextPath);
  expect(existsSync(nextPath)).toBe(false);
});

test.each(["legacy", "generation-unique"])("a live sibling's %s claim is untouched and makes our claim defer", async (form) => {
  const directory = scratchDirectory();
  const sibling = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  testSibling = sibling;
  await new Promise<void>((resolve, reject) => {
    sibling.once("spawn", resolve);
    sibling.once("error", reject);
  });
  const generation = form === "legacy" ? "" : ".aaaa";
  const siblingPath = join(directory, `52345.${sibling.pid}${generation}.lock`);
  writeFileSync(siblingPath, `${sibling.pid}\n`);
  expect(reserveFixturePort(52345, directory)).toBeUndefined();
  expect(readdirSync(directory)).toEqual([basename(siblingPath)]);
  expect(readFileSync(siblingPath, "utf8")).toBe(`${sibling.pid}\n`);
});

test.each(["legacy", "generation-unique"])("a dead pid's %s claim is removed before our claim is created", (form) => {
  const directory = scratchDirectory();
  const generation = form === "legacy" ? "" : ".aaaa";
  const deadPath = join(directory, `52346.2147483647${generation}.lock`);
  writeFileSync(deadPath, "2147483647\n");
  const ownPath = reserveFixturePort(52346, directory);
  if (!ownPath) throw new Error("Expected a fixture port reservation");
  expect(basename(ownPath)).toMatch(new RegExp(`^52346\\.${process.pid}\\.[0-9a-f]+\\.lock$`));
  expect(existsSync(deadPath)).toBe(false);
  expect(readFileSync(ownPath, "utf8")).toBe(`${process.pid}\n`);
  releaseFixturePort(ownPath);
});

test("an unmatched legacy lock is ignored and left untouched", () => {
  const directory = scratchDirectory();
  const legacyPath = join(directory, "52347.lock");
  writeFileSync(legacyPath, "not-a-pid\n");
  const ownPath = reserveFixturePort(52347, directory);
  if (!ownPath) throw new Error("Expected a fixture port reservation");
  expect(basename(ownPath)).toMatch(new RegExp(`^52347\\.${process.pid}\\.[0-9a-f]+\\.lock$`));
  expect(readFileSync(ownPath, "utf8")).toBe(`${process.pid}\n`);
  expect(readFileSync(legacyPath, "utf8")).toBe("not-a-pid\n");
  releaseFixturePort(ownPath);
});

test("a reused pid's new generation survives stale-claim cleanup and makes our claim defer", () => {
  const directory = scratchDirectory();
  const stalePath = join(directory, "52348.2147483647.aaaa.lock");
  const livePath = join(directory, "52348.2147483647.bbbb.lock");
  writeFileSync(stalePath, "2147483647\n");
  expect(reserveFixturePort(52348, directory, {
    ownerIsAlive: (pid) => {
      expect(pid).toBe(2147483647);
      writeFileSync(livePath, "2147483647\n");
      return false;
    },
  })).toBeUndefined();
  expect(existsSync(stalePath)).toBe(false);
  expect(readFileSync(livePath, "utf8")).toBe("2147483647\n");
  expect(readdirSync(directory)).toEqual([basename(livePath)]);
});

test("an owner-write failure removes its claim and allows a subsequent reservation", () => {
  const directory = scratchDirectory();
  const error = new Error("ENOSPC: could not write fixture port owner");
  expect(() => reserveFixturePort(52349, directory, {
    writeOwner: () => {
      throw error;
    },
  })).toThrow(error);
  expect(readdirSync(directory)).toEqual([]);
  const path = reserveFixturePort(52349, directory);
  if (!path) throw new Error("Expected a fixture port reservation");
  expect(basename(path)).toMatch(new RegExp(`^52349\\.${process.pid}\\.[0-9a-f]+\\.lock$`));
  expect(readFileSync(path, "utf8")).toBe(`${process.pid}\n`);
  releaseFixturePort(path);
  expect(existsSync(path)).toBe(false);
  expect(readdirSync(directory)).toEqual([]);
});

test.skipIf(process.getuid?.() === 0)("a failed unlink reports cleanup failure and retains its claim for exit (chmod requires non-root)", async () => {
  const directory = scratchDirectory();
  const source = `
    import assert from "node:assert/strict";
    import { chmodSync, existsSync, readdirSync } from "node:fs";
    import { join } from "node:path";
    import { reserveFixturePort } from ${JSON.stringify(join(import.meta.dir, "fixture-port.ts"))};
    const directory = ${JSON.stringify(directory)};
    const error = new Error("disk full");
    try {
      assert.throws(() => reserveFixturePort(52350, directory, {
        writeOwner: () => {
          chmodSync(directory, 0o500);
          throw error;
        },
      }), (failure) => failure === error && failure.message === "disk full");
      const claims = readdirSync(directory);
      assert.equal(claims.length, 1);
      const path = join(directory, claims[0]);
      assert.ok(existsSync(path));
      process.stdout.write(path);
    } finally {
      chmodSync(directory, 0o700);
    }
  `;
  const child = spawn(process.execPath, ["-e", source], { stdio: ["ignore", "pipe", "pipe"] });
  testSibling = child;
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("close", resolve);
    child.once("error", reject);
  });
  expect(exitCode).toBe(0);
  expect(stdout).toMatch(new RegExp(`^${directory}/52350\\.\\d+\\.[0-9a-f]+\\.lock$`));
  expect(stderr).toContain(`Could not release fixture port reservation ${stdout}: `);
  expect(existsSync(stdout)).toBe(false);
  expect(readdirSync(directory)).toEqual([]);
});

test("a real probe selects a reserved port and release removes its lock", () => {
  const directory = scratchDirectory();
  let path: string | undefined;
  const port = Number(selectFixturePort(
    undefined,
    probeFixturePort,
    (candidate) => {
      path = reserveFixturePort(candidate, directory);
      return path;
    },
  ));
  if (!path) throw new Error("Expected a fixture port reservation");
  expect(basename(path)).toMatch(new RegExp(`^${port}\\.${process.pid}\\.[0-9a-f]+\\.lock$`));
  expect(existsSync(path)).toBe(true);
  expect(readFileSync(path, "utf8")).toBe(`${process.pid}\n`);
  releaseFixturePort(path);
  expect(existsSync(path)).toBe(false);
});

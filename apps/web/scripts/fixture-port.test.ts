import { afterEach, expect, test } from "bun:test";
import { spawn } from "node:child_process";
// oxlint-disable-next-line home/no-source-reads -- Lock tests only read their own system-temp scratch files.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
  if (testDirectory) rmSync(testDirectory, { recursive: true, force: true });
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
  expect(selectFixturePort(
    undefined,
    () => ports.shift() ?? null,
    (port) => reserveFixturePort(port, directory),
  )).toBe("52342");
  const ownPath = join(directory, `52342.${process.pid}.lock`);
  expect(readFileSync(siblingPath, "utf8")).toBe(`${sibling.pid}\n`);
  expect(readFileSync(ownPath, "utf8")).toBe(`${process.pid}\n`);
  releaseFixturePort(ownPath);
});

test("a free port returns an owner-named claim and blocks re-reserving in this process", () => {
  const directory = scratchDirectory();
  const path = reserveFixturePort(52343, directory);
  expect(path).toBe(join(directory, `52343.${process.pid}.lock`));
  if (!path) throw new Error("Expected a fixture port reservation");
  expect(readFileSync(path, "utf8")).toBe(`${process.pid}\n`);
  expect(reserveFixturePort(52343, directory)).toBeUndefined();
  releaseFixturePort(path);
});

test("releasing an owner-named claim removes it and allows the port to be claimed again", () => {
  const directory = scratchDirectory();
  const path = reserveFixturePort(52344, directory);
  if (!path) throw new Error("Expected a fixture port reservation");
  releaseFixturePort(path);
  expect(existsSync(path)).toBe(false);
  expect(reserveFixturePort(52344, directory)).toBe(path);
  releaseFixturePort(path);
});

test("a live sibling's owner-named claim is untouched and makes our claim defer", async () => {
  const directory = scratchDirectory();
  const sibling = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  testSibling = sibling;
  await new Promise<void>((resolve, reject) => {
    sibling.once("spawn", resolve);
    sibling.once("error", reject);
  });
  const siblingPath = join(directory, `52345.${sibling.pid}.lock`);
  const ownPath = join(directory, `52345.${process.pid}.lock`);
  writeFileSync(siblingPath, `${sibling.pid}\n`);
  expect(reserveFixturePort(52345, directory)).toBeUndefined();
  expect(existsSync(ownPath)).toBe(false);
  expect(readFileSync(siblingPath, "utf8")).toBe(`${sibling.pid}\n`);
});

test("a dead pid's owner-named claim is removed before our claim is created", () => {
  const directory = scratchDirectory();
  const deadPath = join(directory, "52346.2147483647.lock");
  const ownPath = join(directory, `52346.${process.pid}.lock`);
  writeFileSync(deadPath, "2147483647\n");
  expect(reserveFixturePort(52346, directory)).toBe(ownPath);
  expect(existsSync(deadPath)).toBe(false);
  expect(readFileSync(ownPath, "utf8")).toBe(`${process.pid}\n`);
  releaseFixturePort(ownPath);
});

test("an unmatched legacy lock is ignored and left untouched", () => {
  const directory = scratchDirectory();
  const legacyPath = join(directory, "52347.lock");
  const ownPath = join(directory, `52347.${process.pid}.lock`);
  writeFileSync(legacyPath, "not-a-pid\n");
  expect(reserveFixturePort(52347, directory)).toBe(ownPath);
  expect(readFileSync(legacyPath, "utf8")).toBe("not-a-pid\n");
  releaseFixturePort(ownPath);
});

test("a real probe selects a reserved port and release removes its lock", () => {
  const directory = scratchDirectory();
  const port = Number(selectFixturePort(
    undefined,
    probeFixturePort,
    (candidate) => reserveFixturePort(candidate, directory),
  ));
  const path = join(directory, `${port}.${process.pid}.lock`);
  expect(existsSync(path)).toBe(true);
  expect(readFileSync(path, "utf8")).toBe(`${process.pid}\n`);
  releaseFixturePort(path);
  expect(existsSync(path)).toBe(false);
});

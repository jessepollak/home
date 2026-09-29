import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export async function withUnitTestFixture(callback: (cwd: string) => Promise<void>) {
  const cwd = await mkdtemp(join(tmpdir(), "home-unit-tests-"));
  try {
    await mkdir(join(cwd, "nested"));
    await writeFile(join(cwd, "nested", "one.test.ts"), "");
    await writeFile(join(cwd, "nested", "two_spec.js"), "");
    await callback(cwd);
  } finally { await rm(cwd, { recursive: true, force: true }); }
}

export async function makeDirectory(cwd: string, name: string) { await mkdir(join(cwd, name)); }
export async function writeFixture(cwd: string, path: string, content: string) { await writeFile(resolve(cwd, path), content); }
export async function readFixture(cwd: string, path: string) { return readFile(join(cwd, path), "utf8"); }

import { afterAll, describe, expect, it } from "bun:test";
import { cp, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const appsWebDir = fileURLToPath(new URL("../..", import.meta.url));
const mirror = await mkdtemp(path.join(tmpdir(), "home-oxlint-no-real-waits-"));
await cp(path.join(appsWebDir, "oxlint"), path.join(mirror, "oxlint"), { recursive: true });
await symlink(path.join(appsWebDir, "node_modules"), path.join(mirror, "node_modules"), "dir");
afterAll(() => rm(mirror, { recursive: true, force: true }));

let fixtureIndex = 0;
async function lint(code) {
  fixtureIndex += 1;
  const fixture = `fixture-${fixtureIndex}.pw.ts`;
  const config = `.oxlintrc-${fixtureIndex}.json`;
  await writeFile(path.join(mirror, fixture), code);
  await writeFile(path.join(mirror, config), JSON.stringify({
    plugins: [],
    categories: { correctness: "off" },
    jsPlugins: ["./oxlint/home-plugin.mjs"],
    rules: { "home/no-real-waits": "error" },
  }));
  const result = spawnSync(
    path.join(appsWebDir, "node_modules", ".bin", "oxlint"),
    ["-c", config, "--disable-nested-config", "-f", "json", fixture],
    { cwd: mirror, encoding: "utf8" },
  );
  expect(result.signal).toBeNull();
  expect([0, 1]).toContain(result.status);
  return JSON.parse(result.stdout).diagnostics.filter((diagnostic) =>
    diagnostic.code === "home(no-real-waits)");
}

describe("no-real-waits", () => {
  it("rejects Playwright page and frame sleeps", async () => {
    expect(await lint("page.waitForTimeout(10); frame['waitForTimeout'](20);"))
      .toHaveLength(2);
  });

  it("rejects promise-wrapped timeouts with direct and zero-argument resolver callbacks", async () => {
    expect(await lint(`
      new Promise((resolve) => setTimeout(resolve, delay));
      new Promise(function (done) { setTimeout(done, 1); });
      new Promise((resolve) => setTimeout(() => resolve(), delay));
      new Promise((resolve) => setTimeout(() => { resolve(); }, delay));
    `)).toHaveLength(4);
  });

  it("documents destructured and aliased waitForTimeout as known non-detections", async () => {
    expect(await lint(`
      const { waitForTimeout } = page;
      waitForTimeout(100);
      const browserPage = page;
      browserPage.waitForTimeout(100);
    `)).toHaveLength(0);
  });

  it("accepts observable Playwright waits and unrelated promises", async () => {
    expect(await lint(`
      await expect.poll(readStatus).toBe("ready");
      await page.getByRole("button").waitFor();
      new Promise((resolve) => subscribe(resolve));
    `)).toHaveLength(0);
  });
});

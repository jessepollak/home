import { afterAll, describe, expect, it } from "bun:test";
import { cp, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const appsWebDir = fileURLToPath(new URL("../..", import.meta.url));
const mirror = await mkdtemp(path.join(tmpdir(), "home-oxlint-no-amount-fallback-"));
await cp(path.join(appsWebDir, "oxlint"), path.join(mirror, "oxlint"), { recursive: true });
await symlink(path.join(appsWebDir, "node_modules"), path.join(mirror, "node_modules"), "dir");
afterAll(() => rm(mirror, { recursive: true, force: true }));

let fixtureIndex = 0;
async function lint(code) {
  fixtureIndex += 1;
  const fixture = `fixture-${fixtureIndex}.ts`;
  const config = `.oxlintrc-${fixtureIndex}.json`;
  await writeFile(path.join(mirror, fixture), code);
  await writeFile(path.join(mirror, config), JSON.stringify({
    plugins: [], categories: { correctness: "off" },
    jsPlugins: ["./oxlint/home-plugin.mjs"],
    rules: { "home/no-amount-fallback": "error" },
  }));
  const result = spawnSync(
    path.join(appsWebDir, "node_modules", ".bin", "oxlint"),
    ["-c", config, "--disable-nested-config", "-f", "json", fixture],
    { cwd: mirror, encoding: "utf8" },
  );
  expect(result.signal).toBeNull();
  expect([0, 1]).toContain(result.status);
  return JSON.parse(result.stdout).diagnostics.filter((diagnostic) =>
    diagnostic.code === "home(no-amount-fallback)");
}

describe("no-amount-fallback", () => {
  it("rejects numeric and string zero defaults on amount-like values", async () => {
    expect(await lint(`
      amount ?? 0;
      input.balance || 0;
      total ?? "0";
      Number(usd) || 0;
      parseFloat(fiatValue) || 0;
      Number.parseFloat(record.atomic) || 0;
    `)).toHaveLength(6);
  });

  it("accepts unavailable propagation, fail-closed handling, and non-money counts", async () => {
    expect(await lint(`
      const displayed = amount ?? null;
      if (balance == null) throw new Error("unavailable");
      retryCount ?? 0;
      Number(pageIndex) || 0;
      parseFloat(computed.paddingLeft) || 0;
    `)).toHaveLength(0);
  });
});

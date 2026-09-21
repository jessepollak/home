import { afterAll, describe, expect, it } from "bun:test";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const appsWebDir = fileURLToPath(new URL("../..", import.meta.url));
const mirror = await mkdtemp(path.join(tmpdir(), "home-oxlint-self-referential-"));
await cp(path.join(appsWebDir, "oxlint"), path.join(mirror, "oxlint"), { recursive: true });
await symlink(path.join(appsWebDir, "node_modules"), path.join(mirror, "node_modules"), "dir");
afterAll(() => rm(mirror, { recursive: true, force: true }));

let fixtureIndex = 0;
async function lintTestFile(filename, code) {
  fixtureIndex += 1;
  const config = `.oxlintrc-${fixtureIndex}.json`;
  await mkdir(path.dirname(path.join(mirror, filename)), { recursive: true });
  await writeFile(path.join(mirror, filename), code);
  await writeFile(path.join(mirror, config), JSON.stringify({
    plugins: [], categories: { correctness: "off" },
    jsPlugins: ["./oxlint/home-plugin.mjs"],
    rules: { "home/no-self-referential-expectation": "error" },
  }));
  const result = spawnSync(
    path.join(appsWebDir, "node_modules", ".bin", "oxlint"),
    ["-c", config, "--disable-nested-config", "-f", "json", filename],
    { cwd: mirror, encoding: "utf8" },
  );
  expect(result.signal).toBeNull();
  expect([0, 1]).toContain(result.status);
  return JSON.parse(result.stdout).diagnostics.filter((diagnostic) =>
    diagnostic.code === "home(no-self-referential-expectation)");
}

describe("no-self-referential-expectation", () => {
  it("rejects expected values imported from the module the test names", async () => {
    expect(await lintTestFile("policy.test.ts", `
      import { expect } from "bun:test";
      import { policy } from "./policy";
      expect(readHeader()).toBe(policy);
    `)).toHaveLength(1);
  });

  it("rejects expected values imported from a same-directory subject by normalized name", async () => {
    expect(await lintTestFile("next-config.test.ts", `
      import { expect } from "bun:test";
      import { contentSecurityPolicy } from "./next.config";
      expect(readHeader()).toBe(contentSecurityPolicy);
    `)).toHaveLength(1);
  });

  it("resolves relative and alias imports to the subject file without same-stem cross-directory matches", async () => {
    expect(await lintTestFile("feature/config.test.ts", `
      import { expect } from "bun:test";
      import { localConfig } from "./config";
      import { aliasedConfig } from "@/feature/config";
      import { otherConfig } from "../other-dir/config";
      expect(readLocal()).toBe(localConfig);
      expect(readAlias()).toBe(aliasedConfig);
      expect(readOther()).toBe(otherConfig);
    `)).toHaveLength(2);
  });

  it("rejects imported aliases and every tracked matcher argument", async () => {
    expect(await lintTestFile("limit.test.ts", `
      import { expect } from "bun:test";
      import { maxPages as pages } from "./limit";
      expect(read()).toEqual(pages);
      expect(read()).toHaveLength(pages);
      expect(read()).not.toBe(pages);
    `)).toHaveLength(3);
  });

  it("unwraps typed, non-null, collection, template, and namespace expected values", async () => {
    expect(await lintTestFile("limit.test.ts", `
      import { expect } from "bun:test";
      import { maxPages } from "./limit";
      import * as limits from "./limit";
      const key = "maxPages";
      expect(read()).toBe(maxPages as number);
      expect(read()).toBe(maxPages!);
      expect(read()).toEqual([maxPages]);
      expect(read()).toMatchObject({ max: maxPages });
      expect(read()).toBe(\`\${maxPages}\`);
      expect(read()).toBe(limits.maxPages);
      expect(read()).toBe(limits["maxPages"]);
      expect(read()).toBe(limits[key]);
    `)).toHaveLength(7);
  });

  it("treats the current-directory barrel as the index subject", async () => {
    expect(await lintTestFile("feature/index.test.ts", `
      import { expect } from "bun:test";
      import { maxPages } from ".";
      expect(read()).toBe(maxPages);
    `)).toHaveLength(1);
  });

  it("accepts literals, derived members, and locally defined expectations", async () => {
    expect(await lintTestFile("behavior.test.ts", `
      import { expect } from "bun:test";
      import { readHeader, expectedHeader } from "./behavior";
      const local = "local";
      expect(readHeader()).toBe("frame-ancestors 'none'");
      expect(readHeader()).toBe(expectedHeader.name);
      expect(readHeader()).toBe(local);
      expect(readHeader()).not.toBeDefined();
    `)).toHaveLength(0);
  });

  it("accepts same-named constants imported from another module alias", async () => {
    expect(await lintTestFile("registry.test.ts", `
      import { expect } from "bun:test";
      import { DEFAULT_MARKET } from "@/shared/registry/registry";
      import { readMarket } from "./registry";
      expect(readMarket()).toBe(DEFAULT_MARKET);
    `)).toHaveLength(0);
  });

  it("stays off for files that are not tests", async () => {
    expect(await lintTestFile("policy.ts", `
      import { expect } from "bun:test";
      import { policy } from "./policy";
      expect(readHeader()).toBe(policy);
    `)).toHaveLength(0);
  });
});

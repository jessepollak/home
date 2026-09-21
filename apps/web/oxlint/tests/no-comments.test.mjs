import { afterAll, describe, expect, it } from "bun:test";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const appsWebDir = fileURLToPath(new URL("../..", import.meta.url));
const mirror = await mkdtemp(path.join(tmpdir(), "home-oxlint-comments-"));
await mkdir(path.join(mirror, "client"), { recursive: true });
await cp(path.join(appsWebDir, "oxlint"), path.join(mirror, "oxlint"), { recursive: true });
await symlink(path.join(appsWebDir, "node_modules"), path.join(mirror, "node_modules"), "dir");
await writeFile(path.join(mirror, ".oxlintrc.jsonc"), JSON.stringify({
  plugins: [],
  categories: { correctness: "off" },
  jsPlugins: ["./oxlint/home-plugin.mjs"],
  rules: { "home/no-comments": "error" },
}));
afterAll(() => rm(mirror, { recursive: true, force: true }));

let fixtureIndex = 0;
async function diagnostics(code, extension = "tsx") {
  fixtureIndex += 1;
  const fixture = `client/fixture-${fixtureIndex}.${extension}`;
  await writeFile(path.join(mirror, fixture), code);
  const result = spawnSync(
    path.join(appsWebDir, "node_modules/.bin/oxlint"),
    ["-c", ".oxlintrc.jsonc", "--disable-nested-config", "-f", "json", fixture],
    { cwd: mirror, encoding: "utf8" },
  );
  expect(result.signal).toBeNull();
  expect([0, 1]).toContain(result.status);
  return JSON.parse(result.stdout).diagnostics.filter((item) => item.code === "home(no-comments)");
}

describe("home/no-comments", () => {
  it("rejects line, block, JSDoc, and JSX comments", async () => {
    const found = await diagnostics(`
// line
/* block */
/** JSDoc */
export function Example() { return <div>{/* JSX */}</div>; }
`);
    expect(found).toHaveLength(4);
  });

  it("allows oxlint disable directives only when they carry a reason", async () => {
    expect(await diagnostics("// oxlint-disable-next-line no-console -- console output is the fixture contract.\nconsole.log('ok');", "ts")).toHaveLength(0);
    expect(await diagnostics("// oxlint-disable-next-line no-console\nconsole.log('no reason');", "ts")).toHaveLength(1);
    expect(await diagnostics("// oxlint-disable-note -- not a directive\nexport {};", "ts")).toHaveLength(1);
    expect(await diagnostics("export const node = <div>{/* oxlint-disable-next-line react/jsx-key -- upstream nodes have stable identity. */}</div>;" )).toHaveLength(0);
  });

  it("allows triple-slash references", async () => {
    expect(await diagnostics('/// <reference types="bun-types" />\nexport {};', "ts")).toHaveLength(0);
  });

  it("allows a third-party licence or notice only as a file header", async () => {
    expect(await diagnostics("/* SPDX-License-Identifier: MIT */\nexport {};", "ts")).toHaveLength(0);
    expect(await diagnostics("export {};\n/* SPDX-License-Identifier: MIT */", "ts")).toHaveLength(1);
  });
});

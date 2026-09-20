import { afterAll, describe, expect, it } from "bun:test";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const appsWebDir = fileURLToPath(new URL("../..", import.meta.url));
const mirror = await mkdtemp(path.join(tmpdir(), "home-oxlint-jsx-colors-"));
await mkdir(path.join(mirror, "client"), { recursive: true });
await mkdir(path.join(mirror, "components"), { recursive: true });
await cp(path.join(appsWebDir, "oxlint"), path.join(mirror, "oxlint"), { recursive: true });
await symlink(path.join(appsWebDir, "node_modules"), path.join(mirror, "node_modules"), "dir");
await writeFile(path.join(mirror, ".oxlintrc.jsonc"), JSON.stringify({
  plugins: [],
  categories: { correctness: "off" },
  jsPlugins: ["./oxlint/home-plugin.mjs"],
  rules: { "home/no-literal-jsx-colors": "error" },
}));
afterAll(() => rm(mirror, { recursive: true, force: true }));

async function diagnostics(code, relativePath = "client/fixture.tsx") {
  await mkdir(path.dirname(path.join(mirror, relativePath)), { recursive: true });
  await writeFile(path.join(mirror, relativePath), code);
  const result = spawnSync(
    path.join(appsWebDir, "node_modules/.bin/oxlint"),
    ["-c", ".oxlintrc.jsonc", "--disable-nested-config", "-f", "json", relativePath],
    { cwd: mirror, encoding: "utf8" },
  );
  expect(result.signal).toBeNull();
  return JSON.parse(result.stdout).diagnostics.filter((item) => item.code === "home(no-literal-jsx-colors)");
}

describe("home/no-literal-jsx-colors", () => {
  it("rejects named and hex paint values", async () => {
    const found = await diagnostics('export function A(){ return <svg><circle stroke="white" fill="#fff" /></svg> }');
    expect(found.map((item) => item.message)).toEqual([
      expect.stringContaining("white"),
      expect.stringContaining("#fff"),
    ]);
  });

  it("rejects functional colors in expression containers", async () => {
    expect(await diagnostics('export function A(){ return <svg><circle fill={"rgb(0,0,0)"} /></svg> }')).toHaveLength(1);
  });

  it("accepts token, url, and paint keyword references", async () => {
    const clean = 'export function A(){ return <svg><circle fill="var(--primary)" stroke="currentColor" /><path fill="none" stroke="url(#g)" /><rect fill="transparent" /></svg> }';
    expect(await diagnostics(clean)).toHaveLength(0);
  });

  it("ignores dynamic paint values", async () => {
    const clean = 'export function A({ fill }: { fill: string }){ return <svg><circle fill={fill} strokeWidth=".22" /></svg> }';
    expect(await diagnostics(clean)).toHaveLength(0);
  });

  it("permits only the reviewed brand-asset colors in the exception file", async () => {
    const eth = 'export function EthMark(){ return <svg><circle fill="#627EEA" /><path fill="#fff" /></svg> }';
    expect(await diagnostics(eth, "components/currency-mark.tsx")).toHaveLength(0);
    expect(await diagnostics(eth, "components/other-mark.tsx")).toHaveLength(2);
  });

  it("still rejects non-exempt colors inside the exception file", async () => {
    expect(await diagnostics('export function A(){ return <svg><circle fill="#123456" /></svg> }', "components/currency-mark.tsx")).toHaveLength(1);
  });
});

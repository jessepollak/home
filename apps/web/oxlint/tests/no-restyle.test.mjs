import { afterAll, describe, expect, it } from "bun:test";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const appsWebDir = fileURLToPath(new URL("../..", import.meta.url));
const mirror = await mkdtemp(path.join(tmpdir(), "home-oxlint-restyle-"));
await mkdir(path.join(mirror, "client"), { recursive: true });
await cp(path.join(appsWebDir, "oxlint"), path.join(mirror, "oxlint"), { recursive: true });
await symlink(path.join(appsWebDir, "node_modules"), path.join(mirror, "node_modules"), "dir");
await writeFile(path.join(mirror, ".oxlintrc.jsonc"), JSON.stringify({
  plugins: [],
  categories: { correctness: "off" },
  jsPlugins: ["./oxlint/home-plugin.mjs"],
  rules: { "home/no-restyle": "error" },
}));
afterAll(() => rm(mirror, { recursive: true, force: true }));

async function diagnostics(code) {
  await writeFile(path.join(mirror, "client/fixture.tsx"), code);
  const result = spawnSync(
    path.join(appsWebDir, "node_modules/.bin/oxlint"),
    ["-c", ".oxlintrc.jsonc", "--disable-nested-config", "-f", "json", "client/fixture.tsx"],
    { cwd: mirror, encoding: "utf8" },
  );
  expect(result.signal).toBeNull();
  return JSON.parse(result.stdout).diagnostics.filter((item) => item.code === "home(no-restyle)");
}

const importedButton = 'import { Button } from "@/components/ui/button";\n';

describe("home/no-restyle", () => {
  it("rejects appearance utilities on an owned component", async () => {
    const found = await diagnostics(`${importedButton}export function A(){ return <Button className="rounded-full">x</Button> }`);
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain("rounded-full");
  });

  it("allows layout, alignment, and accessibility utilities", async () => {
    expect(await diagnostics(`${importedButton}export function A(){ return <Button className="w-full text-left sr-only">x</Button> }`)).toHaveLength(0);
  });

  it("rejects appearance utilities on a relatively imported owned component", async () => {
    const relativeButton = 'import { Button } from "../components/ui/button";\n';
    expect(await diagnostics(`${relativeButton}export function A(){ return <Button className="rounded-full">x</Button> }`)).toHaveLength(1);
  });

  it("allows layout utilities on a relatively imported owned component", async () => {
    const relativeButton = 'import { Button } from "../components/ui/button";\n';
    expect(await diagnostics(`${relativeButton}export function A(){ return <Button className="w-full">x</Button> }`)).toHaveLength(0);
  });

  it("allows a forwarded dynamic className", async () => {
    expect(await diagnostics(`${importedButton}export function A({ className }){ return <Button className={className}>x</Button> }`)).toHaveLength(0);
  });

  it("does not classify condition data as classes", async () => {
    expect(await diagnostics(`${importedButton}export function A({ mode }){ return <Button className={cn(mode === "rounded-full" && "w-full")}>x</Button> }`)).toHaveLength(0);
  });

  it("rejects appearance utilities in class-producing branches", async () => {
    expect(await diagnostics(`${importedButton}export function A({ active }){ return <Button className={cn(active ? "rounded-full" : "w-full")}>x</Button> }`)).toHaveLength(1);
  });
});

import { afterAll, describe, expect, it } from "bun:test";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const appsWebDir = fileURLToPath(new URL("../..", import.meta.url));
const mirror = await mkdtemp(path.join(tmpdir(), "home-oxlint-unknown-classes-"));
await mkdir(path.join(mirror, "client"), { recursive: true });
await mkdir(path.join(mirror, "app"), { recursive: true });
await cp(path.join(appsWebDir, "oxlint"), path.join(mirror, "oxlint"), { recursive: true });
await symlink(path.join(appsWebDir, "node_modules"), path.join(mirror, "node_modules"), "dir");
await symlink(path.join(appsWebDir, "app/globals.css"), path.join(mirror, "app/globals.css"));
await writeFile(path.join(mirror, ".oxlintrc.jsonc"), JSON.stringify({
  plugins: [],
  categories: { correctness: "off" },
  jsPlugins: ["./oxlint/home-plugin.mjs"],
  rules: { "home/no-unknown-tailwind-classes": "error" },
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
  return JSON.parse(result.stdout).diagnostics.filter((item) => item.code === "home(no-unknown-tailwind-classes)");
}

describe("home/no-unknown-tailwind-classes", () => {
  it("rejects unknown bare classes", async () => {
    const found = await diagnostics('export function A(){ return <div className="panel-fade">x</div> }');
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain("panel-fade");
  });

  it("rejects unknown utility values inside className", async () => {
    expect(await diagnostics('export function A(){ return <div className="p-control-inset">x</div> }')).toHaveLength(1);
  });

  it("rejects unknown classes in template literals", async () => {
    const found = await diagnostics("export function A({ on }: { on: string }){ return <div className={`app-main-authenticated ${on}`}>x</div> }");
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain("app-main-authenticated");
  });

  it("rejects unknown classes in cva base strings", async () => {
    expect(await diagnostics('import { cva } from "class-variance-authority"; const v = cva("p-control-inset"); export { v };')).toHaveLength(1);
  });

  it("accepts theme-backed utilities and variants", async () => {
    expect(await diagnostics('export function A(){ return <div className="p-4 bg-primary text-muted-foreground group-data-horizontal/tabs:h-8 sm:order-2">x</div> }')).toHaveLength(0);
  });

  it("accepts group and peer markers", async () => {
    expect(await diagnostics('export function A(){ return <div className="group/tabs-list peer/x">x</div> }')).toHaveLength(0);
  });

  it("accepts registered custom classes", async () => {
    expect(await diagnostics('export function A(){ return <div className="shell-scroll-container shell-scrollbar-compensated">x</div> }')).toHaveLength(0);
  });

  it("ignores non-class attributes", async () => {
    expect(await diagnostics('export function A(){ return <div id="panel-fade" data-x="p-control-inset">x</div> }')).toHaveLength(0);
  });

  it("ignores dynamic className values", async () => {
    expect(await diagnostics("export function A({ c }: { c: string }){ return <div className={c}>x</div> }")).toHaveLength(0);
  });

  it("validates cva variant class strings but not defaultVariants", async () => {
    const valid = 'import { cva } from "class-variance-authority"; const v = cva("bg-primary", { variants: { tone: { default: "text-muted-foreground" } }, defaultVariants: { tone: "default" } }); export { v };';
    expect(await diagnostics(valid)).toHaveLength(0);
    const invalid = 'import { cva } from "class-variance-authority"; const v = cva("bg-primary", { variants: { tone: { default: "panel-fade" } } }); export { v };';
    expect(await diagnostics(invalid)).toHaveLength(1);
  });

  it("validates cva compoundVariants class values and ignores their selectors", async () => {
    const valid = 'import { cva } from "class-variance-authority"; const v = cva("bg-primary", { compoundVariants: [{ tone: "default", className: "text-muted-foreground" }] }); export { v };';
    expect(await diagnostics(valid)).toHaveLength(0);
    const invalid = 'import { cva } from "class-variance-authority"; const v = cva("bg-primary", { compoundVariants: [{ tone: "default", class: "panel-fade" }] }); export { v };';
    expect(await diagnostics(invalid)).toHaveLength(1);
    const selectorOnly = 'import { cva } from "class-variance-authority"; const v = cva("bg-primary", { compoundVariants: [{ tone: "panel-fade" }] }); export { v };';
    expect(await diagnostics(selectorOnly)).toHaveLength(0);
  });

  it("validates clsx-style cn object keys", async () => {
    expect(await diagnostics('import { cn } from "cn"; export const v = cn({ "panel-fade": true });')).toHaveLength(1);
    expect(await diagnostics('import { cn } from "cn"; export const v = cn("p-4", { "text-muted-foreground": true });')).toHaveLength(0);
  });
});

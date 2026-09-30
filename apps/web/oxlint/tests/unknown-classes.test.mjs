import { applyRuleCheckTimeout } from "./rule-check-timeout.mjs";
import { describe, expect, it } from "bun:test";
import { mkdir, rm, symlink } from "node:fs/promises";
import { budgetMs, createOxlintWorkspace } from "./helpers/oxlint-workspace.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
applyRuleCheckTimeout();

const appsWebDir = fileURLToPath(new URL("../..", import.meta.url));
const { directory: mirror, lint } = await createOxlintWorkspace("home-oxlint-unknown-classes-", {
  path: () => "client/fixture.tsx",
  rules: ["no-unknown-tailwind-classes"],
});
await mkdir(path.join(mirror, "app"), { recursive: true });
await symlink(path.join(appsWebDir, "app/globals.css"), path.join(mirror, "app/globals.css"));

async function diagnostics(code) {
  return (await lint({ fixture: code })).fixture;
}

describe("home/no-unknown-tailwind-classes", () => {
  it("rejects unknown bare classes", async () => {
    const found = await diagnostics('export function A(){ return <div className="panel-fade">x</div> }');
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain("panel-fade");
  }, budgetMs);

  it("rejects unknown utility values inside className", async () => {
    expect(await diagnostics('export function A(){ return <div className="p-control-inset">x</div> }')).toHaveLength(1);
  }, budgetMs);

  it("rejects unknown classes in template literals", async () => {
    const found = await diagnostics("export function A({ on }: { on: string }){ return <div className={`app-main-authenticated ${on}`}>x</div> }");
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain("app-main-authenticated");
  }, budgetMs);

  it("rejects unknown classes in cva base strings", async () => {
    expect(await diagnostics('import { cva } from "class-variance-authority"; const v = cva("p-control-inset"); export { v };')).toHaveLength(1);
  }, budgetMs);

  it("accepts theme-backed utilities and variants", async () => {
    expect(await diagnostics('export function A(){ return <div className="p-4 bg-primary text-muted-foreground group-data-horizontal/tabs:h-8 sm:order-2">x</div> }')).toHaveLength(0);
  }, budgetMs);

  it("accepts group and peer markers", async () => {
    expect(await diagnostics('export function A(){ return <div className="group/tabs-list peer/x">x</div> }')).toHaveLength(0);
  }, budgetMs);

  it("accepts registered custom classes", async () => {
    expect(await diagnostics('export function A(){ return <div className="shell-scroll-container shell-scrollbar-compensated">x</div> }')).toHaveLength(0);
  }, budgetMs);

  it("ignores non-class attributes", async () => {
    expect(await diagnostics('export function A(){ return <div id="panel-fade" data-x="p-control-inset">x</div> }')).toHaveLength(0);
  }, budgetMs);

  it("ignores dynamic className values", async () => {
    expect(await diagnostics("export function A({ c }: { c: string }){ return <div className={c}>x</div> }")).toHaveLength(0);
  }, budgetMs);

  it("validates cva variant class strings but not defaultVariants", async () => {
    const valid = 'import { cva } from "class-variance-authority"; const v = cva("bg-primary", { variants: { tone: { default: "text-muted-foreground" } }, defaultVariants: { tone: "default" } }); export { v };';
    expect(await diagnostics(valid)).toHaveLength(0);
    const invalid = 'import { cva } from "class-variance-authority"; const v = cva("bg-primary", { variants: { tone: { default: "panel-fade" } } }); export { v };';
    expect(await diagnostics(invalid)).toHaveLength(1);
  }, budgetMs);

  it("validates cva compoundVariants class values and ignores their selectors", async () => {
    const valid = 'import { cva } from "class-variance-authority"; const v = cva("bg-primary", { compoundVariants: [{ tone: "default", className: "text-muted-foreground" }] }); export { v };';
    expect(await diagnostics(valid)).toHaveLength(0);
    const invalid = 'import { cva } from "class-variance-authority"; const v = cva("bg-primary", { compoundVariants: [{ tone: "default", class: "panel-fade" }] }); export { v };';
    expect(await diagnostics(invalid)).toHaveLength(1);
    const selectorOnly = 'import { cva } from "class-variance-authority"; const v = cva("bg-primary", { compoundVariants: [{ tone: "panel-fade" }] }); export { v };';
    expect(await diagnostics(selectorOnly)).toHaveLength(0);
  }, budgetMs);

  it("validates clsx-style cn object keys", async () => {
    expect(await diagnostics('import { cn } from "cn"; export const v = cn({ "panel-fade": true });')).toHaveLength(1);
    expect(await diagnostics('import { cn } from "cn"; export const v = cn("p-4", { "text-muted-foreground": true });')).toHaveLength(0);
  }, budgetMs);
  it("reports when the project theme is missing, even without class literals", async () => {
    const entrypoint = path.join(mirror, "app/globals.css");
    await rm(entrypoint);
    try {
      const found = await diagnostics("export const value = 1;");
      expect(found).toHaveLength(1);
      expect(found[0].message).toContain("project theme could not load");
    } finally {
      await symlink(path.join(appsWebDir, "app/globals.css"), entrypoint);
    }
  }, budgetMs);
});

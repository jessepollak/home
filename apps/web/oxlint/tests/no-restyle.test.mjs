import { applyRuleCheckTimeout } from "./rule-check-timeout.mjs";
import { describe, expect, it } from "bun:test";
import { budgetMs, createOxlintWorkspace } from "./helpers/oxlint-workspace.mjs";
applyRuleCheckTimeout();

const { lint } = await createOxlintWorkspace("home-oxlint-restyle-", {
  path: () => "client/fixture.tsx",
  rules: ["no-restyle"],
});

async function diagnostics(code) {
  return (await lint({ fixture: code })).fixture;
}

const importedButton = 'import { Button } from "@/components/ui/button";\n';

describe("home/no-restyle", () => {
  it("rejects appearance utilities on an owned component", async () => {
    const found = await diagnostics(`${importedButton}export function A(){ return <Button className="rounded-full">x</Button> }`);
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain("rounded-full");
  }, budgetMs);

  it("allows layout, alignment, and accessibility utilities", async () => {
    expect(await diagnostics(`${importedButton}export function A(){ return <Button className="w-full text-left sr-only">x</Button> }`)).toHaveLength(0);
  }, budgetMs);

  it("rejects appearance utilities on a relatively imported owned component", async () => {
    const relativeButton = 'import { Button } from "../components/ui/button";\n';
    expect(await diagnostics(`${relativeButton}export function A(){ return <Button className="rounded-full">x</Button> }`)).toHaveLength(1);
  }, budgetMs);

  it("allows layout utilities on a relatively imported owned component", async () => {
    const relativeButton = 'import { Button } from "../components/ui/button";\n';
    expect(await diagnostics(`${relativeButton}export function A(){ return <Button className="w-full">x</Button> }`)).toHaveLength(0);
  }, budgetMs);

  it("allows a forwarded dynamic className", async () => {
    expect(await diagnostics(`${importedButton}export function A({ className }){ return <Button className={className}>x</Button> }`)).toHaveLength(0);
  }, budgetMs);

  it("does not classify condition data as classes", async () => {
    expect(await diagnostics(`${importedButton}export function A({ mode }){ return <Button className={cn(mode === "rounded-full" && "w-full")}>x</Button> }`)).toHaveLength(0);
  }, budgetMs);

  it("rejects appearance utilities in class-producing branches", async () => {
    expect(await diagnostics(`${importedButton}export function A({ active }){ return <Button className={cn(active ? "rounded-full" : "w-full")}>x</Button> }`)).toHaveLength(1);
  }, budgetMs);
});

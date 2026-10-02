import { applyRuleCheckTimeout } from "./rule-check-timeout.mjs";
import { describe, expect, it } from "bun:test";
import { budgetMs, createOxlintWorkspace } from "./helpers/oxlint-workspace.mjs";
applyRuleCheckTimeout();

const { lint } = await createOxlintWorkspace("home-oxlint-jsx-colors-", {
  path: () => "client/fixture.tsx",
  rules: ["no-literal-jsx-colors"],
});

async function diagnostics(code, relativePath = "client/fixture.tsx") {
  return (await lint({ fixture: { code, path: relativePath } })).fixture;
}

describe("home/no-literal-jsx-colors", () => {
  it("rejects named and hex paint values", async () => {
    const found = await diagnostics('export function A(){ return <svg><circle stroke="white" fill="#fff" /></svg> }');
    expect(found.map((item) => item.message)).toEqual([
      expect.stringContaining("white"),
      expect.stringContaining("#fff"),
    ]);
  }, budgetMs);

  it("rejects functional colors in expression containers", async () => {
    expect(await diagnostics('export function A(){ return <svg><circle fill={"rgb(0,0,0)"} /></svg> }')).toHaveLength(1);
  }, budgetMs);

  it("accepts token, url, and paint keyword references", async () => {
    const clean = 'export function A(){ return <svg><circle fill="var(--primary)" stroke="currentColor" /><path fill="none" stroke="url(#g)" /><rect fill="transparent" /></svg> }';
    expect(await diagnostics(clean)).toHaveLength(0);
  }, budgetMs);

  it("ignores dynamic paint values", async () => {
    const clean = 'export function A({ fill }: { fill: string }){ return <svg><circle fill={fill} strokeWidth=".22" /></svg> }';
    expect(await diagnostics(clean)).toHaveLength(0);
  }, budgetMs);

  it("permits only the reviewed brand-asset colors in the exception file", async () => {
    const eth = 'export function EthMark(){ return <svg><circle fill="#627EEA" /><path fill="#fff" /></svg> }';
    const found = await lint({
      exception: { code: eth, path: "components/currency-mark.tsx" },
      other: { code: eth, path: "components/other-mark.tsx" },
    });
    expect(found.exception).toHaveLength(0);
    expect(found.other).toHaveLength(2);
  }, budgetMs);

  it("still rejects non-exempt colors inside the exception file", async () => {
    expect(await diagnostics('export function A(){ return <svg><circle fill="#123456" /></svg> }', "components/currency-mark.tsx")).toHaveLength(1);
  }, budgetMs);
});

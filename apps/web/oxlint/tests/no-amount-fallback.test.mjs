import { applyRuleCheckTimeout } from "./rule-check-timeout.mjs";
import { describe, expect, it } from "bun:test";
import { budgetMs, createOxlintWorkspace } from "./helpers/oxlint-workspace.mjs";
applyRuleCheckTimeout();

const { lint: lintFixtures } = await createOxlintWorkspace("home-oxlint-no-amount-fallback-", {
  rules: ["no-amount-fallback"],
});

let fixtureIndex = 0;
async function lint(code) {
  fixtureIndex += 1;
  const fixture = `fixture-${fixtureIndex}.ts`;
  return (await lintFixtures({ fixture: { code, path: fixture } })).fixture;
}

describe("no-amount-fallback", () => {
  it("rejects numeric and string zero defaults for every money-name token", async () => {
    expect(await lint(`
      amount ?? 0;
      input.balance || 0;
      total ?? "0";
      quantity || 0n;
      Number(value) || 0;
      assets ?? 0;
      shares ?? 0;
      Number(usd) || 0;
      parseFloat(fiat) || 0;
      Number.parseFloat(record.atomic) || 0;
    `)).toHaveLength(10);
  }, budgetMs);

  it("rejects every supported compound money-name suffix", async () => {
    expect(await lint(`
      amountBaseUnits ?? "0";
      balanceUnits || 0n;
      quantityWei ?? 0;
      valueWad || "0";
      assetsAtomic ?? 0;
      sharesUsd || 0;
      totalFiat ?? "0";
    `)).toHaveLength(7);
  }, budgetMs);

  it("accepts unavailable propagation, fail-closed handling, and non-money names", async () => {
    expect(await lint(`
      const displayed = amount ?? null;
      if (balance == null) throw new Error("unavailable");
      retryCount ?? 0;
      Number(pageIndex) || 0;
      parseFloat(computed.paddingLeft) || 0;
      valueOf ?? 0;
      totalRows || 0;
      sharesLabel ?? "0";
    `)).toHaveLength(0);
  }, budgetMs);
});

import { applyRuleCheckTimeout } from "./rule-check-timeout.mjs";
import { describe, expect, it } from "bun:test";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { classifyStyleUtility, styleDriftOccurrences } from "../policy/style-drift.mjs";
import { budgetMs, createOxlintWorkspace } from "./helpers/oxlint-workspace.mjs";
applyRuleCheckTimeout();

const { directory, lint } = await createOxlintWorkspace("home-oxlint-style-drift-", {
  path: () => "client/fixture.tsx",
  rules: ["no-raw-style-utilities"],
});
await writeFile(path.join(directory, "oxlint/policy/style-drift-baseline.json"), JSON.stringify({
  files: { "client/baselined.tsx": { "duration-150": 1 } },
}));
const classes = (tokens) => `export const value = <div className="${tokens}" />;`;
const quoted = (found) => found.map((item) => item.message.match(/'([^']+)'/)?.[1]).sort();

describe("home/no-raw-style-utilities", () => {
  it("rejects every off-token family", async () => {
    const tokens = ["shadow-md", "shadow-[0_1px_2px_black]", "rounded-[0.25rem]", "rounded-t-[3px]", "duration-150", "duration-[80ms]", "duration-0", "ease-out", "ease-[ease]"];
    const results = await lint({ fixture: classes(tokens.join(" ")) });
    expect(quoted(results.fixture)).toEqual([...tokens].sort());
    for (const family of ["shadow", "radius", "duration", "ease"]) expect(results.fixture.some((item) => item.message.includes(`(${family})`))).toBe(true);
  }, budgetMs);

  it("allows owned spellings, role radius steps and unrelated strings", async () => {
    const tokens = ["shadow-raised", "shadow-floating", "shadow-overlay", "shadow-toast", "shadow-none", "rounded-sm", "rounded-lg", "rounded-xl", "rounded-2xl", "rounded-full", "rounded-none", "rounded-t-sm", "rounded-ee-full", "duration-fast", "duration-base", "duration-moderate", "duration-slow", "ease-standard", "ease-enter", "ease-exit", "ease-emphasized", "p-4", "unrelated", "shadow", "rounded", "duration", "ease"];
    const results = await lint({ fixture: classes(tokens.join(" ")) });
    expect(results.fixture).toHaveLength(0);
  }, budgetMs);

  it("normalizes variants and important markers without splitting arbitrary values", async () => {
    const tokens = ["hover:shadow-md", "data-[state=on]:duration-150", "!focus:rounded-t-[3px]", "md:!ease-out", "shadow-2xs!", "[&:not([data-x=y])]:shadow-[color:var(--shadow)]", "supports-(color:oklch(0_0_0)):duration-[80ms]"];
    const results = await lint({ fixture: classes(tokens.join(" ")) });
    expect(quoted(results.fixture)).toEqual(["shadow-md", "duration-150", "rounded-t-[3px]", "ease-out", "shadow-2xs", "shadow-[color:var(--shadow)]", "duration-[80ms]"].sort());
    expect(classifyStyleUtility("hover:shadow-[color:var(--shadow)]!")).toEqual({ family: "shadow", token: "shadow-[color:var(--shadow)]" });
    expect(styleDriftOccurrences("shadow-md hover:shadow-md ease-out")).toEqual([
      { family: "shadow", token: "shadow-md" }, { family: "shadow", token: "shadow-md" }, { family: "ease", token: "ease-out" },
    ]);
  }, budgetMs);

  it("checks detached strings and all template quasis and reports only the first excess per token", async () => {
    const results = await lint({ fixture: 'const styles = "shadow-md shadow-md"; export const more = `duration-150 ${styles} ease-out ${styles} rounded-[3px]`;' });
    expect(quoted(results.fixture)).toEqual(["shadow-md", "duration-150", "ease-out", "rounded-[3px]"].sort());
  }, budgetMs);

  it("uses cooked no-substitution templates but keeps interpolated quasis raw", async () => {
    const results = await lint({
      fixture: 'export const allowed = `duration-\\u0066ast`; export const drift = `duration-\\u0031\\u0035\\u0030`; export const interpolated = `duration-\\u0066ast ${""}`;',
    });
    expect(quoted(results.fixture)).toEqual(["duration-150", String.raw`duration-\u0066ast`].sort());
  }, budgetMs);

  it("suppresses the exact baseline count only at the recorded path", async () => {
    const file = "client/baselined.tsx";
    const token = "duration-150";
    const once = await lint({ recorded: { path: file, code: classes(token) }, outside: classes(token) });
    expect(once.recorded).toHaveLength(0);
    expect(once.outside).toHaveLength(1);
    const twice = await lint({ recorded: { path: file, code: classes(`${token} ${token}`) } });
    expect(twice.recorded).toHaveLength(1);
    const separate = await lint({ recorded: { path: file, code: `export const first = "${token}"; export const second = \`${token}\`;` } });
    expect(separate.recorded).toHaveLength(1);
  }, budgetMs);
});

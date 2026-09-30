import { applyRuleCheckTimeout } from "./rule-check-timeout.mjs";
import { describe, expect, it } from "bun:test";
import { mkdir, symlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { designSystem } from "../policy/design-system.mjs";
import { budgetMs, createOxlintWorkspace } from "./helpers/oxlint-workspace.mjs";
applyRuleCheckTimeout();

const appsWebDir = fileURLToPath(new URL("../..", import.meta.url));
const { directory, lint } = await createOxlintWorkspace("home-oxlint-utility-policy-", {
  path: () => "client/fixture.tsx",
  rules: ["no-descendant-has", "no-important-utilities"],
});
await mkdir(path.join(directory, "app"), { recursive: true });
await symlink(path.join(appsWebDir, "app/globals.css"), path.join(directory, "app/globals.css"));

const has = "home(no-descendant-has)";
const important = "home(no-important-utilities)";
const classes = (tokens) => `export const value = <div className="${tokens}" />;`;
const hits = (found, rule) => found.filter((item) => item.code === rule);
const perToken = (tokens) => tokens.map((token, index) => `export const value${index} = <div className="${token}" />;`).join("\n");
const quoted = (found) => found.map((item) => item.message.match(/'([^']+)'/)?.[1]).sort();

describe("home/no-descendant-has", () => {
  it("rejects implicit and explicit descendant spellings and stacked variants", async () => {
    const tokens = ["has-data-[x]:p-0", "has-aria-expanded:p-0", "has-disabled:p-0", "has-[input]:p-0", "group-has-[input]:p-0", "peer-has-[input]:p-0", "not-has-[input]:p-0", "[&:has(input)]:p-0", "[:has(input)&]:p-0", "dark:has-[input]:p-0", "md:not-has-[input]:p-0"];
    const results = await lint({
      fixture1: { path: "client/fixture.tsx", code: perToken(tokens) },
    });
    expect(quoted(hits(results.fixture1, has))).toEqual([...tokens].sort());
  }, budgetMs);

  it("inspects escaped :has spellings that Tailwind emits verbatim", async () => {
    const token = String.raw`[&:h\61s(input)]:p-0`;
    const css = designSystem?.candidatesToCss([token])[0];
    const results = await lint({
      fixture1: { path: "client/fixture.tsx", code: `export const value = <div className={String.raw\`${token}\`} />;` },
    });
    const found = hits(results.fixture1, has);
    if (css === null || css === undefined) {
      expect(found).toHaveLength(0);
    } else {
      expect(found).toHaveLength(1);
    }
  }, budgetMs);

  it("inspects uppercase :HAS when Tailwind emits it", async () => {
    const token = "[&:HAS(input)]:p-0";
    const css = designSystem?.candidatesToCss([token])[0];
    const results = await lint({
      fixture1: { path: "client/fixture.tsx", code: classes(token) },
    });
    const found = hits(results.fixture1, has);
    if (css === null || css === undefined) {
      expect(found).toHaveLength(0);
    } else {
      expect(css).toContain(":HAS(input)");
      expect(found).toHaveLength(1);
    }
  }, budgetMs);

  it("allows only direct child alternatives with no descendant continuation", async () => {
    const accepted = ["has-[>img:first-child]:p-0", "has-[>[data-slot=x]]:p-0", "group-has-[>input]/g:p-0", "has-[>a,>b]:p-0"];
    const results = await lint({
      fixture1: { path: "client/fixture.tsx", code: perToken(accepted) },
    });
    expect(hits(results.fixture1, has)).toHaveLength(0);
    const rejected = ["has-[+x]:p-0", "has-[~x]:p-0", "has-[>a_b]:p-0", "has-[a,>b]:p-0"];
    const results2 = await lint({
      fixture2: { path: "client/fixture.tsx", code: perToken(rejected) },
    });
    expect(quoted(hits(results2.fixture2, has))).toEqual([...rejected].sort());
  }, budgetMs);

  it("does not allow document-root subjects even in a form-control file", async () => {
    const tokens = ["[html:has(.x)_&]:p-0", "[:root:has(.x)_&]:p-0", "[body:has(.x)_&]:p-0", "[:is(html):has(.x)_&]:p-0"];
    const results = await lint({
      root: { path: "components/ui/field.tsx", code: perToken(tokens) },
    });
    const found = hits(results.root, has);
    expect(quoted(found)).toEqual([...tokens].sort());
    for (const item of found) expect(item.message).toContain("document root");
  }, budgetMs);

  it("allows only descendant findings in reviewed form-control files", async () => {
    const token = "has-[input]:p-0";
    const results = await lint({
      ...Object.fromEntries(["components/ui/combobox.tsx", "components/ui/input-group.tsx", "components/ui/input-otp.tsx", "components/ui/field.tsx"].map((file) => [file, { path: file, code: classes(token) }])),
      outside: { path: "client/fixture.tsx", code: classes(token) },
    });
    for (const file of ["components/ui/combobox.tsx", "components/ui/input-group.tsx", "components/ui/input-otp.tsx", "components/ui/field.tsx"]) {
      expect(hits(results[file], has)).toHaveLength(0);
    }
    expect(hits(results.outside, has)).toHaveLength(1);
  }, budgetMs);

  it("inspects detached strings and template quasis and deduplicates selectors per token", async () => {
    const results = await lint({
      fixture1: { path: "client/fixture.tsx", code: 'const styles = "has-[input]:p-0 has-[input]:p-0"; export const more = `group-has-[input]:p-0 ${styles}`;' },
    });
    const found = hits(results.fixture1, has);
    expect(found).toHaveLength(2);
  }, budgetMs);
});

describe("home/no-important-utilities", () => {
  it("rejects both important spellings, variants, and arbitrary declarations", async () => {
    const tokens = ["!p-4", "p-4!", "hover:!p-4", "dark:p-4!", "[color:red!important]"];
    const results = await lint({
      fixture1: { path: "client/fixture.tsx", code: perToken(tokens) },
    });
    expect(quoted(hits(results.fixture1, important))).toEqual([...tokens].sort());
  }, budgetMs);

  it("inspects detached strings and template quasis but ignores ordinary exclamations", async () => {
    const results = await lint({
      fixture1: { path: "client/fixture.tsx", code: 'const styles = "!p-4"; const template = `dark:p-4! ${styles}`; export const copy = ["Done!", "Wow! it works"];' },
    });
    const found = hits(results.fixture1, important);
    expect(found).toHaveLength(2);
    const results2 = await lint({
      fixture2: { path: "client/fixture.tsx", code: classes("content-['!important']") },
    });
    expect(hits(results2.fixture2, important)).toHaveLength(0);
  }, budgetMs);

  it("honors an exact token allowlist without suppressing another token in the file", async () => {
    const results = await lint({
      fixture1: { path: "components/ui/badge.tsx", code: classes("[&>svg]:size-3! p-4!") },
      fixture2: { path: "client/fixture.tsx", code: classes("[&>svg]:size-3!") },
    });
    const found = hits(results.fixture1, important);
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain("p-4!");
    expect(hits(results.fixture2, important)).toHaveLength(1);
  }, budgetMs);

  it("keeps reduced-motion overrides only in the reviewed drawer and toast", async () => {
    const results = await lint({
      ...Object.fromEntries(["components/ui/drawer.tsx", "components/ui/toast.tsx"].map((file) => [file, { path: file, code: classes("motion-reduce:duration-0! p-4!") }])),
      outside: { path: "client/fixture.tsx", code: classes("motion-reduce:duration-0!") },
    });
    for (const file of ["components/ui/drawer.tsx", "components/ui/toast.tsx"]) {
      const found = hits(results[file], important);
      expect(found).toHaveLength(1);
      expect(found[0].message).toContain("p-4!");
    }
    expect(hits(results.outside, important)).toHaveLength(1);
  }, budgetMs);

  it("keeps money drawer desktop overrides scoped to the exact file and token", async () => {
    const tokens = [
      "lg:data-ending-style:duration-180!",
      "lg:top-[calc((100dvh+var(--sheet-keyboard-top,0px)-var(--sheet-keyboard-inset,0px))/2)]!",
      "lg:right-auto!",
      "lg:bottom-auto!",
      "lg:left-1/2!",
      "lg:rounded-xl!",
      "lg:border!",
      "lg:data-starting-style:transform-[translate3d(-50%,-50%,0)_scale(0.97)]!",
      "lg:data-ending-style:transform-[translate3d(-50%,-50%,0)_scale(0.97)]!",
      "lg:motion-reduce:data-starting-style:transform-[translate3d(-50%,-50%,0)]!",
      "lg:motion-reduce:data-ending-style:transform-[translate3d(-50%,-50%,0)]!"
    ];
    const source = tokens.map((token, index) => `export const value${index} = <div className="${token}" />;`).join("\n");
    const results = await lint({
      drawer: { path: "components/ui/drawer.tsx", code: source },
      outside: { path: "client/fixture.tsx", code: source },
    });
    expect(hits(results.drawer, important)).toHaveLength(0);
    const outside = hits(results.outside, important);
    expect(outside).toHaveLength(tokens.length);
    for (const token of tokens) {
      expect(outside.some((item) => item.message.includes(token))).toBe(true);
    }
  }, budgetMs);

  it("keeps money-modal padding overrides scoped to the exact file and token", async () => {
    for (const token of ["pb-4!", "pb-[max(1rem,calc(env(safe-area-inset-bottom)_-_var(--sheet-keyboard-inset,0px)))]!"]) {
      const results = await lint({
        modal: { path: "client/money-modal/money-modal.tsx", code: classes(token) },
        outside: { path: "client/fixture.tsx", code: classes(token) },
      });
      expect(hits(results.modal, important)).toHaveLength(0);
      expect(hits(results.outside, important)).toHaveLength(1);
    }
  }, budgetMs);

  it("deduplicates repeated tokens", async () => {
    const results = await lint({
      fixture1: { path: "client/fixture.tsx", code: classes("p-4! p-4!") },
    });
    expect(hits(results.fixture1, important)).toHaveLength(1);
  }, budgetMs);
});

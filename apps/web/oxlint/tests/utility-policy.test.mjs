import { afterAll, describe, expect, it } from "bun:test";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { designSystem } from "../policy/design-system.mjs";

const appsWebDir = fileURLToPath(new URL("../..", import.meta.url));
const mirror = await mkdtemp(path.join(tmpdir(), "home-oxlint-utility-policy-"));
await mkdir(path.join(mirror, "app"), { recursive: true });
await mkdir(path.join(mirror, "client/money-modal"), { recursive: true });
await mkdir(path.join(mirror, "components/ui"), { recursive: true });
await cp(path.join(appsWebDir, "oxlint"), path.join(mirror, "oxlint"), { recursive: true });
await symlink(path.join(appsWebDir, "node_modules"), path.join(mirror, "node_modules"), "dir");
await symlink(path.join(appsWebDir, "app/globals.css"), path.join(mirror, "app/globals.css"));
await writeFile(path.join(mirror, ".oxlintrc.jsonc"), JSON.stringify({
  plugins: [],
  categories: { correctness: "off" },
  jsPlugins: ["./oxlint/home-plugin.mjs"],
  rules: { "home/no-descendant-has": "error", "home/no-important-utilities": "error" },
}));
afterAll(() => rm(mirror, { recursive: true, force: true }));

async function diagnostics(code, file = "client/fixture.tsx") {
  await writeFile(path.join(mirror, file), code);
  const result = spawnSync(
    path.join(appsWebDir, "node_modules/.bin/oxlint"),
    ["-c", ".oxlintrc.jsonc", "--disable-nested-config", "-f", "json", file],
    { cwd: mirror, encoding: "utf8" },
  );
  expect(result.signal).toBeNull();
  expect(result.stdout).not.toBeEmpty();
  return JSON.parse(result.stdout).diagnostics;
}

const has = "home(no-descendant-has)";
const important = "home(no-important-utilities)";
const classes = (tokens) => `export const value = <div className="${tokens}" />;`;
const hits = (found, rule) => found.filter((item) => item.code === rule);
const perToken = (tokens) => tokens.map((token, index) => `export const value${index} = <div className="${token}" />;`).join("\n");
const quoted = (found) => found.map((item) => item.message.match(/'([^']+)'/)?.[1]).sort();

describe("home/no-descendant-has", () => {
  it("rejects implicit and explicit descendant spellings and stacked variants", async () => {
    const tokens = ["has-data-[x]:p-0", "has-aria-expanded:p-0", "has-disabled:p-0", "has-[input]:p-0", "group-has-[input]:p-0", "peer-has-[input]:p-0", "not-has-[input]:p-0", "[&:has(input)]:p-0", "[:has(input)&]:p-0", "dark:has-[input]:p-0", "md:not-has-[input]:p-0"];
    expect(quoted(hits(await diagnostics(perToken(tokens)), has))).toEqual([...tokens].sort());
  });

  it("inspects escaped :has spellings that Tailwind emits verbatim", async () => {
    const token = String.raw`[&:h\61s(input)]:p-0`;
    const css = designSystem?.candidatesToCss([token])[0];
    const found = hits(await diagnostics(`export const value = <div className={String.raw\`${token}\`} />;`), has);
    if (css === null || css === undefined) {
      expect(found).toHaveLength(0);
    } else {
      expect(found).toHaveLength(1);
    }
  });

  it("inspects uppercase :HAS when Tailwind emits it", async () => {
    const token = "[&:HAS(input)]:p-0";
    const css = designSystem?.candidatesToCss([token])[0];
    const found = hits(await diagnostics(classes(token)), has);
    if (css === null || css === undefined) {
      expect(found).toHaveLength(0);
    } else {
      expect(css).toContain(":HAS(input)");
      expect(found).toHaveLength(1);
    }
  });

  it("allows only direct child alternatives with no descendant continuation", async () => {
    const accepted = ["has-[>img:first-child]:p-0", "has-[>[data-slot=x]]:p-0", "group-has-[>input]/g:p-0", "has-[>a,>b]:p-0"];
    expect(hits(await diagnostics(perToken(accepted)), has)).toHaveLength(0);
    const rejected = ["has-[+x]:p-0", "has-[~x]:p-0", "has-[>a_b]:p-0", "has-[a,>b]:p-0"];
    expect(quoted(hits(await diagnostics(perToken(rejected)), has))).toEqual([...rejected].sort());
  });

  it("does not allow document-root subjects even in a form-control file", async () => {
    const tokens = ["[html:has(.x)_&]:p-0", "[:root:has(.x)_&]:p-0", "[body:has(.x)_&]:p-0", "[:is(html):has(.x)_&]:p-0"];
    const found = hits(await diagnostics(perToken(tokens), "components/ui/field.tsx"), has);
    expect(quoted(found)).toEqual([...tokens].sort());
    for (const item of found) expect(item.message).toContain("document root");
  });

  it("allows only descendant findings in reviewed form-control files", async () => {
    const token = "has-[input]:p-0";
    for (const file of ["components/ui/combobox.tsx", "components/ui/input-group.tsx", "components/ui/input-otp.tsx", "components/ui/field.tsx"]) {
      expect(hits(await diagnostics(classes(token), file), has)).toHaveLength(0);
    }
    expect(hits(await diagnostics(classes(token), "client/fixture.tsx"), has)).toHaveLength(1);
  });

  it("inspects detached strings and template quasis and deduplicates selectors per token", async () => {
    const found = hits(await diagnostics('const styles = "has-[input]:p-0 has-[input]:p-0"; export const more = `group-has-[input]:p-0 ${styles}`;'), has);
    expect(found).toHaveLength(2);
  });
});

describe("home/no-important-utilities", () => {
  it("rejects both important spellings, variants, and arbitrary declarations", async () => {
    const tokens = ["!p-4", "p-4!", "hover:!p-4", "dark:p-4!", "[color:red!important]"];
    expect(quoted(hits(await diagnostics(perToken(tokens)), important))).toEqual([...tokens].sort());
  });

  it("inspects detached strings and template quasis but ignores ordinary exclamations", async () => {
    const found = hits(await diagnostics('const styles = "!p-4"; const template = `dark:p-4! ${styles}`; export const copy = ["Done!", "Wow! it works"];'), important);
    expect(found).toHaveLength(2);
    expect(hits(await diagnostics(classes("content-['!important']")), important)).toHaveLength(0);
  });

  it("honors an exact token allowlist without suppressing another token in the file", async () => {
    const found = hits(await diagnostics(classes("[&>svg]:size-3! p-4!"), "components/ui/badge.tsx"), important);
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain("p-4!");
    expect(hits(await diagnostics(classes("[&>svg]:size-3!")), important)).toHaveLength(1);
  });

  it("keeps reduced-motion overrides only in the reviewed drawer and toast", async () => {
    for (const file of ["components/ui/drawer.tsx", "components/ui/toast.tsx"]) {
      const found = hits(await diagnostics(classes("motion-reduce:duration-0! p-4!"), file), important);
      expect(found).toHaveLength(1);
      expect(found[0].message).toContain("p-4!");
    }
    expect(hits(await diagnostics(classes("motion-reduce:duration-0!")), important)).toHaveLength(1);
  });

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
    expect(hits(await diagnostics(source, "components/ui/drawer.tsx"), important)).toHaveLength(0);
    const outside = hits(await diagnostics(source, "client/fixture.tsx"), important);
    expect(outside).toHaveLength(tokens.length);
    for (const token of tokens) {
      expect(outside.some((item) => item.message.includes(token))).toBe(true);
    }
  });

  it("keeps money-modal padding overrides scoped to the exact file and token", async () => {
    for (const token of ["pb-4!", "pb-[max(1rem,calc(env(safe-area-inset-bottom)_-_var(--sheet-keyboard-inset,0px)))]!"]) {
      expect(hits(await diagnostics(classes(token), "client/money-modal/money-modal.tsx"), important)).toHaveLength(0);
      expect(hits(await diagnostics(classes(token), "client/fixture.tsx"), important)).toHaveLength(1);
    }
  });

  it("deduplicates repeated tokens", async () => {
    expect(hits(await diagnostics(classes("p-4! p-4!")), important)).toHaveLength(1);
  });
});

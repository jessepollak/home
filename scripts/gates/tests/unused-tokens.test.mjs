import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { evaluateUnusedDeclaredTokens } from "../css-custom-properties.mjs";
import { inventoryGlobalsCss } from "../globals-css-allowlist.mjs";
import { loadSourceFiles } from "../source-files.mjs";
import { tailwindThemeSpellings } from "../tailwind-theme-spellings.mjs";

const defaultThemeSpellings = await tailwindThemeSpellings();
const cssUrl = new URL("../../../apps/web/app/globals.css", import.meta.url);
const globalsCss = await readFile(cssUrl, "utf8");
const themeSpellings = await tailwindThemeSpellings(inventoryGlobalsCss(globalsCss).themeInline.properties);
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const source = () => loadSourceFiles(`${repoRoot}/apps/web`, { extensions: [".css", ".ts", ".tsx", ".js", ".jsx", ".mjs"] });
const evaluate = (css, files, allowlist = []) => evaluateUnusedDeclaredTokens({ inventory: inventoryGlobalsCss(css), files, allowlist, themeSpellings });
const clean = { unused: [], staleAllowlist: [], invalidAllowlist: [] };

for (const [namespace, value, spelling] of [
  ["--color", "red", "[&[data-x=\\(]]:bg-probe"],
  ["--color", "red", "[&[data-x='(']]:bg-probe"],
  ["--color", "red", "[&\\[data-x\\]]:bg-probe"],
  ["--color", "red", "unknown\\ bg-probe"],
  ["--color", "red", "hover:bg-probe/50"],
  ["--spacing", "1px", "-mt-probe"],
  ["--color", "red", "!bg-probe"],
  ["--color", "red", "bg-(--color-probe)"],
  ["--breakpoint", "30rem", "hover:probe:block"],
  ["--container", "719px", "@probe/sidebar:block"],
  ["--container", "719px", "@probe/[a]:block"],
  ["--container", "719px", "@min-probe/sidebar:block"],
]) {
  test(`class scanner keeps ${namespace}-probe live through ${spelling}`, () => {
    assert.deepEqual(evaluate(`@theme inline { ${namespace}-probe: ${value}; }`, [
      { path: "components/probe.tsx", content: `const classes = ${JSON.stringify(spelling)};` },
    ]), clean);
  });
}

for (const [namespace, value, spelling] of [
  ["--breakpoint", "30rem", "content-[x:probe:block]"],
  ["--breakpoint", "30rem", "content-['x:probe:block']"],
  ["--breakpoint", "30rem", "content-[']:probe:block']"],
  ["--breakpoint", "30rem", "probe/sidebar:block"],
  ["--breakpoint", "30rem", "not-probe/sidebar:block"],
  ["--container", "719px", "@probe//sidebar:block"],
  ["--container", "719px", "@probe/:block"],
  ["--container", "719px", "not-@probe:block"],
  ["--blur", "1px", "blur-other"],
]) {
  test(`class scanner reports ${namespace}-probe unused with ${spelling}`, () => {
    assert.deepEqual(evaluate(`@theme inline { ${namespace}-probe: ${value}; }`, [
      { path: "components/probe.tsx", content: `const classes = ${JSON.stringify(spelling)};` },
    ]), { ...clean, unused: [`${namespace}-probe`] });
  });
}

test("whitespace always separates class tokens and resets every delimiter state", () => {
  for (const whitespace of [" ", "\t", "\n", "\r", "\f", "\v", "\u00a0", "\u2028", "\u2029"]) {
    for (const prefix of ["unknown", "unknown\\", "content-[", "content-(", "content-['", 'content-("', "content-[`", "content-['\\"]) {
      const spelling = `${prefix}${whitespace}bg-probe`;
      const source = spelling.replaceAll("\\", "\\\\").replaceAll("`", "\\`");
      assert.deepEqual(evaluate("@theme inline { --color-probe: red; }", [
        { path: "components/probe.tsx", content: `const classes = \`${source}\`;` },
      ]), clean, JSON.stringify(spelling));
    }
  }
});

test("single- and double-quoted runs preserve delimiters, other quotes and escaped matching quotes", () => {
  for (const quote of ["'", '"']) {
    for (const spelling of [
      `[&[data-x=${quote}(${quote}]]:bg-probe`,
      `[&[data-x=${quote}\\${quote}(${quote}]]:bg-probe`,
      `content-(${quote}[(${quote}):bg-probe`,
      `unknown${quote}bg-probe${quote}`,
    ]) {
      assert.deepEqual(evaluate("@theme inline { --color-probe: red; }", [
        { path: "components/probe.tsx", content: `const classes = ${JSON.stringify(spelling)};` },
      ]), clean, spelling);
    }
    for (const spelling of [
      `content-[${quote}]:probe:block${quote}]`,
      `content-(${quote}):probe:block${quote})`,
      `content-[${quote}\\${quote}]:probe:block${quote}]`,
      `content-[${quote}]:probe:block`,
      `content-[${quote}${["'", '"', "`"].filter((other) => other !== quote).join("")}]:probe:block${quote}]`,
    ]) {
      assert.deepEqual(evaluate("@theme inline { --breakpoint-probe: 30rem; }", [
        { path: "components/probe.tsx", content: `const classes = ${JSON.stringify(spelling)};` },
      ]), { ...clean, unused: ["--breakpoint-probe"] }, spelling);
    }
  }
});

test("backticks are literal inside brackets and parentheses but separate tokens outside", () => {
  for (const spelling of [
    "supports-[background:url(/a`b)]:bg-probe",
    "[&[data-x=`(]]:bg-probe",
    "content-(a`b):bg-probe",
    "unknown`bg-probe`",
  ]) {
    assert.deepEqual(evaluate("@theme inline { --color-probe: red; }", [
      { path: "components/probe.tsx", content: `const classes = ${JSON.stringify(spelling)};` },
    ]), clean, spelling);
  }
  for (const spelling of ["content-[`]:probe:block`]", "content-(`):probe:block`)"]) {
    assert.deepEqual(evaluate("@theme inline { --breakpoint-probe: 30rem; }", [
      { path: "components/probe.tsx", content: `const classes = ${JSON.stringify(spelling)};` },
    ]), clean, spelling);
  }
});

test("segment splitting clamps unmatched closers and preserves escaped colons", () => {
  for (const spelling of ["unknown]:bg-probe", "unknown):bg-probe", "[&[data-x=\\)]]:bg-probe", "[&\\(data-x\\)]:bg-probe", "[&\\]:hover]:bg-probe"]) {
    assert.deepEqual(evaluate("@theme inline { --color-probe: red; }", [
      { path: "components/probe.tsx", content: `const classes = ${JSON.stringify(spelling)};` },
    ]), clean, spelling);
  }
  for (const spelling of ["probe\\:block", "[x\\]:probe:block]", "(x\\):probe:block)", "content-[probe:block]\\"]) {
    assert.deepEqual(evaluate("@theme inline { --breakpoint-probe: 30rem; }", [
      { path: "components/probe.tsx", content: `const classes = ${JSON.stringify(spelling)};` },
    ]), { ...clean, unused: ["--breakpoint-probe"] }, spelling);
  }
});

test("variant modifiers require a bare container name or one balanced nonempty arbitrary group", () => {
  for (const modifier of ["sidebar", "foo-bar", "_x", "1x", "-x", "x.y", "[a]", "[a/b]", "[a:b]", "[a[b]]", "['a]/b']", "[a\\]b]"]) {
    const spelling = `@probe/${modifier}:block`;
    assert.deepEqual(evaluate("@theme inline { --container-probe: 719px; }", [
      { path: "components/probe.tsx", content: `const classes = ${JSON.stringify(spelling)};` },
    ]), clean, spelling);
  }
  for (const modifier of ["[]", "[a]b", "[a]]", "[a[b]", "[a\\]", "(a/b)", "a\\/b", '("a)/b")', "[`a]/b`]", "(a:b)"]) {
    const spelling = `@probe/${modifier}:block`;
    assert.deepEqual(evaluate("@theme inline { --container-probe: 719px; }", [
      { path: "components/probe.tsx", content: `const classes = ${JSON.stringify(spelling)};` },
    ]), { ...clean, unused: ["--container-probe"] }, spelling);
  }
  for (const spelling of ["@probe/:block", "@probe//sidebar:block", "@probe/sidebar/:block", "@probe/sidebar/other:block", "@probe\\/sidebar:block"]) {
    assert.deepEqual(evaluate("@theme inline { --container-probe: 719px; }", [
      { path: "components/probe.tsx", content: `const classes = ${JSON.stringify(spelling)};` },
    ]), { ...clean, unused: ["--container-probe"] }, spelling);
  }
});

for (const [valid, modifiers] of [
  [true, ["[a]", "[a/b]", "[a:b]", "[a[b]]", "[a\\]b]", "[a\\]]", "[[]]", "[(a)]", "[()]", "[a(b)]", "[[a]]", "[(])]", "[())]", "['a]/b']", '["a]/b"]', "[([])]", "[a\\[b]", "[a(b)c]", "[a\\(b]", "[a\\)b]"]],
  [false, ["[a]]", "[(]", "[a(b]", "[a[b]", "[]]", "[[]", '[(])', "[a)", "[a(]", "[)(", "[([)]]", "[]", "[a]b", "[a\\]", "(a/b)", "a\\/b", '("a)/b")', "[`a]/b`]", "(a:b)"]],
]) {
  for (const modifier of modifiers) {
    test(`arbitrary container modifier ${modifier} ${valid ? "keeps its token live" : "leaves its token unused"}`, () => {
      assert.deepEqual(evaluate("@theme inline { --container-probe: 719px; }", [
        { path: "components/probe.tsx", content: `const classes = ${JSON.stringify(`@probe/${modifier}:block`)};` },
      ]), { ...clean, unused: valid ? [] : ["--container-probe"] });
    });
  }
}

test("unrecognized chained variant segments conservatively keep tokens live", () => {
  for (const [namespace, value, spelling] of [
    ["--container", "719px", "@probe/a:b:block"],
    ["--color", "red", "notavariant:bg-probe"],
  ]) {
    assert.deepEqual(evaluate(`@theme inline { ${namespace}-probe: ${value}; }`, [
      { path: "components/probe.tsx", content: `const classes = ${JSON.stringify(spelling)};` },
    ]), clean, spelling);
  }
});

test("declared theme namespaces without default values keep their consuming utilities live", async () => {
  const declaredTokens = ["--background-image-probe", "--opacity-probe"];
  const extended = await tailwindThemeSpellings(declaredTokens);
  assert.ok(extended.has("--background-image"));
  assert.equal(defaultThemeSpellings.has("--background-image"), false);
  assert.equal(tailwindThemeSpellings(declaredTokens), tailwindThemeSpellings([...declaredTokens].reverse().concat(declaredTokens)));
  assert.notEqual(extended, defaultThemeSpellings);
  for (const [token, value, spelling] of [
    ["--background-image-probe", "url(/x.png)", "bg-probe"],
    ["--opacity-probe", "0.4", "opacity-probe"],
  ]) {
    assert.deepEqual(evaluateUnusedDeclaredTokens({
      inventory: inventoryGlobalsCss(`@theme inline { ${token}: ${value}; }`),
      files: [{ path: "components/probe.tsx", content: `const classes = "${spelling}";` }],
      themeSpellings: extended,
    }), clean, spelling);
  }
});

test("named-container modifiers count in class strings, while negated forms count only in @apply", () => {
  for (const spelling of ["@probe/sidebar:block", "@min-probe/sidebar:block", "not-@probe:block", "not-@probe/sidebar:block", "not-@min-probe/sidebar:block", "hover:not-@probe:block", "a@probe:block"]) {
    assert.deepEqual(evaluate("@theme inline { --container-probe: 719px; }", [
      { path: "components/probe.tsx", content: `const classes = "${spelling}";` },
    ]).unused, spelling.startsWith("@") ? [] : ["--container-probe"], spelling);
    if (!spelling.startsWith("a@")) {
      assert.deepEqual(evaluate("@theme inline { --container-probe: 719px; }", [
        { path: "components/probe.css", content: `.x { @apply ${spelling}; }` },
      ]), clean, spelling);
    }
  }
});

test("the class-string scanner models only the top-level @ boundary", () => {
  for (const spelling of ["@probe:block", "hover:@probe:block", "x:@probe:block", "bg-probe:@probe:block", "@probe/sidebar:block", "@min-probe/sidebar:block"]) {
    assert.deepEqual(evaluate("@theme inline { --container-probe: 719px; }", [
      { path: "components/probe.tsx", content: `const classes = ${JSON.stringify(spelling)};` },
    ]), clean, spelling);
  }
  for (const spelling of ["content-[@foo]:bg-probe", "supports-[@x]:bg-probe", "content-['@foo']:bg-probe", "content-(x:@foo):bg-probe", "content-[`@foo`]:bg-probe", "bg-probe/[@foo]", "unknown]:bg-probe"]) {
    assert.deepEqual(evaluate("@theme inline { --color-probe: red; }", [
      { path: "components/probe.tsx", content: `const classes = ${JSON.stringify(spelling)};` },
    ]), clean, spelling);
  }
  for (const spelling of ["bg-probe@foo", "bg-probe@foo:bg-probe"]) {
    assert.deepEqual(evaluate("@theme inline { --color-probe: red; }", [
      { path: "components/probe.tsx", content: `const classes = "${spelling}";` },
    ]).unused, ["--color-probe"], spelling);
  }
  for (const spelling of ["not-@foo.hover:bg-probe", "not-@foo.bg-probe", "not-@foo}bg-probe", "not-@foo>bg-probe", "bg-probe@foo.bg-probe", "x@y.z@w.v.bg-probe", "not-@foo\\.hover:bg-probe", "not-@foo\\>bg-probe", "not-@foo\\}bg-probe"]) {
    assert.deepEqual(evaluate("@theme inline { --color-probe: red; }", [
      { path: "components/probe.tsx", content: `const classes = ${JSON.stringify(spelling)};` },
    ]), clean, spelling);
  }
});

test("unsupported breakpoint modifiers do not keep their theme tokens live", () => {
  for (const spelling of ["probe/sidebar:block", "not-probe/sidebar:block"]) {
    assert.deepEqual(evaluate("@theme inline { --breakpoint-probe: 30rem; }", [
      { path: "components/probe.tsx", content: `const classes = ${JSON.stringify(spelling)};` },
    ]).unused, ["--breakpoint-probe"], spelling);
  }
});

test("only colons outside arbitrary values and variants separate class segments", () => {
  for (const spelling of ["content-[x:probe:block]", "content-(x:probe:block)", "content-[x:(probe:block)]"]) {
    assert.deepEqual(evaluate("@theme inline { --breakpoint-probe: 30rem; }", [
      { path: "components/probe.tsx", content: `const classes = "${spelling}";` },
    ]).unused, ["--breakpoint-probe"], spelling);
  }
  for (const spelling of ["hover:bg-probe", "[&:hover]:bg-probe"]) {
    assert.deepEqual(evaluate("@theme inline { --color-probe: red; }", [
      { path: "components/probe.tsx", content: `const classes = "${spelling}";` },
    ]), clean, spelling);
  }
});

test("quoted arbitrary values do not expose theme variant segments", () => {
  for (const spelling of ["content-['x:probe:block']", 'content-["x:probe:block"]', "content-[`x:probe:block`]", "content-['hello']"]) {
    assert.deepEqual(evaluate("@theme inline { --breakpoint-probe: 30rem; }", [
      { path: "components/probe.tsx", content: `const classes = ${JSON.stringify(spelling)};` },
    ]).unused, ["--breakpoint-probe"], spelling);
  }
});

test("escaped delimiters keep the utility separator outside arbitrary variants", () => {
  for (const spelling of ["[&[data-x=\\(]]:bg-probe", "[&\\[data-x\\]]:bg-probe", "[&[data-x=\\[]]:bg-probe", "hover:bg-probe", "bg-(--color-probe)", "bg-probe/50", "!bg-probe"]) {
    assert.deepEqual(evaluate("@theme inline { --color-probe: red; }", [
      { path: "components/probe.tsx", content: `const classes = ${JSON.stringify(spelling)};` },
    ]), clean, spelling);
  }
  assert.deepEqual(evaluate("@theme inline { --spacing-probe: 1px; }", [
    { path: "components/probe.tsx", content: 'const classes = "-mt-probe";' },
  ]), clean);
  assert.deepEqual(evaluate("@theme inline { --breakpoint-probe: 30rem; }", [
    { path: "components/probe.tsx", content: `const classes = ${JSON.stringify("content-probe\\:probe:block")};` },
  ]).unused, ["--breakpoint-probe"]);
});

test("bare default-value keys use only measured bare and numeric valued roots", () => {
  assert.ok(themeSpellings.get("--radius").defaults.bare.includes("rounded"));
  for (const spelling of ["rounded", "hover:!rounded", "rounded-tl!"]) {
    assert.deepEqual(evaluate("@theme inline { --radius: 1px; }", [
      { path: "components/probe.tsx", content: `const classes = "${spelling}";` },
    ]), clean, spelling);
  }
  assert.deepEqual(evaluate("@theme inline { --radius: 1px; }", [
    { path: "components/probe.tsx", content: 'const classes = "unknown";' },
  ]).unused, ["--radius"]);
  assert.ok(themeSpellings.get("--drop-shadow").defaults.bare.includes("drop-shadow"));
  for (const spelling of ["drop-shadow", "drop-shadow/50"]) {
    assert.deepEqual(evaluate("@theme inline { --drop-shadow: 0 1px 2px #123456; }", [
      { path: "components/probe.tsx", content: `const classes = "${spelling}";` },
    ]), clean, spelling);
  }
  assert.ok(themeSpellings.get("--spacing").defaults.valued.includes("p"));
  for (const spelling of ["p-4", "p-1.5", "-mt-4", "hover:!p-4", "-mt-4!"]) {
    assert.deepEqual(evaluate("@theme inline { --spacing: 1px; }", [
      { path: "components/probe.tsx", content: `const classes = "${spelling}";` },
    ]), clean, spelling);
  }
  for (const spelling of ["w-1/2", "p-[3px]", "p-px", "p-p3"]) {
    assert.deepEqual(evaluate("@theme inline { --spacing: 1px; --spacing-p3: 1px; }", [
      { path: "components/probe.tsx", content: `const classes = "${spelling} p-p3";` },
    ]).unused, ["--spacing"], spelling);
  }
});

test("every measured default lookup keeps its exact namespace key live", () => {
  for (const [namespace, { defaults }] of themeSpellings) {
    for (const spelling of [...defaults.bare, ...defaults.valued.map((root) => `${root}-1`)]) {
      assert.deepEqual(evaluate(`@theme inline { ${namespace}: 1px; }`, [
        { path: "components/probe.tsx", content: `const classes = "${spelling}";` },
      ]), clean, `${namespace} through ${spelling}`);
    }
  }
});

test("utility modifiers keep their measured namespace tokens live", () => {
  const css = "@theme inline { --leading-probe: 7; }";
  assert.ok(themeSpellings.get("--leading").modifiers.includes("text"));
  for (const spelling of ["text-lg/probe", "text-[1px]/probe", "!text-lg/probe", "hover:text-lg/probe", "hover:text-lg/probe!"]) {
    assert.deepEqual(evaluate(css, [
      { path: "components/probe.tsx", content: `const classes = "${spelling}";` },
    ]), clean, spelling);
  }
  for (const spelling of ["text-lg/other", "text-lg/probe/other", "other-lg/probe", "text-[1px/probe]", "text-lg/[probe]"]) {
    assert.deepEqual(evaluate(css, [
      { path: "components/probe.tsx", content: `const classes = "${spelling}";` },
    ]).unused, ["--leading-probe"], spelling);
  }
});

test("theme spellings are memoized for the installed Tailwind build", async () => {
  assert.equal(tailwindThemeSpellings(), tailwindThemeSpellings());
  assert.equal(await tailwindThemeSpellings(), defaultThemeSpellings);
});

test("the derived Tailwind namespace contract stays explicit", () => {
  assert.deepEqual([...defaultThemeSpellings.keys()], [
    "--animate", "--aspect", "--blur", "--breakpoint", "--color", "--container",
    "--drop-shadow", "--ease", "--font", "--font-weight", "--inset", "--inset-shadow",
    "--leading", "--max-width", "--perspective", "--radius", "--shadow", "--spacing",
    "--text", "--text-shadow", "--tracking",
  ], "When Tailwind adds a namespace, confirm the guard keeps tokens live through it and update this list.");
});

test("derived namespaces expose their consuming utility and variant spellings", () => {
  for (const [namespace, { utilities, variants, modifiers, defaults }] of themeSpellings) {
    for (const roots of [modifiers, defaults.bare, defaults.valued]) assert.deepEqual(roots, [...new Set(roots)].sort());
    assert.ok(utilities.length || variants.length, `${namespace} must have a consuming spelling`);
    assert.deepEqual(utilities, [...new Set(utilities)].sort());
    assert.deepEqual(variants, [...new Set(variants)].sort());
  }
  const representatives = {
    "--blur": "blur", "--tracking": "tracking", "--leading": "leading",
    "--animate": "animate", "--ease": "ease", "--aspect": "aspect",
    "--perspective": "perspective", "--font-weight": "font",
    "--inset-shadow": "inset-shadow", "--drop-shadow": "drop-shadow",
    "--container": "max-w", "--breakpoint": "max-w-screen", "--color": "bg",
    "--spacing": "p", "--radius": "rounded", "--text": "text",
    "--shadow": "shadow", "--font": "font",
  };
  for (const [namespace, root] of Object.entries(representatives)) {
    assert.ok(themeSpellings.get(namespace).utilities.includes(root), `${namespace} must consume ${root}`);
  }
  assert.ok(themeSpellings.get("--breakpoint").variants.includes("{value}"));
  assert.equal(themeSpellings.get("--breakpoint").variants.some((template) => template.endsWith("/{modifier}")), false);
  for (const template of ["@{value}/{modifier}", "@min-{value}/{modifier}", "not-@{value}/{modifier}"]) {
    assert.ok(themeSpellings.get("--container").variants.includes(template), template);
  }
});

test("every modeled namespace keeps a probe live only through a matching spelling", () => {
  for (const [namespace, { utilities, variants }] of themeSpellings) {
    const token = `${namespace}-probe`;
    const css = `@theme inline { ${token}: 1px; }`;
    const spelling = utilities.length ? `${utilities[0]}-probe` : `${variants[0].replace("{value}", "probe").replace("{modifier}", "sidebar")}:block`;
    const file = { path: "components/probe.tsx", content: `const classes = "${spelling}";` };
    assert.deepEqual(evaluate(css, [file]), clean, `${namespace} through ${spelling}`);
    assert.deepEqual(evaluate(css, [{ ...file, content: 'const classes = "unknown-probe";' }]).unused, [token], namespace);
  }
});

test("blur and tracking utilities keep their theme declarations live", () => {
  const css = "@theme inline { --blur-probe: 1px; --tracking-probe: 1px; }";
  const file = { path: "components/probe.tsx", content: 'const classes = "blur-probe tracking-probe";' };
  assert.deepEqual(evaluate(css, [file]), clean);
});

test("theme variants consume only a complete non-final class segment", () => {
  for (const [namespace, { variants }] of themeSpellings) {
    const token = `${namespace}-probe`;
    const css = `@theme inline { ${token}: 1px; }`;
    for (const template of variants) {
      const base = template.replace("/{modifier}", "").replace("{value}", "probe");
      const modifier = template.endsWith("/{modifier}") ? "/sidebar" : "";
      const segment = `${base}${modifier}`;
      const file = base.includes("not-@")
        ? { path: "components/probe.css", content: `.x { @apply hover:${segment}:focus:block; }` }
        : { path: "components/probe.tsx", content: `const classes = "hover:${segment}:focus:block";` };
      assert.deepEqual(evaluate(css, [file]), clean, `${namespace} through ${segment}`);
      for (const wrong of [`${segment}`, `hover:${base}-other${modifier}:block`, `hover:other-${segment}:block`]) {
        assert.deepEqual(evaluate(css, [{ ...file, content: file.path.endsWith(".css") ? `.x { @apply ${wrong}; }` : `const classes = "${wrong}";` }]).unused, [token], wrong);
      }
    }
  }
  assert.deepEqual(evaluate("@theme inline { --breakpoint-probe: 1px; }", [
    { path: "components/probe.css", content: ".x { @apply probe:block; }" },
  ]), clean);
});

test("overlapping namespaces preserve every consuming spelling", () => {
  const css = "@theme inline { --font-weight-probe: 1px; }";
  for (const spelling of ["font-probe", "font-weight-probe"]) {
    assert.deepEqual(evaluate(css, [
      { path: "components/probe.tsx", content: `const classes = "${spelling}";` },
    ]), clean, spelling);
  }
});

test("theme utilities normalize variants, important, opacity and negative markers", () => {
  const css = "@theme inline { --color-probe: red; --spacing-probe: 1px; }";
  for (const spelling of ["hover:focus:!bg-probe/50 -mt-probe", "dark:bg-probe/50! hover:-mt-probe!"]) {
    assert.deepEqual(evaluate(css, [
      { path: "components/probe.tsx", content: `const classes = "${spelling}";` },
    ]), clean, spelling);
  }
});

test("unused-token evaluation requires the measured spelling Map", () => {
  for (const invalid of [undefined, null, {}, []]) {
    assert.throws(() => evaluateUnusedDeclaredTokens({
      inventory: inventoryGlobalsCss(":root { --probe: red; }"),
      files: [{ path: "components/probe.tsx", content: 'const color = "var(--probe)";' }],
      themeSpellings: invalid,
    }), /themeSpellings.*Map.*tailwindThemeSpellings/);
  }
});

test("all declared globals.css tokens have a source reference", async () => {
  const css = await readFile(cssUrl, "utf8");
  const files = await source();
  assert.ok(files.some(({ path }) => path === "app/globals.css"));
  assert.deepEqual(evaluate(css, files), clean);
});

test("commented-out JS references do not keep declared tokens live", () => {
  const css = ":root { --orphan: red; }";
  const story = { path: "components/probe.stories.tsx", content: "// var(--orphan)" };
  assert.deepEqual(evaluate(css, [story]).unused, ["--orphan"]);
  assert.deepEqual(evaluate(css, [{ ...story, content: 'const color = "var(--orphan)";' }]), clean);
});

test("commented-out CSS var() and @apply do not keep tokens live", () => {
  const css = "@theme inline { --color-example: red; } :root { --x: red; }";
  const stylesheet = { path: "components/probe.css", content: "/* var(--x); @apply bg-example; */" };
  assert.deepEqual(evaluate(css, [stylesheet]).unused, ["--color-example", "--x"]);
  assert.deepEqual(evaluate(css, [{ ...stylesheet, content: ".x { color: var(--x); @apply bg-example; }" }]), clean);
});

for (const modifier of ["['a']", '["a"]']) {
  test(`CSS @apply keeps its container token live through quoted modifier ${modifier}`, () => {
    assert.deepEqual(evaluate("@theme inline { --container-probe: 719px; }", [
      { path: "components/probe.css", content: `.x { @apply @probe/${modifier}:block; }` },
    ]), clean);
  });
}

test("CSS @apply quoted whitespace still separates tokens", () => {
  for (const modifier of ["['finance row']", '["finance row"]']) {
    assert.deepEqual(evaluate("@theme inline { --container-probe: 719px; }", [
      { path: "components/probe.css", content: `.x { @apply @probe/${modifier}:block; }` },
    ]).unused, ["--container-probe"], modifier);
  }
});

test("CSS @apply preserves arbitrary container modifiers but ignores commented-out uses", () => {
  const css = "@theme inline { --container-probe: 719px; }";
  const stylesheet = { path: "components/probe.css", content: ".x { @apply @probe/[a]:block; }" };
  assert.deepEqual(evaluate(css, [stylesheet]), clean);
  for (const content of ["/* .x { @apply @probe/[a]:block; } */", ".x { @apply /* @probe/[a]:block */ block; }"]) {
    assert.deepEqual(evaluate(css, [{ ...stylesheet, content }]).unused, ["--container-probe"], content);
  }
});

for (const content of [
  '.x { @apply block "bg-probe"; }',
  ".x { @apply block content-[' bg-probe ']; }",
]) {
  test(`quoted CSS @apply text is not a theme utility consumer: ${content}`, () => {
    assert.deepEqual(evaluate("@theme inline { --color-probe: red; }", [
      { path: "components/probe.css", content },
    ]), { ...clean, unused: ["--color-probe"] });
  });
}

test("CSS @apply masks a quoted brace before locating a following shorthand use", () => {
  assert.deepEqual(evaluate("@theme inline { --color-probe: red; }", [
    { path: "components/probe.css", content: ".x { @apply content-['}'] bg-(--missing); }" },
  ]), { ...clean, unused: ["--color-probe"] });
  assert.deepEqual(evaluate(":root { --missing: red; --after-body: blue; }", [
    { path: "components/probe.css", content: ".x { @apply content-['}'] bg-(--missing); bg-(--after-body); }" },
  ]), { ...clean, unused: ["--after-body"] });
});

test("theme classes do not keep root-only tokens live", () => {
  const css = ":root { --color-orphan: red; }";
  const story = { path: "components/probe.stories.tsx", content: 'const classes = "bg-orphan";' };
  assert.deepEqual(evaluate(css, [story]).unused, ["--color-orphan"]);
  assert.deepEqual(evaluate(css, [{ ...story, content: 'const classes = "bg-orphan"; const color = "var(--color-orphan)";' }]), clean);
});

test("a new declaration without references fails, including a nested declaration", async () => {
  const css = await readFile(cssUrl, "utf8");
  const files = await source();
  assert.deepEqual(evaluate(css.replace("@theme inline {", "@theme inline { --color-orphan: red;"), files).unused, ["--color-orphan"]);
  assert.deepEqual(evaluate(`${css}\n@supports (height: 100dvh) { :root { --nested-orphan: 0; } }`, files).unused, ["--nested-orphan"]);
});

test("var() and theme utilities in CSS and static class strings count as references", () => {
  const css = `@theme inline { --color-example: red; --font-example: sans-serif; --radius-example: 1rem; --spacing-example: 2px; --text-example: 2rem; --shadow-example: 0 1px black; }
:root { --root-example: blue; }
.dark { --root-example: green; }
@supports (height: 100dvh) { :root { --support-example: 1px; } }
@media (display-mode: standalone) { :root { --media-example: 1px; } }`;
  const files = [
    { path: "app/globals.css", content: "@layer base { body { @apply bg-example; } }" },
    { path: "components/probe.tsx", content: 'const classes = "hover:text-example font-example rounded-example px-example text-example shadow-example"; const value = "var(--root-example) var(--support-example) var(--media-example)";' },
  ];
  assert.deepEqual(evaluate(css, files), clean);
  assert.deepEqual(evaluate(css, files.map((file) => ({ ...file, content: file.content.replace("hover:text-example ", "") }))), clean);
  const colorCss = "@theme inline { --color-tone: red; --color-test-only: blue; }";
  assert.deepEqual(evaluate(colorCss, [
    { path: "components/probe.stories.tsx", content: 'const classes = "dark:fill-tone/50";' },
    { path: "components/probe.test.tsx", content: 'const classes = "bg-test-only";' },
  ]).unused, ["--color-test-only"]);
});

test("a theme utility must match the full prefix and token name", () => {
  const css = "@theme inline { --color-primary: red; --color-brand-primary: blue; }";
  const files = [{ path: "components/probe.tsx", content: 'const classes = "bg-brand-primary";' }];
  assert.deepEqual(evaluate(css, files).unused, ["--color-primary"]);
  assert.deepEqual(evaluate(css, [{ ...files[0], content: 'const classes = "bg-brand-primary bg-primary";' }]), clean);
});

test("the parenthesized custom-property shorthand keeps declared tokens live", () => {
  const css = "@theme inline { --color-probe: red; --text-probe: 2rem; } :root { --root-probe: 1px; }";
  const shorthand = { path: "components/probe.tsx", content: 'const classes = "bg-(--color-probe) text-(length:--text-probe) m-(--root-probe,0px)";' };
  assert.deepEqual(evaluate(css, [shorthand]), clean);
  assert.deepEqual(evaluate(css, [{ path: "components/probe.tsx", content: 'const classes = "p-4";' }]).unused, ["--color-probe", "--root-probe", "--text-probe"]);
  assert.deepEqual(evaluate(css, [{ path: "components/probe.tsx", content: 'const classes = "bg-(--color-probe-extra)";' }]).unused, ["--color-probe", "--root-probe", "--text-probe"]);
});

test("every static utility spelling that consumes a theme token counts as a reference", () => {
  const css = "@theme inline { --color-probe: #123456; --radius-probe: 9px; --spacing-probe: 7px; }";
  const live = { path: "components/probe.tsx", content: 'const classes = `drop-shadow-probe ${ok ? "inset-shadow-probe" : "text-shadow-probe"} rounded-tl-probe rounded-ss-probe basis-probe indent-probe border-spacing-probe !bg-probe`;' };
  assert.deepEqual(evaluate(css, [live]), clean);
  assert.deepEqual(evaluate(css, [{ path: "components/probe.tsx", content: 'const classes = "drop-shadow-other rounded-tl-other basis-other";' }]).unused, ["--color-probe", "--radius-probe", "--spacing-probe"]);
});

test("the consuming spellings Tailwind compiles against a namespace stay live", () => {
  const css = "@theme inline { --color-probe: #123456; --spacing-probe: 7px; }";
  const live = { path: "components/probe.tsx", content: 'const classes = "inset-ring-probe border-bs-probe scrollbar-thumb-probe mask-linear-from-probe translate-probe translate-z-probe inset-s-probe inset-bs-probe leading-probe";' };
  assert.deepEqual(evaluate(css, [live]), clean);
});

test("only the top-level tooling tree is outside the product scan", () => {
  const css = "@theme inline { --color-probe: red; }";
  assert.deepEqual(evaluate(css, [{ path: "oxlint/tokens.tsx", content: 'const classes = "bg-probe";' }]).unused, ["--color-probe"]);
  assert.deepEqual(evaluate(css, [{ path: "client/oxlint/tokens.tsx", content: 'const classes = "bg-probe";' }]), clean);
  assert.deepEqual(evaluate(css, [{ path: "client/oxlint/tokens.tsx", content: 'const classes = "p-4";' }]).unused, ["--color-probe"]);
});

test("allowlist entries fail when referenced, removed, duplicated, or missing reasons", async () => {
  const css = await readFile(cssUrl, "utf8");
  const files = await source();
  assert.deepEqual(evaluate(css, files, [{ name: "--color-background", reason: "external" }]).staleAllowlist, ["--color-background"]);
  assert.deepEqual(evaluate(css, files, [{ name: "--no-longer-declared", reason: "external" }]).staleAllowlist, ["--no-longer-declared"]);
  const orphan = css.replace("@theme inline {", "@theme inline { --color-orphan: red;");
  assert.deepEqual(evaluate(orphan, files, [{ name: "--color-orphan", reason: "" }]).invalidAllowlist, ["--color-orphan"]);
  assert.deepEqual(evaluate(orphan, files, [{ name: "--color-orphan", reason: "external" }, { name: "--color-orphan", reason: "external" }]).invalidAllowlist, ["--color-orphan"]);
  assert.deepEqual(evaluate(orphan, files, [{ name: "--color-orphan", reason: "external" }]), clean);
});

for (const [modifier, live] of [["[([])]", true], ["[([)]]", false]]) {
  test(`CSS @apply exotic modifier ${modifier} ${live ? "keeps its token live" : "leaves it unused"}`, () => {
    assert.deepEqual(evaluate("@theme inline { --container-probe: 719px; }", [
      { path: "components/probe.css", content: `.x { @apply @probe/${modifier}:block; }` },
    ]).unused, live ? [] : ["--container-probe"]);
  });
}

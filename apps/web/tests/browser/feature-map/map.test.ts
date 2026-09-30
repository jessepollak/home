import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { parseSurface, readFeatureMap } from "./map";

const path = resolve(import.meta.dir, "../../../../../.agents/skills/browser-iteration/surfaces");

test("keeps every non-manual surface's fixture Reach available to the replay", async () => {
  const { surfaces } = await readFeatureMap(path);
  expect([...surfaces.keys()].sort()).toEqual([
    "access-gate", "account-settings", "activity", "add-money", "balances", "borrow", "card", "cash-out",
    "coverage", "dev-ui", "home-panel", "invest", "investments", "landing", "operator-console", "save",
    "send", "sign-in", "support-chat", "toasts",
  ]);
  expect([...surfaces.values()].filter((surface) => !surface.manual && !surface.reach.length)).toEqual([]);
  expect(surfaces.get("send")?.reach).toContainEqual({ kind: "fill", label: "To", value: "example.base.eth" });
  expect(surfaces.get("save")?.reach).toContainEqual({ kind: "fill", label: "Amount", value: "0.1" });
  expect(surfaces.get("save")?.reach).toContainEqual({ kind: "click", label: "Continue" });
  expect(surfaces.get("save")?.reach).toContainEqual({ kind: "expect", text: "Deposit $0.10" });
  const convert = surfaces.get("save")?.variants.find((variant) => variant.name === "convert")?.reach ?? [];
  expect(convert).toContainEqual({ kind: "click-prefix", prefix: "Euro" });
  expect(convert).toContainEqual({ kind: "expect", text: "Max slippage" });
  expect(convert.at(-1)).toEqual({ kind: "expect", text: "Convert $1.25" });
  expect(surfaces.get("save")?.reach).not.toContainEqual({ kind: "click-prefix", prefix: "Euro" });
});

test("rejects a replay Reach heading the parser cannot read", () => {
  expect(() => parseSurface("demo.md", "### `demo`\n- **Reach (replay: Convert)**:\n  1. `goto \"/cash\"`\n"))
    .toThrow("Invalid or duplicate replay Reach");
});

test("rejects a numbered Reach step the parser cannot read", () => {
  expect(() => parseSurface("demo.md", "### `demo`\n- **Reach**:\n  1. `goto \"/cash\"`\n  2. `clik \"Convert\"`\n"))
    .toThrow("Unreadable Reach step: clik \"Convert\"");
  expect(() => parseSurface("demo.md", "### `demo`\n- **Reach**:\n  1. `fill \"Amount\"`\n"))
    .toThrow("Unreadable Reach step: fill \"Amount\"");
});

test("keeps prose between machine-readable Reach steps", () => {
  const surface = parseSurface("demo.md", "### `demo`\n- **Reach**:\n  1. `expect \"Deposit\"`; in-app entry from `/cash/savings`: open a `Manage <vault>` row, then `Deposit more`; the `vault shares` row, `currency \"US dollar\"` copy and the `value row` follow.\n");
  expect(surface.reach).toEqual([{ kind: "expect", text: "Deposit" }]);
});

test("keeps narrative prose that mentions a step verb word", () => {
  const surface = parseSurface("demo.md", "### `demo`\n- **Reach**:\n  1. `expect \"Deposit\"`; a second click closes the sheet and users expect a warning.\n");
  expect(surface.reach).toEqual([{ kind: "expect", text: "Deposit" }]);
});

test("keeps narrative prose that mentions a step verb in a replay Reach", () => {
  const surface = parseSurface("demo.md", "### `demo`\n- **Reach (replay: convert)**:\n  1. `expect \"Deposit\"`; a second click closes the sheet and users expect a warning.\n");
  expect(surface.variants[0].reach).toEqual([{ kind: "expect", text: "Deposit" }]);
});

test("rejects a prose verb between machine-readable Reach steps", () => {
  expect(() => parseSurface("demo.md", "### `demo`\n- **Reach**:\n  1. `fill \"Amount\" \"0.1\"`, click `Continue`, `expect \"Confirm\"`\n"))
    .toThrow(/Prose Reach step in feature-map surface demo\.md.*click `Continue`/);
});

test("rejects a prose verb in a replay Reach step", () => {
  expect(() => parseSurface("demo.md", "### `demo`\n- **Reach (replay: convert)**:\n  1. `fill \"Amount\" \"0.1\"`, click `Continue`, `expect \"Confirm\"`\n"))
    .toThrow(/Prose Reach step in feature-map surface demo\.md.*click `Continue`/);
});

for (const heading of ["Reach", "Reach (replay: convert)"]) {
  test.each(["click `X`", "expect the `Rate` row", "Expect the `Rate` row"])(
    `rejects connector-word prose in ${heading}: %s`,
    (step) => {
      expect(() => parseSurface("demo.md", `### \`demo\`\n- **${heading}**:\n  1. ${step}\n`))
        .toThrow(`Prose Reach step in feature-map surface demo.md: 1. ${step}`);
    },
  );

  test.each(["expect the `Rate` row", "1. goto /cash", "1. expect Network: Base"])(
    `rejects heading-inline prose in ${heading}: %s`,
    (content) => {
      expect(() => parseSurface("demo.md", `### \`demo\`\n- **${heading}**: ${content}\n  1. \`goto "/cash"\`\n`))
        .toThrow(`Prose Reach step in feature-map surface demo.md: - **${heading}**: ${content}`);
    },
  );

  test(`rejects a numbered prose step after a heading separator in ${heading}`, () => {
    expect(() => parseSurface("demo.md", `### \`demo\`\n- **${heading}**:1. goto /cash\n  1. \`goto "/cash"\`\n`))
      .toThrow(`Prose Reach step in feature-map surface demo.md: - **${heading}**:1. goto /cash`);
  });

  test.each([`- **${heading}** 1. goto /cash`, `- **${heading}** (fixture (smoke-verified)): 1. goto /cash`])(
    `rejects an unsupported heading prefix in ${heading}: %s`,
    (line) => {
      expect(() => parseSurface("demo.md", `### \`demo\`\n${line}\n  1. \`goto "/cash"\`\n`))
        .toThrow(`Unsupported Reach heading in feature-map surface demo.md: ${line}`);
    },
  );

  test(`rejects a numbered prose step behind a doubled separator in ${heading}`, () => {
    expect(() => parseSurface("demo.md", `### \`demo\`\n- **${heading}**: : 1. goto /cash\n  1. \`goto "/cash"\`\n`))
      .toThrow(`Prose Reach step in feature-map surface demo.md: - **${heading}**: : 1. goto /cash`);
  });

  test(`rejects a numbered prose step behind a quote marker in ${heading}`, () => {
    expect(() => parseSurface("demo.md", `### \`demo\`\n- **${heading}**:\n  1. \`goto "/cash"\`\n  > 2. expect "Deposit"\n`))
      .toThrow(`Prose Reach step in feature-map surface demo.md: > 2. expect "Deposit"`);
  });

  test(`keeps a sentence that ends with a number in ${heading}`, () => {
    const list = parseSurface("demo.md", `### \`demo\`\n- **${heading}**:\n  1. \`expect "Deposit"\`; the fixture protocol is version 1. Click events are synthetic.\n`);
    expect(heading === "Reach" ? list.reach : list.variants[0].reach).toEqual([{ kind: "expect", text: "Deposit" }]);
    const inline = parseSurface("demo.md", `### \`demo\`\n- **${heading}**: the fixture protocol is version 1. Click events are synthetic.\n  1. \`goto "/cash"\`\n`);
    expect(heading === "Reach" ? inline.reach : inline.variants[0].reach).toEqual([{ kind: "goto", path: "/cash" }]);
  });

  test(`keeps a numbered sentence with a hyphenated noun in ${heading}`, () => {
    const headingCase = parseSurface("demo.md", `### \`demo\`\n- **${heading}**: 1. click-through rate is measured separately.\n  1. \`goto "/cash"\`\n`);
    expect(heading === "Reach" ? headingCase.reach : headingCase.variants[0].reach).toEqual([{ kind: "goto", path: "/cash" }]);
    const listCase = parseSurface("demo.md", `### \`demo\`\n- **${heading}**:\n  1. \`goto "/cash"\`\n  > 1. click-through rate is measured separately.\n`);
    expect(heading === "Reach" ? listCase.reach : listCase.variants[0].reach).toEqual([{ kind: "goto", path: "/cash" }]);
    const suspended = parseSurface("demo.md", `### \`demo\`\n- **${heading}**:\n  1. \`goto "/cash"\`\n  > 1. click- and tap-through rates are measured separately.\n`);
    expect(heading === "Reach" ? suspended.reach : suspended.variants[0].reach).toEqual([{ kind: "goto", path: "/cash" }]);
    const accented = parseSurface("demo.md", `### \`demo\`\n- **${heading}**: 1. press-étoupe labels are unrelated to navigation.\n  1. \`goto "/cash"\`\n`);
    expect(heading === "Reach" ? accented.reach : accented.variants[0].reach).toEqual([{ kind: "goto", path: "/cash" }]);
  });

  test(`rejects a prose step wrapped onto the next line in ${heading}`, () => {
    expect(() => parseSurface("demo.md", `### \`demo\`\n- **${heading}**:\n  1. \`goto "/cash"\`; expect the\n     \`Deposit\` row.\n`))
      .toThrow(`Prose Reach step in feature-map surface demo.md: 1. \`goto "/cash"\`; expect the`);
  });

  test(`keeps a compound that ends in a command word in ${heading}`, () => {
    const list = parseSurface("demo.md", `### \`demo\`\n- **${heading}**:\n  1. \`goto "/cash"\`; The pre-fill \`Amount\` value comes from the fixture.\n`);
    expect(heading === "Reach" ? list.reach : list.variants[0].reach).toEqual([{ kind: "goto", path: "/cash" }]);
  });

  test(`rejects a prose step that follows an escaped backtick in ${heading}`, () => {
    expect(() => parseSurface("demo.md", `### \`demo\`\n- **${heading}**:\n  1. \`goto "/cash"\`; a literal \\\`\n     click \`Continue\`\n`))
      .toThrow("Prose Reach step in feature-map surface demo.md: click `Continue`");
  });

  test(`rejects a code span the replay cannot read in ${heading}`, () => {
    expect(() => parseSurface("demo.md", `### \`demo\`\n- **${heading}**:\n  1. \`goto\n     "/cash"\`; expect the \`Rate\` row\n`))
      .toThrow(`Wrapped code span in feature-map surface demo.md: 1. \`goto`);
    expect(() => parseSurface("demo.md", `### \`demo\`\n- **${heading}**:\n  1. \`goto "/cash"\`; a stray \` backtick\n`))
      .toThrow(`Unclosed code span in feature-map surface demo.md: 1. \`goto "/cash"\`; a stray \` backtick`);
  });

  test(`rejects a numbered command word with a stray hyphen and an unquoted operand in ${heading}`, () => {
    expect(() => parseSurface("demo.md", `### \`demo\`\n- **${heading}**: 1. expect- Network fee\n  1. \`goto "/cash"\`\n`))
      .toThrow(`Prose Reach step in feature-map surface demo.md: - **${heading}**: 1. expect- Network fee`);
  });
  test(`rejects a numbered command word with a stray hyphen in ${heading}`, () => {
    expect(() => parseSurface("demo.md", `### \`demo\`\n- **${heading}**: 1. expect- "Network fee"\n  1. \`goto "/cash"\`\n`))
      .toThrow(`Prose Reach step in feature-map surface demo.md: - **${heading}**: 1. expect- "Network fee"`);
  });

  test.each([
    '`expect "Rate"`', '`click "A" "B"`', '`expct "Vault fee"`', '`expect"Vault fee"`', "`goto /cash`",
    "`Click-through rate`", "`Fill rate`", "`client/trading`",
  ])(
    `rejects a heading code span in ${heading}: %s`,
    (step) => {
      expect(() => parseSurface("demo.md", `### \`demo\`\n- **${heading}**: ${step}\n  1. \`goto "/cash"\`\n`))
        .toThrow(`Code span in Reach heading of feature-map surface demo.md: - **${heading}**: ${step}`);
    },
  );

  test(`keeps narrative verb mentions and longer operand boundaries in ${heading}`, () => {
    const surface = parseSurface("demo.md", `### \`demo\`\n- **${heading}**:\n  1. \`expect "Deposit"\`; users expect a warning; a second click closes the \`Deposit\` sheet; users expect a warning about the \`Deposit\` sheet; expect an approximate \`EUR\` amount.\n`);
    expect(heading === "Reach" ? surface.reach : surface.variants[0].reach)
      .toEqual([{ kind: "expect", text: "Deposit" }]);
  });

  test(`keeps a narrative heading in ${heading}`, () => {
    const label = heading === "Reach" ? " (smoke-verified):" : ": fixture Convert from USD to EUR, stopping at the review before the marked control.";
    const surface = parseSurface("demo.md", `### \`demo\`\n- **${heading}**${label}\n  1. \`goto "/cash"\`\n`);
    expect(heading === "Reach" ? surface.reach : surface.variants[0].reach)
      .toEqual([{ kind: "goto", path: "/cash" }]);
  });

  test.each(["expect `Rate`", "expect the `Rate` row", '`expect "Rate"`'])(
    `keeps heading-inline steps for manual surfaces in ${heading}: %s`,
    (step) => {
      const surface = parseSurface("demo.md", `### \`demo\`\n- **${heading}**: ${step}\n  1. \`goto "/cash"\`\n- **Verify**: manual\n`);
      expect(surface.manual).toBe(true);
      expect(heading === "Reach" ? surface.reach : surface.variants[0].reach)
        .toEqual([{ kind: "goto", path: "/cash" }]);
    },
  );
}

test("rejects a Reach step written entirely as prose", () => {
  expect(() => parseSurface("demo.md", "### `demo`\n- **Reach**:\n  1. goto /cash\n"))
    .toThrow("Prose Reach step in feature-map surface demo.md: 1. goto /cash");
});

test("keeps prose Reach steps for manual surfaces", () => {
  const markdown = "### `demo`\n- **Reach**:\n  1. `fill \"Amount\" \"0.1\"`, click `Continue`, `expect \"Confirm\"`\n- **Verify**: manual\n";
  expect(() => parseSurface("demo.md", markdown)).not.toThrow();
  expect(parseSurface("demo.md", markdown).manual).toBe(true);
});

test("rejects a numbered Reach step with the wrong number of arguments", () => {
  expect(() => parseSurface("demo.md", "### `demo`\n- **Reach**:\n  1. `click \"Convert\" \"More\"`\n"))
    .toThrow("Unreadable Reach step: click \"Convert\" \"More\"");
  expect(() => parseSurface("demo.md", "### `demo`\n- **Reach**:\n  1. `fill \"Amount\" \"1\" \"extra\"`\n"))
    .toThrow("Unreadable Reach step");
});

test("rejects a known command with malformed arguments", () => {
  expect(() => parseSurface("demo.md", "### `demo`\n- **Reach**:\n  1. `goto /cash`\n"))
    .toThrow("Unreadable Reach step: goto /cash");
  expect(() => parseSurface("demo.md", "### `demo`\n- **Reach**:\n  1. `expect \"Deposit\"`\n  2. `click Convert`\n"))
    .toThrow("Unreadable Reach step: click Convert");
  expect(() => parseSurface("demo.md", "### `demo`\n- **Reach**:\n  1. `expect \"Deposit\"`\n  2. `fil \"Amount\" \"1\"`\n"))
    .toThrow("Unreadable Reach step: fil \"Amount\" \"1\"");
});

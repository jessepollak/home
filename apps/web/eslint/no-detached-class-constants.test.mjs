// Behavioral tests for the no-detached-class-constants rule. Cases assert
// scope-based resolution and initializer shape — never identifier naming: the
// invalid and valid suites reuse bland names like `tone` to prove the rule
// resolves bindings rather than pattern-matching names. Aggregate class-map
// cases follow the same rule: only a lookup whose object resolves by local
// scope binding to a fully static object/array of class strings is reported.
// A second suite runs the production TypeScript parser so `as const`,
// `satisfies`, and non-null wrappers are exercised rather than assumed.
import { RuleTester } from "eslint";
import nextTypescript from "eslint-config-next/typescript";
import { describe, it } from "bun:test";
import { noDetachedClassConstantsRule } from "./no-detached-class-constants.mjs";

// Pipe RuleTester's mocha-style suite hooks into bun's runner so each case
// reports individually.
RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

const detached = (name) => [{ messageId: "detached", data: { name } }];
const detachedAggregate = (name) => [{ messageId: "detachedAggregate", data: { name } }];

ruleTester.run("no-detached-class-constants", noDetachedClassConstantsRule, {
    valid: [
      // Inline utilities stay inline.
      "function Row() { return <div className=\"flex h-11 md:pointer-fine:h-8\" />; }",
      // Dynamic composition through cn() with inline branches.
      "function Row({ active }) { return <div className={cn(\"flex\", active && \"text-primary\")} />; }",
      // Component className props forward a parameter binding, not a constant.
      "function Row({ className }) { return <div className={cn(\"flex\", className)} />; }",
      // Conditional initializers are computed classes.
      "function Row({ active }) { const tone = active ? \"text-primary\" : \"text-muted-foreground\"; return <div className={tone} />; }",
      // Interpolated templates are computed classes.
      "function Row({ active }) { const tone = `h-11 ${active ? \"block\" : \"hidden\"}`; return <div className={tone} />; }",
      // Call initializers are computed values.
      "function Row() { const tone = resolveTone(); return <div className={tone} />; }",
      // A parameter shadows the module constant: the reference binds to the prop.
      "const tone = \"text-primary\";\nfunction Row({ tone }) { return <div className={tone} />; }",
      // cva() definitions keep their class strings intentionally.
      "const chipVariants = cva(\"inline-flex\", { variants: { tone: { neutral: \"bg-muted\", accent: \"bg-primary text-white\" } } });\nfunction Chip({ tone }) { return <span className={chipVariants({ tone })} />; }",
      // Imported constants are cross-file and not locally resolvable here.
      "import { shellWidthClassName } from \"@/components/shell-layout\";\nfunction Frame() { return <div className={shellWidthClassName} />; }",
      // A variable reassigned after initialization is dynamic.
      "let tone = \"flex\";\nfunction Row({ stacked }) { if (stacked) tone = \"flex-col\"; return <div className={tone} />; }",
      // Non-className attributes never trigger the rule.
      "const tone = \"text-primary\";\nfunction Row() { return <div data-tone={tone} />; }",
      // Identifiers inside callbacks in className are not className references.
      "function List({ items }) { return <div className={items.map((item) => item.active && \"hidden\").join(\" \")} />; }",
      // Nested cn() calls inside className report once, not per path.
      "function Row({ active }) { return <div className={cn(cn(\"flex\"), active && \"text-primary\")} />; }",
      // PR #632 false positive: `selected` is only a comparison operand inside
      // the logical test — its value never becomes part of the class output.
      "const selected = \"active\";\nfunction Row({ status }) { return <div className={cn(\"flex\", status === selected && \"bg-primary\")} />; }",
      // The left side of `&&` is a truthiness test; only the right side is
      // class data, so a static string there is fine.
      "const selected = \"active\";\nfunction Row() { return <div className={cn(selected && \"bg-primary\")} />; }",
      // A ternary test is condition data even when it holds a static string.
      "const flag = \"yes\";\nfunction Row() { return <div className={cn(flag ? \"flex\" : \"hidden\")} />; }",
      // cn() object values are conditions, not classes.
      "const selected = \"active\";\nfunction Row({ status }) { return <div className={cn(\"flex\", { \"bg-primary\": status === selected })} />; }",
      // Data maps whose values are not all static class strings are not class
      // maps: a dynamic lookup conservatively requires every value to qualify.
      "const map = { active: \"flex\", count: 2 };\nfunction Row({ status }) { return <div className={map[status]} />; }",
      // Computed values and non-object initializers are dynamic class sources.
      "const map = { active: tone };\nfunction Row({ status, tone }) { return <div className={map[status]} />; }",
      "const map = new Map([[\"active\", \"flex\"]]);\nfunction Row({ status }) { return <div className={map.get(status)} />; }",
      // Imported and parameter maps are outside local static resolution, and a
      // parameter shadows the module map it shares a name with.
      "import { map } from \"./styles\";\nfunction Row({ status }) { return <div className={map[status]} />; }",
      "function Row({ map, status }) { return <div className={map[status]} />; }",
      "const map = { active: \"flex\" };\nfunction Row({ map, status }) { return <div className={map[status]} />; }",
      // Spreads and dynamic property keys leave the map's shape unknowable.
      "const base = { active: \"flex\" };\nconst map = { ...base, idle: \"hidden\" };\nfunction Row({ status }) { return <div className={map[status]} />; }",
      "const key = getKey();\nconst map = { [key]: \"flex\" };\nfunction Row({ status }) { return <div className={map[status]} />; }",
      // A map reassigned after initialization may hold different classes.
      "let map = { active: \"flex\" };\nfunction Row({ status, swap }) { if (swap) map = { active: \"hidden\" }; return <div className={map[status]} />; }",
      // A known key that is absent, or an out-of-range index, resolves to
      // undefined rather than a class string.
      "const map = { active: \"flex\" };\nfunction Row() { return <div className={map.missing} />; }",
      "const map = { active: \"flex\" };\nfunction Row() { return <div className={map[\"missing\"]} />; }",
      "const map = [\"flex\"];\nfunction Row() { return <div className={map[2]} />; }",
      "const map = {};\nfunction Row({ key }) { return <div className={map[key]} />; }",
      // Holes and nested value objects are not static class strings.
      "const map = [\"flex\", , \"hidden\"];\nfunction Row({ index }) { return <div className={map[index]} />; }",
      "const map = { active: { label: \"flex\" } };\nfunction Row({ status }) { return <div className={map[status]} />; }",
      // Comparison operands and cn() object condition values are data.
      "const map = { active: \"flex\" };\nfunction Row({ status }) { return <div className={cn(status === map[status] && \"bg-primary\")} />; }",
      "const map = { active: \"flex\" };\nfunction Row({ status }) { return <div className={cn(\"flex\", { hidden: map[status] })} />; }",
      // A lookup used as a truthiness test or negation operand never reaches
      // the class output.
      "const map = { active: \"flex\" };\nfunction Row({ status }) { return <div className={cn(map[status] && \"bg-primary\")} />; }",
      "const map = { active: \"flex\" };\nfunction Row({ status }) { return <div className={cn(!map[status] && \"bg-primary\")} />; }",
      // Lookups outside className/cn() roles and JSX children are not classes.
      "const map = { active: \"flex\" };\nfunction Row({ status }) { return <div data-status={map[status]} />; }",
      "const map = { active: \"flex\" };\nfunction Row({ status }) { return <div>{map[status]}</div>; }",
      // PR #632 repair: a nested cn() used as a ternary test defers to the
      // enclosing root's role classification — its value is condition data.
      "const pad = \"px-4\";\nfunction Row({ active }) { return <div className={cn(cn(pad) ? \"flex\" : \"hidden\")} />; }",
      // A nested cn() as an object condition value is condition data too.
      "const pad = \"px-4\";\nfunction Row({ ready }) { return <div className={cn(\"flex\", { hidden: cn(pad) })} />; }",
      // A nested cn() under a negation in a logical test never reaches output.
      "const pad = \"px-4\";\nfunction Row({ ready }) { return <div className={cn(!cn(pad) && \"flex\")} />; }",
      // The outer cn() root owns classification even without a className
      // enclosure: the inner predicate cn() is condition data either way.
      "const pad = \"px-4\";\nconst klass = cn(cn(pad) ? \"flex\" : \"hidden\");\nfunction Row() { return <div className={klass} />; }",
    ],
    invalid: [
      // The PR #626 pattern: a module constant of Tailwind utilities passed to className.
      {
        code: "const headerAction = \"h-11 md:pointer-fine:h-8\";\nfunction Toolbar() { return <Button className={headerAction} />; }",
        errors: detached("headerAction"),
      },
      // The same detachment through a cn() argument.
      {
        code: "const chip = \"rounded-md px-2 text-xs\";\nfunction Chip() { return <span className={cn(\"inline-flex\", chip)} />; }",
        errors: detached("chip"),
      },
      // Template interpolation smuggles the constant into className.
      {
        code: "const frame = \"mx-auto w-full\";\nfunction Panel() { return <div className={`${frame} px-4`} />; }",
        errors: detached("frame"),
      },
      // Local aliases resolve through to the static string.
      {
        code: "const source = \"h-11 w-4\";\nconst alias = source;\nfunction Row() { return <div className={alias} />; }",
        errors: detached("alias"),
      },
      // Fully static concatenation is still a static class string.
      {
        code: "const pad = \"px-4 \";\nconst row = pad + \"py-2\";\nfunction Row() { return <div className={row} />; }",
        errors: detached("row"),
      },
      // Detached constants inside cn() template arguments are caught.
      {
        code: "const accent = \"text-primary\";\nfunction Badge({ active }) { return <span className={cn(`flex ${accent}`, active && \"font-medium\")} />; }",
        errors: detached("accent"),
      },
      // Scope-based resolution: the unshadowed reference is flagged even though
      // the identical name passes as a prop elsewhere.
      {
        code: "const tone = \"text-primary\";\nfunction Outer() { return <div className={tone} />; }\nfunction Inner({ tone }) { return <div className={tone} />; }",
        errors: detached("tone"),
      },
      // Naming is irrelevant: a bland function-scoped constant is flagged too.
      {
        code: "function Row() { const presentation = \"overflow-hidden whitespace-nowrap\"; return <div className={presentation} />; }",
        errors: detached("presentation"),
      },
      // Role-aware traversal still analyzes class-producing logical branches:
      // the right side of `&&` is the class when the test passes.
      {
        code: "const frame = \"mx-auto w-full\";\nfunction Row({ open }) { return <div className={cn(\"flex\", open && frame)} />; }",
        errors: detached("frame"),
      },
      // A static string fallback on the left of `||` is the class when truthy.
      {
        code: "const fallback = \"text-muted\";\nfunction Row({ ready }) { return <div className={cn(ready || fallback)} />; }",
        errors: detached("fallback"),
      },
      // Conditional branches are class data; the test above them is not.
      {
        code: "const tone = \"text-primary\";\nfunction Row({ active }) { return <div className={cn(active ? tone : \"hidden\")} />; }",
        errors: detached("tone"),
      },
      {
        code: "const alt = \"hidden\";\nfunction Row({ active }) { return <div className={cn(active ? \"flex\" : alt)} />; }",
        errors: detached("alt"),
      },
      // Concatenation inside cn() is still class-producing.
      {
        code: "const pad = \"px-4 \";\nfunction Row() { return <div className={cn(\"flex \" + pad)} />; }",
        errors: detached("pad"),
      },
      // A nested cn() in a class-producing argument is still flagged, and
      // exactly once despite the overlapping visitors.
      {
        code: "const pad = \"px-4\";\nfunction Row() { return <div className={cn(cn(pad))} />; }",
        errors: detached("pad"),
      },
      // The predicate cn() above the branches is skipped, but the
      // class-producing branch constant is still flagged exactly once.
      {
        code: "const pad = \"px-4\";\nconst alt = \"hidden\";\nfunction Row({ active }) { return <div className={cn(cn(pad) ? alt : \"flex\")} />; }",
        errors: detached("alt"),
      },
      // A nested cn() in a class-producing branch position flags once.
      {
        code: "const tone = \"text-primary\";\nfunction Row({ active }) { return <div className={cn(active ? cn(tone) : \"flex\")} />; }",
        errors: detached("tone"),
      },
      // Home #633: a local static object class map read through a dynamic key
      // in a class-producing role, at module or function scope.
      {
        code: "const map = { active: \"flex\" };\nconst status = \"active\";\nfunction Row() { return <div className={cn(map[status])} />; }",
        errors: detachedAggregate("map"),
      },
      {
        code: "function Row({ status }) { const map = { active: \"flex\" }; return <div className={cn(map[status])} />; }",
        errors: detachedAggregate("map"),
      },
      // The canonical issue shape: a map read inside a className template.
      {
        code: "const STYLES = { cashapp: \"text-primary\", fallback: \"bg-muted\" };\nfunction Mark({ variant }) { return <span className={`flex ${STYLES[variant]}`} />; }",
        errors: detachedAggregate("STYLES"),
      },
      // Statically known keys and indexes resolve their selected value.
      {
        code: "const STYLES = { cashapp: \"bg-primary\", zelle: \"bg-muted\" };\nfunction Mark() { return <span className={STYLES[\"cashapp\"]} />; }",
        errors: detachedAggregate("STYLES"),
      },
      {
        code: "const STYLES = { cashapp: \"bg-primary\", zelle: \"bg-muted\" };\nfunction Mark() { return <span className={STYLES.cashapp} />; }",
        errors: detachedAggregate("STYLES"),
      },
      {
        code: "const STYLES = [\"flex\", \"hidden\"];\nfunction Row() { return <div className={STYLES[1]} />; }",
        errors: detachedAggregate("STYLES"),
      },
      // A statically known key selects one value from a mixed data map.
      {
        code: "const map = { label: 3, className: \"flex\" };\nfunction Row() { return <div className={map.className} />; }",
        errors: detachedAggregate("map"),
      },
      // Local aliases of the aggregate and of its values stay static.
      {
        code: "const BASE = { active: \"flex\" };\nconst STYLES = BASE;\nfunction Row({ status }) { return <div className={STYLES[status]} />; }",
        errors: detachedAggregate("STYLES"),
      },
      {
        code: "const flex = \"flex\";\nconst map = { active: flex };\nfunction Row({ status }) { return <div className={map[status]} />; }",
        errors: detachedAggregate("map"),
      },
      // The lookup key is never reported as its own class source.
      {
        code: "const key = \"active\";\nconst map = { active: \"flex\" };\nfunction Row() { return <div className={map[key]} />; }",
        errors: detachedAggregate("map"),
      },
      // Lookups stay class data in branches, concatenations, and optional
      // chains, and a nested lookup reports once for the map it reads.
      {
        code: "const map = { active: \"flex\" };\nfunction Row({ active, status }) { return <div className={active ? map[status] : \"hidden\"} />; }",
        errors: detachedAggregate("map"),
      },
      {
        code: "const map = { active: \"flex\" };\nfunction Row({ status }) { return <div className={cn(map[status] + \" px-2\")} />; }",
        errors: detachedAggregate("map"),
      },
      {
        code: "const map = { active: \"flex\" };\nfunction Row({ status }) { return <div className={cn(map?.[status])} />; }",
        errors: detachedAggregate("map"),
      },
      {
        code: "const map = { active: \"flex\" };\nfunction Row({ status }) { return <div className={map[status].trim()} />; }",
        errors: detachedAggregate("map"),
      },
      // The nested cn() defers to the className root, so the map reports once.
      {
        code: "const map = { active: \"flex\" };\nfunction Row({ status }) { return <div className={cn(cn(map[status]))} />; }",
        errors: detachedAggregate("map"),
      },
    ],
  });

// TypeScript-wrapper coverage. Home source is TypeScript, where the production
// parser emits TSAsExpression (`as const`), TSSatisfiesExpression
// (`satisfies`), and TSNonNullExpression (`!`) nodes that ESTree never
// produces. These cases run through the same typescript-eslint parser the lint
// run uses — reached through the direct eslint-config-next dependency because
// bun's isolated installs keep the transitive parser package out of this
// workspace's node_modules — and pin the contract that wrappers stay
// transparent to static resolution instead of silently bypassing the rule.
const typescriptParser = nextTypescript
  .map((config) => config.languageOptions?.parser)
  .find((parser) => parser !== undefined);

if (!typescriptParser) {
  throw new Error("eslint-config-next/typescript no longer exposes the TypeScript parser these tests need");
}

const typescriptRuleTester = new RuleTester({
  languageOptions: {
    parser: typescriptParser,
    parserOptions: { ecmaFeatures: { jsx: true }, sourceType: "module" },
  },
});

typescriptRuleTester.run("no-detached-class-constants (TypeScript)", noDetachedClassConstantsRule, {
  valid: [
    // A wrapped parameter stays dynamic.
    "function Row({ tone }) { const classes = tone as string; return <div className={classes} />; }",
    // Wrapping a concatenation does not make its dynamic operand static.
    "function Row({ tone }) { const classes = (\"px-4 \" + tone) as string; return <div className={classes} />; }",
    // A wrapped interpolated template stays computed.
    "function Row({ tone }) { const classes = `px-4 ${tone}` as string; return <div className={classes} />; }",
    // A wrapped call result is not a local constant.
    "function Row() { const classes = readTone() as string; return <div className={classes} />; }",
    // A wrapped conditional is computed, so the map stays dynamic.
    "const map = { active: (true ? \"flex\" : \"hidden\") as string };\nfunction Row({ status }) { return <div className={map[status]} />; }",
    // Wrapping one value does not turn a data map into a class map.
    "const map = { active: \"flex\" as const, count: 2 };\nfunction Row({ status }) { return <div className={map[status]} />; }",
    // Wrapping a dynamic value keeps the map dynamic.
    "const map = { active: tone as string };\nfunction Row({ status, tone }) { return <div className={map[status]} />; }",
    // Lookup results aliased into another variable stay outside the contract,
    // wrapped or not.
    "const map = { active: \"flex\" };\nfunction Row() { const classes = map.active as string; return <div className={classes} />; }",
  ],
  invalid: [
    // A wrapped local string is still a detached constant.
    {
      code: "const classes = \"flex\" as const;\nfunction Row() { return <div className={classes} />; }",
      errors: detached("classes"),
    },
    {
      code: "const classes = \"flex\" satisfies string;\nfunction Row() { return <div className={classes} />; }",
      errors: detached("classes"),
    },
    {
      code: "const classes = \"flex\"!;\nfunction Row() { return <div className={classes} />; }",
      errors: detached("classes"),
    },
    // Chained wrappers unwrap together.
    {
      code: "const classes = (\"flex\" as const)!;\nfunction Row() { return <div className={classes} />; }",
      errors: detached("classes"),
    },
    // Wrapped operands and a fully static wrapped concatenation resolve.
    {
      code: "const row = (\"px-4 \" as const) + \"py-2\";\nfunction Row() { return <div className={row} />; }",
      errors: detached("row"),
    },
    {
      code: "const row = \"px-4 \" + (\"py-2\" satisfies string);\nfunction Row() { return <div className={row} />; }",
      errors: detached("row"),
    },
    {
      code: "const row = \"px-4 \" + \"py-2\" as const;\nfunction Row() { return <div className={row} />; }",
      errors: detached("row"),
    },
    // Wrapped object and array map values are transparent.
    {
      code: "const map = { active: \"flex\" as const };\nfunction Row({ status }) { return <div className={map[status]} />; }",
      errors: detachedAggregate("map"),
    },
    {
      code: "const map = { active: \"flex\" satisfies string };\nfunction Row() { return <div className={map.active} />; }",
      errors: detachedAggregate("map"),
    },
    {
      code: "const map = { active: \"flex\"! };\nfunction Row({ status }) { return <div className={`flex ${map[status]}`} />; }",
      errors: detachedAggregate("map"),
    },
    {
      code: "const map = [\"flex\" as const];\nfunction Row({ index }) { return <div className={map[index]} />; }",
      errors: detachedAggregate("map"),
    },
    // Wrapped local strings resolve through aliases into the map.
    {
      code: "const value = \"flex\" as const;\nconst map = { active: value };\nfunction Row({ status }) { return <div className={map[status]} />; }",
      errors: detachedAggregate("map"),
    },
    {
      code: "const value = \"flex\"!;\nconst alias = value;\nconst map = { active: alias };\nfunction Row({ status }) { return <div className={map[status]} />; }",
      errors: detachedAggregate("map"),
    },
    // Wrapped lookup keys resolve their selected value, on object and array
    // maps, including the mixed data-map case the conservative path skips.
    {
      code: "const map = { label: 3, className: \"flex\" };\nconst key = \"className\" as const;\nfunction Row() { return <div className={map[key]} />; }",
      errors: detachedAggregate("map"),
    },
    {
      code: "const map = [\"flex\", 2];\nfunction Row() { return <div className={map[0 as const]} />; }",
      errors: detachedAggregate("map"),
    },
  ],
});

// Behavioral tests for the no-detached-class-constants rule. Cases assert
// scope-based resolution and initializer shape — never identifier naming: the
// invalid and valid suites reuse bland names like `tone` to prove the rule
// resolves bindings rather than pattern-matching names.
import { RuleTester } from "eslint";
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
      // Member/index positions are data; resolving aggregate object class
      // sources is deferred to Home #633.
      "const map = { active: \"flex\" };\nconst status = \"active\";\nfunction Row() { return <div className={cn(map[status])} />; }",
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
    ],
  });

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
if (typeof describe.only === "function") RuleTester.describeOnly = describe.only;
if (typeof it.only === "function") RuleTester.itOnly = it.only;

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
    ],
  });

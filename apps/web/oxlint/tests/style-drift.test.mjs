import { applyRuleCheckTimeout } from "./rule-check-timeout.mjs";
import { describe, expect, it } from "bun:test";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { classifyStyleUtility, styleDriftOccurrences } from "../policy/style-drift.mjs";
import { budgetMs, createOxlintWorkspace } from "./helpers/oxlint-workspace.mjs";
applyRuleCheckTimeout();

const { directory, lint } = await createOxlintWorkspace("home-oxlint-style-drift-", {
  path: (name) => `client/${name}.tsx`,
  rules: ["no-raw-style-utilities"],
});
await writeFile(path.join(directory, "oxlint/policy/style-drift-baseline.json"), JSON.stringify({
  families: ["shadow", "duration", "ease", "radius", "status-color", "status-motion", "status-mark"],
  files: { "client/baselined.tsx": { "duration-150": 1, "text-destructive": 1, "animate-spin": 1, "<LoaderCircle>": 1 } },
}));
const classes = (tokens) => `export const value = <div className={${JSON.stringify(tokens)}} />;`;
const quoted = (found) => found.map((item) => item.message.match(/'(.+)' \(/u)?.[1]).sort();

describe("home/no-raw-style-utilities", () => {
  it("rejects every off-token family", async () => {
    const statusColors = ["text-(--warning)", "bg-(--destructive)", "text-[var(--warning)]", "bg-[var(--destructive)]", "border-[color:var(--status-positive)]", "ring-[var(--status-caution)]/50", "fill-(--status-negative)", "bg-[var(--status-negative)]/50", "text-(--brand-warning)", "bg-[var(--brand-destructive)]", "border-(--semantic-status-negative)", "ring-[color:var(--ui-status-caution)]/50", "text-(color:--brand-warning)/50", "fill-[var(--semantic-status-positive)]", "text-[var(--warning,var(--foreground))]", "bg-[color-mix(in_oklab,var(--warning),var(--background))]", "text-(--warning,red)", "text-(--warning,var(--foreground))", "text-(--brand-warning,red)", "bg-[VAR(--warning)]", "bg-[Var(--warning)]", "text-[theme(colors.warning)]", "bg-[theme(colors.status-negative)]", "[color:var(--warning)]", "[color:var(--warning)]/50", "bg-[var(--warning,']')]", "text-(--missing,var(--warning))"];
    const statusMotion = ["animate-[spin_1s_linear_infinite]", "animate-[pulse_2s_ease-in-out_infinite]", "animate-[ping_1s_cubic-bezier(0,0,0.2,1)_infinite]", "animate-[bounce_1s_infinite]", "animate-(--animate-spin)", "animate-(--animate-pulse)", "animate-(--my-spin)", "animate-(--animate-spin-slow)", "animate-(--pulse-slow)", "animate-(--bounce-in)", "animate-(--my-ping-slow)", "animate-[var(--animate-spin)]", "animate-[var(--animate-spin)_1s]", "animate-[var(--fade)_spin_1s]", "animate-[1s_var(--fade)_pulse]", "animate-[var(--fade)_linear_spin_1s]", "animate-[var(--missing,spin_1s_linear_infinite)]", "animate-[var(--missing,var(--also-missing,pulse_2s_infinite))]", "animate-(animation:--animate-spin)", "[animation:spin_1s_linear_infinite]", "[animation:var(--animate-spin)]", "[animation-name:spin]", "[animation-name:var(--animate-spin)]", "animate-(--missing,spin_1s_linear_infinite)", "animate-(--missing,var(--animate-spin))", "animate-[var(--missing,spin)_1s_linear_infinite]", "animate-[var(--missing,1s_spin)]"];
    const tokens = ["shadow-md", "shadow-[0_1px_2px_black]", "shadow-[color:var(--shadow)]", "rounded-[0.25rem]", "rounded-t-[3px]", "duration-150", "duration-[80ms]", "duration-0", "ease-out", "ease-[ease]", "text-destructive", "animate-spin", "animate-pulse", "animate-ping", "animate-bounce", ...statusColors, ...statusMotion];
    const results = await lint({ fixture: classes(tokens.join(" ")) });
    expect(quoted(results.fixture)).toEqual([...tokens].sort());
    for (const token of statusColors) expect(classifyStyleUtility(token)).toEqual({ family: "status-color", token });
    for (const token of statusMotion) expect(classifyStyleUtility(token)).toEqual({ family: "status-motion", token });
    expect(classifyStyleUtility("bg-[var( --warning )]")).toEqual({ family: "status-color", token: "bg-[var( --warning )]" });
    expect(classifyStyleUtility("shadow-[color:var(--shadow)]")).toEqual({ family: "shadow", token: "shadow-[color:var(--shadow)]" });
    for (const family of ["shadow", "radius", "duration", "ease", "status-color", "status-motion"]) expect(results.fixture.some((item) => item.message.includes(`(${family})`))).toBe(true);
  }, budgetMs);

  it("allows owned spellings, role radius steps and unrelated strings", async () => {
    const tokens = ["shadow-raised", "shadow-floating", "shadow-overlay", "shadow-toast", "shadow-none", "rounded-sm", "rounded-lg", "rounded-xl", "rounded-2xl", "rounded-full", "rounded-none", "rounded-t-sm", "rounded-ee-full", "duration-fast", "duration-base", "duration-moderate", "duration-slow", "ease-standard", "ease-enter", "ease-exit", "ease-emphasized", "p-4", "unrelated", "shadow", "rounded", "duration", "ease", "text-market-gain", "bg-market-loss", "text-warning-foreground", "bg-destructive-foreground", "text-destructiveish", "text-[var(--warning-foreground)]", "text-(--muted-foreground)", "text-(--brand-warning-foreground)", "text-[var(--surface)]", "bg-[var(--surface-raised)]", "animate-none", "animate-[fade_200ms_ease-out]", "animate-[var(--fade-in)_200ms]", "animate-[var(--fade)_linear_1s]", "animate-[wiggle_1s]", "animate-(--fade-in)", "animate-(--accordion-down)", "animate-(--animate-in)", "animate-(--animate-out)", "animate-(--animate-accordion-down)", "animate-(--animate-accordion-up)", "animate-(--animate-collapsible-down)", "animate-(--animate-collapsible-up)", "animate-(--animate-caret-blink)", "animate-(--spinning)", "animate-[var(--animate-in)]", "animate-[var(--animate-out)]", "animate-[var(--animate-accordion-down)]", "animate-[var(--animate-collapsible-up)]", "animate-[var(--animate-caret-blink)]", "LoaderCircle", "<LoaderCircle>", "m-(--drawer-inset,0px)", "pb-[max(1rem,calc(env(safe-area-inset-bottom)_-_var(--sheet-keyboard-inset,0px)))]!", "content-['var(--warning)']", 'content-["theme(colors.warning)"]'];
    const results = await lint({ fixture: classes(tokens.join(" ")) });
    expect(results.fixture).toHaveLength(0);
    for (const token of tokens) expect(classifyStyleUtility(token)).toBeNull();
  }, budgetMs);

  it("ignores unterminated quoted contents without throwing", async () => {
    const token = `content-['${"\\'".repeat(8192)}var(--warning)]`;
    expect(classifyStyleUtility(token)).toBeNull();
    const results = await lint({ fixture: classes(token) });
    expect(results.fixture).toHaveLength(0);
  }, budgetMs);

  it("normalizes variants and important markers without splitting arbitrary values", async () => {
    const tokens = ["hover:shadow-md", "data-[state=on]:duration-150", "!focus:rounded-t-[3px]", "md:!ease-out", "shadow-2xs!", "[&:not([data-x=y])]:shadow-[color:var(--shadow)]", "supports-(color:oklch(0_0_0)):duration-[80ms]", "motion-safe:animate-spin", "hover:animate-[var(--animate-spin)]", "hover:bg-destructive/10", "**:data-[slot=alert-title]:text-destructive", "!border-warning", "ring-status-positive/50!", "outline-status-caution", "fill-status-negative", "stroke-warning", "from-destructive", "via-warning", "to-status-positive", "divide-warning", "decoration-destructive", "accent-warning", "caret-destructive"];
    const results = await lint({ fixture: classes(tokens.join(" ")) });
    expect(quoted(results.fixture)).toEqual(["shadow-md", "duration-150", "rounded-t-[3px]", "ease-out", "shadow-2xs", "shadow-[color:var(--shadow)]", "duration-[80ms]", "animate-spin", "animate-[var(--animate-spin)]", "bg-destructive/10", "text-destructive", "border-warning", "ring-status-positive/50", "outline-status-caution", "fill-status-negative", "stroke-warning", "from-destructive", "via-warning", "to-status-positive", "divide-warning", "decoration-destructive", "accent-warning", "caret-destructive"].sort());
    expect(classifyStyleUtility("hover:shadow-[color:var(--shadow)]!")).toEqual({ family: "shadow", token: "shadow-[color:var(--shadow)]" });
    expect(classifyStyleUtility("hover:!border-[color:var(--status-positive)]/50")).toEqual({ family: "status-color", token: "border-[color:var(--status-positive)]/50" });
    expect(classifyStyleUtility("motion-safe:animate-[spin_1s_linear_infinite]!")).toEqual({ family: "status-motion", token: "animate-[spin_1s_linear_infinite]" });
    expect(classifyStyleUtility("hover:animate-[var(--animate-spin)]")).toEqual({ family: "status-motion", token: "animate-[var(--animate-spin)]" });
    expect(classifyStyleUtility("motion-safe:!animate-[var(--animate-spin)_1s]")).toEqual({ family: "status-motion", token: "animate-[var(--animate-spin)_1s]" });
    expect(classifyStyleUtility("data-[state=on]:animate-[var(--animate-spin)]!")).toEqual({ family: "status-motion", token: "animate-[var(--animate-spin)]" });
    expect(styleDriftOccurrences("shadow-md hover:shadow-md ease-out")).toEqual([
      { family: "shadow", token: "shadow-md" }, { family: "shadow", token: "shadow-md" }, { family: "ease", token: "ease-out" },
    ]);
  }, budgetMs);

  it("rejects directional status borders and ring offsets but allows neutral colors", async () => {
    const prefixes = ["border-x", "border-y", "border-t", "border-r", "border-b", "border-l", "border-s", "border-e", "border-bs", "border-be", "ring-offset", "inset-ring", "inset-shadow", "text-shadow", "drop-shadow"];
    const colors = ["destructive", "warning", "status-positive", "status-caution", "status-negative"];
    const tokens = prefixes.flatMap((prefix) => colors.flatMap((color) => [`${prefix}-${color}`, `${prefix}-${color}/50`]));
    const results = await lint({ fixture: classes([...tokens, "border-t-border", "ring-offset-background"].join(" ")) });
    expect(quoted(results.fixture)).toEqual([...tokens].sort());
    expect(results.fixture.every((item) => item.message.includes("(status-color)"))).toBe(true);
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

  it("counts lucide spinner specifiers by imported name and gives the texture fix", async () => {
    const code = 'import { Loader, Loader as Again, Loader2 as Spinner, LoaderCircle, LoaderPinwheel, LoaderIcon, Loader2Icon, LoaderCircleIcon, LoaderPinwheelIcon, CircleCheck } from "lucide-react"; export const value = <Spinner />;';
    const results = await lint({ fixture: code });
    expect(quoted(results.fixture)).toEqual(["<Loader>", "<Loader2>", "<LoaderCircle>", "<LoaderPinwheel>", "<LoaderIcon>", "<Loader2Icon>", "<LoaderCircleIcon>", "<LoaderPinwheelIcon>"].sort());
    expect(results.fixture.every((item) => item.message.includes("(status-mark)") && item.message.includes("use a status texture from components/ui/status-texture; presenters return a texture name and owned components render it"))).toBe(true);
    const allowed = await lint({ fixture: 'import { LoaderCircle } from "other-icons"; import Default, * as Icons from "lucide-react"; export const value = <Button variant="destructive" />; export const name = "LoaderCircle <LoaderCircle>";' });
    expect(allowed.fixture).toHaveLength(0);
  }, budgetMs);

  it("exempts only status families in owned status renderers", async () => {
    const code = 'import { LoaderCircle } from "lucide-react"; export const value = "text-destructive animate-pulse duration-150 shadow-md ease-out rounded-[3px]";';
    const results = await lint({
      ui: { path: "components/ui/status-texture.tsx", code },
      rows: { path: "components/finance-rows.tsx", code },
      load: { path: "components/load-error.tsx", code },
      outside: { path: "components/another.tsx", code },
    });
    for (const name of ["ui", "rows", "load"]) expect(quoted(results[name])).toEqual(["duration-150", "shadow-md", "ease-out", "rounded-[3px]"].sort());
    expect(results.outside).toHaveLength(7);
  }, budgetMs);

  it("suppresses exact status counts, not another import alias or repeated utility", async () => {
    const code = 'import { LoaderCircle as Spinner } from "lucide-react"; export const value = "hover:text-destructive motion-safe:animate-spin";';
    const once = await lint({ recorded: { path: "client/baselined.tsx", code }, outside: code });
    expect(once.recorded).toHaveLength(0);
    expect(once.outside).toHaveLength(3);
    const twice = await lint({ recorded: { path: "client/baselined.tsx", code: `${code} import { LoaderCircle as Again } from "lucide-react"; export const more = "text-destructive animate-spin";` } });
    expect(quoted(twice.recorded)).toEqual(["<LoaderCircle>", "text-destructive", "animate-spin"].sort());
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

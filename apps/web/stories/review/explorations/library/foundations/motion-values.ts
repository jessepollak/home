import { selectorClasses } from "./candidates";
import type { MotionUse } from "./usage";

export type MotionValue = { property: string; value: string };
export type MotionReference = { utilities: Record<string, MotionValue[] | null>; tokens: MotionValue[]; easings: string[] };

const MOTION_NAME = /(?:^|[-])(?:ease|duration|delay|transition|animation|animate|motion)(?:-|$)/;
const PROPERTIES = ["transition-property", "transition-duration", "transition-timing-function", "transition-delay"];

type Rule = CSSRule & { selectorText?: string; style?: CSSStyleDeclaration; cssRules?: CSSRuleList };

function declarations(rules: Iterable<Rule>, selector = ""): { selector: string; style: CSSStyleDeclaration }[] {
  return Array.from(rules).flatMap((rule) => [
    ...(rule.style ? [{ selector: rule.selectorText ?? selector, style: rule.style }] : []),
    ...(rule.cssRules ? declarations(Array.from(rule.cssRules), rule.selectorText ?? selector) : []),
  ]);
}

export function readMotionReference(uses: MotionUse[], owner: Document = document): MotionReference | null {
  const probe = owner.createElement("div");
  Object.assign(probe.style, { position: "absolute", visibility: "hidden", pointerEvents: "none" });
  owner.body.append(probe);
  try {
    const rules = Array.from(owner.styleSheets).flatMap((sheet) => declarations(Array.from(sheet.cssRules)));
    const tokenNames = [...new Set(rules.flatMap(({ style }) => Array.from(style).filter((name) => name.startsWith("--") && MOTION_NAME.test(name))))].sort();
    const root = owner.defaultView!.getComputedStyle(owner.documentElement);
    const tokens = tokenNames.map((name) => ({ property: name, value: root.getPropertyValue(name).trim() || "Unavailable in the document scope" }));
    const utilities: MotionReference["utilities"] = Object.fromEntries(uses.map((use) => {
      probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none";
      const matched = rules.filter(({ selector }) => use.classes.some((name) => selectorClasses(selector).has(owner.defaultView!.CSS.escape(name))));
      for (const { style } of matched) {
        for (const property of Array.from(style)) {
          if (property.startsWith("transition") || property.startsWith("--")) probe.style.setProperty(property, style.getPropertyValue(property));
        }
      }
      const selected = use.utility.startsWith("duration-") ? ["transition-duration"]
        : use.utility.startsWith("ease-") ? ["transition-timing-function"]
        : use.utility.startsWith("delay-") ? ["transition-delay"] : PROPERTIES;
      const computed = owner.defaultView!.getComputedStyle(probe);
      const values = selected.map((property) => ({ property, value: computed.getPropertyValue(property).trim() }));
      const missingVariable = selected.some((property) => {
        const authored = probe.style.getPropertyValue(property);
        return [...authored.matchAll(/var\(\s*(--[\w-]+)\s*([,)])/g)].some((match) => match[2] === ")" && !computed.getPropertyValue(match[1]).trim());
      });
      return [use.utility, !matched.length || missingVariable || values.some(({ value }) => !value) ? null : values];
    }));
    const candidates = [
      ...tokens.filter(({ property, value }) => property.includes("ease") && CSS.supports("transition-timing-function", value)).map(({ value }) => value),
      ...Object.values(utilities).flatMap((values) => values?.filter(({ property }) => property === "transition-timing-function")
        .flatMap(({ value }) => value.match(/cubic-bezier\([^)]*\)|steps\([^)]*\)|linear\([^)]*\)|[\w-]+/g) ?? []) ?? []),
    ];
    const easings = [...new Set(candidates.map((value) => {
      probe.style.transitionTimingFunction = value;
      return owner.defaultView!.getComputedStyle(probe).transitionTimingFunction;
    }))];
    return { utilities, tokens, easings };
  } catch {
    return null;
  } finally {
    probe.remove();
  }
}

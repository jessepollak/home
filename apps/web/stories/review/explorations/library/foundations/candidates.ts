export type SourceFile = { path: string; source: string };
export type CandidateFile = { path: string; candidates: string[] };
export type CandidatePayload = CandidateFile[] | { status: "unavailable"; reason: string };
export type CandidateSnapshot = { status: "available"; files: CandidateFile[] } | { status: "unavailable"; files: [] };

export function selectorClasses(selector: string): Set<string> {
  const classes = new Set<string>();
  const parts = /\\[\s\S]|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|\.((?:\\[\da-fA-F]{1,6}\s?|\\[^\r\n\f]|[-\w\u0080-\uFFFF])+)/g;
  for (const match of selector.matchAll(parts)) if (match[1]) classes.add(match[1]);
  return classes;
}

type Rule = CSSRule & { name?: string; selectorText?: string; cssRules?: CSSRuleList; styleSheet?: CSSStyleSheet };

export function confirmedCandidates(files: CandidateFile[] | null, owner: Document = document): CandidateSnapshot {
  if (files === null) return { status: "unavailable", files: [] };
  try {
    const selectors = new Set<string>();
    const visit = (rules: Iterable<Rule>, inUtilities = false) => {
      for (const rule of rules) {
        const utilities = inUtilities || (rule.name === "utilities" && rule.cssText.startsWith("@layer "));
        if (utilities && rule.selectorText) for (const name of selectorClasses(rule.selectorText)) selectors.add(name);
        if (rule.cssRules) visit(Array.from(rule.cssRules), utilities);
        if (rule.styleSheet) visit(Array.from(rule.styleSheet.cssRules), utilities);
      }
    };
    const sheets = Array.from(owner.styleSheets);
    if (!sheets.length) return { status: "unavailable", files: [] };
    for (const sheet of sheets) visit(Array.from(sheet.cssRules));
    return { status: "available", files: files.map(({ path, candidates }) => ({ path,
      candidates: candidates.filter((name) => selectors.has(owner.defaultView!.CSS.escape(name))),
    })) };
  } catch {
    return { status: "unavailable", files: [] };
  }
}

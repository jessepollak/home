export type SourceFile = { path: string; source: string };
export type CandidateFile = { path: string; candidates: string[] };
export type CandidateSnapshot = { status: "available"; files: CandidateFile[] } | { status: "unavailable"; files: [] };

export function sourceCandidates(source: string): string[] {
  const candidates: string[] = [];
  let token = "";
  let depth = 0;
  let quote = "";
  const flush = () => {
    const candidate = token.replace(/:$/, "");
    if (candidate && depth === 0) candidates.push(candidate);
    token = "";
    depth = 0;
    quote = "";
  };
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (depth > 0) {
      if (/\s/.test(char) || char === "`" || char === "{" || char === "}") {
        flush();
        continue;
      }
      token += char;
      if (char === "\\" && index + 1 < source.length) token += source[++index];
      else if (quote) { if (char === quote) quote = ""; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === "[") depth += 1;
      else if (char === "]") depth -= 1;
    } else if (char === "[" && (token.endsWith("-") || token.endsWith(":") || !token)) {
      const end = source.indexOf("]", index + 1);
      const body = source.slice(index + 1, end);
      if (end !== -1 && body && !/^[\["'`]|\s/.test(body) &&
        (token.endsWith("-") || token.endsWith(":") || body.includes(":") || source[end + 1] === ":")) {
        token += char;
        depth = 1;
      } else flush();
    } else if ((char === "." && !(/\d/.test(source[index - 1] ?? "") && /\d/.test(source[index + 1] ?? ""))) ||
      /[\s"'`{}()\[\],;=<>+$?&|]/.test(char)) flush();
    else token += char;
  }
  flush();
  return candidates;
}

export function selectorClasses(selector: string): Set<string> {
  const classes = new Set<string>();
  const parts = /\\[\s\S]|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|\.((?:\\[\da-fA-F]{1,6}\s?|\\[^\r\n\f]|[-\w\u0080-\uFFFF])+)/g;
  for (const match of selector.matchAll(parts)) if (match[1]) classes.add(match[1]);
  return classes;
}

type Rule = CSSRule & { selectorText?: string; cssRules?: CSSRuleList; styleSheet?: CSSStyleSheet };

export function confirmedCandidates(files: SourceFile[], owner: Document = document): CandidateSnapshot {
  try {
    const selectors = new Set<string>();
    const visit = (rules: Iterable<Rule>) => {
      for (const rule of rules) {
        if (rule.selectorText) for (const name of selectorClasses(rule.selectorText)) selectors.add(name);
        if (rule.cssRules) visit(Array.from(rule.cssRules));
        if (rule.styleSheet) visit(Array.from(rule.styleSheet.cssRules));
      }
    };
    const sheets = Array.from(owner.styleSheets);
    if (!sheets.length) return { status: "unavailable", files: [] };
    for (const sheet of sheets) visit(Array.from(sheet.cssRules));
    return { status: "available", files: files.map(({ path, source }) => ({ path,
      candidates: sourceCandidates(source).filter((name) => selectors.has(owner.defaultView!.CSS.escape(name))),
    })) };
  } catch {
    return { status: "unavailable", files: [] };
  }
}

type Token = { value: string; literal?: boolean; template?: boolean };

function lex(source: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/|["'`]|[\w$]+|===|!==|==|!=|&&|\|\||\?\?|\?\.|=>|[^\s]/gy;
  let index = 0;
  while (index < source.length) {
    pattern.lastIndex = index;
    const match = pattern.exec(source)!;
    const value = match[0];
    index = pattern.lastIndex;
    if (/^\s|^\/[/\*]/.test(value)) continue;
    if (value === '"' || value === "'" || value === "`") {
      const start = index;
      while (index < source.length) {
        if (source[index] === "\\") index += 2;
        else if (source[index++] === value) break;
      }
      tokens.push({ value: source.slice(start, index - 1), literal: true, template: value === "`" });
    } else tokens.push({ value });
  }
  return tokens;
}

const HELPERS = new Set(["cn", "clsx", "cva"]);
const CLOSING: Record<string, string> = { "(": ")", "[": "]", "{": "}" };

export function classOperands(source: string): string[] {
  const tokens = lex(source);
  const ends = new Map<number, number>();
  const stack: number[] = [];
  tokens.forEach((token, index) => {
    if (token.literal) return;
    if (CLOSING[token.value]) stack.push(index);
    else if (token.value === CLOSING[tokens[stack.at(-1) ?? -1]?.value]) {
      ends.set(stack.pop()!, index);
    }
  });
  const collected = new Map<number, string[]>();
  const positions = (start: number, end: number, separator: string): number[] => {
    const found: number[] = [];
    for (let index = start; index < end; index += 1) {
      if (tokens[index].literal) continue;
      if (tokens[index].value === separator) found.push(index);
      if (ends.has(index)) index = ends.get(index)!;
    }
    return found;
  };
  const ranges = (start: number, end: number): [number, number][] => {
    const commas = positions(start, end, ",");
    return [start, ...commas.map((index) => index + 1)].map((from, index) => [from, commas[index] ?? end]);
  };
  const properties = (start: number, end: number): { key: string; start: number; end: number }[] => {
    if (tokens[start]?.value !== "{" || ends.get(start) !== end - 1) return [];
    return ranges(start + 1, end - 1).flatMap(([from, to]) => {
      if (tokens[from + 1]?.value !== ":") return [];
      return [{ key: tokens[from].value, start: from + 2, end: to }];
    });
  };
  const collect = (start: number, end: number): void => {
    if (start >= end) return;
    if (["(", "{"].includes(tokens[start].value) && ends.get(start) === end - 1) {
      collect(start + 1, end - 1);
      return;
    }
    const question = positions(start, end, "?")[0];
    if (question !== undefined) {
      let nested = 0;
      for (let index = question + 1; index < end; index += 1) {
        if (tokens[index].literal) continue;
        if (ends.has(index)) { index = ends.get(index)!; continue; }
        if (tokens[index].value === "?") nested += 1;
        if (tokens[index].value === ":" && nested-- === 0) {
          collect(question + 1, index);
          collect(index + 1, end);
          return;
        }
      }
      return;
    }
    for (const operator of ["||", "??", "&&"]) {
      const split = positions(start, end, operator).at(-1);
      if (split !== undefined) {
        if (operator !== "&&") collect(start, split);
        collect(split + 1, end);
        return;
      }
    }
    if (end === start + 1 && tokens[start].literal) {
      const token = tokens[start];
      if (token.template && token.value.includes("${")) {
        const literals: string[] = [];
        let offset = 0;
        for (const match of token.value.matchAll(/\$\{([^{}]*)\}/g)) {
          literals.push(token.value.slice(offset, match.index), ...classOperands(`className={${match[1]}}`));
          offset = match.index + match[0].length;
        }
        literals.push(token.value.slice(offset));
        collected.set(start, literals);
      } else collected.set(start, [token.value]);
      return;
    }
    if (tokens[start].value === "[" && ends.get(start) === end - 1) {
      ranges(start + 1, end - 1).forEach(([from, to]) => collect(from, to));
      return;
    }
    if (!HELPERS.has(tokens[start].value) || tokens[start + 1]?.value !== "(" || ends.get(start + 1) !== end - 1) return;
    const args = ranges(start + 2, end - 1);
    if (tokens[start].value !== "cva") {
      args.forEach(([from, to]) => collect(from, to));
      return;
    }
    if (args[0]) collect(...args[0]);
    for (const config of args.slice(1).flatMap(([from, to]) => properties(from, to))) {
      if (config.key === "variants") {
        for (const variant of properties(config.start, config.end)) {
          for (const value of properties(variant.start, variant.end)) collect(value.start, value.end);
        }
      } else if (config.key === "compoundVariants" && tokens[config.start]?.value === "[") {
        for (const [from, to] of ranges(config.start + 1, config.end - 1)) {
          for (const entry of properties(from, to)) {
            if (entry.key === "class" || entry.key === "className") collect(entry.start, entry.end);
          }
        }
      }
    }
  };
  let scannedUntil = 0;
  tokens.forEach((token, index) => {
    if (token.literal || index < scannedUntil) return;
    if (HELPERS.has(token.value) && tokens[index + 1]?.value === "(" && ends.has(index + 1)) {
      scannedUntil = ends.get(index + 1)! + 1;
      collect(index, ends.get(index + 1)! + 1);
    } else if (token.value === "className" && ["=", ":"].includes(tokens[index + 1]?.value)) {
      const start = index + 2;
      const end = ends.get(start);
      scannedUntil = (end ?? start) + 1;
      if (end !== undefined) collect(start, end + 1);
      else if (tokens[start]?.literal) collect(start, start + 1);
    }
  });
  return [...collected].sort(([left], [right]) => left - right).flatMap(([, values]) => values);
}

export const formControlHasAllowlist = new Map([
  ["components/ui/combobox.tsx", "Combobox controls own a small static option subtree."],
  ["components/ui/field.tsx", "Field controls own a small static label and input subtree."],
  ["components/ui/input-group.tsx", "Input groups own a small static addon subtree."],
  ["components/ui/input-otp.tsx", "OTP controls own a small static slot subtree."],
]);

function walk(text, visit) {
  const brackets = [];
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "\\") { i++; continue; }
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === "/" && text[i + 1] === "*") {
      i = text.indexOf("*/", i + 2);
      if (i < 0) return;
      i++;
      continue;
    }
    if (visit(i, char, brackets) === false) return;
    if (char === "(" || char === "[") brackets.push({ char, index: i });
    else if (char === ")" || char === "]") brackets.pop();
  }
}

function alternatives(argument) {
  const parts = [];
  let start = 0;
  walk(argument, (i, char, stack) => {
    if (char === "," && stack.length === 0) {
      parts.push(argument.slice(start, i));
      start = i + 1;
    }
  });
  parts.push(argument.slice(start));
  return parts;
}

export function isChildHasArgument(argument) {
  return alternatives(argument).every((part) => {
    const value = part.trim();
    if (!value.startsWith(">")) return false;
    let hasCompound = false;
    let valid = true;
    walk(value.slice(1).trimStart(), (_index, char, stack) => {
      if (stack.length !== 0) return;
      if (/\s|[>+~,]/.test(char)) valid = false;
      else hasCompound = true;
    });
    return valid && hasCompound;
  });
}


function compoundAt(selector, index) {
  let start = 0;
  let depth = 0;
  let quote = null;
  for (let i = 0; i < selector.length; i += 1) {
    const char = selector[i];
    if (char === "\\") {
      const hex = /^[a-f\d]{1,6}(?:\r\n|[ \t\n\r\f])?/i.exec(selector.slice(i + 1));
      i += hex ? 1 + hex[0].length : 1;
      continue;
    }
    if (quote) { if (char === quote) quote = null; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === "/" && selector[i + 1] === "*") {
      const close = selector.indexOf("*/", i + 2);
      if (close < 0) break;
      i = close + 1;
      continue;
    }
    if (char === "(" || char === "[") { depth += 1; continue; }
    if (char === ")" || char === "]") { depth = Math.max(0, depth - 1); continue; }
    if (depth === 0 && /[\s>+~,]/.test(char)) {
      if (index < i) return { compound: selector.slice(start, i), start };
      start = i + 1;
    }
  }
  return { compound: selector.slice(start), start };
}

export function subjectPrefix(selector, index) {
  const depths = new Array(index + 1);
  let depth = 0;
  let quote = null;
  for (let i = 0; i <= index; i++) {
    const char = selector[i];
    if (char === "\\") {
      const hex = /^[a-f\d]{1,6}(?:\r\n|[ \t\n\r\f])?/i.exec(selector.slice(i + 1));
      i += hex ? 1 + hex[0].length : 1;
      continue;
    }
    if (quote) { if (char === quote) quote = null; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === "/" && selector[i + 1] === "*") {
      const close = selector.indexOf("*/", i + 2);
      if (close < 0) break;
      i = close + 1;
      continue;
    }
    depths[i] = depth;
    if (char === "(" || char === "[") depth += 1;
    else if (char === ")" || char === "]") depth = Math.max(0, depth - 1);
  }
  let target = depths[index];
  if (target === undefined) return "";
  let cursor = index;
  while (true) {
    let start = 0;
    for (let i = 0; i < cursor; i++) {
      if (depths[i] === undefined) continue;
      if (depths[i] < target || (depths[i] === target && /[\s>+~,]/.test(selector[i]))) start = i + 1;
    }
    const prefix = selector.slice(start, cursor);
    if (prefix.replace(/\/\*[\s\S]*?\*\//g, "").trim() || target === 0) return prefix;
    let opener = -1;
    for (let i = cursor - 1; i >= 0; i--) {
      if (depths[i] === target - 1 && selector[i] === "(") { opener = i; break; }
    }
    if (opener < 0) return prefix;
    cursor = opener;
    target -= 1;
  }
}

function withoutFunctionalArguments(compound) {
  let result = "";
  let depth = 0;
  let quote = null;
  for (let i = 0; i < compound.length; i += 1) {
    const char = compound[i];
    if (char === "\\") {
      if (depth === 0) result += char + (compound[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (quote) {
      if (depth === 0) result += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      if (depth === 0) result += char;
      quote = char;
      continue;
    }
    if (char === "/" && compound[i + 1] === "*") {
      const close = compound.indexOf("*/", i + 2);
      if (close < 0) return result;
      i = close + 1;
      continue;
    }
    if (char === "(") { depth += 1; continue; }
    if (char === ")") { depth = Math.max(0, depth - 1); continue; }
    if (depth === 0) result += char;
  }
  return result;
}

const ROOT_ELEMENT = /^(?:(?:(?:[\w-]|[^\x00-\x7f])+|\*)?\|(?!\|))?(?:html|body)(?=$|[.#:\[])/i;

function maskEscapesAndStrings(compound) {
  return compound
    .replace(/\\(?:[a-f\d]{1,6}(?:\r\n|[ \t\n\r\f])?|[^\r\n\f])/gi, "_")
    .replace(/"[^"]*"|'[^']*'/g, '""');
}

function rootCompound(compound, scopeIsRoot) {
  const stripped = maskEscapesAndStrings(withoutFunctionalArguments(compound));
  if (/:root(?=$|[.#:\[])/i.test(stripped) || ROOT_ELEMENT.test(stripped)) return true;
  if (scopeIsRoot && /:scope(?=$|[.#:\[])/i.test(stripped)) return true;
  return wrappedRoot(compound, scopeIsRoot);
}

function wrappedRoot(compound, scopeIsRoot) {
  let depth = 0;
  let quote = null;
  for (let i = 0; i < compound.length; i += 1) {
    const char = compound[i];
    if (char === "\\") { i += 1; continue; }
    if (quote) { if (char === quote) quote = null; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === "/" && compound[i + 1] === "*") {
      const close = compound.indexOf("*/", i + 2);
      if (close < 0) return false;
      i = close + 1;
      continue;
    }
    if (char === "(") { depth += 1; continue; }
    if (char === ")") { depth = Math.max(0, depth - 1); continue; }
    if (char !== ":" || depth !== 0) continue;
    const match = /^:(?:is|where)\(/i.exec(compound.slice(i));
    if (!match) continue;
    const start = i + match[0].length;
    let end = -1;
    walk(compound.slice(start), (offset, current, stack) => {
      if (current === ")" && stack.length === 0) { end = start + offset; return false; }
    });
    if (end < 0) return false;
    if (alternatives(compound.slice(start, end)).some((part) => {
      const alternative = part.trim();
      return rootCompound(compoundAt(alternative, alternative.length - 1).compound, scopeIsRoot);
    })) return true;
    i = end;
  }
  return false;
}

function rootSubject(selector, index, scopeIsRoot) {
  return rootCompound(compoundAt(selector, index).compound, scopeIsRoot);
}

function selectorFindings(selector, scopeIsRoot) {
  const findings = [];
  walk(selector, (index, char) => {
    if (char !== ":" || selector.slice(index, index + 5).toLowerCase() !== ":has(") return;
    const start = index + 5;
    let end = -1;
    walk(selector.slice(start), (offset, current, stack) => {
      if (current === ")" && stack.length === 0) { end = start + offset; return false; }
    });
    if (end < 0) return;
    const argument = selector.slice(start, end);
    if (rootSubject(selector, index, scopeIsRoot)) findings.push({ kind: "root", selector: selector.trim(), argument, index });
    else if (!isChildHasArgument(argument)) findings.push({ kind: "descendant", selector: selector.trim(), argument, index });
  });
  return findings;
}

const LETTER = /^[a-z]$/i;

export function decodeLetterEscapes(text) {
  return text.replace(/\\(?:([a-f\d]{1,6})(?:\r\n|[ \t\n\r\f])?|([^\r\n\f]))/gi, (match, hex, escaped) => {
    const char = hex ? String.fromCodePoint(Math.min(parseInt(hex, 16) || 0xfffd, 0x10ffff)) : escaped;
    return LETTER.test(char) ? char : match;
  });
}

export function hasSelectorFindings(source) {
  const cssText = decodeLetterEscapes(source);
  const findings = [];
  const rules = [];
  const scopes = [];
  let start = 0;
  walk(cssText, (index, char, stack) => {
    if (stack.length !== 0) return;
    if (char === "{") {
      const prelude = cssText.slice(start, index).trim();
      const parent = rules.findLast((rule) => rule !== null);
      const selectors = !prelude || prelude.startsWith("@") ? null
        : (parent ?? [null]).flatMap((ancestor) => alternatives(prelude).map((alternative) => {
          const child = alternative.trim();
          return ancestor && child.includes("&") ? child.replaceAll("&", ancestor)
            : ancestor ? `${ancestor} ${child}` : child;
        }));
      if (selectors) {
        const scopeIsRoot = !scopes.includes(true);
        for (const selector of selectors) findings.push(...selectorFindings(selector, scopeIsRoot));
      }
      const isScope = /^@scope(?![\w-])/i.test(prelude);
      if (isScope) {
        let groupStart = -1;
        walk(prelude, (offset, current, groups) => {
          if (current === "(" && groups.length === 0) groupStart = offset + 1;
          else if (current === ")" && groups.length === 1 && groups[0].char === "(") {
            for (const alternative of alternatives(prelude.slice(groupStart, offset))) {
              findings.push(...selectorFindings(alternative, false));
            }
          }
        });
      }
      rules.push(selectors);
      scopes.push(isScope);
      start = index + 1;
    } else if (char === "}") {
      rules.pop();
      scopes.pop();
      start = index + 1;
    } else if (char === ";") start = index + 1;
  });
  return findings;
}

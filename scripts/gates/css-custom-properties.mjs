import { applyBodies } from "./css-apply.mjs";

// App CSS and TS/TSX class strings must not reference an unresolved CSS
// custom property: every var(--name) use needs a declaration in CSS, an inline
// TS/TSX provider, or an entry in the narrow runtime-injected allowlist.

// Custom-property name, without the leading --, normalized everywhere. Valid
// names may contain underscores and start with a digit (e.g. --_private,
// --1px); escaped/unicode names remain an accepted residual.
const NAME = "[a-zA-Z0-9_-]+";
const CSS_DECLARATION = new RegExp(`--(${NAME})\\s*:`, "g");
const CSS_VAR_USE = new RegExp(`var\\(\\s*(--${NAME})`, "g");

// Tailwind's parenthesized custom-property shorthand consumes a property the same
// way var() does, with an optional type hint and fallback: `bg-(--color-probe)`,
// `text-(length:--text-probe)` and `m-(--drawer-inset,0px)`.
const SHORTHAND_USE = /-\((?:(?:[a-z][a-z0-9-]*):)?(--[a-zA-Z0-9_-]+)/g;

// The same shorthand without a fallback is a required reference: Tailwind emits a
// bare var(--name), so the property must resolve exactly like a CSS var() use.
const SHORTHAND_REQUIRED_USE = /-\((?:(?:[a-z][a-z0-9-]*):)?(--[a-zA-Z0-9_-]+)\s*\)/g;

// A class string splits on whitespace and quotes, so a class token inside a
// template interpolation is still judged as one.
const CLASS_SPLIT = /[\s"'`]+/;


function shorthandUses(value) {
  return [...value.matchAll(SHORTHAND_USE)].map((match) => match[1]);
}

function requiredShorthandUses(value) {
  return [...value.matchAll(SHORTHAND_REQUIRED_USE)].map((match) => match[1]);
}

// A var() with a fallback is a use but not a requirement: the fallback keeps the
// declaration valid even when the property is never defined.
function varUseIsRequired(value, index) {
  return !/^var\(\s*--[a-zA-Z0-9_-]+\s*,/.test(value.slice(index));
}

// Provider-shaped TS/TSX literals only: a setProperty call whose first argument
// is a "--name" literal, a literal object property key "--name":, or a Tailwind
// arbitrary-property class ([--name:value]). A quoted "--name" on its own (a
// constant, a getPropertyValue/removeProperty lookup, or a comment) never
// defines a property. Type-declaration keys ("--name":) are indistinguishable
// from object keys by literal scan and remain an accepted residual in .ts/.tsx;
// .d.ts declarations are excluded.
const TS_SETPROPERTY_PROVIDER = new RegExp(`\\.setProperty\\(\\s*['"](--${NAME})['"]\\s*,`, "g");
const TS_OBJECT_KEY_PROVIDER = new RegExp(`['"](--${NAME})['"]\\s*:`, "g");
const TS_CLASS_PROPERTY_PROVIDER = new RegExp(`\\[--(${NAME})\\s*:`, "g");

// TS/TSX paths that never define a property at runtime and are skipped as
// provider sources: test files, test directories, and type declarations.
const TS_PROVIDER_SKIP = /(?:^|\/)(?:tests?|__tests__)\//;

const withoutLeadingDashes = (name) => name.replace(/^-+/, "");

// Strip // and /* */ comments from TS/TSX source while respecting string
// literals, so commented-out provider code is never counted as a definition.
// Template-literal ${...} interpolation is not modeled and remains a residual.
function stripJsComments(source) {
  let out = "";
  let quote = null;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];
    if (quote) {
      out += ch;
      if (ch === "\\") {
        out += next ?? "";
        i += next === undefined ? 0 : 1;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      i -= 1; // re-consume the newline in the main loop
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        if (source[i] === "\n") out += "\n"; // keep line structure
        i += 1;
      }
      i += 1; // step past the closing "/"
      out += " ";
      continue;
    }
    out += ch;
  }
  return out;
}

// A TS/TSX path counts as a provider source only when real runtime code could
// live there: not a test file, not inside a tests directory, not a .d.ts.
function isTsProviderSource(path) {
  if (!/\.m?[jt]sx?$/.test(path)) return false;
  if (/\.d\.tsx?$/.test(path)) return false;
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path)) return false;
  return !TS_PROVIDER_SKIP.test(path);
}

function note(map, name, file) {
  if (!map.has(name)) map.set(name, new Set());
  map.get(name).add(file);
}

// Return static quoted/template literal contents. Interpolated expressions are
// not evaluated; recognizable literal segments remain safe to inspect.
export function jsStringLiterals(source) {
  const literals = [];
  for (let i = 0; i < source.length; i += 1) {
    const quote = source[i];
    if (quote !== "'" && quote !== '"' && quote !== "`") continue;
    let value = "";
    i += 1;
    while (i < source.length && source[i] !== quote) {
      if (source[i] === "\\" && i + 1 < source.length) {
        value += source[i + 1];
        i += 2;
      } else {
        value += source[i];
        i += 1;
      }
    }
    literals.push(value);
  }
  return literals;
}

// A var() is a class-string consumer only when it occurs in a Tailwind
// arbitrary-value token. Plain TS values such as `const color = "var(--x)"`
// are runtime CSS values, but are deliberately outside this class-string gate.
function isArbitraryClassValue(literal, index) {
  const tokenStart = Math.max(literal.lastIndexOf(" ", index), literal.lastIndexOf("\n", index), literal.lastIndexOf("\t", index)) + 1;
  const suffix = literal.slice(tokenStart);
  const close = suffix.search(/\s/);
  const token = close === -1 ? suffix : suffix.slice(0, close);
  return token.includes("[") && token.includes("]");
}

// files: { path, content }[]. Definitions come from CSS declarations and
// provider-shaped TS/TSX literals; uses come from var() references in CSS and
// statically recognizable Tailwind arbitrary-value class strings.
export function collectCustomProperties(files) {
  const defined = new Map();
  const usedInCss = new Map();
  const requiredInCss = new Map();

  for (const file of files) {
    if (file.path.endsWith(".css")) {
      const source = file.content.replace(/\/\*[\s\S]*?\*\//g, " ");
      for (const match of source.matchAll(CSS_DECLARATION)) note(defined, match[1], file.path);
      for (const match of source.matchAll(CSS_VAR_USE)) {
        note(usedInCss, withoutLeadingDashes(match[1]), file.path);
        if (varUseIsRequired(source, match.index)) note(requiredInCss, withoutLeadingDashes(match[1]), file.path);
      }
      for (const { maskedBody } of applyBodies(source)) {
        for (const name of shorthandUses(maskedBody)) note(usedInCss, withoutLeadingDashes(name), file.path);
        for (const name of requiredShorthandUses(maskedBody)) note(requiredInCss, withoutLeadingDashes(name), file.path);
      }
    } else if (isTsProviderSource(file.path)) {
      const source = stripJsComments(file.content);
      for (const pattern of [TS_SETPROPERTY_PROVIDER, TS_OBJECT_KEY_PROVIDER]) {
        for (const match of source.matchAll(pattern)) note(defined, withoutLeadingDashes(match[1]), file.path);
      }
      for (const literal of jsStringLiterals(source)) {
        for (const match of literal.matchAll(TS_CLASS_PROPERTY_PROVIDER)) note(defined, match[1], file.path);
        for (const match of literal.matchAll(CSS_VAR_USE)) {
          if (isArbitraryClassValue(literal, match.index)) {
            note(usedInCss, withoutLeadingDashes(match[1]), file.path);
            if (varUseIsRequired(literal, match.index)) note(requiredInCss, withoutLeadingDashes(match[1]), file.path);
          }
        }
        for (const name of shorthandUses(literal)) note(usedInCss, withoutLeadingDashes(name), file.path);
        for (const name of requiredShorthandUses(literal)) note(requiredInCss, withoutLeadingDashes(name), file.path);
      }
    }
  }
  return { defined, usedInCss, requiredInCss };
}

// defined/usedInCss/requiredInCss: maps from collectCustomProperties; runtimeAllowed:
// names injected by frameworks at runtime. requiredInCss holds the references that
// must resolve, so a shorthand with a fallback is a use but not a requirement.
// unresolved: required references with no definition anywhere; staleAllowlist:
// runtime names now defined in the repo; unusedAllowlist: runtime names no longer
// used by any var() or shorthand reference.
export function evaluateCustomPropertyResolution({ defined, usedInCss, requiredInCss = usedInCss, runtimeAllowed = [] }) {
  const allowed = new Set(runtimeAllowed);
  const unresolved = [...requiredInCss.keys()]
    .filter((name) => !defined.has(name) && !allowed.has(name))
    .sort()
    .map((name) => ({ name, files: [...requiredInCss.get(name)].sort() }));
  const staleAllowlist = runtimeAllowed.filter((name) => defined.has(name)).sort();
  const unusedAllowlist = runtimeAllowed.filter((name) => !usedInCss.has(name)).sort();
  return { unresolved, staleAllowlist, unusedAllowlist };
}

function splitClassParts(value, separator) {
  const parts = [];
  const classList = separator === undefined;
  let part = "";
  let bracketDepth = 0;
  let parenthesisDepth = 0;
  let quote = null;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    const isQuote = ch === "'" || ch === '"' || ch === "`";
    if (classList && (/\s/.test(ch) || (!quote && bracketDepth === 0 && parenthesisDepth === 0 && isQuote))) {
      if (part) parts.push(part);
      part = "";
      bracketDepth = 0;
      parenthesisDepth = 0;
      quote = null;
      continue;
    }
    if (ch === "\\") {
      part += ch;
      const next = value[i + 1];
      if (next !== undefined && !/\s/.test(next)) {
        part += next;
        i += 1;
      }
      continue;
    }
    if (quote) {
      part += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if ((ch === "'" || ch === '"') && (bracketDepth > 0 || parenthesisDepth > 0)) quote = ch;
    else if (ch === "[") bracketDepth += 1;
    else if (ch === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
    } else if (ch === "(" && bracketDepth === 0) parenthesisDepth += 1;
    else if (ch === ")" && bracketDepth === 0) parenthesisDepth = Math.max(0, parenthesisDepth - 1);
    else if (ch === separator && bracketDepth === 0 && parenthesisDepth === 0) {
      parts.push(part);
      part = "";
      continue;
    }
    part += ch;
  }
  if (part || !classList) parts.push(part);
  return parts;
}

function classTokens(literal) {
  return splitClassParts(literal);
}

function splitClassToken(token) {
  const parts = splitClassParts(token, ":");
  return { variants: parts.slice(0, -1), utility: parts.at(-1) };
}

function segmentBalanced(value) {
  const stack = [];
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch === "\\") { i += 1; continue; }
    if (ch === "'" || ch === '"') {
      const quote = ch;
      while (++i < value.length) {
        if (value[i] === "\\") { i += 1; continue; }
        if (value[i] === quote) break;
      }
      continue;
    }
    if (ch === "(") stack.push(")");
    else if (ch === "[") stack.push("]");
    else if (ch === "{") stack.push("}");
    else if ((ch === ")" || ch === "]" || ch === "}") && stack.length > 0 && stack[stack.length - 1] === ch) stack.pop();
  }
  return stack.length === 0;
}

const MODIFIER_SEPARATORS = new Set([":", ",", "=", ">", "<", "\n", " ", "\t"]);

function decodeModifierValue(input) {
  const ast = [];
  const stack = [];
  let parent = null;
  let buffer = "";
  const pushNode = (node) => { (parent ? parent.nodes : ast).push(node); };
  const flushWord = () => { if (buffer.length > 0) { pushNode({ name: null, text: buffer }); buffer = ""; } };
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (ch === "\\") { buffer += input[i] + (input[i + 1] ?? ""); i += 1; continue; }
    if (ch === "'" || ch === '"') {
      const start = i;
      const quote = ch;
      while (++i < input.length) {
        if (input[i] === "\\") { i += 1; continue; }
        if (input[i] === quote) break;
      }
      buffer += input.slice(start, i + 1);
      continue;
    }
    if (MODIFIER_SEPARATORS.has(ch)) {
      flushWord();
      const start = i;
      while (i + 1 < input.length && MODIFIER_SEPARATORS.has(input[i + 1])) i += 1;
      pushNode({ name: null, text: input.slice(start, i + 1) });
      continue;
    }
    if (ch === "/") {
      flushWord();
      pushNode({ name: null, text: "/" });
      continue;
    }
    if (ch === "(") {
      const node = { name: buffer, nodes: [] };
      buffer = "";
      pushNode(node);
      stack.push(node);
      parent = node;
      continue;
    }
    if (ch === ")") {
      const tail = stack.pop() ?? null;
      if (buffer.length > 0) { if (tail) tail.nodes.push({ name: null, text: buffer }); buffer = ""; }
      parent = stack.length > 0 ? stack[stack.length - 1] : null;
      continue;
    }
    buffer += ch;
  }
  flushWord();
  const toCss = (nodes) => nodes.map((node) => (node.name === null ? node.text : `${node.name}(${toCss(node.nodes)})`)).join("");
  return toCss(ast);
}

function isValidArbitraryValue(value) {
  const stack = [];
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch === "\\") { i += 1; continue; }
    if (ch === "'" || ch === '"') {
      const quote = ch;
      while (++i < value.length) {
        if (value[i] === "\\") { i += 1; continue; }
        if (value[i] === quote) break;
      }
      continue;
    }
    if (ch === "(") stack.push(")");
    else if (ch === "[") stack.push("]");
    else if (ch === ")" || ch === "]" || ch === "}") {
      if (stack.length === 0) return false;
      if (stack[stack.length - 1] === ch) stack.pop();
    } else if (ch === ";" && stack.length === 0) return false;
  }
  return true;
}

// Mirrors Tailwind 4.3.3 parseModifier, segment, decodeArbitraryValue and isValidArbitrary.
function isArbitraryModifier(value) {
  if (value.length <= 2 || value[0] !== "[" || value[value.length - 1] !== "]") return false;
  if (!segmentBalanced(value)) return false;
  const inner = value.slice(1, -1);
  const decoded = inner.includes("(") ? decodeModifierValue(inner) : inner;
  return isValidArbitraryValue(decoded) && decoded.trim().length > 0;
}

// Tailwind's source scanner starts a candidate at the token start or after a
// boundary character (whitespace, a quote, a backtick, `.`, `>` or `}`), and an
// `@` outside brackets, parentheses and quoted runs is startable only at that
// position or immediately after `:`. A token with an unstartable `@` therefore
// yields only the pieces after its boundary characters; text before the first
// boundary is not a candidate. Over-approximating the pieces keeps the guard
// fail-open.
const SCANNER_BOUNDARY = /[\s"'`>}.]/;

function scannerCandidates(token) {
  const candidates = [];
  let start = 0;
  let recovery = false;
  let bracketDepth = 0;
  let parenthesisDepth = 0;
  let quote = null;
  for (let i = 0; i < token.length; i += 1) {
    const ch = token[i];
    if (ch === "\\") {
      const escaped = token[i + 1];
      if (recovery && escaped !== undefined && SCANNER_BOUNDARY.test(escaped)) {
        if (start >= 0) candidates.push(token.slice(start, i));
        start = i + 2;
      }
      i += 1;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === "[") {
      bracketDepth += 1;
      continue;
    }
    if (ch === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }
    if (ch === "(" && bracketDepth === 0) {
      parenthesisDepth += 1;
      continue;
    }
    if (ch === ")" && bracketDepth === 0) {
      parenthesisDepth = Math.max(0, parenthesisDepth - 1);
      continue;
    }
    if (bracketDepth > 0 || parenthesisDepth > 0) continue;
    if (ch === "@" && i !== start && token[i - 1] !== ":") {
      if (recovery && start >= 0) candidates.push(token.slice(start, i));
      start = -1;
      recovery = true;
      continue;
    }
    if (!recovery || !SCANNER_BOUNDARY.test(ch)) continue;
    if (start >= 0) candidates.push(token.slice(start, i));
    start = i + 1;
  }
  if (start >= 0 && start < token.length) candidates.push(token.slice(start));
  return candidates;
}

// A declared theme token consumes measured utility, variant, modifier or default
// spellings; overlapping namespaces must all be considered.
function themeSpellingUses(token, classes, themeSpellings) {
  for (const [namespace, { utilities, variants, modifiers, defaults }] of themeSpellings) {
    const isDefault = token === namespace;
    if (!isDefault && !token.startsWith(`${namespace}-`)) continue;
    const value = token.slice(namespace.length + 1);
    if (classes.some((part) => {
      const { variants: segments, utility: rawUtility } = splitClassToken(part);
      const normalized = rawUtility.replace(/^!/, "").replace(/!$/, "");
      if (isDefault) {
        const base = splitClassParts(normalized, "/")[0];
        return defaults.bare.includes(base) || defaults.valued.some((root) => normalized.startsWith(`${root}-`)
          && /^-?\d+(?:\.\d+)?$/.test(normalized.slice(root.length + 1)));
      }
      const utility = normalized.split("/")[0].replace(/^-/, "");
      if (utilities.some((root) => utility === `${root}-${value}`)) return true;
      const modifierParts = splitClassParts(normalized, "/");
      if (modifierParts.length === 2 && modifierParts[1] === value
        && modifiers.some((root) => modifierParts[0] === root || modifierParts[0].startsWith(`${root}-`))) return true;
      return segments.some((segment) => variants.some((template) => {
        const modified = template.endsWith("/{modifier}");
        const spelling = (modified ? template.slice(0, -"/{modifier}".length) : template).replace("{value}", value);
        if (!modified) return segment === spelling;
        const parts = splitClassParts(segment, "/");
        if (parts.length !== 2 || parts[0] !== spelling) return false;
        return /^[A-Za-z0-9_.-]+$/.test(parts[1]) || isArbitraryModifier(parts[1]);
      }));
    })) return true;
  }
  return false;
}

function shorthandCustomPropertyUses(classes) {
  const uses = new Set();
  for (const literal of classes) {
    for (const token of literal.split(CLASS_SPLIT)) {
      for (const match of token.matchAll(SHORTHAND_USE)) uses.add(match[1]);
    }
  }
  return uses;
}

export function evaluateUnusedDeclaredTokens({ inventory, files, allowlist = [], themeSpellings }) {
  if (!(themeSpellings instanceof Map)) {
    throw new TypeError("evaluateUnusedDeclaredTokens requires themeSpellings to be a Map derived from tailwindThemeSpellings()");
  }
  const declared = new Set([
    ...inventory.themeInline.properties, ...inventory.root.properties, ...inventory.dark.properties,
    ...Object.values(inventory.supports).flatMap(({ properties }) => properties),
    ...Object.values(inventory.media).flatMap(({ properties }) => properties),
  ]);
  const product = files.filter(({ path }) => !/(?:^|\/)(?:tests?|__tests__)\/|^oxlint\//.test(path)
    && !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path));
  const vars = new Set();
  const classes = [];
  const shorthandClasses = [];
  for (const { path, content } of product) {
    let source = content;
    if (path.endsWith(".css")) source = content.replace(/\/\*[\s\S]*?\*\//g, " ");
    else if (/\.[cm]?[jt]sx?$/.test(path)) source = stripJsComments(content);
    for (const match of source.matchAll(CSS_VAR_USE)) vars.add(match[1]);
    if (path.endsWith(".css")) {
      for (const { classBody, maskedBody } of applyBodies(source)) {
        classes.push(...classTokens(classBody));
        shorthandClasses.push(maskedBody);
      }
    } else if (/\.[cm]?[jt]sx?$/.test(path)) {
      const literals = jsStringLiterals(source);
      classes.push(...literals.flatMap((literal) => classTokens(literal).flatMap(scannerCandidates)));
      shorthandClasses.push(...literals);
    }
  }
  const themeTokens = new Set(inventory.themeInline.properties);
  const shorthand = shorthandCustomPropertyUses(shorthandClasses);
  const referenced = (name) => vars.has(name) || shorthand.has(name) || (themeTokens.has(name) && themeSpellingUses(name, classes, themeSpellings));
  const allowed = new Set(allowlist.map(({ name }) => name));
  return {
    unused: [...declared].filter((name) => !referenced(name) && !allowed.has(name)).sort(),
    staleAllowlist: allowlist.filter(({ name }) => !declared.has(name) || referenced(name)).map(({ name }) => name).sort(),
    invalidAllowlist: allowlist.filter(({ name, reason }, index) => !name || !reason?.trim()
      || allowlist.findIndex((entry) => entry.name === name) !== index).map(({ name }) => name).sort(),
  };
}

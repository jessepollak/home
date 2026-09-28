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

// A declared global token is live if any app source (including stories and
// explorations) uses var(--name), references it through Tailwind's parenthesized
// custom-property shorthand, or consumes its @theme inline mapping with a
// statically recognizable Tailwind class. Count uncertain references as uses.
const THEME_UTILITY = {
  color: [
    "bg", "text", "border", "border-x", "border-y", "border-s", "border-e", "border-t", "border-b", "border-l", "border-r",
    "ring", "ring-offset", "fill", "stroke", "from", "to", "via", "divide", "divide-x", "divide-y",
    "outline", "shadow", "accent", "caret", "decoration", "placeholder",
    "drop-shadow", "inset-shadow", "text-shadow",
    "inset-ring", "border-bs", "border-be", "scrollbar-thumb", "scrollbar-track",
    "mask-linear-from", "mask-linear-to", "mask-radial-from", "mask-conic-from",
    "mask-t-from", "mask-b-from", "mask-l-from", "mask-r-from", "mask-x-from", "mask-y-from",
  ],
  font: ["font"],
  radius: ["rounded", "rounded-s", "rounded-e", "rounded-t", "rounded-b", "rounded-l", "rounded-r", "rounded-tl", "rounded-tr", "rounded-br", "rounded-bl", "rounded-ss", "rounded-se", "rounded-es", "rounded-ee"],
  spacing: [
    "m", "mx", "my", "ms", "me", "mt", "mb", "ml", "mr",
    "p", "px", "py", "ps", "pe", "pt", "pb", "pl", "pr",
    "gap", "gap-x", "gap-y", "space-x", "space-y", "inset", "inset-x", "inset-y",
    "start", "end", "top", "right", "bottom", "left",
    "inset-s", "inset-e", "inset-bs", "inset-be", "translate", "translate-z", "leading",
    "w", "min-w", "max-w", "h", "min-h", "max-h", "size", "translate-x", "translate-y",
    "scroll-m", "scroll-mx", "scroll-my", "scroll-ms", "scroll-me", "scroll-mt", "scroll-mb", "scroll-ml", "scroll-mr",
    "scroll-p", "scroll-px", "scroll-py", "scroll-ps", "scroll-pe", "scroll-pt", "scroll-pb", "scroll-pl", "scroll-pr",
    "basis", "indent", "border-spacing", "border-spacing-x", "border-spacing-y",
  ],
  text: ["text"],
  shadow: ["shadow"],
};

function themeUtilityUses(token, classes) {
  const match = token.match(/^--(color|font|radius|spacing|text|shadow)-(.+)$/);
  if (!match) return false;
  const [, family, name] = match;
  const prefixes = THEME_UTILITY[family];
  return classes.some((literal) => literal.split(CLASS_SPLIT).some((part) => {
    // Strip variants, a leading or trailing important marker, and the opacity
    // suffix, then the negative marker.
    const utility = part.slice(part.lastIndexOf(":") + 1).replace(/^!/, "").replace(/!$/, "").split("/")[0].replace(/^-/, "");
    return prefixes.some((prefix) => utility === `${prefix}-${name}`);
  }));
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

export function evaluateUnusedDeclaredTokens({ inventory, files, allowlist = [] }) {
  const declared = new Set([
    ...inventory.themeInline.properties, ...inventory.root.properties, ...inventory.dark.properties,
    ...Object.values(inventory.supports).flatMap(({ properties }) => properties),
    ...Object.values(inventory.media).flatMap(({ properties }) => properties),
  ]);
  const product = files.filter(({ path }) => !/(?:^|\/)(?:tests?|__tests__)\/|^oxlint\//.test(path)
    && !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path));
  const vars = new Set();
  const classes = [];
  for (const { path, content } of product) {
    let source = content;
    if (path.endsWith(".css")) source = content.replace(/\/\*[\s\S]*?\*\//g, " ");
    else if (/\.[cm]?[jt]sx?$/.test(path)) source = stripJsComments(content);
    for (const match of source.matchAll(CSS_VAR_USE)) vars.add(match[1]);
    if (path.endsWith(".css")) {
      for (const { maskedBody } of applyBodies(source)) classes.push(maskedBody);
    } else if (/\.[cm]?[jt]sx?$/.test(path)) {
      classes.push(...jsStringLiterals(source));
    }
  }
  const themeTokens = new Set(inventory.themeInline.properties);
  const shorthand = shorthandCustomPropertyUses(classes);
  const referenced = (name) => vars.has(name) || shorthand.has(name) || (themeTokens.has(name) && themeUtilityUses(name, classes));
  const allowed = new Set(allowlist.map(({ name }) => name));
  return {
    unused: [...declared].filter((name) => !referenced(name) && !allowed.has(name)).sort(),
    staleAllowlist: allowlist.filter(({ name }) => !declared.has(name) || referenced(name)).map(({ name }) => name).sort(),
    invalidAllowlist: allowlist.filter(({ name, reason }, index) => !name || !reason?.trim()
      || allowlist.findIndex((entry) => entry.name === name) !== index).map(({ name }) => name).sort(),
  };
}

// App CSS must not reference an unresolved CSS custom property: every var(--name)
// use in an app CSS file needs a declaration in CSS, an inline TS/TSX provider,
// or an entry in the narrow runtime-injected allowlist.

// Custom-property name, without the leading --, normalized everywhere. Valid
// names may contain underscores and start with a digit (e.g. --_private,
// --1px); escaped/unicode names remain an accepted residual.
const NAME = "[a-zA-Z0-9_-]+";
const CSS_DECLARATION = new RegExp(`--(${NAME})\\s*:`, "g");
const CSS_VAR_USE = new RegExp(`var\\(\\s*(--${NAME})`, "g");

// Provider-shaped TS/TSX literals only: a setProperty call whose first argument
// is a "--name" literal, or a literal object property key "--name":. A quoted
// "--name" on its own (a constant, a getPropertyValue/removeProperty lookup, or
// a comment) never defines a property. Tailwind arbitrary properties
// ([--name:value]) in class strings are deliberately not treated as providers;
// a var() use of one must be declared in CSS or allowlisted. Type-declaration
// keys ("--name":) are indistinguishable from object keys by literal scan and
// remain an accepted residual in .ts/.tsx; .d.ts declarations are excluded.
const TS_SETPROPERTY_PROVIDER = new RegExp(`\\.setProperty\\(\\s*['"](--${NAME})['"]\\s*,`, "g");
const TS_OBJECT_KEY_PROVIDER = new RegExp(`['"](--${NAME})['"]\\s*:`, "g");

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

// files: { path, content }[]. Definitions come from CSS declarations and
// provider-shaped TS/TSX literals; uses come from var() references in CSS
// files only.
export function collectCustomProperties(files) {
  const defined = new Map();
  const usedInCss = new Map();

  for (const file of files) {
    if (file.path.endsWith(".css")) {
      for (const match of file.content.matchAll(CSS_DECLARATION)) note(defined, match[1], file.path);
      for (const match of file.content.matchAll(CSS_VAR_USE)) note(usedInCss, withoutLeadingDashes(match[1]), file.path);
    } else if (isTsProviderSource(file.path)) {
      const source = stripJsComments(file.content);
      for (const pattern of [TS_SETPROPERTY_PROVIDER, TS_OBJECT_KEY_PROVIDER]) {
        for (const match of source.matchAll(pattern)) note(defined, withoutLeadingDashes(match[1]), file.path);
      }
    }
  }
  return { defined, usedInCss };
}

// defined/usedInCss: maps from collectCustomProperties; runtimeAllowed: names
// injected by frameworks at runtime. unresolved: CSS var() uses with no
// definition anywhere; staleAllowlist: runtime names now defined in the repo;
// unusedAllowlist: runtime names no longer used by any CSS var().
export function evaluateCustomPropertyResolution({ defined, usedInCss, runtimeAllowed = [] }) {
  const allowed = new Set(runtimeAllowed);
  const unresolved = [...usedInCss.keys()]
    .filter((name) => !defined.has(name) && !allowed.has(name))
    .sort()
    .map((name) => ({ name, files: [...usedInCss.get(name)].sort() }));
  const staleAllowlist = runtimeAllowed.filter((name) => defined.has(name)).sort();
  const unusedAllowlist = runtimeAllowed.filter((name) => !usedInCss.has(name)).sort();
  return { unresolved, staleAllowlist, unusedAllowlist };
}

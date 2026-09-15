// App CSS must not reference an unresolved CSS custom property: every var(--name)
// use in an app CSS file needs a declaration in CSS, an inline TS/TSX provider,
// or an entry in the narrow runtime-injected allowlist.

// Custom-property name, without the leading --, normalized everywhere.
const NAME = "[a-zA-Z][a-zA-Z0-9-]*";
const CSS_DECLARATION = new RegExp(`--(${NAME})\\s*:`, "g");
const CSS_VAR_USE = new RegExp(`var\\(\\s*(--${NAME})`, "g");
// Style object keys and setProperty arguments: "--name"
const TS_QUOTED_PROVIDER = new RegExp(`['"](--${NAME})['"]`, "g");
// Tailwind arbitrary properties: [--name:...]
const TS_TAILWIND_PROVIDER = new RegExp(`\\[\\s*(--${NAME})\\s*:`, "g");

const withoutLeadingDashes = (name) => name.replace(/^-+/, "");

function note(map, name, file) {
  if (!map.has(name)) map.set(name, new Set());
  map.get(name).add(file);
}

// files: { path, content }[]. Definitions come from CSS declarations and inline
// TS/TSX providers; uses come from var() references in CSS files only.
export function collectCustomProperties(files) {
  const defined = new Map();
  const usedInCss = new Map();

  for (const file of files) {
    const isCss = file.path.endsWith(".css");
    if (isCss) {
      for (const match of file.content.matchAll(CSS_DECLARATION)) note(defined, match[1], file.path);
      for (const match of file.content.matchAll(CSS_VAR_USE)) note(usedInCss, withoutLeadingDashes(match[1]), file.path);
    } else if (/\.m?[jt]sx?$/.test(file.path)) {
      for (const pattern of [TS_QUOTED_PROVIDER, TS_TAILWIND_PROVIDER]) {
        for (const match of file.content.matchAll(pattern)) note(defined, withoutLeadingDashes(match[1]), file.path);
      }
    }
  }
  return { defined, usedInCss };
}

// defined/usedInCss: maps from collectCustomProperties; runtimeAllowed: names
// injected by frameworks at runtime. unresolved: CSS var() uses with no
// definition anywhere; staleAllowlist: runtime names now defined in the repo.
export function evaluateCustomPropertyResolution({ defined, usedInCss, runtimeAllowed = [] }) {
  const allowed = new Set(runtimeAllowed);
  const unresolved = [...usedInCss.keys()]
    .filter((name) => !defined.has(name) && !allowed.has(name))
    .sort()
    .map((name) => ({ name, files: [...usedInCss.get(name)].sort() }));
  const staleAllowlist = runtimeAllowed.filter((name) => defined.has(name)).sort();
  return { unresolved, staleAllowlist };
}

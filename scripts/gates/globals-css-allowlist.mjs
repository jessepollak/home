// A small structural parser for globals.css: semicolons/braces inside strings,
// functions, and attribute selectors are not CSS statement boundaries.
export function parseGlobalsCss(css) {
  if (/\/\*|\*\//.test(css)) throw new Error("globals.css must not contain comments");
  let position = 0;
  function nodes(nested = false) {
    const result = [];
    let start = position;
    let quote = null;
    let parens = 0;
    let brackets = 0;
    for (; position < css.length; position++) {
      const ch = css[position];
      if (quote) {
        if (ch === "\\") position++;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") { quote = ch; continue; }
      if (ch === "(") parens++;
      else if (ch === ")") parens--;
      else if (ch === "[") brackets++;
      else if (ch === "]") brackets--;
      if (parens < 0 || brackets < 0) throw new Error("Unbalanced CSS delimiter");
      if (parens || brackets) continue;
      if (ch === ";" || ch === "{" || ch === "}") {
        const text = css.slice(start, position).trim();
        if (ch === "}") {
          if (!nested || text) throw new Error(`Unexpected CSS closing brace: ${text}`);
          position++;
          return result;
        }
        if (!text) throw new Error("Empty CSS statement");
        if (ch === "{") {
          position++;
          result.push({ selector: text, children: nodes(true) });
          position--;
        } else {
          result.push({ declaration: text });
        }
        start = position + 1;
      }
    }
    if (nested || quote || parens || brackets || css.slice(start).trim()) throw new Error("Unclosed CSS statement or block");
    return result;
  }
  return nodes();
}

function sorted(values) { return values.sort(); }
function blocks(nodes) {
  if (nodes.some((node) => !node.children)) throw new Error("Expected CSS blocks");
  const names = nodes.map((node) => node.selector);
  if (new Set(names).size !== names.length) throw new Error("Duplicate CSS block");
  return Object.fromEntries(nodes.map((node) => [node.selector, node.children]));
}
function declarations(nodes) {
  if (nodes.some((node) => !node.declaration)) throw new Error("Unexpected nested CSS block");
  return nodes.map((node) => {
    const match = node.declaration.match(/^([@\w-]+)\s*:\s*(.+)$/s);
    if (!match) throw new Error(`Invalid CSS declaration: ${node.declaration}`);
    return { name: match[1], value: match[2] };
  });
}
function customProperties(nodes) {
  const entries = declarations(nodes);
  return {
    properties: sorted(entries.filter(({ name }) => name.startsWith("--")).map(({ name }) => name)),
    other: sorted(entries.filter(({ name }) => !name.startsWith("--")).map(({ name, value }) => `${name}: ${value}`)),
  };
}
function ruleDeclarations(nodes) {
  return Object.fromEntries(Object.entries(blocks(nodes)).map(([selector, body]) => [selector,
    sorted(body.map((node) => {
      if (node.children) throw new Error(`Unexpected nested CSS rule in ${selector}`);
      // @apply is a Tailwind declaration without a colon.
      if (node.declaration.startsWith("@apply ")) return node.declaration;
      const [{ name, value }] = declarations([node]);
      return `${name}: ${value}`;
    }))]));
}
export function inventoryGlobalsCss(css) {
  const parsed = parseGlobalsCss(css);
  const imports = [];
  const customVariants = [];
  const sources = [];
  const rules = [];
  for (const node of parsed) {
    if (node.children) rules.push(node);
    else if (node.declaration.startsWith("@import ")) imports.push(node.declaration);
    else if (node.declaration.startsWith("@custom-variant ")) customVariants.push(node.declaration);
    else if (node.declaration.startsWith("@source ")) sources.push(node.declaration);
    else throw new Error(`Unexpected top-level CSS declaration: ${node.declaration}`);
  }
  const top = blocks(rules);
  const nested = (selector) => Object.fromEntries(Object.entries(blocks(top[selector] ?? [])).map(([inner, body]) => [inner, customProperties(body)]));
  return {
    imports: sorted(imports), customVariants: sorted(customVariants), sources: sorted(sources), topLevel: sorted(Object.keys(top)),
    themeInline: customProperties(top["@theme inline"] ?? []),
    root: customProperties(top[":root"] ?? []), dark: customProperties(top[".dark"] ?? []),
    supports: nested("@supports (height: 100dvh)"),
    media: nested("@media (display-mode: standalone)"),
    baseLayer: ruleDeclarations(top["@layer base"] ?? []),
    utilitiesLayer: ruleDeclarations(top["@layer utilities"] ?? []),
    registeredProperties: Object.fromEntries(Object.entries(top).filter(([selector]) => selector.startsWith("@property ")).map(([selector, body]) => [selector, declarations(body).map(({ name, value }) => `${name}: ${value}`).sort()])),
  };
}

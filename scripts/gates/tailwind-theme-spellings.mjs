import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const spellingsPromises = new Map();

async function deriveThemeSpellings(declaredTokens) {
  const webRequire = createRequire(new URL("../../apps/web/package.json", import.meta.url));
  const tailwind = (await import(webRequire.resolve("tailwindcss"))).default;
  const core = await readFile(webRequire.resolve("tailwindcss/index.css"), "utf8");
  const base = await tailwind.__unstable__loadDesignSystem(core, { base: "." });
  const namespaces = new Set();
  for (const key of [...base.theme.entries()].map(([name]) => name).concat(declaredTokens)) {
    const parts = key.slice(2).split("-");
    for (let i = 1; i <= parts.length; i += 1) {
      // Companion keys such as --text-xs--line-height stop at the empty segment.
      if (parts[i - 1] === "") break;
      namespaces.add(`--${parts.slice(0, i).join("-")}`);
    }
  }

  // Unique probe names prevent a utility's fallback namespaces from masking its owner.
  const candidates = [...namespaces].sort();
  const declarations = candidates.map((namespace, i) => `${namespace}-p${i}: 1px;`).join(" ");
  const design = await tailwind.__unstable__loadDesignSystem(`${core}\n@theme { ${declarations} }`, { base: "." });
  const roots = [...new Set(design.utilities.keys("functional"))].sort();
  const variantMetadata = design.getVariants();
  const variantTemplates = candidates.map((_, i) => {
    const probe = `p${i}`;
    const variants = new Set();
    // Variant metadata also exposes namespaces that have no functional utility.
    for (const variant of variantMetadata) {
      if (variant.name === probe) variants.add("{value}");
      if (variant.values.includes(probe)) {
        variants.add(`${variant.name}${variant.hasDash ? "-" : ""}{value}`);
      }
    }
    return variants;
  });
  const negatedProbes = variantTemplates.flatMap((variants, i) => [...variants].map((template) => ({
    namespaceIndex: i,
    template: `not-${template}`,
    candidate: `not-${template.replace("{value}", `p${i}`)}:block`,
  })));
  const modifierProbes = variantTemplates.flatMap((variants, i) => [...variants]
    .flatMap((template) => [template, `not-${template}`])
    .map((template) => ({
      namespaceIndex: i,
      template: `${template}/{modifier}`,
      candidate: `${template.replace("{value}", `p${i}`)}/sidebar:block`,
    })));
  const variantProbes = [...negatedProbes, ...modifierProbes];
  const probes = [
    ...candidates.flatMap((_, i) => roots.map((root) => `${root}-p${i}`)),
    ...variantProbes.map(({ candidate }) => candidate),
  ];
  const css = design.candidatesToCss(probes);
  for (const [i, { namespaceIndex, template }] of variantProbes.entries()) {
    if (css[candidates.length * roots.length + i] !== null) variantTemplates[namespaceIndex].add(template);
  }
  const spellings = new Map();
  for (const [i, namespace] of candidates.entries()) {
    const utilities = roots.filter((_, rootIndex) => css[i * roots.length + rootIndex] !== null);
    const variants = [...variantTemplates[i]].sort();
    if (utilities.length || variants.length) {
      spellings.set(namespace, { utilities, variants });
    }
  }
  return spellings;
}

export function tailwindThemeSpellings(declaredTokens = []) {
  // Each distinct token set shares one measurement of the installed contract.
  const tokens = [...new Set(declaredTokens)].sort();
  const key = tokens.join("\n");
  if (!spellingsPromises.has(key)) spellingsPromises.set(key, deriveThemeSpellings(tokens));
  return spellingsPromises.get(key);
}

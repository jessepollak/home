import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { __unstable__loadDesignSystem } from "tailwindcss";

// Resolve Tailwind's own design system once so class names are validated against
// the exact theme (default scale, project `@theme` tokens, and imported layers)
// instead of a hand-maintained allowlist.
const policyDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(policyDir, "../..");
const nodeModules = path.join(projectRoot, "node_modules");

const stylesheetResolutions = new Map([
  ["tailwindcss", path.join(nodeModules, "tailwindcss/index.css")],
  ["tw-animate-css", path.join(nodeModules, "tw-animate-css/dist/tw-animate.css")],
  ["shadcn/tailwind.css", path.join(nodeModules, "shadcn/dist/tailwind.css")],
]);

function loadStylesheet(id, baseDir) {
  const resolved = stylesheetResolutions.get(id) ?? path.resolve(baseDir, id);
  return { path: resolved, base: path.dirname(resolved), content: fs.readFileSync(resolved, "utf8") };
}

const entrypoint = path.join(projectRoot, "app/globals.css");
const designSystem = fs.existsSync(entrypoint)
  ? await __unstable__loadDesignSystem(fs.readFileSync(entrypoint, "utf8"), { base: projectRoot, loadStylesheet })
  : null;

/** True when Tailwind can resolve the candidate, or when the theme is unavailable. */
export function isKnownClass(candidate) {
  if (!designSystem) return true;
  return designSystem.candidatesToCss([candidate])[0] !== null;
}

export { designSystem };

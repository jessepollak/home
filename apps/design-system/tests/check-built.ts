// Runs after `next build`, not against development output. No browser required.
import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";

const cssFiles = Array.from(new Bun.Glob("**/*.css").scanSync(".next/static"));
assert(cssFiles.length > 0, "Production CSS must exist");
const css = (await Promise.all(cssFiles.map((file) => readFile(`.next/static/${file}`, "utf8")))).join("\n");
assert.match(css, /\.isolate\s*\{\s*isolation:\s*isolate/, "Package-only Tailwind utility must survive the production build");
assert.match(css, /\.bg-home-ui-surface\s*\{[^}]*--home-ui-color-surface/, "Semantic adapter utility must be emitted");
assert.match(css, /@font-face[^}]*\.woff2/, "Next adapter must emit local WOFF2 faces");
assert.match(css, /@font-face[^}]*\.ttf[^}]*font-weight:500/, "Next adapter must emit the static local numeric face at its real weight");
assert.match(css, /--home-ui-font-dm-mono:/, "Opt-in numeric family must be wired into production CSS");
assert.match(css, /home-ui-button:focus-visible/, "Shared focus styles must be emitted");

const fonts = Array.from(new Bun.Glob("**/*.{woff2,ttf}").scanSync(".next/static"));
const hashes = await Promise.all(fonts.map(async (file) => new Bun.CryptoHasher("sha256").update(await readFile(`.next/static/${file}`)).digest("hex")));
for (const expected of [
  "e80dcae1d6cec824ed44daa671795d742f5c9ad8d50f7774bd0418eb44bfd4e1",
  "b86afcd6982355b627b0168dc055635829ecd8e74a30b391473a2d5e8add1544",
  "fd327daf461db87b44a87def475d251bf03b997f7c07d9680592d75dbbfaad0b",
]) assert(hashes.includes(expected), "All three licensed local font files must be in the production output");

const html = await readFile(".next/server/app/index.html", "utf8");
assert(html.includes("Home UI foundation") && html.includes("home-ui-button"), "Catalog must prerender actual shared exports, not a blank dev-only route");
assert(html.includes("₹12,34,56,789.00"), "Large display fixtures must be server rendered");
console.log(`Production catalog verified: ${cssFiles.length} CSS files, package-only utility, shared styles, all three local fonts (DM Sans normal/italic + DM Mono Medium), prerendered controls/values.`);

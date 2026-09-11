import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

const from = fileURLToPath(new URL("../app/globals.css", import.meta.url));

test("Tailwind v4 emits an internal-only package utility and semantic adapter classes", async () => {
  const source = await readFile(from, "utf8");
  const result = await postcss([tailwind()]).process(source, { from });
  expect(result.css).toMatch(/\.isolate\s*\{\s*isolation:\s*isolate/);
  expect(result.css).toMatch(/\.bg-home-ui-surface\s*\{\s*background-color:\s*var\(--home-ui-color-surface\)/);
  expect(result.css).toContain(".home-ui-button:focus-visible");
  expect(result.css).toContain("--home-ui-target-min: 44px");
  expect(result.css).toContain("prefers-reduced-motion: reduce");
});

test("without the explicit package source the internal utility is not emitted", async () => {
  const source = (await readFile(from, "utf8")).replace('@source "../../../packages/ui/src";', "");
  const result = await postcss([tailwind()]).process(source, { from: from.replace("globals.css", "source-scan-negative.css") });
  expect(result.css).not.toMatch(/\.isolate\s*\{/);
});

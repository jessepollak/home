import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const REGENERATE_COMMAND = "node scripts/gates/env-names.mjs --write";
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

export function parseEnvNames(template) {
  return [...new Set([...template.matchAll(/^\s*(?:#\s*)?([A-Z][A-Z0-9_]*)=/gm)].map((match) => match[1]))].sort();
}

export function renderEnvNames(template) {
  const names = parseEnvNames(template);
  if (names.length === 0) throw new Error(".env.example must document at least one environment name.");
  return `import "server-only";\n\nexport const ALLOWED_ENV_NAMES = [\n${names.map((name) => `  ${JSON.stringify(name)},`).join("\n")}\n] as const;\n\nexport type AllowedEnvName = (typeof ALLOWED_ENV_NAMES)[number];\n`;
}

export async function checkEnvNames(root = repoRoot, { write = false } = {}) {
  const template = await readFile(path.join(root, ".env.example"), "utf8");
  const generatedPath = path.join(root, "apps/web/server/config/env-names.ts");
  const expected = renderEnvNames(template);
  if (write) {
    await writeFile(generatedPath, expected);
    return;
  }
  let actual;
  try {
    actual = await readFile(generatedPath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (actual !== expected) {
    throw new Error(`apps/web/server/config/env-names.ts is missing or stale. Regenerate with: ${REGENERATE_COMMAND}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || (args.length === 1 && args[0] !== "--write")) {
      throw new Error(`Usage: node scripts/gates/env-names.mjs [--write]`);
    }
    await checkEnvNames(repoRoot, { write: args[0] === "--write" });
    console.log(`env-names: ${args[0] === "--write" ? "regenerated" : "up to date"}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

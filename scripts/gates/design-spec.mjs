import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseGlobalsCss } from "./globals-css-allowlist.mjs";

const startMarker = "<!-- design-spec:tokens:start -->";
const endMarker = "<!-- design-spec:tokens:end -->";

export function evaluateDesignSpec({ css, spec }) {
  const declared = new Map();
  function collect(nodes, selectors = []) {
    for (const node of nodes) {
      if (node.children) {
        collect(node.children, [...selectors, node.selector]);
      } else {
        const match = /^(--[\w-]+)\s*:\s*(.+)$/s.exec(node.declaration);
        if (!match) {
          if (node.declaration.startsWith("--")) throw new Error(`Invalid CSS declaration: ${node.declaration}`);
          continue;
        }
        const name = match[1];
        if (!declared.has(name)) declared.set(name, new Set());
        declared.get(name).add(selectors.join(" "));
      }
    }
  }
  collect(parseGlobalsCss(css));

  const invalid = [];
  const listed = new Set();
  const start = spec.indexOf(startMarker);
  const end = spec.indexOf(endMarker);
  if (start === -1) invalid.push(`Missing token marker: ${startMarker}`);
  if (end === -1) invalid.push(`Missing token marker: ${endMarker}`);
  if (start !== -1 && end !== -1) {
    if (end < start) {
      invalid.push("Token end marker precedes start marker");
    } else {
      const lines = spec.slice(start + startMarker.length, end).split(/\r?\n/);
      for (const [index, raw] of lines.entries()) {
        const line = raw.trim();
        if (!line) continue;
        if (!/^--[a-z0-9-]+$/.test(line)) {
          invalid.push(`Invalid token line ${index + 1}: ${line}`);
        } else if (listed.has(line)) {
          invalid.push(`Duplicate token line ${index + 1}: ${line}`);
        } else {
          listed.add(line);
        }
      }
    }
  }

  return {
    missing: [...declared.keys()].filter((name) => !listed.has(name))
      .map((name) => `${name} (declared in ${[...declared.get(name)].sort().join(", ")})`).sort(),
    undeclared: [...listed].filter((name) => !declared.has(name)).sort(),
    invalid: invalid.sort(),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length > 4) {
    console.error("usage: node scripts/gates/design-spec.mjs [cssPath] [specPath]");
    process.exitCode = 1;
  } else {
    try {
      const css = readFileSync(process.argv[2] ?? new URL("../../apps/web/app/globals.css", import.meta.url), "utf8");
      const spec = readFileSync(process.argv[3] ?? new URL("../../docs/design-system/spec.md", import.meta.url), "utf8");
      const { missing, undeclared, invalid } = evaluateDesignSpec({ css, spec });
      const findings = [...missing, ...undeclared, ...invalid];
      for (const finding of findings) console.error(finding);
      if (findings.length) process.exitCode = 1;
    } catch (error) {
      console.error(`Design spec error: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
      process.exitCode = 1;
    }
  }
}

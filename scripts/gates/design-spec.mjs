import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseGlobalsCss } from "./globals-css-allowlist.mjs";
import { repositoryStoryFiles, storyIdsFromFiles } from "./story-references.mjs";

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

const planned = "planned: PR 3";
const textureNames = ["Settled", "Working", "Needs you", "Can't load", "Failed, recoverable", "Done", "Loading"];
const templateNames = ["Destination", "Row", "Facts", "Money flow", "First use", "Detail"];
const tableHeaders = {
  "Status texture": ["Texture", "Color", "Mark", "Motion", "Placement and copy", "Component", "Story"],
  Templates: ["Template", "Structure", "Component", "Story"],
};

function tableCells(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((cell) => cell.trim());
}

export function evaluateDesignSpecReferences({ spec, componentExists, storyExists }) {
  const findings = [];
  const lines = spec.split(/\r?\n/);
  const templateRows = new Set();
  for (const [section, headers] of Object.entries(tableHeaders)) {
    const headings = lines.flatMap((line, index) => line.trim() === `## ${section}` ? [index] : []);
    if (headings.length !== 1) {
      findings.push(`${section}: expected one section; add a single ## ${section} heading and its table.`);
      continue;
    }
    const start = headings[0] + 1;
    const next = lines.findIndex((line, index) => index >= start && /^##\s/.test(line));
    const end = next === -1 ? lines.length : next;
    const tables = [];
    for (let index = start; index < end - 1; index++) {
      if (!lines[index].trim().startsWith("|")) continue;
      const cells = tableCells(lines[index]);
      const divider = tableCells(lines[index + 1]);
      if (cells.length === headers.length && cells.every((cell, i) => cell === headers[i]) &&
        divider.length === headers.length && divider.every((cell) => /^:?-{3,}:?$/.test(cell))) tables.push(index);
    }
    if (tables.length !== 1) {
      findings.push(`${section}: expected one table with ${headers.join(" | ")}; restore its header and separator.`);
      continue;
    }
    const names = [];
    for (let index = tables[0] + 2; index < end && lines[index].trim().startsWith("|"); index++) {
      if (section === "Templates") templateRows.add(index);
      const cells = tableCells(lines[index]);
      const name = cells[0] || `(unnamed row at line ${index + 1})`;
      const row = `${section} / ${name}`;
      names.push(cells[0]);
      if (cells.length !== headers.length) findings.push(`${row}: expected ${headers.length} cells; restore every column (escape literal pipes).`);
      const component = cells[headers.indexOf("Component")] ?? "";
      const story = cells[headers.indexOf("Story")] ?? "";
      if (section === "Templates" && cells.slice(0, 2).some((cell) => cell.includes(planned))) {
        findings.push(`${row}: ${planned} belongs only in Component and Story; replace it with the template structure.`);
      }
      if (section === "Templates" && (component.includes(planned) || story.includes(planned))) {
        if (component !== `\`${planned}\`` || story !== `\`${planned}\``) {
          findings.push(`${row}: use \`${planned}\` in both Component and Story, or replace both with existing references.`);
        }
        continue;
      }
      for (const [column, cell, exists] of [["Component", component, componentExists], ["Story", story, storyExists]]) {
        if (!cell) {
          findings.push(`${row}: missing ${column}; add a backticked ${column === "Component" ? "path relative to apps/web" : "Storybook story id"}.`);
          continue;
        }
        const references = [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
        if (!references.length || cell.replace(/`[^`]+`/g, "").replace(/(?:\s|,|;|<br\s*\/?>)+/g, "")) {
          findings.push(`${row}: invalid ${column} cell; use backticked ${column === "Component" ? "paths relative to apps/web" : "Storybook story ids"} separated by commas.`);
          continue;
        }
        for (const reference of references) {
          if (reference.includes(planned)) continue;
          if (column === "Component" && (path.posix.isAbsolute(reference) || reference.includes("\\") ||
            reference.split("/").some((part) => !part || part === "." || part === "..") || reference.startsWith("apps/web/"))) {
            findings.push(`${row}: Component ${reference} is not a path under apps/web; use a path relative to apps/web without traversal.`);
          } else if (!exists(reference)) {
            findings.push(`${row}: ${column} ${reference} does not ${column === "Component" ? "exist under apps/web; restore the file or update its path" : "resolve to an exported story; update the id from the story meta and export"}.`);
          }
        }
      }
    }
    if (section === "Status texture" && (names.length !== textureNames.length || names.some((name, i) => name !== textureNames[i]))) {
      findings.push(`Status texture rows (${names.join(", ")}): restore exactly ${textureNames.join(" → ")} in that order.`);
    }
    if (section === "Templates") {
      for (const name of templateNames) {
        if (!names.includes(name)) findings.push(`Templates / ${name}: missing template; add its Structure, Component and Story row.`);
        else if (names.filter((entry) => entry === name).length > 1) findings.push(`Templates / ${name}: duplicate template; keep one row.`);
      }
    }
  }
  for (const [index, line] of lines.entries()) {
    if (line.includes(planned) && !templateRows.has(index)) {
      const row = line.trim().startsWith("|") ? tableCells(line)[0] : `line ${index + 1}`;
      findings.push(`${row}: ${planned} is allowed only in the Templates table's paired Component and Story cells; replace it with existing references or remove it.`);
    }
  }
  return findings.sort();
}

export function repositoryDesignSpecReferenceFindings(repoRoot, spec) {
  const { ids, findings } = storyIdsFromFiles(repositoryStoryFiles(repoRoot));
  return [...findings, ...evaluateDesignSpecReferences({
    spec,
    componentExists: (file) => statSync(path.join(repoRoot, "apps/web", file), { throwIfNoEntry: false })?.isFile() ?? false,
    storyExists: (id) => ids.has(id),
  })];
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
      const references = repositoryDesignSpecReferenceFindings(fileURLToPath(new URL("../..", import.meta.url)), spec);
      const findings = [...missing, ...undeclared, ...invalid, ...references];
      for (const finding of findings) console.error(finding);
      if (findings.length) process.exitCode = 1;
    } catch (error) {
      console.error(`Design spec error: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
      process.exitCode = 1;
    }
  }
}

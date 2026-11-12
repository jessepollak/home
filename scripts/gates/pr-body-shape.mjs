import { realpathSync, statSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { visibleMarkdownLines } from "./failure-cases.mjs";

const factoryTitle = /^(?:product|design|feat|fix|test|ops|dx|docs|chore)(?:\([^)]+\))?!?:/;
const allowedHeadings = new Set([
  "What changes", "Preview", "Verification", "State transitions", "Test plan", "Review", "Real money", "Operator action required",
]);
const labels = ["Before", "After", "Who notices", "Your call", "Risk"];
const tableHeader = /^\|[ \t]*\|[ \t]*Summary[ \t]*\|?[ \t]*$/;
const tableSeparator = /^\|?[ \t:|-]+\|?[ \t]*$/;
const tableBlockStart = /^ {0,3}(?:#{1,6}(?:[ \t]|$)|>|[-*+][ \t]|\d+[.)][ \t]|-{3,}[ \t]*$|\*{3,}[ \t]*$|_{3,}[ \t]*$)/;
const htmlBlockStart = /^ {0,3}<(?:address|article|aside|audio|base|basefont|blockquote|body|canvas|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|embed|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|math|menu|menuitem|nav|noframes|object|ol|optgroup|option|p|param|picture|pre|script|search|section|source|style|summary|svg|table|tbody|td|textarea|tfoot|th|thead|title|tr|track|ul|video|xmp)\b/i;
const tableRow = /^\|[ \t]*\*\*([^*|]+)\*\*[ \t]*\|(.*?)\|?[ \t]*$/;
const placeholders = new Set([
  "What happens today, in plain words.",
  "What happens once this merges.",
  "users / developers (name the command, job, or file) / operators / nobody (refactor)",
]);

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function referenceId(value) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function referenceDefinitions(lines) {
  const definitions = new Map();
  let previousWasDefinition = false;
  for (let index = 0; index < lines.length;) {
    const match = /^ {0,3}\[((?:\\.|[^\]\\])+)\]:[ \t]*(?:<([^<>\r\n]+)>|((?!\[)\S+))?(?:[ \t]+("[^"\r\n]*"|'[^'\r\n]*'|\([^()\r\n]*\)))?[ \t]*$/.exec(lines[index]);
    const sameLine = match?.[2] ?? match?.[3];
    const continuation = match && !sameLine ? /^[ \t]*(?:<([^<>\r\n]+)>|((?!\[)\S+))(?:[ \t]+("[^"\r\n]*"|'[^'\r\n]*'|\([^()\r\n]*\)))?[ \t]*$/.exec(lines[index + 1] ?? "") : null;
    const destination = sameLine ?? continuation?.[1] ?? continuation?.[2];
    const hasTitle = Boolean(match?.[4] ?? continuation?.[3]);
    const startsBlock = index === 0 || !lines[index - 1].trim() || /^ {0,3}#{1,6}(?:[ \t]|$)/.test(lines[index - 1]) || /^ {0,3}(?:-{3,}|\*{3,}|_{3,})[ \t]*$/.test(lines[index - 1]) || /^ {0,3}(?:>|[-*+]|\d+[.)])[ \t]*$/.test(lines[index - 1]) || previousWasDefinition;
    if (match && destination && startsBlock) {
      const id = referenceId(match[1]);
      if (!definitions.has(id)) definitions.set(id, destination);
      previousWasDefinition = true;
      let consumed = continuation ? 2 : 1;
      if (!hasTitle && /^[ \t]*(?:"[^"\r\n]*"|'[^'\r\n]*'|\([^()\r\n]*\))[ \t]*$/.test(lines[index + consumed] ?? "")) consumed++;
      index += consumed;
    } else {
      previousWasDefinition = false;
      index++;
    }
  }
  return definitions;
}

function imageSource(tag) {
  let index = 4;
  while (index < tag.length) {
    while (index < tag.length && /[\s/]/.test(tag[index])) index++;
    const start = index;
    while (index < tag.length && !/[\s=/>]/.test(tag[index])) index++;
    const name = tag.slice(start, index).toLowerCase();
    while (index < tag.length && /\s/.test(tag[index])) index++;
    let value = "";
    if (tag[index] === "=") {
      index++;
      while (index < tag.length && /\s/.test(tag[index])) index++;
      const quote = tag[index];
      if (quote === '"' || quote === "'") {
        const valueStart = ++index;
        while (index < tag.length && tag[index] !== quote) index++;
        value = tag.slice(valueStart, index);
        index++;
      } else {
        const valueStart = index;
        while (index < tag.length && !/[\s>]/.test(tag[index])) index++;
        value = tag.slice(valueStart, index);
      }
    }
    if (name === "src") return value;
    if (start === index) index++;
  }
  return null;
}

function quotedTitleEnd(line, index) {
  const open = line[index];
  const close = open === "(" ? ")" : open;
  if (open !== '"' && open !== "'" && open !== "(") return -1;
  for (let cursor = index + 1; cursor < line.length; cursor++) {
    const char = line[cursor];
    if (char === "\\") cursor++;
    else if (char === close) return cursor + 1;
    else if (open === "(" && char === "(") return -1;
  }
  return -1;
}

const maxDestinationDepth = 32;

function inlineDestination(line, start) {
  let index = start;
  while (line[index] === " " || line[index] === "\t") index++;
  let destination;
  if (line[index] === "<") {
    const destinationStart = ++index;
    while (index < line.length && line[index] !== ">") {
      if (line[index] === "<") return null;
      index += line[index] === "\\" ? 2 : 1;
    }
    if (line[index] !== ">") return null;
    destination = line.slice(destinationStart, index++);
  } else {
    const destinationStart = index;
    let depth = 0;
    while (index < line.length && !/\s/.test(line[index])) {
      const char = line[index];
      if (char === "\\") {
        index += 2;
        continue;
      }
      if (char === "(" && ++depth > maxDestinationDepth) return null;
      else if (char === ")" && --depth < 0) break;
      index++;
    }
    if (depth > 0) return null;
    destination = line.slice(destinationStart, index);
  }
  const afterDestination = index;
  while (line[index] === " " || line[index] === "\t") index++;
  if (index > afterDestination && line[index] !== ")") {
    const titleEnd = quotedTitleEnd(line, index);
    if (titleEnd === -1) return null;
    index = titleEnd;
    while (line[index] === " " || line[index] === "\t") index++;
  }
  return line[index] === ")" ? { destination, end: index + 1 } : null;
}

const maxLabelLength = 999 * 2;

function referenceLabelEnd(line, start) {
  for (let index = start; index < line.length && index - start <= maxLabelLength; index++) {
    const char = line[index];
    if (char === "\\") index++;
    else if (char === "[") return -1;
    else if (char === "]") return index;
  }
  return -1;
}

function skipCodeSpan(line, index) {
  let end = index;
  while (line[end] === "`") end++;
  const fence = line.slice(index, end);
  let close = line.indexOf(fence, end);
  while (close !== -1 && (line[close - 1] === "`" || line[close + fence.length] === "`")) close = line.indexOf(fence, close + 1);
  return close === -1 ? end : close + fence.length;
}

function markdownImages(line, definitions) {
  const images = [];
  const open = [];
  let linkFloor = 0;
  for (let index = 0; index < line.length;) {
    const char = line[index];
    if (char === "\\") {
      index += 2;
    } else if (char === "`") {
      index = skipCodeSpan(line, index);
    } else if (char === "[" || (char === "!" && line[index + 1] === "[")) {
      const bracket = char === "[" ? index : index + 1;
      open.push({ bracket, start: index, image: char === "!", position: open.length });
      index = bracket + 1;
    } else if (char === "]" && open.length) {
      const opener = open.pop();
      const inactive = !opener.image && opener.position < linkFloor;
      linkFloor = Math.min(linkFloor, open.length);
      if (inactive) {
        index++;
        continue;
      }
      const textLength = index - opener.bracket - 1;
      const text = textLength <= maxLabelLength ? line.slice(opener.bracket + 1, index) : null;
      const next = line[index + 1];
      let end = index + 1;
      let resolved = false;
      let target;
      if (next === "(") {
        const parsed = inlineDestination(line, index + 2);
        if (parsed) {
          resolved = true;
          target = parsed.destination;
          end = parsed.end;
        }
      } else {
        let label = text;
        if (next === "[") {
          const labelEnd = referenceLabelEnd(line, index + 2);
          if (labelEnd !== -1) {
            const explicit = line.slice(index + 2, labelEnd);
            if (explicit.trim()) label = explicit;
            if (label !== null && definitions.has(referenceId(label))) end = labelEnd + 1;
          }
        }
        if (label !== null) {
          target = definitions.get(referenceId(label));
          resolved = target !== undefined || opener.image;
          if (resolved && target === undefined) target = { undefinedLabel: label.trim() };
        }
      }
      if (resolved && opener.image) {
        while (images.length && images.at(-1).index > opener.start) images.pop();
        images.push(typeof target === "string" ? { reference: target, index: opener.start } : { ...target, index: opener.start });
      } else if (resolved) {
        linkFloor = open.length;
      }
      index = end;
    } else {
      index++;
    }
  }
  return images;
}

function mediaReferences(line, definitions) {
  const references = markdownImages(line, definitions);
  for (const image of line.matchAll(/<img\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi)) {
    const reference = imageSource(image[0]);
    if (reference !== null) references.push({ reference, index: image.index });
  }
  for (const match of line.matchAll(/https:\/\/(?:github\.com\/user-attachments\/assets\/|user-images\.githubusercontent\.com\/)[^\s<>"'`|)\]]+/g)) {
    references.push({ reference: match[0], index: match.index });
  }
  const seen = new Set();
  return references.sort((a, b) => a.index - b.index).filter((entry) => {
    const key = entry.undefinedLabel === undefined ? `r:${entry.reference}` : `u:${referenceId(entry.undefinedLabel)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mediaResolves(reference) {
  try {
    const url = new URL(reference);
    if (url.protocol === "https:" && (
      (url.host === "github.com" && url.pathname.startsWith("/user-attachments/assets/") && url.pathname.split("/").at(-1))
      || (url.host === "user-images.githubusercontent.com" && url.pathname.length > 1)
    )) return true;
  } catch {}
  if (!reference || /^[a-z][a-z0-9+.-]*:/i.test(reference) || reference.startsWith("/")) return false;
  try {
    const file = resolve(repositoryRoot, decodeURIComponent(reference.split(/[?#]/, 1)[0]));
    if (!file.startsWith(`${repositoryRoot}${sep}`)) return false;
    const canonicalRoot = realpathSync(repositoryRoot);
    const canonicalFile = realpathSync(file);
    return canonicalFile.startsWith(`${canonicalRoot}${sep}`) && statSync(canonicalFile).isFile();
  } catch {
    return false;
  }
}

function tableRowIndexes(lines) {
  const headers = new Set();
  const rows = new Set();
  let coveredUntil = -1;
  for (let index = 0; index < lines.length; index++) {
    if (index <= coveredUntil) continue;
    const line = lines[index];
    if (!line.includes("|") || !tableSeparator.test(line.trim())) continue;
    let header = index - 1;
    while (header >= 0 && !lines[header].trim()) header--;
    if (header < 0 || !lines[header].includes("|") || tableSeparator.test(lines[header].trim())) continue;
    headers.add(header);
    let row = index + 1;
    for (; row < lines.length; row++) {
      const candidate = lines[row];
      if (!candidate.trim() || tableBlockStart.test(candidate) || htmlBlockStart.test(candidate)) break;
      if (!tableSeparator.test(candidate.trim())) rows.add(row);
    }
    coveredUntil = row - 1;
  }
  return { headers, rows };
}

function visibleReason(value) {
  return value
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<(?:"[^"]*"|'[^']*'|[^'">])*>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => { try { return String.fromCodePoint(parseInt(hex, 16)); } catch { return " "; } })
    .replace(/&#(\d+);/g, (_, dec) => { try { return String.fromCodePoint(Number(dec)); } catch { return " "; } })
    .replace(/&(nbsp|amp|lt|gt|quot|apos|mdash|ndash|hellip);/gi, (_, name) => ({ nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", mdash: "—", ndash: "–", hellip: "…" })[name.toLowerCase()])
    .replace(/&[#a-z0-9]+;/gi, " ");
}

function unchangedReason(line) {
  const match = /Preview unchanged\b([^|]*)/.exec(line);
  if (!match) return false;
  return /[A-Za-z0-9]/.test(visibleReason(match[1]));
}

function previewFindings(content, definitions) {
  const details = content.findIndex((line) => /^\s*<details\b/i.test(line));
  const lines = details === -1 ? content : content.slice(0, details);
  if (lines.some((line) => /^N\/A:[ \t]*\S/.test(line.trim()))) return [];
  if (lines.some((line) => line.trim().startsWith("N/A:"))) {
    return ["## Preview N/A needs a reason (docs-only, CI-only, or pure server)."];
  }
  const { headers, rows } = tableRowIndexes(lines);
  const findings = [];
  for (const [index, line] of lines.entries()) {
    const leading = line.trimStart().startsWith("|");
    const isSeparator = tableSeparator.test(line.trim());
    const isHeader = headers.has(index);
    const isRow = (leading || rows.has(index)) && !isSeparator && !isHeader;
    const label = (leading ? line.trimStart().slice(1) : line.trim()).split("|")[0].replaceAll("**", "").trim() || "(no label)";
    const references = mediaReferences(line, definitions);
    let hasMedia = false;
    for (const { reference, undefinedLabel } of references) {
      if (undefinedLabel !== undefined) {
        findings.push(`## Preview image reference [${undefinedLabel}] has no definition${isRow ? ` in row "${label}"` : ""}.`);
      } else if (mediaResolves(reference)) {
        hasMedia = true;
      } else {
        findings.push(`## Preview image ${reference || "(empty reference)"}${isRow ? ` in row "${label}"` : ""} does not resolve to a GitHub attachment or an existing repository file.`);
      }
    }
    if (isRow && !hasMedia && !unchangedReason(line)) {
      findings.push(`## Preview row "${label}" needs media or the exact phrase \`Preview unchanged\` with a reason.`);
    }
  }
  return findings;
}

export function prBodyShapeFindings(title, body) {
  if (!factoryTitle.test(title)) return [];
  const lines = visibleMarkdownLines(body);
  const headings = lines.flatMap((line, index) => {
    const match = /^ {0,3}##[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/.exec(line);
    return match ? [{ name: match[1].trim(), index }] : [];
  });
  const findings = [];
  const section = headings.find((heading) => heading.name === "What changes");
  if (!section) {
    findings.push("PR body needs a visible ## What changes section.");
  } else {
    if (section !== headings[0]) findings.push("## What changes must be the first level-two heading.");
    const next = headings.find((heading) => heading.index > section.index);
    const content = lines.slice(section.index + 1, next?.index ?? lines.length);
    const prose = content.filter((line) => !tableSeparator.test(line)).join("\n").replace(/\|/g, " ");
    const words = prose.match(/\S+/g)?.length ?? 0;
    if (words > 200) findings.push(`## What changes has ${words} words; the limit is 200.`);
    const header = content.findIndex((line) => tableHeader.test(line));
    if (header === -1 || !tableSeparator.test(content[header + 1] ?? "")) {
      findings.push("## What changes needs a `| | Summary |` table with Before, After, Who notices, Your call, and Risk rows.");
    } else {
      const rows = new Map();
      for (const line of content.slice(header + 2)) {
        const match = tableRow.exec(line.trim());
        if (!match) break;
        rows.set(match[1].trim(), match[2].trim());
      }
      for (const label of labels) {
        const value = rows.get(label);
        if (!value || placeholders.has(value)) findings.push(`## What changes needs a \`| **${label}** | … |\` row with text that is not a template placeholder.`);
      }
    }
  }
  for (const heading of headings) {
    if (!allowedHeadings.has(heading.name)) findings.push(`Disallowed level-two heading: ${heading.name || "(empty)"}.`);
  }
  const preview = headings.find((heading) => heading.name === "Preview");
  if (preview) {
    const next = headings.find((heading) => heading.index > preview.index);
    findings.push(...previewFindings(lines.slice(preview.index + 1, next?.index ?? lines.length), referenceDefinitions(lines)));
  }
  return findings;
}

function main() {
  if (process.argv.length !== 2) throw new Error("Usage: node scripts/gates/pr-body-shape.mjs");
  const findings = prBodyShapeFindings(process.env.PR_TITLE || "", process.env.PR_BODY || "");
  console.log("## PR body shape");
  if (findings.length === 0) {
    console.log("PR body shape gate passed.");
    return;
  }
  for (const finding of findings) console.log(`- ${finding}`);
  if (findings.some((finding) => finding.startsWith("## Preview"))) {
    console.log('Preview media: a GitHub attachment (github.com/user-attachments/assets or user-images.githubusercontent.com) or an existing repository-relative file; a row without media needs the exact phrase "Preview unchanged" plus a reason.');
  }
  process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();

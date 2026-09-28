import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { formControlHasAllowlist, hasSelectorFindings, subjectPrefix } from "../../apps/web/oxlint/policy/has-selectors.mjs";

const webDir = fileURLToPath(new URL("../../apps/web/", import.meta.url));
const defaultBuildDir = path.join(webDir, ".next");
const nonProductionBuildDirs = new Set(["cache", "dev"]);

function unescapeCss(value) {
  return value.replace(/\\(?:([a-f\d]{1,6})(?:\r\n|[ \t\n\r\f])?|([^\r\n\f]))/gi, (_match, hex, escaped) =>
    hex ? String.fromCodePoint(Math.min(parseInt(hex, 16) || 0xfffd, 0x10ffff)) : escaped);
}

function afterEscape(text, index) {
  const hex = /^[a-f\d]{1,6}(?:\r\n|[ \t\n\r\f])?/i.exec(text.slice(index + 1));
  return hex ? index + 1 + hex[0].length : Math.min(index + 2, text.length);
}

function balancedArgument(text, open) {
  let depth = 1;
  let bracket = 0;
  let quote = null;
  let hasCombinator = false;
  for (let i = open + 1; i < text.length; i++) {
    const char = text[i];
    if (char === "\\") { i = afterEscape(text, i) - 1; continue; }
    if (quote) { if (char === quote) quote = null; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === "/" && text[i + 1] === "*") {
      const close = text.indexOf("*/", i + 2);
      if (close < 0) return null;
      i = close + 1;
      continue;
    }
    if (char === "[") { bracket++; continue; }
    if (char === "]" && bracket) { bracket--; continue; }
    if (bracket) continue;
    if (char === "(") { depth++; continue; }
    if (char === ")") {
      if (--depth === 0) return { end: i, single: !hasCombinator };
      continue;
    }
    if (depth === 1 && /[\s>+~,]/.test(char)) hasCombinator = true;
  }
  return null;
}

function ownerClass(prefix) {
  let bracket = 0;
  let quote = null;
  for (let i = 0; i < prefix.length; i++) {
    const char = prefix[i];
    if (char === "\\") { i = afterEscape(prefix, i) - 1; continue; }
    if (quote) { if (char === quote) quote = null; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === "/" && prefix[i + 1] === "*") {
      const close = prefix.indexOf("*/", i + 2);
      if (close < 0) break;
      i = close + 1;
      continue;
    }
    if (char === "[") { bracket++; continue; }
    if (char === "]" && bracket) { bracket--; continue; }
    if (bracket) continue;
    if (char === ":") {
      const match = /^:(is|where|not)\(/i.exec(prefix.slice(i));
      if (match) {
        const open = i + match[0].length - 1;
        const argument = balancedArgument(prefix, open);
        if (!argument) break;
        if (match[1].toLowerCase() !== "not" && argument.single) {
          const found = ownerClass(prefix.slice(open + 1, argument.end));
          if (found) return found;
        }
        i = argument.end;
        continue;
      }
    }
    if (char === "(") {
      const argument = balancedArgument(prefix, i);
      if (!argument) break;
      i = argument.end;
      continue;
    }
    if (char !== ".") continue;
    let end = i + 1;
    while (end < prefix.length) {
      if (prefix[end] === "\\") end = afterEscape(prefix, end);
      else if (/[^\w-]/.test(prefix[end]) && prefix[end].codePointAt(0) < 128) break;
      else end++;
    }
    if (end > i + 1) return unescapeCss(prefix.slice(i + 1, end));
  }
  return null;
}

export function firstClassBeforeHas(finding) {
  return ownerClass(subjectPrefix(finding.selector, finding.index));
}

const HAS_VARIANT = /(?:^|:)(?:[\w-]*-)?has-[^\s:]*:\S|(?:^|:)\[&:has\([^\s]*\]:\S/i;
const GROUP_MARKER = /^(?:group|peer)\/[\w-]+$/;

export function isHasClassToken(token) {
  return HAS_VARIANT.test(token) || GROUP_MARKER.test(token);
}

function classTokens(source) {
  const tokens = new Set();
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i++;
    } else if (source[i] === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      if (end < 0) break;
      i = end + 1;
    } else if (source[i] === '"' || source[i] === "'" || source[i] === "`") {
      const quote = source[i];
      let value = "";
      for (i++; i < source.length && source[i] !== quote; i++) {
        if (source[i] === "\\" && i + 1 < source.length) i++;
        value += source[i];
      }
      for (const token of value.split(/\s+/)) if (isHasClassToken(token)) tokens.add(token);
    }
  }
  return tokens;
}

export function collectBuiltCssFindings(files, allowedSources) {
  const allowedClasses = new Set([...allowedSources.values()].flatMap((source) => [...classTokens(source)]));
  const findings = [];
  for (const { path: file, content } of files) {
    for (const finding of hasSelectorFindings(content)) {
      if (finding.kind === "descendant") {
        const className = firstClassBeforeHas(finding);
        if (className && allowedClasses.has(className)) continue;
      }
      findings.push({ path: file, kind: finding.kind, selector: finding.selector });
    }
  }
  return findings;
}

export async function checkBuiltCss(dir = defaultBuildDir) {
  const files = [];
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (current === dir && nonProductionBuildDirs.has(entry.name)) continue;
        await walk(absolute);
      } else if (entry.isFile() && entry.name.endsWith(".css")) {
        files.push({ path: path.relative(dir, absolute).split(path.sep).join("/"), content: await readFile(absolute, "utf8") });
      }
    }
  }
  try { await walk(dir); }
  catch (error) {
    if (error.code === "ENOENT") throw new Error(`No built CSS found in ${dir}; run bun run build first.`, { cause: error });
    throw error;
  }
  if (!files.length || !files.some(({ content }) => content.trim().length)) throw new Error(`No built CSS found in ${dir}; run bun run build first.`);
  const allowedSources = new Map(await Promise.all([...formControlHasAllowlist.keys()].map(async (file) =>
    [file, await readFile(path.join(webDir, file), "utf8")])));
  return { files, findings: collectBuiltCssFindings(files, allowedSources) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { files, findings } = await checkBuiltCss(process.argv[2]);
    for (const finding of findings) console.error(`${finding.path}: ${finding.kind} :has() in ${finding.selector}`);
    if (findings.length) process.exitCode = 1;
    else console.log(`Built CSS guard passed (${files.length} CSS files).`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

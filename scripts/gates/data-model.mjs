// Migration-created tables must appear in the architecture data-model inventory.
// An exemption needs a reason and fails once the table disappears or is documented.

import { readFileSync, readdirSync } from "node:fs";
import { join, posix } from "node:path";

const migrationDirectories = ["apps/web/server/db/migrations", "apps/web/server/funding/migrations"];

// PostgreSQL executes a quoted body only in a DO block, a function or procedure
// body, or a statically known EXECUTE argument. The same text inside VALUES is
// data, so it is never scanned as SQL. Dynamic SQL inside a body is rejected
// rather than skipped, because a table behind EXECUTE format(...) would
// otherwise bypass the inventory.
const executableAfter = new Set(["as", "do", "execute"]);

// lineAt returns the 1-based line of index, given how many lines precede content.
function lineAt(content, index, linesBefore) {
  return linesBefore + content.slice(0, index).split("\n").length;
}
// PostgreSQL decodes an E-string's backslash escapes before executing it, so the
// body is scanned decoded; a decoded newline shifts later reported lines.
const escapeLetters = { b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v" };

function decodeEscapes(raw) {
  return raw.replace(
    /\\(?:x([0-9A-Fa-f]{1,2})|u([0-9A-Fa-f]{4})|U([0-9A-Fa-f]{8})|([0-7]{1,3})|([\s\S]))/g,
    (match, hex, unicode, longUnicode, octal, character) => {
      if (hex) return String.fromCodePoint(parseInt(hex, 16));
      if (unicode) return String.fromCodePoint(parseInt(unicode, 16));
      if (longUnicode) return String.fromCodePoint(parseInt(longUnicode, 16));
      if (octal) return String.fromCodePoint(parseInt(octal, 8));
      return escapeLetters[character] ?? character;
    },
  );
}


function scanSql(content, { inBody = false, linesBefore = 0 } = {}) {
  const streams = [[]];
  const dynamicSql = [];
  const searchPath = [];
  const unreadable = [];
  const [tokens] = streams;
  let pendingLine = null;
  let pendingLiteralLine = null;
  let index = 0;

  // A literal argument is only an EXECUTE target when the statement ends right
  // after it; a following operator or call makes the argument an expression,
  // which the gate cannot read and therefore rejects.
  const settleLiteral = (token) => {
    if (pendingLiteralLine === null) return;
    const line = pendingLiteralLine;
    pendingLiteralLine = null;
    const ends = token === null
      || (token.kind === "punctuation" && [";", ")"].includes(token.value))
      || (token.kind === "word" && ["into", "using"].includes(token.value));
    if (!ends) dynamicSql.push(line);
  };

  const push = (token, at = index) => {
    const previous = tokens[tokens.length - 1];
    if (token.kind === "punctuation" && token.value === "string"
      && previous?.kind === "punctuation" && previous.value === "string"
      && /[\r\n]/.test(content.slice(previous.end, at))) {
      unreadable.push(lineAt(content, at, linesBefore));
    }
    settleLiteral(token);
    if (pendingLine !== null) {
      const line = pendingLine;
      pendingLine = null;
      const literal = token.kind === "punctuation" && ["string", "dollar body"].includes(token.value);
      const triggerClause = token.kind === "word" && ["function", "procedure"].includes(token.value);
      if (literal) pendingLiteralLine = line;
      else if (!triggerClause) dynamicSql.push(line);
    }
    tokens.push({ ...token, at });
  };

  const executable = () => {
    const previous = tokens[tokens.length - 1];
    return (previous?.kind === "word" && executableAfter.has(previous.value))
      || (keyword(tokens[tokens.length - 3], "do")
        && keyword(tokens[tokens.length - 2], "language")
        && (tableName(previous) !== null || (previous?.kind === "punctuation" && ["string", "dollar body"].includes(previous.value))));
  };

  const scanBody = (raw, at) => {
    const nested = scanSql(raw, { inBody: true, linesBefore: lineAt(content, at, linesBefore) - 1 });
    streams.push(...nested.streams);
    dynamicSql.push(...nested.dynamicSql);
    searchPath.push(...nested.searchPath);
    unreadable.push(...nested.unreadable);
  };

  while (index < content.length) {
    const character = content[index];
    if (/\s/.test(character)) {
      index += 1;
    } else if (content.startsWith("--", index)) {
      index = content.indexOf("\n", index + 2);
      if (index < 0) break;
    } else if (content.startsWith("/*", index)) {
      let depth = 1;
      index += 2;
      while (index < content.length && depth) {
        if (content.startsWith("/*", index)) {
          depth += 1;
          index += 2;
        } else if (content.startsWith("*/", index)) {
          depth -= 1;
          index += 2;
        } else {
          index += 1;
        }
      }
    } else if (/^[uU]&['"]/.test(content.slice(index, index + 3))) {
      unreadable.push(lineAt(content, index, linesBefore));
      index += 2;
    } else if (character === "'") {
      const escapes = content[index - 1] === "E" || content[index - 1] === "e";
      index += 1;
      const start = index;
      let closed = false;
      while (index < content.length) {
        if (escapes && content[index] === "\\") {
          index += 2;
        } else if (content.startsWith("''", index)) {
          index += 2;
        } else if (content[index] === "'") {
          closed = true;
          index += 1;
          break;
        } else {
          index += 1;
        }
      }
      const body = content.slice(start, closed ? index - 1 : index);
      const unquoted = body.replaceAll("''", "'");
      const text = escapes ? decodeEscapes(unquoted) : unquoted;
      if (executable()) scanBody(text, start);
      push({ kind: "punctuation", value: "string", text, end: index }, start - 1);
    } else if (character === '"') {
      const start = index++;
      while (index < content.length) {
        if (content.startsWith('""', index)) {
          index += 2;
        } else if (content[index++] === '"') {
          break;
        }
      }
      push({ kind: "quoted", value: content.slice(start + 1, index - 1).replaceAll('""', '"') }, start);
    } else if (character === "$") {
      const delimiter = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(content.slice(index))?.[0];
      const end = delimiter ? content.indexOf(delimiter, index + delimiter.length) : -1;
      if (end >= 0) {
        if (executable()) scanBody(content.slice(index + delimiter.length, end), index);
        push({ kind: "punctuation", value: "dollar body" });
        index = end + delimiter.length;
      } else {
        push({ kind: "punctuation", value: character });
        index += 1;
      }
    } else if (/[A-Za-z_]/.test(character)) {
      const start = index++;
      while (index < content.length && /[A-Za-z0-9_$]/.test(content[index])) index += 1;
      const value = content.slice(start, index).toLowerCase();
      // The E prefix of an E-string belongs to the literal, not to the tokens
      // before it, so a body after AS or EXECUTE still reads as executable.
      if (!(value === "e" && content[index] === "'")) {
        push({ kind: "word", value }, start);
        if (inBody && value === "execute") pendingLine = lineAt(content, start, linesBefore);
      }
    } else {
      push({ kind: "punctuation", value: character });
      index += 1;
    }
  }
  settleLiteral(null);
  searchPath.push(...searchPathChanges(tokens).map((at) => lineAt(content, at, linesBefore)));
  searchPath.sort((a, b) => a - b);
  unreadable.sort((a, b) => a - b);
  return { streams, dynamicSql, searchPath, unreadable };
}

function keyword(token, value) {
  return token?.kind === "word" && token.value === value;
}

function tableName(token) {
  return token?.kind === "word" || token?.kind === "quoted" ? token.value : null;
}

const protectedSettings = new Set(["search_path", "standard_conforming_strings"]);

function isUpdateAssignment(tokens, index) {
  for (let offset = 1; offset <= 8 && index - offset >= 0; offset += 1) {
    const token = tokens[index - offset];
    const previous = tokens[index - offset - 1];
    if (keyword(token, "update") && !(previous?.kind === "punctuation" && previous.value === ".")) {
      return !keyword(previous, "for") && !keyword(previous, "key");
    }
    if (tableName(token) === null && !(token.kind === "punctuation" && [".", "*"].includes(token.value))) return false;
  }
  return false;
}

function searchPathChanges(tokens) {
  const positions = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    let next = index + 1;
    if (keyword(token, "set") && !isUpdateAssignment(tokens, index)) {
      if (keyword(tokens[next], "session") || keyword(tokens[next], "local")) next += 1;
      if (keyword(tokens[next], "schema") || protectedSettings.has(tableName(tokens[next])?.toLowerCase())) positions.push(token.at);
    }
    if (tableName(token)?.toLowerCase() !== "set_config"
      || tokens[index + 1]?.kind !== "punctuation" || tokens[index + 1].value !== "(") continue;
    const argument = tokens[index + 2];
    const separator = tokens[index + 3];
    const plainLiteral = argument?.kind === "punctuation" && argument.value === "string"
      && separator?.kind === "punctuation" && [",", ")"].includes(separator.value);
    if (!plainLiteral || protectedSettings.has(argument.text.trim().toLowerCase())) positions.push(token.at);
  }
  return positions;
}

function createdTables(tokens) {
  const names = [];
  let schema = null;
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].kind === "punctuation" && tokens[index].value === ";") schema = null;
    if (!keyword(tokens[index], "create")) continue;
    let next = index + 1;
    if (keyword(tokens[next], "schema")) {
      next += 1;
      if (keyword(tokens[next], "if") && keyword(tokens[next + 1], "not") && keyword(tokens[next + 2], "exists")) next += 3;
      schema = tableName(tokens[keyword(tokens[next], "authorization") ? next + 1 : next]);
      continue;
    }
    if (["unlogged", "temp", "temporary"].some((value) => keyword(tokens[next], value))) next += 1;
    if (!keyword(tokens[next++], "table")) continue;
    if (keyword(tokens[next], "if") && keyword(tokens[next + 1], "not") && keyword(tokens[next + 2], "exists")) next += 3;
    const first = tableName(tokens[next++]);
    if (first === null) continue;
    let name = schema === null || schema === "public" ? first : `${schema}.${first}`;
    if (tokens[next]?.kind === "punctuation" && tokens[next].value === ".") {
      const second = tableName(tokens[next + 1]);
      if (second === null) continue;
      name = first === "public" ? second : `${first}.${second}`;
      next += 2;
    }
    if (keyword(tokens[next], "partition") && keyword(tokens[next + 1], "of")) continue;
    names.push(name);
  }
  return names;
}

export function analyzeMigrations(files) {
  const tables = new Map();
  const dynamicSql = [];
  const searchPath = [];
  const unreadable = [];
  for (const file of files) {
    const scanned = scanSql(file.content);
    for (const tokens of scanned.streams) {
      for (const name of createdTables(tokens)) {
        if (!tables.has(name)) tables.set(name, new Set());
        tables.get(name).add(file.path);
      }
    }
    dynamicSql.push(...scanned.dynamicSql.map((line) => `${file.path}:${line}`));
    searchPath.push(...scanned.searchPath.map((line) => `${file.path}:${line}`));
    unreadable.push(...scanned.unreadable.map((line) => `${file.path}:${line}`));
  }
  return { tables, dynamicSql, searchPath, unreadable };
}

export function migrationTables(files) {
  return analyzeMigrations(files).tables;
}

const tableKinds = new Set(["record", "observation"]);

export function documentedTables(markdown) {
  const tables = new Set();
  let inSection = false;
  let fence = null;
  for (const line of markdown.replace(/<!--[\s\S]*?(?:-->|$)/g, "").split(/\r?\n/)) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      continue;
    }
    if (marker) {
      fence = marker[1];
      continue;
    }
    if (!inSection) {
      if (/^## Data model\s*$/.test(line)) inSection = true;
      continue;
    }
    if (/^##\s/.test(line)) break;
    if (/^(?: {4,}|\t)/.test(line)) continue;
    const cells = line.trim().split("|");
    if (cells[0] !== "" || cells.length < 4 || !tableKinds.has(cells[2].trim()) || !cells[3].trim()) continue;
    const match = /^`([A-Za-z_][A-Za-z0-9_$]*(?:\.[A-Za-z_][A-Za-z0-9_$]*)?)`$/.exec(cells[1].trim());
    if (match) tables.add(match[1]);
  }
  if (!inSection) throw new Error("Missing ## Data model section in docs/architecture.md");
  return tables;
}

export function evaluateDataModel({ created, documented, exemptions = {} }) {
  const undocumented = [...created]
    .filter(([name]) => !documented.has(name) && !Object.hasOwn(exemptions, name))
    .flatMap(([name, paths]) => [...paths].map((path) => `${name} (${path})`))
    .sort();
  const staleExemptions = Object.entries(exemptions)
    .filter(([name, reason]) => !created.has(name) || documented.has(name) || typeof reason !== "string" || !reason.trim())
    .map(([name]) => name)
    .sort();
  return { undocumented, staleExemptions };
}

export function repositoryDataModel(root) {
  const files = migrationDirectories.flatMap((migrationDirectory) =>
    readdirSync(join(root, migrationDirectory))
      .filter((name) => /^\d+_.*\.sql$/.test(name))
      .sort()
      .map((name) => ({
        path: posix.join(migrationDirectory, name),
        content: readFileSync(join(root, migrationDirectory, name), "utf8"),
      })),
  );
  const scanned = analyzeMigrations(files);
  return {
    created: scanned.tables,
    dynamicSql: scanned.dynamicSql,
    searchPath: scanned.searchPath,
    unreadable: scanned.unreadable,
    documented: documentedTables(readFileSync(join(root, "docs/architecture.md"), "utf8")),
  };
}

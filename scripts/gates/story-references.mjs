import { readdirSync, readFileSync } from "node:fs";
import { join, relative, extname } from "node:path";

const storyExtensions = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx"]);
export const storyGlobs = [
  "../{client,components}/**/*.stories.@(js|jsx|mjs|ts|tsx)",
  "../stories/**/*.stories.@(js|jsx|mjs|ts|tsx)",
];

export function sanitize(value) {
  return value.toLowerCase().replace(/[ ’–—―′¿'`~!@#$%^&*()_|+\-=?;:'",.<>\{\}\[\]\\\/]/gi, "-")
    .replace(/-+/g, "-").replace(/^-+/, "").replace(/-+$/, "");
}

export function storyNameFromExport(key) {
  return key.replace(/[_\-.]/g, " ").replace(/([^\n])([A-Z])([a-z])/g, "$1 $2$3")
    .replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([a-z])([0-9])/gi, "$1 $2")
    .replace(/([0-9])([a-z])/gi, "$1 $2").replace(/(\s|^)(\w)/g, (_, space, char) => space + char.toUpperCase())
    .replace(/\s+/g, " ").trim();
}

export function toId(kind, exportName) {
  return `${sanitize(kind)}--${sanitize(storyNameFromExport(exportName))}`;
}

// Tokenize only the JavaScript structure needed for CSF: quoted content, comments,
// and template literals cannot contribute braces or export declarations.
function decodeStringLiteral(raw, closed) {
  if (!closed || raw.length < 2) return null;
  let value = "";
  for (let i = 1; i < raw.length - 1; i++) {
    const char = raw[i];
    if (["\n", "\r", "\u2028", "\u2029"].includes(char)) return null;
    if (char !== "\\") { value += char; continue; }
    const escape = raw[++i];
    if (["\n", "\u2028", "\u2029"].includes(escape)) continue;
    if (escape === "\r") { if (raw[i + 1] === "\n") i++; continue; }
    const simple = { "\\": "\\", "'": "'", '"': '"', n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v" };
    if (Object.hasOwn(simple, escape)) { value += simple[escape]; continue; }
    if (escape === "0" && !/[0-9]/.test(raw[i + 1] ?? "")) { value += "\0"; continue; }
    if (escape === "x" || escape === "u") {
      if (escape === "u" && raw[i + 1] === "{") {
        const end = raw.indexOf("}", i + 2);
        const digits = raw.slice(i + 2, end);
        if (end < 0 || !/^[0-9a-f]+$/i.test(digits)) return null;
        const codePoint = Number.parseInt(digits, 16);
        if (codePoint > 0x10ffff) return null;
        value += String.fromCodePoint(codePoint);
        i = end;
      } else {
        const digits = raw.slice(i + 1, i + (escape === "x" ? 3 : 5));
        if (!(escape === "x" ? /^[0-9a-f]{2}$/i : /^[0-9a-f]{4}$/i).test(digits)) return null;
        value += String.fromCharCode(Number.parseInt(digits, 16));
        i += digits.length;
      }
      continue;
    }
    if (escape === undefined || /[0-9]/.test(escape)) return null;
    value += escape;
  }
  return value;
}

const identifierStart = /[$_\p{ID_Start}]/u;
const identifierContinue = /[$_\p{ID_Continue}]/u;

function identifierEscape(source, start) {
  const match = /^\\u(?:[0-9a-f]{4}|\{[0-9a-f]+\})/i.exec(source.slice(start));
  if (!match) return null;
  const raw = match[0];
  const codePoint = Number.parseInt(raw.startsWith("\\u{") ? raw.slice(3, -1) : raw.slice(2), 16);
  return codePoint <= 0x10ffff ? { value: String.fromCodePoint(codePoint), length: raw.length } : null;
}

const regexPrefixPunct = new Set("=!&|?+-*%^~<>,:;[({");
const regexPrefixWords = new Set([
  "return", "throw", "typeof", "case", "in", "of", "do", "else", "yield", "await", "void", "delete", "instanceof", "new",
]);

function typeParametersEnd(source, start) {
  const first = /^<([A-Za-z_$][\w$]*)(?=\s*(?:,|extends\b|>))/.exec(source.slice(start));
  if (!first) return null;
  let depth = 1;
  let braces = 0;
  for (let i = start + first[0].length; i < source.length; i++) {
    const char = source[i];
    if (char === "'" || char === '"' || char === "`") {
      const quote = char;
      while (++i < source.length && source[i] !== quote) if (source[i] === "\\") i++;
      if (i >= source.length) return null;
    } else if (char === "{" && source.slice(start, i).trimEnd().endsWith("=")) return null;
    else if (char === "{") braces++;
    else if (char === "}" && --braces < 0) return null;
    else if (char === "/") return null;
    else if (braces === 0 && char === "<") depth++;
    else if (braces === 0 && char === ">") {
      if (--depth === 0) return /^\s*\(/.test(source.slice(i + 1)) ? i + 1 : null;
    }
  }
  return null;
}

function jsxEnd(source, start) {
  let i = start;
  const elements = [];
  while (i < source.length) {
    if (source[i] === "<") {
      const tag = /^<(\/?)((?:[A-Za-z_$][\w.$:-]*)?)/.exec(source.slice(i));
      if (!tag) return null;
      const [, closing, name] = tag;
      if (!closing && !name && source[i + tag[0].length] !== ">") return null;
      i += tag[0].length;
      if (!closing && name && source[i] === "<") {
        let depth = 0;
        while (i < source.length) {
          if (source[i] === "'" || source[i] === '"' || source[i] === "`") {
            const quote = source[i++];
            while (i < source.length && source[i] !== quote) i += source[i] === "\\" ? 2 : 1;
            if (i >= source.length) return null;
          } else if (source[i] === "<") depth++;
          else if (source[i] === ">" && --depth === 0) { i++; break; }
          i++;
        }
        if (depth !== 0) return null;
      }
      let selfClosing = false;
      while (i < source.length) {
        if (source.startsWith("/>", i) && !closing) { selfClosing = true; i += 2; break; }
        if (source[i] === ">") { i++; break; }
        if (closing || source[i] === "<") return null;
        if (source[i] === "{") {
          const end = tokens(source, i + 1, true);
          if (end === null) return null;
          i = end + 1;
          continue;
        }
        if (source[i] === "'" || source[i] === '"') {
          const quote = source[i++];
          while (i < source.length && source[i] !== quote) i += source[i] === "\\" ? 2 : 1;
          if (i >= source.length) return null;
          i++;
          continue;
        }
        if (!/[\s\w.$:=\-]/.test(source[i])) return null;
        i++;
      }
      if (i > source.length || source[i - 1] !== ">") return null;
      if (closing) {
        if (elements.pop() !== name) return null;
        if (elements.length === 0) return i;
      } else if (!selfClosing) elements.push(name);
      else if (elements.length === 0) return i;
      continue;
    }
    if (source[i] === "{") {
      const end = tokens(source, i + 1, true);
      if (end === null) return null;
      i = end + 1;
    } else i++;
  }
  return null;
}

function tokens(source, offset = 0, stopAtBrace = false) {
  const result = [];
  const parens = [];
  const braces = [];
  let i = offset;
  while (i < source.length) {
    const start = i;
    const char = source[i];
    if (/\s/.test(char)) { i++; continue; }
    if (source.startsWith("//", i)) { i = source.indexOf("\n", i + 2); if (i < 0) break; continue; }
    if (source.startsWith("/*", i)) { const end = source.indexOf("*/", i + 2); i = end < 0 ? source.length : end + 2; continue; }
    const previous = result.at(-1);
    const expressionPosition = previous === undefined || previous.type === "punct" &&
      (regexPrefixPunct.has(previous.value) || previous.value === ")" && previous.controlClose ||
        previous.value === "}" && previous.blockClose || previous.value === "." && result.at(-2)?.value === "." && result.at(-3)?.value === ".") ||
      previous.type === "word" && regexPrefixWords.has(previous.value) && result.at(-2)?.value !== ".";
    if (char === "<" && expressionPosition && previous?.value !== "<" && /^<(?:[A-Za-z_$]|>)/.test(source.slice(i))) {
      if (typeParametersEnd(source, i) === null) {
        const end = jsxEnd(source, i);
        if (end === null) { result.push({ value: null, type: "unmodeledJsx", start }); break; }
        result.push({ value: null, type: "jsx", start });
        i = end;
        continue;
      }
    }
    if (char === "/" && expressionPosition) {
      i++;
      let inClass = false;
      let closed = false;
      while (i < source.length && source[i] !== "\n") {
        if (source[i] === "\\") { i += 2; continue; }
        if (source[i] === "[") inClass = true;
        if (source[i] === "]") inClass = false;
        if (source[i++] === "/" && !inClass) { closed = true; break; }
      }
      while (i < source.length && /[a-z]/i.test(source[i])) i++;
      const raw = source.slice(start, i);
      const delimiter = closed ? raw.lastIndexOf("/") : -1;
      result.push({ value: null, type: "regex", start, source: delimiter > 0 ? raw.slice(1, delimiter) : null, flags: delimiter > 0 ? raw.slice(delimiter + 1) : null });
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      i++;
      let closed = false;
      while (i < source.length) {
        if (source[i] === "\\") { i += 2; continue; }
        if (source[i++] === char) { closed = true; break; }
      }
      const raw = source.slice(start, i);
      result.push({ value: char === "`" ? null : decodeStringLiteral(raw, closed), type: char === "`" ? "template" : "string", start });
      continue;
    }
    const first = String.fromCodePoint(source.codePointAt(i));
    if (identifierStart.test(first) || char === "\\") {
      let value = "";
      let valid = true;
      while (i < source.length) {
        const escaped = source[i] === "\\";
        const part = escaped ? identifierEscape(source, i) : { value: String.fromCodePoint(source.codePointAt(i)) };
        if (!part) { valid = false; break; }
        if (!(value ? identifierContinue : identifierStart).test(part.value)) {
          if (escaped) valid = false;
          break;
        }
        value += part.value;
        i += escaped ? part.length : part.value.length;
      }
      if (!valid) {
        result.push({ value: null, type: "invalidIdentifier", start });
        i++;
      } else result.push({ value, type: "word", start });
      continue;
    }
    if (char === "}" && stopAtBrace && braces.length === 0) return i;
    if (char === "(") parens.push(["if", "while", "for", "with"].includes(previous?.value));
    const controlClose = char === ")" ? parens.pop() : false;
    if (char === "{") braces.push(previous?.value === ")" && previous.controlClose ||
      previous?.value === ")" && result.slice(-8).some((token) => token.value === "function") ||
      ["else", "do", "try", "finally"].includes(previous?.value) ||
      previous === undefined || previous?.value === ";" || previous?.blockClose);
    const blockClose = char === "}" ? braces.pop() : false;
    result.push({ value: char, type: "punct", start, controlClose, blockClose });
    i++;
  }
  return stopAtBrace ? null : result;
}

function matchingEnd(items, start, open, close) {
  let depth = 0;
  for (let i = start; i < items.length; i++) {
    if (items[i].value === open && items[i].type === "punct") depth++;
    if (items[i].value === close && items[i].type === "punct" && --depth === 0) return i;
  }
  return -1;
}

function storyFilter(items) {
  if (items.length === 1 && (items[0].type === "regex" || items[0].type === "string")) {
    const { type, value, source, flags } = items[0];
    if (type === "regex" && source === null || type === "string" && value === null) return { type: "unsupported" };
    const pattern = type === "string" ? value : source;
    try { new RegExp(pattern, type === "string" ? undefined : flags); } catch { return { type: "unsupported" }; }
    return { type: "regex", source: pattern, flags: type === "string" ? undefined : flags };
  }
  if (items[0]?.value !== "[" || matchingEnd(items, 0, "[", "]") !== items.length - 1) return { type: "unsupported" };
  const values = [];
  for (let i = 1; i < items.length - 1;) {
    if (items[i].type !== "string" || items[i].value === null) return { type: "unsupported" };
    values.push(items[i++].value);
    if (i === items.length - 1) break;
    if (items[i++].value !== ",") return { type: "unsupported" };
  }
  return values;
}

function metaFields(items, start) {
  const end = matchingEnd(items, start, "{", "}");
  const fields = new Map();
  // An unterminated regex literal can swallow the meta's closing brace; still name the filter
  // that could not be modeled instead of reporting only a missing id or title.
  if (end < 0) {
    for (let i = start + 1; i < items.length - 2; i++) {
      if (items[i].type === "word" && ["includeStories", "excludeStories"].includes(items[i].value) && items[i + 1]?.value === ":" &&
        items[i + 2]?.type === "regex" && items[i + 2].source === null) {
        fields.set(items[i].value, { type: "unsupported" });
      }
    }
    return fields;
  }
  for (let i = start + 1; i < end;) {
    const key = items[i];
    if (items[i + 1]?.value !== ":" || key.type !== "word") {
      if (key.type === "word" && ["includeStories", "excludeStories"].includes(key.value)) fields.set(key.value, { type: "unsupported" });
      i++;
      continue;
    }
    const valueStart = i + 2;
    // Skip the entire value before inspecting the next top-level key.
    i = valueStart;
    i = valueStart;
    const stack = [];
    for (; i < end; i++) {
      const token = items[i];
      if (token.type !== "punct") continue;
      if (["{", "[", "("].includes(token.value)) stack.push(token.value);
      else if (["}", "]", ")"].includes(token.value)) stack.pop();
      else if (token.value === "," && stack.length === 0) break;
    }
    if (["id", "title"].includes(key.value)) {
      const value = items.slice(valueStart, i);
      fields.set(key.value, value.length === 1 && value[0].type === "string" ? value[0].value : { type: "unsupported" });
    }
    if (["includeStories", "excludeStories"].includes(key.value)) fields.set(key.value, storyFilter(items.slice(valueStart, i)));
    if (items[i]?.value === ",") i++;
  }
  return fields;
}

function variableDeclarators(items, start, source) {
  const declarations = [];
  let segment = start + 1;
  let equals = -1;
  let annotated = false;
  let angleDepth = 0;
  const stack = [];
  const finish = (end) => {
    if (items[segment]?.type === "word" && equals >= 0) {
      declarations.push({ name: items[segment].value, objectStart: items[equals + 1]?.value === "{" ? equals + 1 : -1 });
    }
    segment = end + 1;
    equals = -1;
    annotated = false;
    angleDepth = 0;
  };
  for (let i = segment; i < items.length; i++) {
    const token = items[i];
    if (stack.length === 0 && angleDepth === 0 && equals >= 0 && i > equals + 1 &&
      token.type === "word" && ["export", "const", "let", "var", "function", "class", "type", "interface"].includes(token.value) &&
      !["=", ",", ".", "?", ":", "+", "-", "*", "/", "|", "&", "^", "<"].includes(items[i - 1].value) &&
      !(items[i - 1].value === ">" && items[i - 2]?.value === "=") &&
      /[\r\n\u2028\u2029]/.test(source.slice(items[i - 1].start, token.start))) {
      finish(i - 1);
      return { declarations, end: i - 1 };
    }
    if (token.type !== "punct") continue;
    if (annotated && stack.length === 0 && token.value === "<") angleDepth++;
    else if (annotated && stack.length === 0 && token.value === ">" && items[i - 1]?.value !== "=" && angleDepth > 0) angleDepth--;
    else if (["{", "[", "("].includes(token.value)) stack.push(token.value);
    else if (["}", "]", ")"].includes(token.value)) stack.pop();
    else if (stack.length === 0 && angleDepth === 0) {
      if (token.value === ":" && i === segment + 1) annotated = true;
      else if (token.value === "=" && equals < 0 && items[i + 1]?.value !== ">") { equals = i; annotated = false; }
      else if (token.value === ";") { finish(i); return { declarations, end: i }; }
      else if (token.value === "," && !annotated) finish(i);
    }
  }
  if (stack.length === 0) finish(items.length);
  return { declarations, end: items.length - 1 };
}

function objectField(items, start, name) {
  const end = matchingEnd(items, start, "{", "}");
  if (end < 0) return null;
  for (let i = start + 1; i < end;) {
    const key = items[i];
    const valueStart = i + 2;
    let next = valueStart;
    const stack = [];
    for (; next < end; next++) {
      const token = items[next];
      if (token.type !== "punct") continue;
      if (["{", "[", "("].includes(token.value)) stack.push(token.value);
      else if (["}", "]", ")"].includes(token.value)) stack.pop();
      else if (token.value === "," && stack.length === 0) break;
    }
    if (key.type === "word" && key.value === name && items[i + 1]?.value === ":") return items.slice(valueStart, next);
    i = next + 1;
  }
  return null;
}

function storyOverride(items, objectStart) {
  if (objectStart < 0) return null;
  const parameters = objectField(items, objectStart, "parameters");
  if (parameters?.[0]?.value !== "{") return null;
  const override = objectField(parameters, 0, "__id");
  if (!override) return null;
  return override.length === 1 && override[0].type === "string" && override[0].value !== null
    ? { id: override[0].value } : { unsupported: true };
}

function storyExports(items, source) {
  const names = [];
  for (let i = 0; i < items.length - 2; i++) {
    if (items[i].value !== "export" || items[i].type !== "word") continue;
    if (["const", "let", "var"].includes(items[i + 1].value)) {
      const { declarations, end } = variableDeclarators(items, i + 1, source);
      for (const { name, objectStart } of declarations) names.push({ name, objectStart });
      i = end;
      continue;
    }
    const functionStart = items[i + 1]?.value === "async" ? i + 2 : i + 1;
    if (items[functionStart]?.value === "function") {
      const name = items[functionStart + (items[functionStart + 1]?.value === "*" ? 2 : 1)];
      if (name?.type === "word") names.push({ name: name.value, objectStart: -1 });
    }
    if (items[i + 1].value !== "{") continue;
    const end = matchingEnd(items, i + 1, "{", "}");
    if (end < 0) continue;
    for (let j = i + 2; j < end;) {
      if (items[j]?.value === "type" && ["word", "string"].includes(items[j + 1]?.type)) {
        while (j < end && items[j].value !== ",") j++;
        j++;
        continue;
      }
      const local = items[j]?.value;
      if (!local || !["word", "string"].includes(items[j].type)) { j++; continue; }
      j++;
      const exported = items[j]?.value === "as" ? items[j + 1]?.value : local;
      if (exported && exported !== "default") names.push({ name: exported, objectStart: -1 });
      j += items[j]?.value === "as" ? 2 : 0;
      while (j < end && items[j].value !== ",") j++;
      j++;
    }
    i = end;
  }
  return names;
}

function lineAt(content, offset) {
  return content.slice(0, Math.max(offset, 0)).split("\n").length;
}

export function storyIdsFromFiles(files) {
  const ids = new Set();
  const findings = [];
  for (const file of files) {
    const items = tokens(file.content);
    const unmodeledJsx = items.find((item) => item.type === "unmodeledJsx");
    if (unmodeledJsx) {
      findings.push(`${file.path}:${lineAt(file.content, unmodeledJsx.start)}: unmodeled JSX or type-parameter syntax`);
      continue;
    }
    const invalid = items.find((item) => item.type === "invalidIdentifier");
    if (invalid) {
      findings.push(`${file.path}:${lineAt(file.content, invalid.start)}: unmodeled identifier escape`);
      continue;
    }
    const topLevelConsts = new Set();
    let depth = 0;
    for (let i = 0; i < items.length; i++) {
      const token = items[i];
      if (depth === 0 && token.type === "word" && token.value === "const") topLevelConsts.add(i);
      if (token.type !== "punct") continue;
      if (["{", "(", "["].includes(token.value)) depth++;
      else if (["}", ")", "]"].includes(token.value)) depth--;
    }
    let metaStart = -1;
    for (let i = 0; i < items.length - 2; i++) {
      if (items[i].value !== "export" || items[i].type !== "word") continue;
      let name = null;
      if (items[i + 1]?.value === "default") {
        if (items[i + 2]?.value === "{") metaStart = i + 2;
        else name = items[i + 2]?.value;
      } else if (items[i + 1]?.value === "{") {
        const end = matchingEnd(items, i + 1, "{", "}");
        for (let j = i + 2; j < end; j++) {
          if (items[j + 1]?.value === "as" && items[j + 2]?.value === "default") name = items[j].value;
        }
      }
      if (name) {
        for (let j = 0; j < i; j++) {
          if (!topLevelConsts.has(j)) continue;
          const { declarations, end } = variableDeclarators(items, j, file.content);
          const declaration = declarations.find((candidate) => candidate.name === name && candidate.objectStart >= 0);
          if (declaration) metaStart = declaration.objectStart;
          j = end;
        }
      }
      if (metaStart >= 0) break;
    }
    const meta = metaStart >= 0 ? metaFields(items, metaStart) : new Map();
    for (const key of ["includeStories", "excludeStories"]) {
      if (meta.get(key)?.type === "unsupported") findings.push(`${file.path}:1: unmodeled ${key} filter`);
    }
    const id = meta.get("id");
    const title = meta.get("title");
    for (const key of ["id", "title"]) {
      if (meta.get(key)?.type === "unsupported") findings.push(`${file.path}:1: story meta has nonliteral ${key}`);
    }
    if (["id", "title"].some((key) => meta.get(key)?.type === "unsupported")) continue;
    const kind = typeof id === "string" && id.trim() ? id : title;
    if (!kind || !kind.trim() || id === null || title === null) { findings.push(`${file.path}:1: story meta has no literal id or title`); continue; }
    if (["includeStories", "excludeStories"].some((key) => meta.get(key)?.type === "unsupported")) continue;
    const matches = (name, filter) => filter?.type === "regex" ? name.match(new RegExp(filter.source, filter.flags)) !== null : filter.includes(name);
    const include = meta.get("includeStories");
    const exclude = meta.get("excludeStories");
    const stories = storyExports(items, file.content);
    const overrides = stories.map(({ objectStart }) => storyOverride(items, objectStart));
    if (overrides.some((override) => override?.unsupported)) {
      findings.push(`${file.path}:1: unmodeled story __id`);
      continue;
    }
    for (let i = 0; i < stories.length; i++) {
      const { name } = stories[i];
      if (["__namedExportsOrder", "__esModule"].includes(name)) continue;
      if (include && !matches(name, include)) continue;
      if (exclude && matches(name, exclude)) continue;
      ids.add(overrides[i]?.id ?? toId(kind, name));
    }
  }
  return { ids, findings };
}

export function storyReferenceFindings({ storyFiles, boards, docs }) {
  const { ids, findings } = storyIdsFromFiles(storyFiles);
  const boardFrames = new Map();
  const report = (file, offset, message) => findings.push(`${file.path}:${lineAt(file.content, offset)}: ${message}`);
  for (const file of boards) {
    const board = JSON.parse(file.content);
    if (!ids.has(`review-boards--${board.id}`)) report(file, file.content.indexOf('"id"'), `unresolved board review-boards--${board.id}`);
    const frames = new Set();
    let cursor = 0;
    for (const section of board.sections ?? []) for (const frame of section.frames ?? []) {
      const idOffset = file.content.indexOf(`"id": "${frame.id}"`, cursor);
      if (idOffset >= 0) cursor = idOffset + 1;
      if (frames.has(frame.id)) report(file, idOffset, `duplicate frame ${frame.id}`);
      frames.add(frame.id);
      for (const key of ["story", "before"]) {
        if (frame[key] && !ids.has(frame[key])) report(file, file.content.indexOf(`"${key}": "${frame[key]}"`, cursor), `unresolved ${key} ${frame[key]}`);
      }
    }
    boardFrames.set(board.id, frames);
  }
  for (const file of [...storyFiles, ...boards, ...docs]) {
    for (const match of file.content.matchAll(/\?id=([^\s"'`<>)]*)/g)) {
      const query = match[1];
      const raw = query.split(/[&#]/)[0];
      let id;
      try { id = decodeURIComponent(raw); }
      catch {
        if (raw.includes("--")) report(file, match.index, `unmodeled link id ${raw}`);
        continue;
      }
      if (!id.includes("--")) continue;
      if (!ids.has(id)) {
        const stripped = id.replace(/[.,;:!?]$/, "");
        if (ids.has(stripped)) id = stripped;
        else report(file, match.index, `unresolved link id ${id}`);
      }
      const rawFrame = /(?:^|&(?:amp;)?)frame=([^&\s"'`<>)]*)/.exec(query)?.[1];
      if (!rawFrame || !id.startsWith("review-boards--")) continue;
      let frame;
      try { frame = decodeURIComponent(rawFrame.split("#")[0]); }
      catch { report(file, match.index, `unmodeled frame ${rawFrame} on ${id}`); continue; }
      const board = id.slice("review-boards--".length);
      const knownFrames = board === "changes" ? ids : boardFrames.get(board);
      if (knownFrames && !knownFrames.has(frame)) {
        const stripped = frame.replace(/[.,;:!?]$/, "");
        if (knownFrames.has(stripped)) frame = stripped;
        else report(file, match.index, `unresolved frame ${frame} on ${id}`);
      }
    }
  }
  for (const file of docs) {
    let kind = null;
    for (const match of file.content.matchAll(/`(?:([\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*)--([\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*|\*)|--([\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*))`/gu)) {
      if (match[1]) kind = match[1];
      else if (!kind) { report(file, match.index, `orphan inventory shorthand --${match[3]}`); continue; }
      const id = `${kind}--${match[2] ?? match[3]}`;
      if (id.endsWith("--*") ? ![...ids].some((story) => story.startsWith(id.slice(0, -1))) : !ids.has(id)) {
        report(file, match.index, `unresolved inventory id ${id}`);
      }
    }
  }
  return findings;
}

function filesIn(root, dir, predicate) {
  const files = [];
  function walk(directory) {
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!["node_modules", ".next", "storybook-static", "test-results", "playwright-report"].includes(entry.name)) walk(join(directory, entry.name));
      } else if (predicate(entry.name)) {
        const absolute = join(root, directory, entry.name);
        files.push({ path: relative(root, absolute).split("\\").join("/"), content: readFileSync(absolute, "utf8") });
      }
    }
  }
  walk(dir);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export function storyGlobFindings(configPath, configSource) {
  const items = tokens(configSource);
  const declarations = [];
  for (let i = 0; i < items.length - 1; i++) {
    if (items[i].value !== "stories" || items[i + 1].value !== ":" || !["word", "string"].includes(items[i].type)) continue;
    const start = i + 2;
    const end = items[start]?.value === "[" ? matchingEnd(items, start, "[", "]") : -1;
    if (end < 0) { declarations.push(null); continue; }
    const values = [];
    let literal = true;
    for (let j = start + 1; j < end; j++) {
      if (items[j].type === "string" && items[j].value !== null && (j === start + 1 || items[j - 1].value === ",")) values.push(items[j].value);
      else if (items[j].value !== "," || items[j - 1]?.type !== "string") literal = false;
    }
    declarations.push(literal && [",", "}"].includes(items[end + 1]?.value) ? values : null);
  }
  if (declarations.length !== 1 || !declarations[0] || declarations[0].length !== storyGlobs.length ||
    declarations[0].some((glob, index) => glob !== storyGlobs[index])) {
    return [`${configPath}:1: Storybook stories must be a literal array matching gate globs`];
  }
  return [];
}

function repositoryStoryFiles(repoRoot) {
  return ["client", "components", "stories"].flatMap((dir) =>
    filesIn(repoRoot, `apps/web/${dir}`, (name) => storyExtensions.has(extname(name)) && name.endsWith(`.stories${extname(name)}`)));
}

export function repositoryStoryReferenceFindings(repoRoot) {
  const storyFiles = repositoryStoryFiles(repoRoot);
  const boards = filesIn(repoRoot, "apps/web/stories/review/boards", (name) => name.endsWith(".json"));
  const docs = filesIn(repoRoot, "docs/design-system/stories", (name) => name.endsWith(".md"));
  const configPath = "apps/web/.storybook/main.ts";
  return [...storyGlobFindings(configPath, readFileSync(join(repoRoot, configPath), "utf8")), ...storyReferenceFindings({ storyFiles, boards, docs })];
}

export function repositoryStoryIds(repoRoot) {
  return storyIdsFromFiles(repositoryStoryFiles(repoRoot)).ids;
}

import path from "node:path";

// Product source under the five layers carries no comments. Oxlint's
// home/no-comments rule covers TypeScript and TSX; this gate covers the CSS
// and Python that Oxlint cannot parse. Test and story sources keep the same
// exclusions as the Oxlint rule.
const PRODUCT_LAYER_SKIP = /(?:^|\/)(?:tests?|__tests__)\/|\.(?:test|spec)\.[^/]+$|\.stories\.[^/]+$/;

// The layers the comment policy covers. Callers filter scan candidates through
// this list so a new layer is a deliberate edit here instead of an implicit scan.
export const PRODUCT_LAYERS = ["app", "client", "components", "server", "shared"];

// Mirrors THIRD_PARTY_NOTICE in apps/web/oxlint/rules/no-comments.mjs: the one
// allowed comment is a third-party licence or notice header, and only as the
// file's first content. Everything else must become code, a test, lint, or
// durable documentation.
export const THIRD_PARTY_NOTICE = /(?:SPDX-License-Identifier:|@license\b|\bCopyright\s*(?:\(c\)|©)|\bMIT License\b|\bApache License\b)/iu;

export function isProductSource(filePath) {
  return !PRODUCT_LAYER_SKIP.test(filePath);
}

// CSS comments are /* ... */, with no nesting: the first */ closes the block.
// Quoted strings are skipped so a url() or content value that happens to contain
// comment markers is not reported. Unterminated quotes consume the rest of the
// file, which only under-reports comments in already-invalid CSS.
function scanCssComments(source) {
  const comments = [];
  let line = 1;
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (char === "\n") {
      line += 1;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      index += 1;
      while (index < source.length && source[index] !== char) {
        if (source[index] === "\\") {
          if (source[index + 1] === "\n") line += 1;
          index += 2;
          continue;
        }
        if (source[index] === "\n") line += 1;
        index += 1;
      }
      index += 1;
      continue;
    }
    if (char === "/" && source[index + 1] === "*") {
      const start = index;
      const startLine = line;
      let text = "";
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
        if (source[index] === "\n") line += 1;
        text += source[index];
        index += 1;
      }
      index += 2;
      comments.push({ start, line: startLine, text: text.trim() });
      continue;
    }
    index += 1;
  }
  return comments;
}

// Python comments run from # to the end of the line. Single, double, and triple
// quoted strings are skipped, so hex colors, "# not a comment" fixtures, and
// docstrings are not comments. A backslash escape is honored in every string
// form, which also keeps raw strings from terminating early.
function scanPythonComments(source) {
  const comments = [];
  let line = 1;
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (char === "\n") {
      line += 1;
      index += 1;
      continue;
    }
    if (char === "#") {
      const start = index;
      const startLine = line;
      index += 1;
      while (index < source.length && source[index] !== "\n") index += 1;
      comments.push({ start, line: startLine, text: source.slice(start + 1, index).trim() });
      continue;
    }
    if (char === '"' || char === "'") {
      const close = source.startsWith(char.repeat(3), index) ? char.repeat(3) : char;
      index += close.length;
      while (index < source.length && !source.startsWith(close, index)) {
        if (source[index] === "\\") {
          if (source[index + 1] === "\n") line += 1;
          index += 2;
          continue;
        }
        if (source[index] === "\n") line += 1;
        index += 1;
      }
      index += close.length;
      continue;
    }
    index += 1;
  }
  return comments;
}

function isNoticeHeader(source, comment) {
  return source.slice(0, comment.start).trim().length === 0 && THIRD_PARTY_NOTICE.test(comment.text);
}

// Python functional lines are comments a tool consumes, not prose: a line-1
// shebang, a line-1/2 PEP 263 encoding declaration, and inline PEP 484
// `# type:` / flake8 `# noqa` pragmas. The pragma prefixes are exact, so
// `# type: ignore` is exempt and `# typing: ...` is not.
const PYTHON_ENCODING = /^(?:-\*-\s*coding[:=][ \t]*[A-Za-z0-9._-]+\s*-\*-|coding[:=][ \t]*[A-Za-z0-9._-]+)$/;
const PYTHON_PRAGMA = /^(?:type:|noqa$|noqa:)/;

function isPythonFunctionalComment(source, comment) {
  if (PYTHON_PRAGMA.test(comment.text)) return true;
  if (comment.line === 1 && comment.start === 0 && comment.text.startsWith("!")) return true;
  if (comment.line > 2) return false;
  const lineStart = source.lastIndexOf("\n", comment.start - 1) + 1;
  return source.slice(lineStart, comment.start).trim().length === 0 && PYTHON_ENCODING.test(comment.text);
}

// files: { path, content }[]. Returns forbidden comments as { path, line, text }
// in path/line order. Unknown extensions and non-product paths are ignored; the
// contract test asserts the loaded tree still contains CSS and Python sources.
export function collectForbiddenComments(files) {
  const forbidden = [];
  for (const file of files) {
    if (!isProductSource(file.path)) continue;
    const extension = path.extname(file.path).toLowerCase();
    if (extension !== ".css" && extension !== ".py") continue;
    const comments = extension === ".css" ? scanCssComments(file.content) : scanPythonComments(file.content);
    for (const comment of comments) {
      if (extension === ".py" && isPythonFunctionalComment(file.content, comment)) continue;
      if (isNoticeHeader(file.content, comment)) continue;
      forbidden.push({ path: file.path, line: comment.line, text: comment.text });
    }
  }
  return forbidden.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
}

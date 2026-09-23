const OXLINT_DISABLE_DIRECTIVE = /^\s*oxlint-disable(?:-line|-next-line)?\s[^\r\n]*?\s--\s\S/u;
const TRIPLE_SLASH_REFERENCE = /^\/\s*<reference\s+(?:path|types|lib|no-default-lib)=/u;
const THIRD_PARTY_NOTICE = /(?:SPDX-License-Identifier:|@license\b|\bCopyright\s*(?:\(c\)|©)|\bMIT License\b|\bApache License\b)/iu;
const PUBLIC_EXPORT_JSDOC = /^\*\s+@public\s+\S[^\r\n]*$/u;

function isFileHeader(sourceCode, comment) {
  return sourceCode.text.slice(0, comment.range[0]).trim().length === 0;
}

function isPublicExportJSDoc(sourceCode, comment) {
  if (comment.type !== "Block" || !PUBLIC_EXPORT_JSDOC.test(comment.value.trim())) return false;
  const nextStatement = sourceCode.ast.body.find((statement) => statement.range[0] >= comment.range[1]);
  if (!nextStatement || sourceCode.text.slice(comment.range[1], nextStatement.range[0]).trim() !== "") return false;
  return nextStatement.type === "ExportNamedDeclaration" || nextStatement.type === "ExportDefaultDeclaration" || nextStatement.type === "ExportAllDeclaration";
}

function isAllowedComment(sourceCode, comment) {
  const value = comment.value.trim();
  if (OXLINT_DISABLE_DIRECTIVE.test(value)) return true;
  if (comment.type === "Line" && TRIPLE_SLASH_REFERENCE.test(value)) return true;
  if (isPublicExportJSDoc(sourceCode, comment)) return true;
  return isFileHeader(sourceCode, comment) && THIRD_PARTY_NOTICE.test(value);
}

export const noComments = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      forbidden: "Product code must express this information through code, tests, types, lint rules, or documentation instead of comments.",
    },
  },
  create(context) {
    return {
      "Program:exit"() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (!isAllowedComment(context.sourceCode, comment)) {
            context.report({ loc: comment.loc, messageId: "forbidden" });
          }
        }
      },
    };
  },
};

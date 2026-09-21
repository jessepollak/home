const OXLINT_DISABLE_DIRECTIVE = /^\s*oxlint-disable(?:-line|-next-line)?\b[^\r\n]*?\s--\s\S/u;
const TRIPLE_SLASH_REFERENCE = /^\/\s*<reference\s+(?:path|types|lib|no-default-lib)=/u;
const THIRD_PARTY_NOTICE = /(?:SPDX-License-Identifier:|@license\b|\bCopyright\s*(?:\(c\)|©)|\bMIT License\b|\bApache License\b)/iu;

function isFileHeader(sourceCode, comment) {
  return sourceCode.text.slice(0, comment.range[0]).trim().length === 0;
}

function isAllowedComment(sourceCode, comment) {
  const value = comment.value.trim();
  if (OXLINT_DISABLE_DIRECTIVE.test(value)) return true;
  if (comment.type === "Line" && TRIPLE_SLASH_REFERENCE.test(value)) return true;
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

// General-purpose EVM address shape belongs to shared/chain/hex.ts; only registered legacy files are exempt.
import { addressLiteralExceptions } from "../policy/address-literals.mjs";

const anchoredHex40 = /^\^0x\[([0-9a-fA-F-]+)\]\{40\}\$$/u;

function isAddressPattern(pattern) {
  if (typeof pattern !== "string") return false;
  const match = anchoredHex40.exec(pattern.trim());
  if (match === null) return false;
  const alphabet = match[1].replace(/([a-fA-F])-([a-fA-F])/gu, (_, start, end) => {
    let expanded = "";
    for (let code = start.charCodeAt(0); code <= end.charCodeAt(0); code += 1) expanded += String.fromCharCode(code);
    return expanded;
  }).replaceAll("-", "");
  return new Set(alphabet.toLowerCase().match(/[a-f]/gu) ?? []).size >= 3;
}

function unwrapExpression(node) {
  while (node && [
    "ParenthesizedExpression",
    "ChainExpression",
    "TSAsExpression",
    "TSTypeAssertion",
    "TSNonNullExpression",
    "TSSatisfiesExpression",
  ].includes(node.type)) node = node.expression;
  return node;
}

function literalText(node) {
  node = unwrapExpression(node);
  if ((node?.type === "Literal" || node?.type === "StringLiteral") && typeof node.value === "string") return node.value;
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis[0]?.value.cooked ?? null;
  return null;
}

function relativeFile(filename) {
  const normalized = String(filename ?? "").replaceAll("\\", "/").replace(/^\.\//u, "");
  const cwd = String(typeof process === "undefined" ? "" : process.cwd()).replaceAll("\\", "/").replace(/\/+$/u, "");
  if (cwd && normalized.startsWith(`${cwd}/`)) return normalized.slice(cwd.length + 1);
  const marker = "/apps/web/";
  const index = normalized.indexOf(marker);
  if (index !== -1) return normalized.slice(index + marker.length);
  if (normalized.startsWith("apps/web/")) return normalized.slice("apps/web/".length);
  return normalized;
}

function isPlatformRegExp(sourceCode, callee) {
  const identifier = unwrapExpression(callee);
  if (identifier?.type !== "Identifier" || identifier.name !== "RegExp") return false;
  let scope = sourceCode.getScope(identifier);
  while (scope) {
    const variable = scope.set.get(identifier.name);
    if (variable) return variable.defs.length === 0;
    scope = scope.upper;
  }
  return true;
}

export const noAddressLiteralRegex = {
  meta: {
    type: "problem",
    schema: [{
      type: "object",
      properties: { allow: { type: "array", items: { type: "string" } } },
      additionalProperties: false,
    }],
    messages: {
      rejected: "Use the canonical hex parser in shared/chain/hex.ts instead of a handwritten address regex.",
    },
  },
  create(context) {
    const filename = relativeFile(context.filename);
    const allow = context.options[0]?.allow ?? addressLiteralExceptions;
    if (Array.isArray(allow) ? allow.includes(filename) : allow.has(filename)) return {};

    function inspectPattern(node) {
      if (isPlatformRegExp(context.sourceCode, node.callee) && isAddressPattern(literalText(node.arguments[0]))) {
        context.report({ node, messageId: "rejected" });
      }
    }

    return {
      Literal(node) {
        if (isAddressPattern(node.regex?.pattern)) context.report({ node, messageId: "rejected" });
      },
      NewExpression: inspectPattern,
      CallExpression: inspectPattern,
    };
  },
};

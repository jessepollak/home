import path from "node:path";
import { cdpAuthOwners } from "../policy/cdp-auth.mjs";

function relativeToAppsWeb(filename) {
  const normalized = path.posix.normalize(String(filename ?? "").replaceAll("\\", "/"));
  const cwd = String(process.cwd()).replaceAll("\\", "/").replace(/\/+$/u, "");
  if (normalized.startsWith(`${cwd}/`)) return normalized.slice(cwd.length + 1).replace(/^apps\/web\//u, "");
  const marker = "/apps/web/";
  const index = normalized.lastIndexOf(marker);
  if (index !== -1) return normalized.slice(index + marker.length);
  return normalized.replace(/^apps\/web\//u, "");
}

function staticSource(node) {
  if (node?.type === "Literal" || node?.type === "StringLiteral") return node.value;
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis[0]?.value.cooked;
  if (node?.type === "BinaryExpression" && node.operator === "+") {
    const left = staticSource(node.left);
    const right = staticSource(node.right);
    if (typeof left === "string" && typeof right === "string") return left + right;
  }
  return undefined;
}

export const noLocalCdpJwt = {
  meta: {
    type: "problem",
    schema: [],
    messages: { rejected: "CDP JWT signing belongs in server/cdp/auth.ts; use signCdpRequest instead of importing the SDK auth module." },
  },
  create(context) {
    if (cdpAuthOwners.has(relativeToAppsWeb(context.filename))) return {};
    function check(node) {
      if (staticSource(node) === "@coinbase/cdp-sdk/auth") context.report({ node, messageId: "rejected" });
    }
    return {
      ImportDeclaration(node) { check(node.source); },
      ExportNamedDeclaration(node) { if (node.source) check(node.source); },
      ExportAllDeclaration(node) { check(node.source); },
      ImportExpression(node) { check(node.source); },
      TSImportType(node) { check(node.source); },
      TSExternalModuleReference(node) { check(node.expression); },
      CallExpression(node) {
        if (node.callee.type === "Identifier" && node.callee.name === "require") check(node.arguments[0]);
      },
    };
  },
};

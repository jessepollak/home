import { rawEnvExceptions } from "../policy/raw-env.mjs";

function relativeFile(filename) {
  let normalized = String(filename ?? "").replaceAll("\\", "/").replace(/^\.\//u, "");
  const cwd = process.cwd().replaceAll("\\", "/").replace(/\/+$/u, "");
  if (normalized.startsWith(`${cwd}/`)) {
    normalized = normalized.slice(cwd.length + 1);
    return normalized.startsWith("apps/web/") ? normalized.slice("apps/web/".length) : normalized;
  }
  const marker = "/apps/web/";
  const index = normalized.indexOf(marker);
  if (index !== -1) return normalized.slice(index + marker.length);
  if (normalized.startsWith("apps/web/")) return normalized.slice("apps/web/".length);
  return normalized;
}

function unwrap(node) {
  while (node && ["ParenthesizedExpression", "ChainExpression", "TSAsExpression", "TSTypeAssertion", "TSNonNullExpression", "TSSatisfiesExpression"].includes(node.type)) node = node.expression;
  return node;
}

function staticText(node) {
  node = unwrap(node);
  if ((node?.type === "Literal" || node?.type === "StringLiteral") && typeof node.value === "string") return node.value;
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis[0]?.value.cooked;
  if (node?.type === "BinaryExpression" && node.operator === "+") {
    const left = staticText(node.left);
    const right = staticText(node.right);
    if (left !== undefined && right !== undefined) return left + right;
  }
  return undefined;
}

function platformProcess(sourceCode, node) {
  node = unwrap(node);
  if (node?.type !== "Identifier") return false;
  let scope = sourceCode.getScope(node);
  while (scope) {
    const variable = scope.set.get(node.name);
    if (variable) {
      if (variable.defs.length === 0) return node.name === "process";
      return variable.defs.some((definition) => definition.type === "ImportBinding"
        && definition.parent?.type === "ImportDeclaration"
        && definition.parent.importKind !== "type"
        && definition.node.importKind !== "type"
        && (definition.node.type !== "ImportSpecifier"
          || (definition.node.imported.name ?? staticText(definition.node.imported)) === "default")
        && ["node:process", "process"].includes(staticText(definition.parent.source)));
    }
    scope = scope.upper;
  }
  return node.name === "process";
}

export const noRawProcessEnv = {
  meta: {
    type: "problem",
    schema: [{
      type: "object",
      properties: { allow: { type: "array", items: { type: "string" } } },
      additionalProperties: false,
    }],
    messages: {
      rejected: "Read server environment through server/config/env.ts instead of raw process.env.",
    },
  },
  create(context) {
    const filename = relativeFile(context.filename);
    if (!filename.startsWith("server/") || filename === "server/config/env.ts"
      || /(?:^|\/)(?:tests|testing)\/|\.(?:test|spec)(?:\.[^/]*)?\.[cm]?[jt]sx?$/u.test(filename)) return {};
    const allow = context.options[0]?.allow ?? rawEnvExceptions;
    if (Array.isArray(allow) ? allow.includes(filename) : allow.has(filename)) return {};
    return {
      ImportDeclaration(node) {
        if (node.importKind === "type" || !["node:process", "process"].includes(staticText(node.source))) return;
        for (const variable of context.sourceCode.getDeclaredVariables(node)) {
          if (!variable.defs.some((definition) => definition.node.type === "ImportSpecifier"
            && definition.node.importKind !== "type"
            && (definition.node.imported.name ?? staticText(definition.node.imported)) === "env")) continue;
          for (const reference of variable.references) {
            let target = reference.identifier;
            while (target.parent?.type === "TSQualifiedName") target = target.parent;
            if (reference.isRead() && reference.isValueReference !== false
              && target.parent?.type !== "TSTypeQuery") {
              context.report({ node: reference.identifier, messageId: "rejected" });
            }
          }
        }
      },
      MemberExpression(node) {
        const property = node.computed ? staticText(node.property) : node.property.name;
        if (property === "env" && platformProcess(context.sourceCode, node.object)) {
          context.report({ node, messageId: "rejected" });
        }
      },
    };
  },
};

// Client reads belong in query factories, and query keys must come from scope factories.
import { clientGetExceptions, queryKeyExceptions } from "../policy/client-data.mjs";

const wrappers = new Set([
  "ParenthesizedExpression",
  "ChainExpression",
  "TSAsExpression",
  "TSNonNullExpression",
  "TSSatisfiesExpression",
  "TSTypeAssertion",
]);
const allowSchema = [{
  type: "object",
  properties: { allow: { type: "array", items: { type: "string" } } },
  additionalProperties: false,
}];

function unwrap(node) {
  let current = node;
  while (current && wrappers.has(current.type)) current = current.expression;
  return current;
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

function allowed(context, defaultAllow) {
  const filename = relativeFile(context.filename);
  const allow = context.options[0]?.allow ?? defaultAllow;
  return Array.isArray(allow) ? allow.includes(filename) : allow.has(filename);
}

function staticString(node) {
  const expression = unwrap(node);
  if (expression?.type === "Literal" && typeof expression.value === "string") return expression.value;
  if (expression?.type === "TemplateLiteral" && expression.expressions.length === 0) {
    return expression.quasis[0]?.value.cooked ?? null;
  }
  return null;
}

function platformIdentifier(sourceCode, node, names) {
  const identifier = unwrap(node);
  if (identifier?.type !== "Identifier" || !names.includes(identifier.name)) return false;
  let scope = sourceCode.getScope(identifier);
  while (scope) {
    const variable = scope.set.get(identifier.name);
    if (variable) return variable.defs.length === 0;
    scope = scope.upper;
  }
  return true;
}

function isFetch(sourceCode, node) {
  const callee = resolvedValue(sourceCode, node);
  if (platformIdentifier(sourceCode, callee, ["fetch"])) return true;
  if (callee?.type !== "MemberExpression" || callee.computed || callee.property.name !== "fetch") return false;
  return platformIdentifier(sourceCode, callee.object, ["window", "globalThis"]);
}

function propertyName(node) {
  if (!node.computed && node.key.type === "Identifier") return node.key.name;
  const value = staticString(node.key);
  if (value !== null) return value;
  const key = unwrap(node.key);
  if (key?.type === "Literal" && (typeof key.value === "number" || typeof key.value === "bigint")) return String(key.value);
  return null;
}

function methodFromInit(node, inherited = "GET") {
  if (!node) return inherited;
  const expression = unwrap(node);
  if (expression?.type !== "ObjectExpression") return "unknown";
  let method = inherited;
  for (const property of expression.properties) {
    if (property.type === "SpreadElement") {
      method = methodFromInit(property.argument, method);
    } else if (property.type === "Property") {
      const name = propertyName(property);
      if (name === "method") method = staticString(property.value)?.toUpperCase() ?? "unknown";
      else if (name === null) method = "unknown";
    }
  }
  return method;
}

function methodFromInput(sourceCode, node) {
  const input = unwrap(node);
  if (input?.type !== "NewExpression" || !platformIdentifier(sourceCode, input.callee, ["Request"])) return "GET";
  return methodFromInit(input.arguments[1], methodFromInput(sourceCode, input.arguments[0]));
}

function isGet(sourceCode, node) {
  return methodFromInit(node.arguments[1], methodFromInput(sourceCode, node.arguments[0])) === "GET";
}

function immutableDefinition(sourceCode, identifier) {
  let scope = sourceCode.getScope(identifier);
  while (scope) {
    const variable = scope.set.get(identifier.name);
    if (variable) {
      if (variable.defs.length !== 1
        || variable.references.some((reference) => reference.isWrite() && !reference.init)) return null;
      return variable.defs[0];
    }
    scope = scope.upper;
  }
  return null;
}

function resolvedValue(sourceCode, node, seen = new Set(), depth = 0) {
  const expression = unwrap(node);
  if (expression?.type !== "Identifier" || depth >= 5) return expression;
  const definition = immutableDefinition(sourceCode, expression);
  if (!definition || seen.has(definition) || definition.type !== "Variable"
    || definition.node?.id.type !== "Identifier" || definition.node.parent?.kind !== "const"
    || !definition.node.init) return expression;
  seen.add(definition);
  return resolvedValue(sourceCode, definition.node.init, seen, depth + 1);
}

export const noFetchInClientComponents = {
  meta: {
    type: "problem",
    schema: allowSchema,
    messages: {
      rejected: "Move client reads into the query factories instead of calling fetch from a component or effect; keep fetch for event-handler mutations.",
    },
  },
  create(context) {
    if (allowed(context, clientGetExceptions)) return {};
    return {
      CallExpression(node) {
        if (isFetch(context.sourceCode, node.callee) && isGet(context.sourceCode, node)) context.report({ node, messageId: "rejected" });
      },
    };
  },
};

export const queryKeyFactory = {
  meta: {
    type: "problem",
    schema: allowSchema,
    messages: {
      rejected: "Build query keys with the registered scope factories instead of an inline or aliased key literal.",
    },
  },
  create(context) {
    if (allowed(context, queryKeyExceptions)) return {};
    return {
      Property(node) {
        if (propertyName(node) !== "queryKey") return;
        const value = resolvedValue(context.sourceCode, node.value);
        if (value?.type === "ArrayExpression" || staticString(value) !== null) {
          context.report({ node: node.value, messageId: "rejected" });
        }
      },
    };
  },
};
